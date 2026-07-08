# Personal OS Skills

Skills are split by **runtime**. MCP is connectivity; Claude holds the agent playbook.

| Directory | Runtime | Deploy |
|-----------|---------|--------|
| `platform/` | AnythingMCP (Render) | `node scripts/deploy-anythingmcp-skills.mjs` |
| `claude/` | Claude Skills (zip or `.claude/skills/`) | See [claude/README.md](claude/README.md) |

## Platform skills (AnythingMCP)

Thin server contract only (~3 skills). See [Anthropic distinction](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices): MCP carries **tool safety and connector facts**; Claude Skills carry **workflows and voice**.

| Skill | Job |
|-------|-----|
| `server-manifest` | What connectors exist on this server; what is not connected |
| `notion-tooling` | Notion tool choice, retrieval rules, schema-on-demand |
| `mcp-write-safety` | Mutation gate, untrusted external content |

## Claude skill

One domain skill: `claude/personal-os/` (router + `references/`). Package with `node scripts/package-claude-skills.mjs`. See [claude/README.md](claude/README.md).

## Deploying platform skills

```bash
node scripts/deploy-anythingmcp-skills.mjs           # deploy + retire legacy
node scripts/deploy-anythingmcp-skills.mjs --dry-run # preview
```

The deployer retires applied skills that are no longer in `platform/` (old playbook skills removed from Render).

## Related files

- `docs/personal-os-notion-manifest.json` — data source IDs (git source of truth; agent uses `API-retrieve-a-data-source` at runtime)
- `scripts/seed-notion-personal-os.mjs` — one-time Notion seed

## Frontmatter (platform skills)

```yaml
---
title: Skill title in AnythingMCP
scope: server
status: applied
whenToUse: Short trigger for the agent
---
```

Max 2,000 chars per skill body (AnythingMCP truncates beyond that).
