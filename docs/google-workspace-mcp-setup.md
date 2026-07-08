# Google Workspace MCP (Universal Search)

Cross-product search across Gmail, Drive, Calendar, and Chat via Google's **hosted** MCP server. No Cloud Run required.

## Architecture

| Piece | Where |
|-------|--------|
| MCP server | Google hosts `https://workspacemcp.googleapis.com/mcp/v1` |
| OAuth credentials | Your GCP project → Render env vars |
| Bridge | AnythingMCP MCP connector on Render |

## GCP project: `niagara-mcp-host`

1. Enable APIs: Gmail, Drive, Calendar, Chat + **Google Workspace MCP API** (`workspacemcp.googleapis.com`).
2. OAuth consent → add scopes:
   - `gmail.readonly`
   - `drive.readonly`
   - `calendar.readonly`
   - `chat.messages.readonly`
3. OAuth client (Web application) → redirect URI:
   ```
   https://personal-os-mcp.onrender.com/api/mcp-oauth/callback
   ```
4. Add yourself as **Test user** while in Testing mode.

## Render env

```
GOOGLE_WORKSPACE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_WORKSPACE_CLIENT_SECRET=....
```

## Wire connector

```bash
node scripts/setup-google-workspace-mcp.mjs --wait-deploy
```

Open the printed authorization URL, sign in, approve scopes. Tools import automatically on callback (`search_corpus`).

## Limits

- **Read/search only** — no create calendar events, send mail, etc.
- Add per-product MCP bridges later (`calendarmcp`, `gmailmcp`) for writes.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `access_denied` | Test user on consent screen |
| Redirect mismatch | Exact Render callback URL on OAuth client |
| 0 tools after auth | Re-run script; check discover-tools on connector |
| Calendar not in results | Grant `calendar.readonly` scope and re-auth |
