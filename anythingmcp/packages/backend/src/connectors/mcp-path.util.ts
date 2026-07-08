/** MCP HTTP path on the remote server (default `/mcp`; Google uses `/mcp/v1`). */
export function getConnectorMcpPath(connector: {
  config?: unknown;
}): string {
  const cfg = connector.config as Record<string, unknown> | null | undefined;
  const path = cfg?.mcpPath;
  return typeof path === 'string' && path.length > 0 ? path : '/mcp';
}
