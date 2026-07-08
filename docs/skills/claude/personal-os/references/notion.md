# Notion reference

Parent: Personal OS page `39727d3a-aeb5-8177-8187-d18b5aab21be`

## MCP tools (AnythingMCP)

Bridged from `@notionhq/notion-mcp-server`. Use **`API-*` names only** — legacy `notion-*` names are not on this server.

| Task | Tool |
|------|------|
| Free-text search | `API-post-search` |
| Filtered query | `API-query-data-source` |
| Schema / data source | `API-retrieve-a-data-source`, `API-retrieve-a-database` |
| Read page | `API-retrieve-a-page` |
| Create row | `API-post-page` |
| Update row | `API-patch-page` |
| Move row | `API-move-page` |

## Active databases

| Database | `collection://` ID |
|----------|-------------------|
| Projects | `359b4e81-b19b-4059-8f5d-378c92b6202b` |
| Decisions | `a9067638-ad1d-4c08-8509-488dc07b821c` |
| Actions | `17d97b1f-7037-4150-91cf-6441e4e9a624` |
| Inbox | `96f34dc5-f7ca-4529-b266-8bc54ad1ff2e` |
| Daily | `4da467ab-8705-4ef0-897b-de5ed6701662` |

Dormant until needed: Notes, People, Areas, Tag Definitions (IDs in repo manifest).

## Project slugs → relation URLs

| Slug | URL |
|------|-----|
| sauna | https://app.notion.com/39727d3aaeb58105ae15fb951dbed9f5 |
| deck | https://app.notion.com/39727d3aaeb58129b4a1c2245fc3fa00 |
| training | https://app.notion.com/39727d3aaeb581779a0cf2faaa488126 |
| home-energy | https://app.notion.com/39727d3aaeb581b0be2ac038969f91c0 |
| anythingmcp-stack | https://app.notion.com/39727d3aaeb581e3a6f4e3420a3701d2 |
| career | https://app.notion.com/39727d3aaeb581e4bed4c5886775aeac |
| family-ops | https://app.notion.com/39727d3aaeb581f4b363fc8c43d2f6ea |

Relations require page URLs, not bare IDs. Pointer fields: `hevy_workout_id`, `gmail_thread_id`, `calendar_event_id`, `drive_file_id`.

Sync from `docs/personal-os-notion-manifest.json` when re-seeding.
