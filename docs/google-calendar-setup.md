# Google Calendar connector (Personal OS)

Read/write your calendar **and calendars shared with you** (e.g. family) through AnythingMCP. OAuth runs as **your** Google account.

## How shared calendars work

You authorize once as yourself. The API returns every calendar on your [calendar list](https://developers.google.com/calendar/api/v3/reference/calendarList/list):

- **Read** any calendar you can see in Google Calendar (including wife's if shared).
- **Write** only where `accessRole` is `writer` or `owner` (your `primary` calendar; her calendar only if she granted edit access).

## 1. Google Cloud setup (~10 min)

1. [Google Cloud Console](https://console.cloud.google.com) → create or pick a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **OAuth consent screen**
   - User type: **External**
   - Scope: `https://www.googleapis.com/auth/calendar` (full calendar access)
   - **Test users:** add your Google email (required while app is in *Testing*).
4. **Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - **Authorized redirect URI:**
     ```
     https://personal-os-mcp.onrender.com/api/mcp-oauth/callback
     ```
5. Copy **Client ID** and **Client secret**.

## 2. Deploy + import

After the `google-calendar` adapter is on Render:

```bash
# Optional: store secrets on Render first, then:
GOOGLE_CALENDAR_CLIENT_ID=... GOOGLE_CALENDAR_CLIENT_SECRET=... \
  node scripts/setup-google-calendar.mjs --wait-deploy
```

Or manually: AnythingMCP → Catalog → **Google Calendar** → Import → paste credentials.

## 3. Authorize

Open the URL from the setup script (or connector → **Authorize with Provider**). Sign in with the Google account whose calendar list you want.

If you previously authorized with a readonly scope, **re-authorize** so Google issues the full `calendar` scope.

## 4. Tools

| Tool | Action |
|------|--------|
| `gcal_list_calendars` | List calendars + `accessRole` |
| `gcal_list_events` | Events in a time window |
| `gcal_get_event` | Single event |
| `gcal_create_event` | Create (timed or all-day) |
| `gcal_update_event` | Patch fields |
| `gcal_delete_event` | Delete |

## 5. Verify shared calendars

```
gcal_list_calendars — show accessRole and primary
gcal_list_events calendarId=<wife-calendar-id> timeMin=<today> timeMax=<+7d>
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| OAuth redirect error | Redirect URI must match Render URL exactly |
| `access_denied` | Add yourself as Test user on consent screen |
| Shared calendar missing | Owner must share; check calendar.google.com sidebar |
| Write fails on shared calendar | You may only have `reader` — need edit share |
| `insufficientPermissions` after scope change | Re-authorize connector |

## Write safety

Calendar mutations follow AnythingMCP **mcp-write-safety** — propose creates/updates/deletes in plain language unless the user explicitly authorizes that exact change.
