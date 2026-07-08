#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://personal-os-mcp.onrender.com';
const DEFAULT_SERVICE_ID = 'srv-d96qkv7aqgkc73c9tjv0';
const DEFAULT_SERVER_ID = 'cmrbfay0e00032eh39ymrpfw7';
const DEFAULT_USER_ID = 'cmrbfaxxg00012eh34jfgltsj';
const DEFAULT_ORG_ID = 'cmrbfawp600002eh31o2ckkdj';
const DEFAULT_EMAIL = 'phaiel@gmail.com';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: process.env.AMCP_USER_ID || DEFAULT_USER_ID,
      email: process.env.AMCP_EMAIL || DEFAULT_EMAIL,
      role: 'ADMIN',
      organizationId: process.env.AMCP_ORG_ID || DEFAULT_ORG_ID,
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
  const text = await readFile(cliPath, 'utf8');
  return text.match(/key:\s*(rnd_\S+)/)?.[1] ?? null;
}

async function renderEnv(name) {
  const key = await renderApiKey();
  if (!key) return null;
  const serviceId = process.env.RENDER_SERVICE_ID || DEFAULT_SERVICE_ID;
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars/${name}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Render env ${name} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.envVar ?? json).value;
}

async function authToken() {
  if (process.env.AMCP_JWT) return process.env.AMCP_JWT;
  const secret = process.env.AMCP_JWT_SECRET || (await renderEnv('JWT_SECRET'));
  if (!secret) {
    throw new Error('Set AMCP_JWT, AMCP_JWT_SECRET, or RENDER_API_KEY/Render CLI auth.');
  }
  return signJwt(secret);
}

async function request(baseUrl, token, method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${route} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function parseSkill(text, file) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  if (!meta.title) throw new Error(`${file}: missing title`);
  if (!meta.scope) throw new Error(`${file}: missing scope`);
  const instruction = match[2].trim();
  if (!instruction) throw new Error(`${file}: missing instruction body`);
  return {
    file,
    title: meta.title,
    scope: meta.scope,
    connector: meta.connector,
    status: meta.status || 'applied',
    whenToUse: meta.whenToUse || '',
    instruction,
  };
}

async function loadSkills() {
  const root = process.cwd();
  const dir = path.join(root, 'docs', 'skills');
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  return Promise.all(
    files.map(async (file) => parseSkill(await readFile(path.join(dir, file), 'utf8'), file)),
  );
}

async function allSkills(baseUrl, token) {
  const all = [];
  for (let skip = 0; ; skip += 100) {
    const page = await request(baseUrl, token, 'GET', `/api/knowledge-graph/skills?take=100&skip=${skip}`);
    all.push(...page.items);
    if (all.length >= page.total || page.items.length === 0) return all;
  }
}

async function main() {
  const baseUrl = process.env.AMCP_BASE_URL || DEFAULT_BASE_URL;
  const serverId = process.env.AMCP_SERVER_ID || DEFAULT_SERVER_ID;
  const token = await authToken();
  const skills = await loadSkills();
  const connectors = await request(baseUrl, token, 'GET', '/api/connectors');
  const connectorByName = new Map(connectors.map((c) => [String(c.name).toLowerCase(), c.id]));
  const existing = await allSkills(baseUrl, token);
  const existingByTitle = new Map(existing.map((s) => [s.title, s]));

  console.log(`${dryRun ? 'Dry run: ' : ''}Deploying ${skills.length} skills to ${baseUrl}`);

  for (const skill of skills) {
    const body = {
      title: skill.title,
      whenToUse: skill.whenToUse,
      instruction: skill.instruction,
      status: skill.status,
    };
    if (skill.scope === 'server') {
      body.mcpServerId = serverId;
    } else if (skill.scope === 'connector') {
      const connectorId = connectorByName.get(String(skill.connector || '').toLowerCase());
      if (!connectorId) throw new Error(`${skill.file}: connector not found: ${skill.connector}`);
      body.connectorId = connectorId;
    } else {
      throw new Error(`${skill.file}: unsupported scope ${skill.scope}`);
    }

    const found = existingByTitle.get(skill.title);
    const wrongScope =
      found &&
      ((body.mcpServerId && found.mcpServerId !== body.mcpServerId) ||
        (body.connectorId && found.connectorId !== body.connectorId));

    if (dryRun) {
      console.log(`${found ? (wrongScope ? 'recreate' : 'update') : 'create'}: ${skill.title}`);
      continue;
    }

    if (found && wrongScope) {
      await request(baseUrl, token, 'DELETE', `/api/knowledge-graph/skills/${found.id}`);
      await request(baseUrl, token, 'POST', '/api/knowledge-graph/skills', body);
      console.log(`recreated: ${skill.title}`);
    } else if (found) {
      await request(baseUrl, token, 'PATCH', `/api/knowledge-graph/skills/${found.id}`, body);
      console.log(`updated: ${skill.title}`);
    } else {
      await request(baseUrl, token, 'POST', '/api/knowledge-graph/skills', body);
      console.log(`created: ${skill.title}`);
    }
  }

  if (!dryRun) {
    await request(baseUrl, token, 'PUT', '/api/knowledge-graph/settings', {
      enabled: true,
      captureIntent: true,
      skillAutoApply: false,
      edgeAutoApply: false,
    });
    console.log('settings: kg enabled, intent capture on, auto-apply off');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
