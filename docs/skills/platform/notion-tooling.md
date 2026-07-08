---
title: Notion Tooling
scope: server
status: applied
whenToUse: Before any Notion tool call — retrieval, create, or update.
---

Storage lives under the Notion page "Personal OS". Tools are bridged from `@notionhq/notion-mcp-server` and use **`API-*` names** — not legacy `notion-*` placeholders.

If you need table names or property types, call `API-retrieve-a-data-source` (or `API-retrieve-a-database`) — do not guess schema.

Active databases (use these): Inbox, Projects, Decisions, Actions, Daily.
Dormant (skip unless the user explicitly needs them): Notes, People, Areas, Tag Definitions.

Retrieval:
- Free text / topic → `API-post-search` first.
- Structured filters → `API-query-data-source` with equality only (`project_slug`, `Status`, `Processed`, `Name`) and always `LIMIT`.
- Single page or row by ID → `API-retrieve-a-page` or `API-retrieve-a-data-source`.
- Never `LIKE` on `Raw capture` or other long text fields.

Writes:
- New rows → `API-post-page` (parent = data source or page per Notion API shape).
- Updates → `API-patch-page`. Moves → `API-move-page`.
- Relation values must be Notion page URLs (`https://app.notion.com/...`), never bare IDs.
- Cross-connector pointers on rows: `hevy_workout_id`, `gmail_thread_id`, `calendar_event_id`, `drive_file_id` — one-line summary plus ID, never full payloads.

Active `project_slug` values: sauna, deck, career, training, home-energy, family-ops, anythingmcp-stack.
