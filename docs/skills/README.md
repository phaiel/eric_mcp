# Personal OS Skills

Reviewed source text for the AnythingMCP AI Skills that drive the Personal OS.
GitHub is the source of truth; AnythingMCP (Render) is the runtime. Applied
skills are composed into the MCP server's instructions, so they apply to every
client of that server (Claude, Cursor, mobile) without any Claude-side setup.

## The set

| Skill | Scope | Job |
|---|---|---|
| `personal-os-schema-map` | server | Where everything lives: databases, properties, IDs, conventions |
| `personal-os-presenter` | server | ADHD output rules + response templates |
| `write-gate` | server | Propose-before-write, untrusted external content |
| `dedup-before-write` | server | Search first; supersede decisions, never duplicate |
| `find-the-thread` | server | Retrieval recipe: project → decisions → blockers → facts |
| `morning-brief-and-shutdown` | server | Today's 3, shutdown log to Daily, re-entry rule |
| `hevy-training-summary` | server | Workout facts stay in Hevy; Daily gets pointer + summary |
| `capture-to-notion-inbox` | Notion connector | "dump:" → Inbox row, zero friction |

## Deploying

```bash
node scripts/deploy-anythingmcp-skills.mjs           # deploy/update all
node scripts/deploy-anythingmcp-skills.mjs --dry-run # preview
```

The deployer matches by title (updates in place), scopes `server` skills to the
Personal OS MCP server and `connector` skills by connector name, and leaves
`skillAutoApply` off so AI-generated suggestions still require review.

## Related files

- `docs/personal-os-notion-manifest.json` — data source IDs and project page
  URLs created by the Notion seed. The schema-map skill embeds these; if you
  re-seed, regenerate that skill text too.
- `scripts/seed-notion-personal-os.mjs` — one-time Notion storage seed
  (databases + golden rows). Guarded by the manifest: delete it to re-seed.

## Frontmatter

```yaml
---
title: Skill title in AnythingMCP   # match key for updates
scope: server | connector
connector: Notion                    # only for scope: connector
status: applied
whenToUse: Short trigger text shown to the agent
---
```

Body = the instruction (max 2,000 chars — AnythingMCP truncates beyond that).
Keep skills imperative and specific; they are concatenated into one
instructions block, so bloat in any one skill costs every request.
