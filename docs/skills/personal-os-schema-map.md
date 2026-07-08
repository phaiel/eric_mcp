---
title: Personal OS Schema Map
scope: server
status: applied
whenToUse: Whenever reading or writing Personal OS data in Notion — consult this map first instead of searching for databases.
---

Personal OS storage lives under the "Personal OS" Notion page. Databases (data_source_id in parentheses):
- Projects (359b4e81-b19b-4059-8f5d-378c92b6202b): Name, project_slug (kebab-case cross-DB key), Status, Blocking, Decision gate, Next action, Area relation.
- Decisions (a9067638-ad1d-4c08-8509-488dc07b821c): Decision, Project relation, Assumption, Open question, Status (Open/Decided/Superseded), Date, Source, Supersedes self-relation.
- Actions (17d97b1f-7037-4150-91cf-6441e4e9a624): Name, Status (Inbox/Today/Doing/Done/Later), Energy (High/Medium/Low/Zombie), Size, Project relation, Next physical action, Blocked, Due.
- Inbox (96f34dc5-f7ca-4529-b266-8bc54ad1ff2e): Title, Raw capture (verbatim), Source, Processed, Captured, Project relation.
- Daily (4da467ab-8705-4ef0-897b-de5ed6701662): Name (YYYY-MM-DD), Date, Energy log, Shutdown notes, hevy_workout_id, Actions completed relation.
- Notes (9efade5b-f2c1-4f1a-b6d2-a5330dc94c27): Name, Type, Tags, Status, project_slug, Project relation, Source pointer, Parent self-relation.
- People (c41f39df-a425-4588-ab14-13bbf1e105a1): Name, Role, Org, Incentives, Last touch, Email, Related projects relation.
- Areas (b1b0fc74-e8c0-4109-bc15-e6cfe36a037f): Name, Review cadence; Projects roll up here.
- Tag Definitions (1cb1607a-48e2-4ae7-827e-c84c86b63149): Tag, Definition, Synonyms — check before inventing new tags.

Mechanics: relation property values must be Notion page URLs (https://app.notion.com/<32-hex-id>), never bare IDs. Cross-connector ID properties: hevy_workout_id, gmail_thread_id, calendar_event_id, drive_file_id. Active projects have slugs: sauna, deck, career, training, home-energy, family-ops, anythingmcp-stack.
