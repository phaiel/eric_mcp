import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../../common/prisma.service';
import { encrypt, decrypt } from '../../common/crypto/encryption.util';
import { getRequiredSecret } from '../../common/secrets.util';
import { assertSafeOutboundUrl } from '../../common/ssrf.util';
import { ToolRegistry } from '../../mcp-server/tool-registry';

/** Refresh tokens that expire within this window (5 minutes). */
const PROACTIVE_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Shared OAuth2 token management: in-memory cache, proactive refresh, and DB persistence.
 * Used by RestEngine, GraphqlEngine, and McpClientEngine to handle OAuth2 token lifecycle.
 *
 * Proactive refresh: tokens are refreshed *before* they expire so callers never see a 401
 * due to token expiration.
 */
@Injectable()
export class OAuth2TokenService {
  private readonly logger = new Logger(OAuth2TokenService.name);
  private readonly encryptionKey: string;

  // In-memory cache for refreshed tokens (keyed by connectorId or tokenUrl)
  private tokenCache = new Map<
    string,
    { accessToken: string; expiresAt: number }
  >();

  // Per-key mutex to prevent concurrent refresh storms
  private refreshInFlight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Optional() private readonly toolRegistry?: ToolRegistry,
  ) {
    this.encryptionKey = getRequiredSecret(
      'ENCRYPTION_KEY',
      this.configService.get<string>('ENCRYPTION_KEY'),
    );
  }

  /**
   * Returns the best available access token, refreshing proactively if needed.
   *
   * 1. Cached token still valid (> 5 min remaining) → return immediately
   * 2. Token expired or near-expiry AND refreshToken available → refresh first, then return
   * 3. Refresh fails → fall back to stored token (caller's 401 retry will catch it)
   */
  async getAccessToken(
    authConfig: Record<string, unknown>,
    connectorId?: string,
  ): Promise<string> {
    const cacheKey = connectorId || String(authConfig.tokenUrl || '');
    const grant = String(authConfig.grant || 'refresh_token');

    // 1. Check cache — return immediately if well within validity
    if (cacheKey) {
      const cached = this.tokenCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now() + PROACTIVE_REFRESH_BUFFER_MS) {
        return cached.accessToken;
      }
    }

    // Prefer DB tokens when refreshing — MCP tools keep a stale authConfig
    // snapshot in memory, and providers that rotate refresh tokens (Guava)
    // reject the old one with 400 invalid_grant.
    const effectiveAuth = await this.hydrateAuthConfigFromDb(
      authConfig,
      connectorId,
    );

    // 2. Determine if proactive refresh is possible and needed.
    // client_credentials needs only tokenUrl + clientId/Secret; refresh_token
    // also needs a stored refreshToken.
    const hasRefreshCapability =
      grant === 'client_credentials'
        ? !!(
            effectiveAuth.tokenUrl &&
            effectiveAuth.clientId &&
            effectiveAuth.clientSecret
          )
        : !!(effectiveAuth.refreshToken && effectiveAuth.tokenUrl);
    const tokenNearExpiry = this.isTokenNearExpiry(effectiveAuth, cacheKey);

    if (hasRefreshCapability && tokenNearExpiry) {
      this.logger.debug(`OAuth2 (${grant}): token near expiry, proactive refresh...`);
      const refreshed = await this.refreshTokenWithMutex(
        effectiveAuth,
        connectorId,
      );
      if (refreshed) {
        return refreshed;
      }
    }
    // Refresh failed — fall through to return stored token

    // 3. Return the best available token (cached or stored)
    if (cacheKey) {
      const cached = this.tokenCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.accessToken;
      }
    }

    return String(effectiveAuth.accessToken || '');
  }

  /**
   * Refresh the OAuth2 access token using the refresh token.
   * On success: caches in-memory and persists to DB.
   * Returns the new access token, or null on failure.
   */
  async refreshToken(
    authConfig: Record<string, unknown>,
    connectorId?: string,
  ): Promise<string | null> {
    // Always refresh against the latest DB tokens when we have a connectorId.
    const effectiveAuth = await this.hydrateAuthConfigFromDb(
      authConfig,
      connectorId,
    );

    const tokenUrl = String(effectiveAuth.tokenUrl || '');
    const grant = String(effectiveAuth.grant || 'refresh_token');
    const refreshToken = String(effectiveAuth.refreshToken || '');
    const clientId = effectiveAuth.clientId
      ? String(effectiveAuth.clientId)
      : undefined;
    const clientSecret = effectiveAuth.clientSecret
      ? String(effectiveAuth.clientSecret)
      : undefined;
    const scope = effectiveAuth.scope
      ? String(effectiveAuth.scope)
      : effectiveAuth.scopes
        ? String(effectiveAuth.scopes)
        : undefined;

    if (!tokenUrl) {
      this.logger.warn('OAuth2 refresh: missing tokenUrl');
      return null;
    }

    if (grant === 'client_credentials') {
      // SAP S/4HANA Cloud Public Edition and most service-to-service OAuth2
      // servers reject client_id/client_secret in the body — they MUST be
      // sent via HTTP Basic Authorization header (RFC 6749 §2.3.1). We rely
      // on the Basic header path and keep the body to grant_type + scope.
      if (!clientId || !clientSecret) {
        this.logger.warn(
          'OAuth2 client_credentials: missing clientId/clientSecret',
        );
        return null;
      }
    } else if (!refreshToken) {
      this.logger.warn('OAuth2 refresh: missing refreshToken');
      return null;
    }

    try {
      let body: Record<string, string>;
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      if (grant === 'client_credentials') {
        body = { grant_type: 'client_credentials' };
        if (scope) body.scope = scope;
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
          'base64',
        );
        headers.Authorization = `Basic ${basic}`;
      } else {
        // Guava (and OAuth 2.1 confidential clients) require client_secret_post
        // OR Basic — never both. We use form fields only.
        body = {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        };
        if (clientId) body.client_id = clientId;
        if (clientSecret) body.client_secret = clientSecret;
      }

      await assertSafeOutboundUrl(tokenUrl);
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams(body).toString(),
        {
          headers,
          timeout: 10000,
        },
      );

      const { access_token, expires_in, refresh_token: newRefreshToken } =
        response.data;
      if (!access_token) return null;

      // Cache the new token
      const expiresInMs = (expires_in || 3600) * 1000;
      const cacheKey = connectorId || tokenUrl;
      this.tokenCache.set(cacheKey, {
        accessToken: access_token,
        expiresAt: Date.now() + expiresInMs,
      });

      // Persist to DB if connectorId is available. For client_credentials
      // there's no refresh_token to store — we just record the latest
      // access_token + its expiry so a cold-start can reuse it briefly.
      // Always prefer the rotated refresh_token when the provider returns one
      // (Guava rotates on every refresh; reusing the old one → invalid_grant).
      if (connectorId) {
        await this.persistRefreshedToken(
          connectorId,
          access_token,
          newRefreshToken || refreshToken || '',
          Date.now() + expiresInMs,
        );
      }

      // Keep the caller's authConfig object current for same-request 401 retries
      authConfig.accessToken = access_token;
      if (newRefreshToken) authConfig.refreshToken = newRefreshToken;
      authConfig.expiresAt = Date.now() + expiresInMs;

      this.logger.debug(`OAuth2 (${grant}): token refreshed successfully`);
      return access_token;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      this.logger.warn(
        `OAuth2 (${grant}) token refresh failed: ${err.message}` +
          (status ? ` status=${status}` : '') +
          (body ? ` body=${JSON.stringify(body).slice(0, 300)}` : '') +
          (connectorId ? ` connector=${connectorId}` : ''),
      );
      return null;
    }
  }

  /**
   * Merge the latest tokens from the DB into the (possibly stale) in-memory
   * authConfig snapshot used by MCP tools.
   */
  private async hydrateAuthConfigFromDb(
    authConfig: Record<string, unknown>,
    connectorId?: string,
  ): Promise<Record<string, unknown>> {
    if (!connectorId) return authConfig;
    try {
      const connector = await this.prisma.connector.findUnique({
        where: { id: connectorId },
        select: { authConfig: true },
      });
      if (!connector?.authConfig) return authConfig;
      const stored = JSON.parse(
        decrypt(connector.authConfig, this.encryptionKey),
      ) as Record<string, unknown>;
      return {
        ...authConfig,
        accessToken: stored.accessToken ?? authConfig.accessToken,
        refreshToken: stored.refreshToken ?? authConfig.refreshToken,
        expiresAt: stored.expiresAt ?? authConfig.expiresAt,
        tokenUrl: stored.tokenUrl ?? authConfig.tokenUrl,
        clientId: stored.clientId ?? authConfig.clientId,
        clientSecret: stored.clientSecret ?? authConfig.clientSecret,
        scopes: stored.scopes ?? authConfig.scopes,
        scope: stored.scope ?? authConfig.scope,
      };
    } catch (err: any) {
      this.logger.warn(
        `OAuth2: failed to hydrate authConfig from DB: ${err.message}`,
      );
      return authConfig;
    }
  }

  /**
   * Wraps refreshToken with a per-key mutex to prevent concurrent refresh storms.
   */
  private async refreshTokenWithMutex(
    authConfig: Record<string, unknown>,
    connectorId?: string,
  ): Promise<string | null> {
    const cacheKey = connectorId || String(authConfig.tokenUrl || '');

    // If a refresh is already in-flight for this key, wait for it
    const inFlight = this.refreshInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const refreshPromise = this.refreshToken(authConfig, connectorId).finally(
      () => {
        this.refreshInFlight.delete(cacheKey);
      },
    );

    this.refreshInFlight.set(cacheKey, refreshPromise);
    return refreshPromise;
  }

  /**
   * Check if the token is expired or near-expiry.
   */
  private isTokenNearExpiry(
    authConfig: Record<string, unknown>,
    cacheKey: string,
  ): boolean {
    const now = Date.now();

    // Check cached token first
    if (cacheKey) {
      const cached = this.tokenCache.get(cacheKey);
      if (cached) {
        return cached.expiresAt <= now + PROACTIVE_REFRESH_BUFFER_MS;
      }
    }

    // Check expiresAt from authConfig (set during initial OAuth grant or previous refresh)
    if (authConfig.expiresAt) {
      const expiresAt = Number(authConfig.expiresAt);
      return expiresAt <= now + PROACTIVE_REFRESH_BUFFER_MS;
    }

    // No expiry info — assume token may be stale, try proactive refresh
    return true;
  }

  /**
   * Update the connector's encrypted authConfig with the new access token
   * so it survives server restarts.
   */
  private async persistRefreshedToken(
    connectorId: string,
    newAccessToken: string,
    newRefreshToken: string,
    expiresAt: number,
  ): Promise<void> {
    try {
      const connector = await this.prisma.connector.findUnique({
        where: { id: connectorId },
        select: { authConfig: true },
      });

      if (!connector?.authConfig) return;

      const authConfig = JSON.parse(
        decrypt(connector.authConfig, this.encryptionKey),
      );
      authConfig.accessToken = newAccessToken;
      authConfig.refreshToken = newRefreshToken;
      authConfig.expiresAt = expiresAt;
      authConfig.lastRefreshedAt = new Date().toISOString();

      const encrypted = encrypt(JSON.stringify(authConfig), this.encryptionKey);

      await this.prisma.connector.update({
        where: { id: connectorId },
        data: { authConfig: encrypted },
      });

      // Keep MCP tool registry in sync so the next call doesn't re-parse a
      // stale refresh token from the in-memory snapshot.
      this.toolRegistry?.updateConnectorAuthConfig(
        connectorId,
        JSON.stringify(authConfig),
      );

      this.logger.debug(
        `OAuth2: persisted refreshed token for connector ${connectorId}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `OAuth2: failed to persist refreshed token: ${err.message}`,
      );
    }
  }
}
