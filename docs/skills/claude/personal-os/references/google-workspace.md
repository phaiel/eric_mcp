# Google Workspace APIs (when connected)

One connector, GA REST APIs, OAuth as Eric. Tools: `gcal_*` (see [google-calendar.md](google-calendar.md)), `gmail_*`, `drive_*`, `chat_*`.

## Gmail

| Tool | Use |
|------|-----|
| `gmail_search_messages` | Query syntax: `from:`, `subject:`, `newer_than:7d`, `has:attachment`, `is:unread` |
| `gmail_get_message` / `gmail_get_thread` | Detail; `format=metadata` for headers only |
| `gmail_list_labels` / `gmail_modify_labels` | Archive = remove INBOX; read = remove UNREAD |
| `gmail_create_draft` | Preferred write — user reviews in Gmail |
| `gmail_send_message` | Only on explicit "send it" |

Drafts/sends take `raw`: RFC 2822 (`To:`/`Subject:` headers, blank line, body) base64url-encoded.

## Drive

| Tool | Use |
|------|-----|
| `drive_search_files` | `name contains 'x'`, `fullText contains 'x'`, `trashed = false` |
| `drive_get_file` | Metadata + webViewLink |
| `drive_export_file` | Google Docs → `text/plain`, Sheets → `text/csv` |
| `drive_create_file` / `drive_update_file` | Metadata only (empty Doc, folder, rename, trash) |

## Chat

`chat_list_spaces`, `chat_list_messages`, `chat_send_message` (spaceId = part after `spaces/`). Needs a Chat app configured in GCP — on 403, say "Chat not configured" in one line and move on.

## Find-the-thread usage

External context for a topic: `gmail_search_messages` + `drive_search_files` (one query each). Notion stays the commitments layer — summarize and link, never paste full emails/files into Notion.

## Writes

All mutations (events, drafts, sends, file changes, chat messages) follow **mcp-write-safety**: propose in one plain-language line unless the user's current message explicitly authorizes that exact change. Prefer drafts over sends.

## Not connected

If `gmail_*`/`drive_*` tools are absent, one line — don't fabricate.
