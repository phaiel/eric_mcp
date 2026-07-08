#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.AMCP_BASE_URL || 'https://personal-os-mcp.onrender.com';
const NOTION_ID = process.env.NOTION_CONNECTOR_ID || 'cmrc9fnd4002n2ht61pa1dfwb';
const SERVER_ID = process.env.AMCP_SERVER_ID || 'cmrbfay0e00032eh39ymrpfw7';
const HEVY_ID = process.env.HEVY_CONNECTOR_ID || 'cmrbfd4jv00082eh3t667r77h';
const DEFAULT_USER_ID = 'cmrbfaxxg00012eh34jfgltsj';
const DEFAULT_ORG_ID = 'cmrbfawp600002eh31o2ckkdj';
const DEFAULT_EMAIL = 'phaiel@gmail.com';
const DEFAULT_SERVICE_ID = 'srv-d96qkv7aqgkc73c9tjv0';

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

async function renderEnv(name) {
  const cliPath = path.join(process.env.HOME || '', '.render', 'cli.yaml');
  if (!existsSync(cliPath)) return null;
  const key = readFileSync(cliPath, 'utf8').match(/key:\s*(rnd_\S+)/)?.[1];
  if (!key) return null;
  const res = await fetch(`https://api.render.com/v1/services/${DEFAULT_SERVICE_ID}/env-vars/${name}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return (json.envVar ?? json).value;
}

async function request(token, method, route, body) {
  const res = await fetch(`${BASE_URL}${route}`, {
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
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    throw new Error(`${method} ${route} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const secret = process.env.AMCP_JWT_SECRET || (await renderEnv('JWT_SECRET'));
  if (!secret) throw new Error('Missing JWT secret');
  const token = process.env.AMCP_JWT || signJwt(secret);

  const imported = await request(token, 'POST', `/api/connectors/${NOTION_ID}/import`, {
    source: 'openapi',
    url: 'https://developers.notion.com/openapi.json',
  });
  console.log(
    `Imported tools: created=${imported.created ?? '?'} updated=${imported.updated ?? '?'} total=${imported.tools?.length ?? '?'}`,
  );

  const tools = await request(token, 'GET', `/api/connectors/${NOTION_ID}/tools`);
  console.log('Sample tool names:', tools.slice(0, 12).map((t) => t.name).join(', '));

  await request(token, 'PUT', `/api/mcp-servers/${SERVER_ID}/connectors`, {
    connectorIds: [HEVY_ID, NOTION_ID],
  });
  console.log('Assigned Notion + Hevy to MCP server');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
