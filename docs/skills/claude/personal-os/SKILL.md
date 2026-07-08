---
name: personal-os
description: Operates Eric's Personal OS over MCP—capture, thread retrieval, morning brief, shutdown, training. Use for dump:/capture:, blocking, decisions, morning brief, shutdown, Hevy, or Personal OS chat.
---

# Personal OS

Eric's context-and-execution layer over Notion (commitments) + Hevy (workouts) + Google Workspace (calendar, mail, files) + future Health. **AnythingMCP** supplies connector rules and write safety; this skill supplies **what to do**.

## Route first

Match **one** playbook below. Load [references/playbooks.md](references/playbooks.md) for that section only.

| User signal | Playbook |
|-------------|----------|
| `dump:`, `capture:`, `remember:`, unstructured save | Capture |
| blocking, decided, context, thread on, what about X | Find the thread |
| morning brief, what to work on, today's focus | Morning brief |
| shutdown, wrap up, end of day | Shutdown |
| I'm back, catch me up, re-entry | Re-entry |
| workout, lift, training, Hevy | Training |
| before creating a Notion row | Dedup (also read playbook) |

If no match: answer briefly; offer capture if they're thinking out loud.

## Output (every reply)

1. Answer or next action in line one.
2. Max three suggested actions—never a backlog dump.
3. Hide mechanics (no DB IDs, property names, URLs).
4. One optional next step at the end—not a menu.
5. Stale connector → one line, no guilt, never fabricate.

Templates: [references/templates.md](references/templates.md)

## Notion & projects

Schema, data source IDs, project URLs: [references/notion.md](references/notion.md)

Live property types → `API-retrieve-a-data-source` on the data source. Retrieval rules (search vs query) are enforced by AnythingMCP **notion-tooling**—follow them.

Calendar (when connected): [references/google-calendar.md](references/google-calendar.md)
Gmail/Drive/Chat (when connected): [references/google-workspace.md](references/google-workspace.md)

## Writes

AnythingMCP **mcp-write-safety** gates tool calls. Propose mutations in one plain-language line unless the user's **current** message explicitly authorizes them (`dump:`/`capture:`/`remember:` → Inbox only).

## Examples

**dump: door size blocking sauna** → Capture playbook → confirm "Filed under Sauna"

**what's blocking sauna?** → Find the thread → DECISION / STILL OPEN / CONTEXT

**morning brief** → Morning brief → TODAY (≤3) / BLOCKING / IGNORE FOR NOW
