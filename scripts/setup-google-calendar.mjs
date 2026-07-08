#!/usr/bin/env node
/**
 * Import Google Calendar adapter on Personal OS AnythingMCP and assign to MCP server.
 *
 * Requires (env or flags):
 *   GOOGLE_CALENDAR_CLIENT_ID
 *   GOOGLE_CALENDAR_CLIENT_SECRET
 *
 * After import, open the printed authorizationUrl in a browser to complete OAuth.
 *
 * Usage:
 *   node scripts/setup-google-calendar.mjs
 *   node scripts/setup-google-calendar.mjs --wait-deploy   # trigger Render deploy first
 */
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const {
  AMCP_BASE_URL = 'https://personal-os-mcp.onrender.com',
  AMCP_SERVER_ID = 'cmrbfay0e00032eh39ymrpfw7',
  HEVY_CONNECTOR_ID = 'cmrbfd4jv00082eh3t667r77h',
  NOTION_CONNECTOR_ID = process.env.NOTION_CONNECTOR_ID || '',
  RENDER_SERVICE_ID = 'srv-d96qkv7aqgkc73c9tjv0',
  GOOGLE_CALENDAR_CLIENT_ID = '',
  GOOGLE_CALENDAR_CLIENT_SECRET = '',
} = process.env;

const DEFAULT_USER_ID = 'cmrbfaxxg00012eh34jfgltsj';
const DEFAULT_ORG_ID = 'cmrbfawp600002eh31o2ckkdj';
const DEFAULT_EMAIL = 'phaiel@gmail.com';

const waitDeploy = process.argv.includes('--wait-deploy');

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

async function renderApiKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY;
  const cliPath = path.join(process.env.HOME || '', '.render', 'cli.yaml');
  if (!existsSync(cliPath)) return null;
  return readFileSync(cliPath, 'utf8').match(/key:\s*(rnd_\S+)/)?.[1] ?? null;
}

async function renderEnv(name) {
  const key = await renderApiKey();
  if (!key) return null;
  const res = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars/${name}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
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
  const json = await res.json();
  return json.id ?? json.deploy?.id;
}

async function waitForHealthy(timeoutMs = 900000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${AMCP_BASE_URL}/health`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        console.log('health: ok');
        return;
      }
    } catch {
      /* cold start */
    }
    console.log('health: waiting...');
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('Timed out waiting for Render health');
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
  const clientId = GOOGLE_CALENDAR_CLIENT_ID || (await renderEnv('GOOGLE_CALENDAR_CLIENT_ID'));
  const clientSecret =
    GOOGLE_CALENDAR_CLIENT_SECRET || (await renderEnv('GOOGLE_CALENDAR_CLIENT_SECRET'));

  if (!clientId || !clientSecret) {
    console.error(
      'Missing GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET.\n' +
        'Create a Google Cloud OAuth Web client (see docs/google-calendar-setup.md),\n' +
        'then set env vars locally or on Render and re-run.',
    );
    process.exit(1);
  }

  const jwtSecret = (await renderEnv('JWT_SECRET')) || process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET not found (set locally or on Render)');
  }

  if (waitDeploy) {
    console.log('Triggering Render deploy (adapter must be on server)...');
    await renderDeploy();
    await waitForHealthy();
  }

  const amcpToken = signJwt(jwtSecret);
  const connectors = await amcpRequest(amcpToken, 'GET', '/api/connectors');
  let connector = connectors.find((c) => c.name === 'Google Calendar');

  if (!connector) {
    const imported = await amcpRequest(amcpToken, 'POST', '/api/adapters/google-calendar/import', {
      GOOGLE_CALENDAR_CLIENT_ID: clientId,
      GOOGLE_CALENDAR_CLIENT_SECRET: clientSecret,
    });
    connector = { id: imported.connectorId };
    console.log(`Imported Google Calendar adapter → connector ${connector.id} (${imported.toolsCreated} tools)`);
  } else {
    console.log(`Google Calendar connector already exists: ${connector.id}`);
  }

  const notionId =
    NOTION_CONNECTOR_ID ||
    connectors.find((c) => c.name === 'Notion' && c.type === 'MCP')?.id;
  const connectorIds = [HEVY_CONNECTOR_ID, notionId, connector.id].filter(Boolean);
  await amcpRequest(amcpToken, 'PUT', `/api/mcp-servers/${AMCP_SERVER_ID}/connectors`, {
    connectorIds,
  });
  console.log('Assigned connectors to MCP server:', connectorIds.join(', '));

  const oauth = await amcpRequest(
    amcpToken,
    'POST',
    `/api/connectors/${connector.id}/oauth/authorize`,
  );
  if (oauth.error) {
    throw new Error(oauth.error);
  }

  console.log('\n--- Authorize Google Calendar (open in browser) ---\n');
  console.log(oauth.authorizationUrl);
  console.log('\nAfter approving, test with gcal_list_calendars on your MCP server.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
