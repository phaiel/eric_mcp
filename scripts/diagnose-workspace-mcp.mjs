#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CONNECTOR_ID = 'cmrcbxw3h00002hp30ers1pbl';
const AMCP_BASE = 'https://personal-os-mcp.onrender.com';

const renderKey =
  process.env.RENDER_API_KEY ||
  readFileSync(`${process.env.HOME}/.render/cli.yaml`, 'utf8').match(/key:\s*(rnd_\S+)/)?.[1];

async function renderEnv(name) {
  const res = await fetch(
    `https://api.render.com/v1/services/srv-d96qkv7aqgkc73c9tjv0/env-vars/${name}`,
    { headers: { Authorization: `Bearer ${renderKey}` } },
  );
  return (await res.json()).value;
}

function signJwt(secret) {
  const b64url = (s) => Buffer.from(s).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: 'cmrbfaxxg00012eh34jfgltsj',
      email: 'phaiel@gmail.com',
      role: 'ADMIN',
      organizationId: 'cmrbfawp600002eh31o2ckkdj',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const jwtSecret = await renderEnv('JWT_SECRET');
const amcp = signJwt(jwtSecret);

const connector = await fetch(`${AMCP_BASE}/api/connectors/${CONNECTOR_ID}`, {
  headers: { Authorization: `Bearer ${amcp}` },
}).then((r) => r.json());

console.log('Connector:', {
  id: connector.id,
  name: connector.name,
  type: connector.type,
  authType: connector.authType,
  baseUrl: connector.baseUrl,
  config: connector.config,
  hasAuthConfig: !!connector.authConfig,
});

const test = await fetch(`${AMCP_BASE}/api/connectors/${CONNECTOR_ID}/test`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${amcp}` },
}).then((r) => r.json());
console.log('Test:', test);

const tools = await fetch(`${AMCP_BASE}/api/connectors/${CONNECTOR_ID}/tools`, {
  headers: { Authorization: `Bearer ${amcp}` },
}).then((r) => r.json());
console.log('Tools:', tools.map((t) => t.name));

// Optional: token scope check via Render DB (needs pg)
try {
  const { createDecipheriv } = await import('node:crypto');
  const pg = (await import('pg')).default;
  const [encKey, pgUrl] = await Promise.all([
    renderEnv('ENCRYPTION_KEY'),
    renderEnv('DATABASE_URL'),
  ]);
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
  const client = new pg.Client({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const { rows } = await client.query('SELECT auth_config FROM connectors WHERE id = $1', [
    CONNECTOR_ID,
  ]);
  const auth = JSON.parse(decrypt(rows[0].auth_config, encKey));
  await client.end();
  const info = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${auth.accessToken}`,
  ).then((r) => r.json());
  console.log('Google token scopes:', info.scope || info.error);
  console.log('Google token email:', info.email);
} catch (e) {
  console.log('Token scope check skipped:', e.message);
}

const MCP_KEY = await renderEnv('MCP_API_KEY');
const call = await fetch(`${AMCP_BASE}/mcp/cmrbfay0e00032eh39ymrpfw7`, {
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
    params: { name: 'search_corpus', arguments: { query: 'test' } },
  }),
});
const body = await call.text();
console.log('search_corpus sample:', body.slice(0, 300));
