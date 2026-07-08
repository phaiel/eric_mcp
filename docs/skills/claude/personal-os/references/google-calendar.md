# Google Calendar (when connected)

Read/write. OAuth is **Eric's** Google account — every calendar on his Google Calendar sidebar (including shared family calendars) is available.

## Tools

| Tool | Use |
|------|-----|
| `gcal_list_calendars` | Discover `id`, `summary`, `accessRole`, `primary` |
| `gcal_list_events` | Events for one `calendarId` in a time window |
| `gcal_get_event` | Single event detail |
| `gcal_create_event` | New event (writer/owner only) |
| `gcal_update_event` | Patch event fields |
| `gcal_delete_event` | Remove event |

## Shared calendars (e.g. wife's)

1. Run `gcal_list_calendars` once; note stable `id` values (often an email).
2. **Read** any listed calendar.
3. **Write** only when `accessRole` is `writer` or `owner`.
4. If missing → one line: check Google Calendar share/subscribe.

## Morning brief

- `timeMin` / `timeMax`: today in user's timezone as ISO 8601.
- `singleEvents: true`, `orderBy: startTime`.
- Summarize: time, title, location — not full attendee lists unless asked.

## Writes

Follow AnythingMCP **mcp-write-safety**: propose `gcal_create_event`, `gcal_update_event`, `gcal_delete_event` in one plain-language line unless the user explicitly authorizes that exact calendar change.

## Not connected yet

If `gcal_*` tools are absent, skip calendar — don't fabricate events.
