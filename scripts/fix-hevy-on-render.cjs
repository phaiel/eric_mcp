/**
 * One-off fix for Hevy connector on Render Personal OS deployment.
 */
const { createDecipheriv, createCipheriv, randomBytes } = require('crypto');
const { readFileSync } = require('fs');
const { PrismaClient } = require('@prisma/client');

const CONNECTOR_ID = 'cmrbfd4jv00082eh3t667r77h';
const SERVER_ID = 'cmrbfay0e00032eh39ymrpfw7';
const TOOLS_PATH = process.argv[2] || '/tmp/hevy-tools-export.json';

const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function decrypt(ciphertext, encryptionKey) {
  const key = Buffer.from(encryptionKey, 'utf-8').subarray(0, 32);
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(data.length - TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

function encrypt(plaintext, encryptionKey) {
  const key = Buffer.from(encryptionKey, 'utf-8').subarray(0, 32);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

function stripApiKeyParam(parameters) {
  if (!parameters || typeof parameters !== 'object') return parameters;
  const p = { ...parameters };
  const props = { ...(p.properties || {}) };
  delete props['api-key'];
  p.properties = props;
  p.required = (p.required || []).filter((x) => x !== 'api-key');
  return p;
}

async function main() {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) throw new Error('ENCRYPTION_KEY not set');

  const tools = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'));
  const prisma = new PrismaClient();

  const connector = await prisma.connector.findUnique({ where: { id: CONNECTOR_ID } });
  if (!connector) throw new Error(`Connector ${CONNECTOR_ID} not found`);

  let authConfigEnc = connector.authConfig;
  if (authConfigEnc) {
    const auth = JSON.parse(decrypt(authConfigEnc, encKey));
    auth.headerName = 'api-key';
    authConfigEnc = encrypt(JSON.stringify(auth), encKey);
  }

  await prisma.connector.update({
    where: { id: CONNECTOR_ID },
    data: {
      baseUrl: 'https://api.hevyapp.com',
      healthcheckPath: '/v1/user/info',
      authConfig: authConfigEnc,
      specUrl: 'https://raw.githubusercontent.com/chrisdoc/hevy-mcp/main/openapi-spec.json',
    },
  });
  console.log('Updated connector baseUrl + api-key header');

  const existing = await prisma.mcpTool.count({ where: { connectorId: CONNECTOR_ID } });
  if (existing === 0) {
    for (const t of tools) {
      await prisma.mcpTool.create({
        data: {
          connectorId: CONNECTOR_ID,
          name: t.name,
          description: t.description,
          isEnabled: t.is_enabled ?? true,
          operationId: t.operation_id,
          parameters: stripApiKeyParam(t.parameters),
          endpointMapping: t.endpoint_mapping,
          responseMapping: t.response_mapping,
          outputSchema: t.output_schema,
        },
      });
    }
    console.log(`Created ${tools.length} tools`);
  } else {
    console.log(`Tools already exist (${existing}), skipping create`);
  }

  const link = await prisma.mcpServerConnector.findUnique({
    where: {
      mcpServerId_connectorId: { mcpServerId: SERVER_ID, connectorId: CONNECTOR_ID },
    },
  });
  if (!link) {
    await prisma.mcpServerConnector.create({
      data: { mcpServerId: SERVER_ID, connectorId: CONNECTOR_ID },
    });
    console.log('Assigned Hevy to MCP server');
  } else {
    console.log('Hevy already assigned to MCP server');
  }

  await prisma.$disconnect();
  console.log('Done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
