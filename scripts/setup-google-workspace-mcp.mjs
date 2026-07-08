#!/usr/bin/env node
/**
 * Google Workspace Universal Search MCP bridge on Personal OS AnythingMCP.
 *
 * Google's hosted endpoint (no Cloud Run): workspacemcp.googleapis.com/mcp/v1
 *
 * Render env (or local):
 *   GOOGLE_WORKSPACE_CLIENT_ID
 *   GOOGLE_WORKSPACE_CLIENT_SECRET
 *
 * Usage:
 *   node scripts/setup-google-workspace-mcp.mjs
 *   node scripts/setup-google-workspace-mcp.mjs --wait-deploy
 */
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_MCP_BASE = 'https://workspacemcp.googleapis.com';
const WORKSPACE_MCP_PATH = '/mcp/v1';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
].join(' ');

const {
  AMCP_BASE_URL = 'https://personal-os-mcp.onrender.com',
  AMCP_SERVER_ID = 'cmrbfay0e00032eh39ymrpfw7',
  HEVY_CONNECTOR_ID = 'cmrbfd4jv00082eh3t667r77h',
  RENDER_SERVICE_ID = 'srv-d96qkv7aqgkc73c9tjv0',
  GOOGLE_WORKSPACE_CLIENT_ID = '',
  GOOGLE_WORKSPACE_CLIENT_SECRET = '',
} = process.env;

const DEFAULT_USER_ID = 'cmrbfaxxg00012eh34jfgltsj';
const DEFAULT_ORG_ID = 'cmrbfawp600002eh31o2ckkdj';
const DEFAULT_EMAIL = 'phaiel@gmail.com';

const waitDeploy = process.argv.includes('--wait-deploy');
const CONNECTOR_NAME = 'Google Workspace';

async function renderApiKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY;
  const cliPath = path.join(process.env.HOME || '', '.render', 'cli.yaml');
  if (!existsSync(cliPath)) return null;
  return readFileSync(cliPath, 'utf8').match(/key:\s*(rnd_\S+)/)?.[1] ?? null;
}

async function renderEnv(name) {
  const key = await renderApiKey();
  if (!key) return null;
  const res = await fetch(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars/${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return null;
  const json = await res.json();
  return (json.envVar ?? json).value;
}

async function renderDeploy() {
  const apiKey = await renderApiKey();
  const res = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  if (!res.ok) throw new Error(`Render deploy failed: ${res.status} ${await res.text()}`);
}

async function waitForHealthy(timeoutMs = 900000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${AMCP_BASE_URL}/health`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return;
    } catch {
      /* cold start */
    }
    console.log('health: waiting...');
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('Timed out waiting for Render health');
}

function signJwt(secret) {
  const b64url = (s) => Buffer.from(s).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: DEFAULT_USER_ID,
      email: DEFAULT_EMAIL,
      role: 'ADMIN',
      organizationId: DEFAULT_ORG_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function amcpRequest(token, method, route, body) {
  const res = await fetch(`${AMCP_BASE_URL}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  if (!res.ok) {
    throw new Error(`${method} ${route} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function connectorPayload(clientId, clientSecret) {
  return {
    name: CONNECTOR_NAME,
    type: 'MCP',
    baseUrl: WORKSPACE_MCP_BASE,
    authType: 'OAUTH2',
    authConfig: {
      clientId,
      clientSecret,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: SCOPES,
      authorizationParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
    config: { mcpPath: WORKSPACE_MCP_PATH },
    instructions:
      "Google Workspace Universal Search MCP (hosted by Google). Tool: search_corpus — cross-product search across Gmail, Drive, Calendar, and Chat. Read-only. OAuth must include scopes for each product you want searched.",
  };
}

async function main() {
  const clientId =
    GOOGLE_WORKSPACE_CLIENT_ID ||
    (await renderEnv('GOOGLE_WORKSPACE_CLIENT_ID')) ||
    (await renderEnv('OOGLE_WORKSPACE_CLIENT_ID'));
  const clientSecret =
    GOOGLE_WORKSPACE_CLIENT_SECRET || (await renderEnv('GOOGLE_WORKSPACE_CLIENT_SECRET'));

  if (!clientId || !clientSecret) {
    console.error('Missing GOOGLE_WORKSPACE_CLIENT_ID or GOOGLE_WORKSPACE_CLIENT_SECRET on Render/local.');
    process.exit(1);
  }

  const jwtSecret = (await renderEnv('JWT_SECRET')) || process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET not found');

  if (waitDeploy) {
    console.log('Triggering Render deploy...');
    await renderDeploy();
    await waitForHealthy();
  }

  const token = signJwt(jwtSecret);
  const connectors = await amcpRequest(token, 'GET', '/api/connectors');
  let connector = connectors.find((c) => c.name === CONNECTOR_NAME && c.type === 'MCP');

  const payload = connectorPayload(clientId, clientSecret);

  if (!connector) {
    connector = await amcpRequest(token, 'POST', '/api/connectors', payload);
    console.log('Created connector', connector.id);
  } else {
    const { type: _type, authConfig: _auth, ...updatePayload } = payload;
    connector = await amcpRequest(token, 'PUT', `/api/connectors/${connector.id}`, updatePayload);
    console.log('Updated connector', connector.id, '(preserved OAuth tokens)');
  }

  const notionId = connectors.find((c) => c.name === 'Notion' && c.type === 'MCP')?.id;
  const connectorIds = [HEVY_CONNECTOR_ID, notionId, connector.id].filter(Boolean);
  await amcpRequest(token, 'PUT', `/api/mcp-servers/${AMCP_SERVER_ID}/connectors`, {
    connectorIds,
  });
  console.log('Assigned to MCP server:', connectorIds.join(', '));

  // Clear strict upstream output schemas and reload tool registry
  const discovered = await amcpRequest(
    token,
    'POST',
    `/api/connectors/${connector.id}/discover-tools`,
  );
  if (!discovered.error) {
    console.log('Refreshed tools (outputSchema stripped for MCP bridge)');
  }

  const MCP_KEY = await renderEnv('MCP_API_KEY');
  if (MCP_KEY) {
    const probe = await fetch(`${AMCP_BASE}/mcp/${AMCP_SERVER_ID}`, {
      method: 'POST',
      headers: {
        'X-API-Key': MCP_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_corpus', arguments: { query: 'calendar tomorrow' } },
      }),
    });
    const probeText = await probe.text();
    if (probeText.includes('unregistered callers') || probeText.includes('does not have permission')) {
      console.log('\nOAuth token missing or stale — authorization required.\n');
    } else if (!probeText.includes('isError":true') && !probeText.includes('Output validation error')) {
      console.log('\nsearch_corpus probe: OK');
      console.log(probeText.slice(0, 400));
      return;
    } else {
      console.log('\nsearch_corpus probe failed (may need deploy):');
      console.log(probeText.slice(0, 500));
    }
  }

  const oauth = await amcpRequest(
    token,
    'POST',
    `/api/connectors/${connector.id}/oauth/authorize`,
  );
  if (oauth.error) throw new Error(oauth.error);

  console.log('\n--- Open this URL to authorize Google Workspace MCP ---\n');
  console.log(oauth.authorizationUrl);
  console.log('\nAfter approving, tools auto-import on callback. Re-run this script to verify.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
