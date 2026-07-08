# Claude skill — Personal OS

One **domain skill** per [Agent Skills](https://claude.com/docs/skills/how-to) guidance: a cohesive specialty (Personal OS), not one micro-skill per trigger.

## Why one skill

Anthropic's model ([overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)):

- **Level 1** (always): only `name` + `description` (~100 tokens)—cheap at discovery
- **Level 2** (on trigger): `SKILL.md` loads when the task matches
- **Level 3** (as needed): `references/*` load only for the playbook in use

Nine skills meant nine competing descriptions for the same chat. One skill with `references/playbooks.md` is the progressive-disclosure pattern Anthropic documents (like `pdf-skill/` + `FORMS.md`).

## Layout

```
personal-os/
├── SKILL.md              # Router + global output rules + links
└── references/
    ├── playbooks.md      # Capture, find-thread, brief, shutdown, training, dedup
    ├── templates.md      # Response shapes
    └── notion.md         # IDs, slugs (on demand)
```

**AnythingMCP** (`../platform/`) stays thin: connector manifest, Notion API rules, write safety.

## Install

### claude.ai

```bash
cd docs/skills/claude/personal-os && zip -r ../personal-os.zip .
```

Settings → Capabilities → Skills → upload `personal-os.zip` (zip root must be `SKILL.md` + `references/`).

### Claude Code

```bash
mkdir -p .claude/skills
cp -R docs/skills/claude/personal-os .claude/skills/
```

Connect the Personal OS MCP server.

## Test

| Prompt | Should load |
|--------|-------------|
| `dump: test` | personal-os → playbooks Capture |
| `what's blocking sauna?` | personal-os → playbooks Find the thread |
| `morning brief` | personal-os → playbooks Morning brief |

If it doesn't trigger, tighten the `description` in `SKILL.md` frontmatter with more keywords.

## Maintenance

- Playbook changes → `references/playbooks.md`
- Re-seed Notion → update `references/notion.md` from `docs/personal-os-notion-manifest.json`
- New connectors (Gmail, etc.) → add playbook section + update AnythingMCP `server-manifest`, not a new Claude skill
