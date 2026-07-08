#!/usr/bin/env node
/**
 * Configure Notion as an MCP Bridge to the local @notionhq/notion-mcp-server sidecar.
 *
 * Prerequisites on Render:
 *   - NOTION_MCP_AUTH_TOKEN (gateway bearer for the sidecar)
 *   - NOTION_TOKEN (Notion PAT) — copied from existing REST connector if missing
 *   - SSRF_ALLOW_LOCALHOST=true, NOTION_MCP_PORT=3001 (render.yaml)
 *   - start.sh sidecar deployed
 *
 * Usage: node scripts/setup-notion-mcp-bridge.mjs [--wait-deploy]
 */
import { createHmac, createDecipheriv } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const {
  AMCP_BASE_URL = 'https://personal-os-mcp.onrender.com',
  AMCP_SERVER_ID = 'cmrbfay0e00032eh39ymrpfw7',
  HEVY_CONNECTOR_ID = 'cmrbfd4jv00082eh3t667r77h',
  NOTION_CONNECTOR_ID = 'cmrc9fnd4002n2ht61pa1dfwb',
  RENDER_SERVICE_ID = 'srv-d96qkv7aqgkc73c9tjv0',
  NOTION_MCP_PORT = '3001',
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

function decrypt(ciphertext, encryptionKey) {
  const key = Buffer.from(encryptionKey, 'utf-8').subarray(0, 32);
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, 16);
  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(16, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
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

async function renderSetEnv(name, value) {
  const key = await renderApiKey();
  if (!key) throw new Error('Render API key not found');
  const res = await fetch(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value }),
    },
  );
  if (!res.ok) {
    throw new Error(`Render set ${name} failed: ${res.status} ${await res.text()}`);
  }
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

async function renderPostgresUrl() {
  const key = await renderApiKey();
  if (!key) return null;
  const res = await fetch(
    'https://api.render.com/v1/postgres/dpg-d96qkt58nd3s73beussg-a/connection-info',
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json.externalConnectionString ?? null;
}

async function notionTokenFromConnector(databaseUrl, encryptionKey, connectorId) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT auth_config FROM connectors WHERE id = $1', [connectorId]);
    if (!rows[0]?.auth_config) throw new Error(`No auth on connector ${connectorId}`);
    const auth = JSON.parse(decrypt(rows[0].auth_config, encryptionKey));
    if (!auth.token) throw new Error('Connector auth has no token field');
    return auth.token;
  } finally {
    await client.end();
  }
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
  const renderKey = await renderApiKey();
  if (!renderKey) throw new Error('Set RENDER_API_KEY or log in with Render CLI');

  const [jwtSecret, encKey, databaseUrlInternal, bridgeAuth] = await Promise.all([
    renderEnv('JWT_SECRET'),
    renderEnv('ENCRYPTION_KEY'),
    renderEnv('DATABASE_URL'),
    renderEnv('NOTION_MCP_AUTH_TOKEN'),
  ]);
  const databaseUrl = (await renderPostgresUrl()) || databaseUrlInternal;
  if (!jwtSecret || !encKey || !databaseUrl || !bridgeAuth) {
    throw new Error('Missing JWT_SECRET, ENCRYPTION_KEY, database URL, or NOTION_MCP_AUTH_TOKEN on Render');
  }

  let notionToken = process.env.NOTION_TOKEN || (await renderEnv('NOTION_TOKEN'));
  if (!notionToken) {
    console.log('NOTION_TOKEN missing on Render — trying existing connector auth...');
    try {
      notionToken = await notionTokenFromConnector(databaseUrl, encKey, NOTION_CONNECTOR_ID);
      await renderSetEnv('NOTION_TOKEN', notionToken);
      console.log('NOTION_TOKEN set on Render from connector auth');
    } catch (err) {
      console.warn(`Could not copy NOTION_TOKEN (${err.message}).`);
      console.warn('Add NOTION_TOKEN in Render (your Notion PAT), redeploy, then re-run discover.');
    }
  }

  for (const [k, v] of [
    ['SSRF_ALLOW_LOCALHOST', 'true'],
    ['NOTION_MCP_PORT', NOTION_MCP_PORT],
  ]) {
    const cur = await renderEnv(k);
    if (cur !== v) {
      await renderSetEnv(k, v);
      console.log(`Render env ${k}=${v}`);
    }
  }

  const amcpToken = signJwt(jwtSecret);
  const sidecarBase = `http://127.0.0.1:${NOTION_MCP_PORT}`;

  // Replace REST connector with MCP bridge (type cannot be changed in-place).
  try {
    await amcpRequest(amcpToken, 'DELETE', `/api/connectors/${NOTION_CONNECTOR_ID}`);
    console.log('Deleted old REST Notion connector');
  } catch (err) {
    console.log('Delete old connector skipped:', err.message);
  }

  let connector;
  const existing = await amcpRequest(amcpToken, 'GET', '/api/connectors');
  connector = existing.find((c) => c.name === 'Notion' && c.type === 'MCP');
  if (!connector) {
    connector = await amcpRequest(amcpToken, 'POST', '/api/connectors', {
      name: 'Notion',
      type: 'MCP',
      baseUrl: sidecarBase,
      authType: 'BEARER_TOKEN',
      authConfig: { token: bridgeAuth },
    });
    console.log('Created MCP bridge connector', connector.id);
  } else {
    await amcpRequest(amcpToken, 'PUT', `/api/connectors/${connector.id}`, {
      baseUrl: sidecarBase,
      authType: 'BEARER_TOKEN',
      authConfig: { token: bridgeAuth },
      headers: {},
    });
    console.log('Updated MCP bridge connector', connector.id);
  }

  if (waitDeploy) {
    console.log('Triggering Render deploy (sidecar requires latest start.sh)...');
    await renderDeploy();
    await waitForHealthy();
  } else {
    console.log('Skipping deploy wait — run with --wait-deploy after pushing start.sh');
  }

  let discovered;
  for (let attempt = 1; attempt <= 8; attempt++) {
    discovered = await amcpRequest(amcpToken, 'POST', `/api/connectors/${connector.id}/discover-tools`);
    if (!discovered.error) break;
    console.log(`discover attempt ${attempt}: ${discovered.error}`);
    if (attempt < 8) await new Promise((r) => setTimeout(r, 20000));
  }
  if (discovered?.error) {
    throw new Error(
      `Tool discovery failed: ${discovered.error}. Push start.sh, deploy Render, then re-run with --wait-deploy`,
    );
  }
  console.log(
    `Discovered tools: created=${discovered.created ?? 0} updated=${discovered.updated ?? 0} total=${discovered.tools?.length ?? '?'}`,
  );

  const tools = await amcpRequest(amcpToken, 'GET', `/api/connectors/${connector.id}/tools`);
  console.log('Sample tools:', tools.slice(0, 8).map((t) => t.name).join(', '));

  await amcpRequest(amcpToken, 'PUT', `/api/mcp-servers/${AMCP_SERVER_ID}/connectors`, {
    connectorIds: [HEVY_CONNECTOR_ID, connector.id],
  });
  console.log('Assigned Notion + Hevy to MCP server');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
