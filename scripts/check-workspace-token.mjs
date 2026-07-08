#!/usr/bin/env node
/** Inspect the Google OAuth token stored on the Workspace MCP connector. */
import { createDecipheriv } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const CONNECTOR_ID = 'cmrcbxw3h00002hp30ers1pbl';
const RENDER_SERVICE_ID = 'srv-d96qkv7aqgkc73c9tjv0';
const RENDER_PG_ID = 'dpg-d96qkt58nd3s73beussg-a';

function renderApiKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY;
  const cliPath = path.join(process.env.HOME || '', '.render', 'cli.yaml');
  if (!existsSync(cliPath)) return null;
  return readFileSync(cliPath, 'utf8').match(/key:\s*(rnd_\S+)/)?.[1] ?? null;
}

const key = renderApiKey();

async function renderEnv(name) {
  const res = await fetch(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars/${name}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return null;
  return (await res.json()).value;
}

function decrypt(ciphertext, encryptionKey) {
  const k = Buffer.from(encryptionKey, 'utf-8').subarray(0, 32);
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, 16);
  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(16, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', k, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

const [encKey, pgInfo] = await Promise.all([
  renderEnv('ENCRYPTION_KEY'),
  fetch(`https://api.render.com/v1/postgres/${RENDER_PG_ID}/connection-info`, {
    headers: { Authorization: `Bearer ${key}` },
  }).then((r) => r.json()),
]);

const client = new pg.Client({
  connectionString: pgInfo.externalConnectionString,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(
  'SELECT auth_config FROM connectors WHERE id = $1',
  [CONNECTOR_ID],
);
await client.end();

if (!rows[0]?.auth_config) {
  console.log('No authConfig stored on connector.');
  process.exit(0);
}

const auth = JSON.parse(decrypt(rows[0].auth_config, encKey));
console.log('authConfig keys:', Object.keys(auth).sort().join(', '));
console.log('authorizedAt:', auth.authorizedAt);
console.log('expiresAt:', auth.expiresAt ? new Date(auth.expiresAt).toISOString() : '(none)');
console.log('has accessToken:', !!auth.accessToken, '| has refreshToken:', !!auth.refreshToken);

if (auth.accessToken) {
  const info = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${auth.accessToken}`,
  ).then((r) => r.json());
  console.log('\nGoogle tokeninfo:');
  console.log('  error:', info.error ?? '(none)', info.error_description ?? '');
  console.log('  aud (client):', info.aud);
  console.log('  scopes:', info.scope);
  console.log('  expires_in:', info.expires_in);

  // Call Google's MCP server directly with this token
  const res = await fetch('https://workspacemcp.googleapis.com/mcp/v1', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
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
  const text = await res.text();
  console.log('\nDirect Google MCP call status:', res.status);
  console.log('Direct Google MCP body:', text.slice(0, 600));
}
