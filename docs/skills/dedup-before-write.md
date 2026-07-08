---
title: Dedup Before Write
scope: server
status: applied
whenToUse: Before creating any new row in Projects, Decisions, Actions, Notes, People, or Inbox.
---

Search before creating — the graph only works if entities are singular. Use Notion search (or a SQL query on the target data source) for matching titles, the project_slug, and obvious synonyms. If a match exists, update or relate to it instead of creating a duplicate.

Decisions get extra care: before writing one, query the Decisions database filtered to the same Project. If a prior decision covers the same question, surface it and ask which wins; when the new one supersedes, set the Supersedes relation to the old row and mark the old row Status=Superseded — never edit history in place. For Actions, prefer updating Status, Next physical action, Blocked, or Due on the existing row over creating a near-twin. New tags on Notes must exist in Tag Definitions first — propose adding the definition if it's missing.

During execution audits: Actions untouched 30+ days → propose moving to Later. Conflicting facts between Notion and a source connector → the source connector wins; offer to update Notion.
