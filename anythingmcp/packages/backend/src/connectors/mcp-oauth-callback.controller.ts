import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { McpOAuthService } from './mcp-oauth.service';
import { ConnectorsService } from './connectors.service';
import { McpClientEngine } from './engines/mcp-client.engine';
import { getConnectorMcpPath } from './mcp-path.util';
import { PrismaService } from '../common/prisma.service';
import { McpServerService } from '../mcp-server/mcp-server.service';
import { decrypt } from '../common/crypto/encryption.util';
import { getRequiredSecret } from '../common/secrets.util';

/**
 * Separate controller for the OAuth2 callback — no JWT guard.
 * The remote MCP server redirects the user's browser here after login.
 */
@ApiTags('MCP OAuth')
@Controller('api/mcp-oauth')
export class McpOAuthCallbackController {
  private readonly logger = new Logger(McpOAuthCallbackController.name);
  private readonly encryptionKey: string;

  constructor(
    private readonly mcpOAuthService: McpOAuthService,
    private readonly connectorsService: ConnectorsService,
    private readonly mcpClientEngine: McpClientEngine,
    private readonly prisma: PrismaService,
    private readonly mcpServer: McpServerService,
    private readonly configService: ConfigService,
  ) {
    this.encryptionKey = getRequiredSecret(
      'ENCRYPTION_KEY',
      this.configService.get<string>('ENCRYPTION_KEY'),
    );
  }

  @Get('callback')
  @ApiOperation({
    summary: 'OAuth2 callback handler for MCP connector authorization',
    description:
      'Handles the redirect from a remote MCP server after user authorization. ' +
      'Exchanges the auth code for tokens and auto-discovers MCP tools.',
  })
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    if (!code || !state) {
      return res.redirect(
        `${frontendUrl}/connectors?error=${encodeURIComponent('Missing code or state in OAuth callback')}`,
      );
    }

    const flow = this.mcpOAuthService.getPendingFlow(state);
    if (!flow) {
      this.logger.warn(`OAuth callback with unknown state: ${state}`);
      return res.redirect(
        `${frontendUrl}/connectors?error=${encodeURIComponent('OAuth session expired or invalid state')}`,
      );
    }

    try {
      // 1. Exchange auth code for tokens
      const tokens = await this.mcpOAuthService.exchangeCodeForTokens({
        tokenUrl: flow.tokenUrl,
        code,
        redirectUri: flow.redirectUri,
        clientId: flow.clientId,
        clientSecret: flow.clientSecret,
        codeVerifier: flow.codeVerifier,
      });

      this.logger.log(
        `OAuth tokens obtained for connector ${flow.connectorId}`,
      );

      // 2. Store tokens (encrypted) — merge so clientId/scopes survive refresh
      const existingConnector = await this.connectorsService.findByIdInternal(
        flow.connectorId,
      );
      const existingAuth = existingConnector.authConfig
        ? JSON.parse(
            decrypt(existingConnector.authConfig, this.encryptionKey),
          )
        : {};

      await this.connectorsService.update(flow.connectorId, {
        authConfig: {
          ...existingAuth,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? existingAuth.refreshToken,
          tokenUrl: flow.tokenUrl,
          clientId: flow.clientId,
          clientSecret: flow.clientSecret,
          expiresIn: tokens.expiresIn,
          expiresAt: Date.now() + (tokens.expiresIn || 3600) * 1000,
          authorizedAt: new Date().toISOString(),
        },
      });

      // 3. Reload the in-memory MCP tool registry so REST/GraphQL OAuth
      // connectors pick up the new accessToken immediately. Without this,
      // tools keep the pre-authorize authConfig (no Bearer) until restart —
      // the dashboard "Test" path reads fresh from the DB, which is why UI
      // works while MCP calls return Guava's missing-Bearer 401.
      await this.mcpServer.reloadConnectorTools(flow.connectorId);

      // 4. Auto-discover tools from remote MCP servers only (REST adapters
      // already imported their tools from the catalog).
      let toolsImported = 0;
      try {
        const connector = await this.connectorsService.findByIdInternal(
          flow.connectorId,
        );

        if (connector.type === 'MCP') {
          const mcpPath = getConnectorMcpPath(connector);

          const remoteTools = await this.mcpClientEngine.listTools({
            baseUrl: connector.baseUrl,
            authType: 'OAUTH2',
            authConfig: {
              accessToken: tokens.accessToken,
            },
            headers: connector.headers as Record<string, string>,
            mcpPath,
          });

          for (const rt of remoteTools) {
            try {
              await this.prisma.mcpTool.create({
                data: {
                  connectorId: flow.connectorId,
                  name: rt.name,
                  description: rt.description || `MCP tool: ${rt.name}`,
                  parameters: rt.inputSchema as any,
                  endpointMapping: {
                    method: rt.name,
                    path: mcpPath,
                  } as any,
                },
              });
              toolsImported++;
            } catch (err: any) {
              // Skip duplicates
              if (err.code !== 'P2002') {
                this.logger.warn(
                  `Failed to import tool ${rt.name}: ${err.message}`,
                );
              }
            }
          }

          if (toolsImported > 0) {
            await this.mcpServer.reloadConnectorTools(flow.connectorId);
          }

          this.logger.log(
            `Auto-discovered ${toolsImported} tools for connector ${flow.connectorId}`,
          );
        }
      } catch (discoverErr: any) {
        this.logger.warn(
          `Tool discovery failed after OAuth (will proceed anyway): ${discoverErr.message}`,
        );
      }

      // 5. Clean up
      this.mcpOAuthService.deletePendingFlow(state);

      // 6. Redirect to frontend
      return res.redirect(
        `${frontendUrl}/connectors/${flow.connectorId}?oauth=success&tools=${toolsImported}`,
      );
    } catch (error: any) {
      this.logger.error(
        `OAuth callback failed for connector ${flow.connectorId}: ${error.message}`,
      );
      this.mcpOAuthService.deletePendingFlow(state);
      return res.redirect(
        `${frontendUrl}/connectors/${flow.connectorId}?oauth=error&message=${encodeURIComponent(error.message)}`,
      );
    }
  }
}
