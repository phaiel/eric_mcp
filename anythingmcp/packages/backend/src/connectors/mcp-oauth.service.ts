import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import axios from 'axios';
import { assertSafeOutboundUrl } from '../common/ssrf.util';

interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

interface PendingOAuthFlow {
  codeVerifier: string;
  connectorId: string;
  userId: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  tokenUrl: string;
  createdAt: number;
}

@Injectable()
export class McpOAuthService {
  private readonly logger = new Logger(McpOAuthService.name);

  // In-memory store for pending OAuth flows, keyed by state.
  // Entries auto-expire after 10 minutes.
  private pendingFlows = new Map<string, PendingOAuthFlow>();

  /**
   * Fetch OAuth Authorization Server Metadata (RFC 8414)
   * from a remote MCP server's .well-known endpoint.
   *
   * If the metadata contains endpoint URLs with a different origin than the
   * actual server (common misconfiguration), they are rebased automatically.
   */
  async discoverMetadata(baseUrl: string): Promise<OAuthMetadata> {
    const actualOrigin = new URL(baseUrl).origin;

    // Try the standard well-known path
    const metadataUrl = new URL(
      '/.well-known/oauth-authorization-server',
      baseUrl,
    ).toString();

    this.logger.debug(`Discovering OAuth metadata from ${metadataUrl}`);

    await assertSafeOutboundUrl(metadataUrl);
    const response = await axios.get(metadataUrl, { timeout: 10000 });
    const metadata: OAuthMetadata = response.data;

    // Rebase endpoint URLs if the remote server reports a different origin
    // (e.g. the server's OAUTH_SERVER_URL env var is misconfigured).
    const rebase = (endpoint: string): string => {
      try {
        const parsed = new URL(endpoint);
        if (parsed.origin !== actualOrigin) {
          this.logger.warn(
            `Rebasing OAuth endpoint from ${parsed.origin} → ${actualOrigin} (${parsed.pathname})`,
          );
          return `${actualOrigin}${parsed.pathname}${parsed.search}`;
        }
        return endpoint;
      } catch {
        return endpoint;
      }
    };

    metadata.issuer = rebase(metadata.issuer);
    metadata.authorization_endpoint = rebase(metadata.authorization_endpoint);
    metadata.token_endpoint = rebase(metadata.token_endpoint);
    if (metadata.registration_endpoint) {
      metadata.registration_endpoint = rebase(metadata.registration_endpoint);
    }

    return metadata;
  }

  /**
   * Register as an OAuth client via RFC 7591 Dynamic Client Registration.
   */
  async registerClient(
    registrationEndpoint: string,
    callbackUrl: string,
  ): Promise<{ clientId: string; clientSecret?: string }> {
    this.logger.debug(
      `Registering OAuth client at ${registrationEndpoint}`,
    );

    await assertSafeOutboundUrl(registrationEndpoint);
    const response = await axios.post(
      registrationEndpoint,
      {
        client_name: 'AnythingMCP Bridge',
        redirect_uris: [callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      },
      { timeout: 10000 },
    );

    const clientId = response.data?.client_id;
    if (!clientId) {
      throw new Error(
        'Dynamic client registration failed: server did not return a client_id',
      );
    }

    return {
      clientId,
      clientSecret: response.data.client_secret,
    };
  }

  /**
   * Build the authorization URL with PKCE S256 challenge.
   */
  buildAuthorizationUrl(params: {
    authorizationEndpoint: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scope?: string;
    extraParams?: Record<string, string>;
  }): string {
    const url = new URL(params.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', params.state);
    if (params.scope) {
      url.searchParams.set('scope', params.scope);
    }
    if (params.extraParams) {
      for (const [key, value] of Object.entries(params.extraParams)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  /**
   * OAuth 2.1 Pushed Authorization Request (RFC 9126).
   *
   * Some servers (e.g. Guava) require the authorization request to be pushed
   * server-to-server BEFORE the front-channel redirect: the client POSTs all
   * the authorization parameters to a PAR endpoint and receives a one-shot
   * `request_uri`. The user is then redirected to the authorization endpoint
   * with only `client_id` + `request_uri` — no scope/redirect_uri/challenge in
   * the browser URL. Client authentication uses client_secret_post (form
   * fields), matching exchangeCodeForTokens, so we never send Basic + body
   * together (which such servers reject).
   */
  async pushAuthorizationRequest(params: {
    parUrl: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scope?: string;
    extraParams?: Record<string, string>;
  }): Promise<string> {
    const body: Record<string, string> = {
      response_type: 'code',
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      state: params.state,
    };
    if (params.clientSecret) body.client_secret = params.clientSecret;
    if (params.scope) body.scope = params.scope;
    if (params.extraParams) {
      for (const [key, value] of Object.entries(params.extraParams)) {
        body[key] = value;
      }
    }

    this.logger.debug(`Pushing authorization request to ${params.parUrl}`);

    await assertSafeOutboundUrl(params.parUrl);
    const response = await axios.post(
      params.parUrl,
      new URLSearchParams(body).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
    );

    const data = response.data;
    if (data?.error) {
      throw new Error(
        `Pushed authorization request failed: ${data.error} — ${data.error_description || ''}`,
      );
    }
    if (!data?.request_uri) {
      throw new Error(
        'Pushed authorization request returned no request_uri',
      );
    }
    return String(data.request_uri);
  }

  /**
   * Build the front-channel authorization URL for a PAR flow: only `client_id`
   * and the `request_uri` returned by pushAuthorizationRequest go in the URL.
   */
  buildAuthorizationUrlWithRequestUri(params: {
    authorizationEndpoint: string;
    clientId: string;
    requestUri: string;
  }): string {
    const url = new URL(params.authorizationEndpoint);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('request_uri', params.requestUri);
    return url.toString();
  }

  /**
   * Exchange an authorization code for tokens (with PKCE verifier).
   */
  async exchangeCodeForTokens(params: {
    tokenUrl: string;
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret?: string;
    codeVerifier: string;
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.codeVerifier,
    };
    if (params.clientSecret) {
      body.client_secret = params.clientSecret;
    }

    this.logger.debug(`Exchanging auth code at ${params.tokenUrl}`);

    await assertSafeOutboundUrl(params.tokenUrl);
    const response = await axios.post(
      params.tokenUrl,
      new URLSearchParams(body).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        timeout: 10000,
      },
    );

    const data = response.data;
    if (data.error) {
      throw new Error(`Token exchange failed: ${data.error} — ${data.error_description || ''}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  // --- PKCE Helpers ---

  generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  generateState(): string {
    return randomBytes(16).toString('hex');
  }

  // --- Pending Flow Storage ---

  storePendingFlow(state: string, data: PendingOAuthFlow): void {
    // Clean up expired entries (>10 min)
    const now = Date.now();
    for (const [key, flow] of this.pendingFlows) {
      if (now - flow.createdAt > 10 * 60 * 1000) {
        this.pendingFlows.delete(key);
      }
    }

    this.pendingFlows.set(state, data);
  }

  getPendingFlow(state: string): PendingOAuthFlow | undefined {
    const flow = this.pendingFlows.get(state);
    if (!flow) return undefined;

    // Check expiry
    if (Date.now() - flow.createdAt > 10 * 60 * 1000) {
      this.pendingFlows.delete(state);
      return undefined;
    }

    return flow;
  }

  deletePendingFlow(state: string): void {
    this.pendingFlows.delete(state);
  }
}
