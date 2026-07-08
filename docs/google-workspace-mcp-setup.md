# Google Workspace — REST APIs (current) vs MCP (superseded)

> **Superseded:** the Google-hosted Workspace MCP servers (`workspacemcp.googleapis.com` etc.) require enrollment in the [Workspace Developer Preview Program](https://developers.google.com/workspace/preview). We switched to the GA REST APIs instead — no preview gate. If preview enrollment is ever approved, the MCP bridge path below still works.

## Current setup: `google-workspace-apis` adapter

One REST connector, one OAuth, four products. 21 curated tools.

| Product | Tools | Scope |
|---------|-------|-------|
| Calendar | `gcal_list_calendars`, `gcal_list_events`, `gcal_get_event`, `gcal_create_event`, `gcal_update_event`, `gcal_delete_event` | `calendar` (read/write) |
| Gmail | `gmail_search_messages`, `gmail_get_message`, `gmail_get_thread`, `gmail_list_labels`, `gmail_modify_labels`, `gmail_create_draft`, `gmail_send_message` | `gmail.modify` |
| Drive | `drive_search_files`, `drive_get_file`, `drive_export_file`, `drive_create_file`, `drive_update_file` | `drive` |
| Chat | `chat_list_spaces`, `chat_list_messages`, `chat_send_message` | `chat.messages` |

### GCP (project `niagara-mcp-host`)

1. APIs enabled: Calendar, Gmail, Drive, Chat (all GA — done).
2. OAuth consent screen: External, Test user `phaiel@gmail.com`, scopes above.
3. Web OAuth client redirect URI:
   ```
   https://personal-os-mcp.onrender.com/api/mcp-oauth/callback
   ```
4. Render env: `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET`.

### Wire it

```bash
node scripts/setup-google-workspace-apis.mjs
```

Deletes the old MCP connector, imports the adapter, assigns it to the MCP server, and prints the OAuth URL. Open it, approve, done.

### Notes

- **Chat** needs a Chat app configured (Google Chat API → Configuration in GCP) even for reads. Skip if 403.
- **Gmail drafts/sends** take a base64url-encoded RFC 2822 `raw` message. Prefer drafts.
- **Shared calendars**: anything visible in Eric's Google Calendar sidebar is readable; writes need writer/owner access.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `redirect_uri_mismatch` | Exact callback URL on the OAuth client |
| `access_denied` / org_internal | Consent screen External + Test user added |
| 403 on Chat tools | Configure Chat app in GCP or skip Chat |
| `insufficientPermissions` | Re-authorize — scope set changed |
