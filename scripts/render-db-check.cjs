const { PrismaClient } = require('@prisma/client');

async function main() {
  const p = new PrismaClient();
  try {
    const connectors = await p.connector.findMany({
      select: { id: true, name: true, baseUrl: true, healthcheckPath: true },
    });
    const links = await p.mcpServerConnector.findMany({
      select: { mcpServerId: true, connectorId: true },
    });
    const toolCount = await p.mcpTool.count({
      where: { connectorId: 'cmrbfd4jv00082eh3t667r77h' },
    });
    const sample = await p.mcpTool.findMany({
      where: { connectorId: 'cmrbfd4jv00082eh3t667r77h' },
      select: { name: true },
      take: 3,
    });
    console.log(
      JSON.stringify({ connectors, links, toolCount, sample }, null, 2),
    );
  } finally {
    await p['$disconnect']();
  }
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
