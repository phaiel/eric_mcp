#!/usr/bin/env node
/**
 * Google Workspace via GA REST APIs (Calendar/Gmail/Drive/Chat) — one
 * connector, one OAuth. Replaces the preview-gated Workspace MCP bridge.
 *
 * Steps: delete old "Google Workspace" MCP connector → import the
 * google-workspace-apis adapter → assign to MCP server → print OAuth URL.
 *
 * Render env: GOOGLE_WORKSPACE_CLIENT_ID, GOOGLE_WORKSPACE_CLIENT_SECRET
 *
 * Usage: node scripts/setup-google-workspace-apis.mjs [--wait-deploy]
 */
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

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
const ADAPTER_SLUG = 'google-workspace-apis';
const CONNECTOR_NAME = 'Google Workspace APIs';

const waitDeploy = process.argv.includes('--wait-deploy');

function renderApiKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY;
  const cliPath = path.join(process.env.HOME || '', '.render', 'cli.yaml');
  if (!existsSync(cliPath)) return null;
  return readFileSync(cliPath, 'utf8').match(/key:\s*(rnd_\S+)/)?.[1] ?? null;
}

async function renderEnv(name) {
  const key = renderApiKey();
  if (!key) return null;
  const res = await fetch(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars/${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return null;
  return (await res.json()).value;
}

async function renderDeploy() {
  const key = renderApiKey();
  const res = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
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

async function main() {
  const clientId =
    GOOGLE_WORKSPACE_CLIENT_ID || (await renderEnv('GOOGLE_WORKSPACE_CLIENT_ID'));
  const clientSecret =
    GOOGLE_WORKSPACE_CLIENT_SECRET || (await renderEnv('GOOGLE_WORKSPACE_CLIENT_SECRET'));
  if (!clientId || !clientSecret) {
    console.error('Missing GOOGLE_WORKSPACE_CLIENT_ID / GOOGLE_WORKSPACE_CLIENT_SECRET.');
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

  // Remove the preview-gated Workspace MCP bridge if present.
  const oldMcp = connectors.find((c) => c.name === 'Google Workspace' && c.type === 'MCP');
  if (oldMcp) {
    await amcpRequest(token, 'DELETE', `/api/connectors/${oldMcp.id}`);
    console.log('Deleted old Workspace MCP connector', oldMcp.id);
  }

  let connector = connectors.find((c) => c.name === CONNECTOR_NAME);
  if (connector && process.argv.includes('--reimport')) {
    await amcpRequest(token, 'DELETE', `/api/connectors/${connector.id}`);
    console.log('Deleted existing connector for re-import', connector.id);
    connector = undefined;
  }
  if (!connector) {
    const imported = await amcpRequest(token, 'POST', `/api/adapters/${ADAPTER_SLUG}/import`, {
      credentials: {
        GOOGLE_WORKSPACE_CLIENT_ID: clientId,
        GOOGLE_WORKSPACE_CLIENT_SECRET: clientSecret,
      },
    });
    connector = { id: imported.connectorId };
    console.log(
      `Imported ${ADAPTER_SLUG} → connector ${connector.id} (${imported.toolsCreated} tools)`,
    );
  } else {
    console.log('Connector already exists:', connector.id);
  }

  const notionId = connectors.find((c) => c.name === 'Notion' && c.type === 'MCP')?.id;
  const connectorIds = [HEVY_CONNECTOR_ID, notionId, connector.id].filter(Boolean);
  await amcpRequest(token, 'PUT', `/api/mcp-servers/${AMCP_SERVER_ID}/connectors`, {
    connectorIds,
  });
  console.log('Assigned to MCP server:', connectorIds.join(', '));

  const oauth = await amcpRequest(
    token,
    'POST',
    `/api/connectors/${connector.id}/oauth/authorize`,
  );
  if (oauth.error) throw new Error(oauth.error);

  console.log('\n--- Open this URL to authorize Google (Calendar/Gmail/Drive/Chat) ---\n');
  console.log(oauth.authorizationUrl);
  console.log('\nAfter approving, test with gcal_list_calendars or gmail_search_messages.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
