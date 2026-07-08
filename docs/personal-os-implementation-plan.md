# Personal OS Implementation Plan

Context-retention and prioritization layer over life/work systems — not a chatbot with tools.

**Stack:** Claude + AnythingMCP (skills, KG, connectors) + Notion (storage).  
**Reference:** [AnythingMCP Knowledge Graph guide](https://anythingmcp.com/guides/knowledge-graph-mcp)

**Interface model:** The LLM is the primary UI. Storage is optimized for retrieval, graph, and agent reasoning — not for manual browsing. ADHD compliance lives in **how the agent formats responses**, not in simplifying the backend schema.

---

## Project scope (read this first)

**This project configures an existing stack — it does not build a new app.**

| In scope | Out of scope |
|----------|--------------|
| Claude (Mobile/Desktop) as the interface | Custom apps, cron jobs, schedulers, bots |
| AnythingMCP: org settings, KG edges, skills | Custom MCP servers or middleware |
| Connectors via AnythingMCP (OAuth, assign to server) | Push-notification infrastructure (ntfy, Telegram, etc.) |
| Notion databases + sharing with integration | Backup/export scripts or automation pipelines |
| Skill text (rules, templates) — documented in this repo, pasted into AnythingMCP | Vector DB, multi-agent orchestration, durable workflow engines |
| AnythingMCP deploy config (Render from GitHub) | Building features AnythingMCP doesn't already provide |

**Deliverables:** configured MCP server, connector assignments, KG seeds, Notion schema, and a small set of skills. Success = you talk to Claude and get ADHD-formatted briefs from real data.

**When research suggests something useful but code-heavy** (proactive push briefs, automated backups, heartbeat agents): note it as a known limitation or a separate future project — not a phase of *this* plan.

---

## Two-layer design: storage vs presentation

```
┌─────────────────────────────────────────────────────────────┐
│  YOU  →  natural language  →  Claude / Mobile / Desktop      │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │  PRESENTATION LAYER         │
              │  Skills + response templates│
              │  ADHD output rules        │
              │  (you never see raw DBs)  │
              └──────────────┬────────────┘
                             │ read/write
              ┌──────────────▼──────────────┐
              │  STORAGE LAYER              │
              │  Notion (graph, GTD, PARA)  │
              │  KG (cross-system glue)     │
              │  Connectors (facts)         │
              └─────────────────────────────┘
```

| Layer | Optimized for | ADHD rules apply? |
|-------|---------------|-------------------|
| **Storage** (Notion, KG) | Graph traversal, dedup, agent search, relations, decision history, `project_slug` keys | No — can be rich and structured |
| **Presentation** (skills) | Scannable replies, Today's 3, energy fit, no walls of text | **Yes — this is where ADHD design lives** |
| **Capture** (via chat) | Zero-friction dump → agent writes structured rows | User says one sentence; agent handles properties |

**You don't maintain the system.** You talk to it. The agent captures to Inbox, links to Projects, files Decisions — with full metadata the KG needs.

---

## ADHD presentation rules (agent skill — non-negotiable)

These govern every user-facing response. Backend can be a 7-database graph; output must never look like one.

### Output format

1. **Lead with the answer** — first line = what you need to know or do
2. **Max 3 priorities** when suggesting actions (Today's 3, not a backlog dump)
3. **Sections with headers** — never a wall of prose or raw JSON
4. **Hide storage mechanics** — no property names, database IDs, or "I updated row X"
5. **Offer one next step** — "Want me to capture this as a decision?" not a menu of 6 options
6. **Re-entry safe** — if context is stale, say so in one line; no guilt

### Response templates by mode

**Find the thread** (e.g. "what did we decide about sauna cladding?")
```
DECISION: [one sentence]
STILL OPEN: [bullets, max 3]
CONTEXT: [2–3 sentences max]
→ [optional single suggested next action]
```

**Today's focus** (e.g. "what should I work on?")
```
TODAY (pick up to 3):
1. [action] — [project] — [~time or energy: High/Med/Low]
2. ...
BLOCKING YOU: [0–2 items, only if real blockers exist]
IGNORE FOR NOW: [1 line — permission to not think about the rest]
```

**Pre-meeting brief** (e.g. "before I talk to Dimitri")
```
MEETING: [who/when if known]
YOU OWE: [bullets]
THEIR LIKELY ANGLE: [1–2 sentences]
SUGGESTED FRAMING: [2–3 bullets]
DRAFT OPENER: [optional 1–2 sentences]
```

**Decision memo** (e.g. "should I do X or Y?")
```
OPTIONS: A vs B (max 2–3 options)
ASSUMPTIONS: [bullets]
RISKS: [bullets]
RECOMMENDATION: [one sentence + confidence level]
→ Capture as decision? [yes/no prompt]
```

**Execution audit** (e.g. "what am I forgetting?")
```
STALE (>2 weeks, no progress): [max 5, with project name]
OPEN DECISIONS: [max 5]
FOLLOW-UPS YOU OWE: [from email/calendar if connected]
→ Pick one to unblock? [single suggestion]
```

**Capture confirm** (after you dump a thought)
```
Captured: "[title]"
→ Filed under: [Project] as [Action / Decision / Note]
Anything else while we're here?
```

### Energy awareness

When suggesting actions, agent should ask or infer energy fit:
- **High** — deep work, decisions, hard conversations
- **Medium** — standard tasks
- **Low** — admin, email, organizing
- **Zombie** — one &lt;15 min win to break freeze

Storage has `Energy` on Actions; presentation filters by it when user says "I'm fried" or "I have 20 minutes."

### What the agent stores vs what you see

| You say | Agent writes (storage) | You get back (presentation) |
|---------|------------------------|----------------------------|
| "dump: need to check door size for sauna" | Inbox row → clarify → Action or Open Question on Sauna project | "Captured. Blocking sauna materials order. Want this as an open question on Sauna?" |
| "what's blocking sauna?" | Queries Projects + Decisions + Actions | BLOCKING section, 3 items max |
| "before Dimitri" | kg_how_to_obtain → People, Gmail, Decisions | Pre-meeting brief template |
| "I did the workout" | Hevy fetch → Daily note + `hevy_workout_id` | "Logged. RPE felt high on OHP — want a note for next time?" |

---

## Architecture (four layers, one job each)

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Mobile / Desktop                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  AnythingMCP  (single "Personal OS" MCP server)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ KG (glue)    │  │ Skills       │  │ kg_how_to_obtain     │  │
│  │ static       │  │ learned rules│  │ runtime chaining     │  │
│  │ observed     │  │              │  │ hints                │  │
│  │ manual       │  │              │  │                      │  │
│  │ llm          │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└───────┬──────────────┬──────────────┬──────────────┬───────────┘
        │              │              │              │
   ┌────▼────┐   ┌─────▼─────┐  ┌────▼────┐   ┌─────▼─────┐
   │ Notion  │   │ Gmail/Cal │  │ Drive   │   │ Hevy/etc  │
   │ CONTEXT │   │ FACTS     │  │ FACTS   │   │ FACTS     │
   │ synthesis│  │ at source │  │ at source│  │ at source │
   └─────────┘   └───────────┘  └─────────┘   └───────────┘
```

| Layer | Stores | Does NOT store |
|-------|--------|----------------|
| **Notion** | Decisions, assumptions, open questions, synthesis, links, next actions | Raw workouts, emails, file contents |
| **KG** | Entity shapes, cross-system keys, chaining rules | Note text, PII values (hashed only) |
| **Connectors** | Authoritative facts | Your interpretation of them |
| **Vector DB** | *(skip for now)* | — |

**Decision log:** A **Notion database** (`Decisions`) — not a separate MCP or custom service.

**Vector DB:** Out of scope until 1,000+ notes and tag search fails.

---

## KG layer primer

Per the [AnythingMCP KG guide](https://anythingmcp.com/guides/knowledge-graph-mcp):

| Layer | When it runs | Your action |
|-------|--------------|-------------|
| **STATIC** | Auto on tool import | Nothing — every connector gets this |
| **OBSERVED** | After real tool calls | Enable intent capture; use the system normally |
| **MANUAL** | You draw edges in KG UI | Seed cross-system links automation can't infer |
| **LLM** | Optional enrichment pass | Enable after 3+ connectors; review suggested edges |

**Tag legend for connectors below:**

- **S** = STATIC (automatic, high value)
- **O** = OBSERVED (turn on intent capture; use regularly)
- **M** = MANUAL (seed edges at connect time)
- **L** = LLM (helps alias different names for same real-world thing)

Priority for setup effort: **M > O > L > S**. STATIC is free on everything.

---

## Notion schema (storage layer — optimize for graph + KG + agent retrieval)

Property names matter — they become STATIC entities and OBSERVED match keys. **You do not navigate these manually.** The agent reads/writes them; richness helps search and `kg_how_to_obtain`.

### Core databases (GTD + PARA + decision graph)

| Database | Storage role | Key properties |
|----------|--------------|----------------|
| **Inbox** | GTD capture stream — agent landing zone for raw dumps | `Title`, `Captured`, `Processed`, `Source`, `Raw capture` (verbatim user text) |
| **Actions** | GTD next-actions — agent queries by Status/Energy/Project | `Name`, `Status` (Inbox/Today/Doing/Done/Later), `Energy` (High/Med/Low/Zombie), `Size` (Quick/Standard/Deep), `Project` (relation), `Next physical action`, `Blocked`, `due`, connector IDs |
| **Daily** | Stream + shutdown log | `Date`, `Energy log`, `Shutdown notes`, `hevy_workout_id`, relations to Actions completed |
| **Projects** | PARA Projects + GTD project list | `Name`, `project_slug`, `Area`, `Status` (active/paused/done), `Blocking`, `Decision gate`, `Next action`, `Related` (Notes/Decisions) |
| **Decisions** | Anti-re-litigation graph nodes | `Project` (relation), `Decision`, `Assumption`, `Open question`, `Status`, `Date`, `Supersedes` (relation → Decisions), `Source` |
| **Notes** | PARA Resources + stable context | `Type`, `Tags`, `Status`, `Area`, `Related`, `Parent`, `project_slug`, connector pointer fields |
| **People** | Relationship graph | `Name`, `Role`, `Org`, `Incentives`, `Last touch`, `email`, `Related projects` |
| **Areas** | PARA Areas (ongoing life domains) | `Name`, `Projects` (rollup), `Review cadence` |
| **Tag definitions** | Agent routing (TAG paper) | `Tag`, `Definition`, `Synonyms` |

### Graph edges (relations the agent maintains)

```
Project ──< Actions
Project ──< Decisions
Project ──< Notes
Decision ──> Decision (Supersedes)
Note ──< Note (Related, Parent)
People ──< Projects
Area ──< Projects
```

No Home dashboard required for you — optional if you ever open Notion directly. Your interface is Claude + skills.

### Cross-connector property convention

Use **shared identifier property names** wherever a fact links to a source system:

| Property | Links to |
|----------|----------|
| `hevy_workout_id` | Hevy |
| `gmail_thread_id` | Gmail |
| `drive_file_id` | Google Drive |
| `calendar_event_id` | Google Calendar |
| `github_issue_id` | GitHub |
| `project_slug` | Internal key across all DBs |

When the same ID flows Hevy → Notion Daily, the **OBSERVED** layer promotes a `produces_consumes` edge automatically.

---

## Connector plan with KG layer tags

### Phase 1 — Personal execution stack (connect first)

| Connector | S | O | M | L | Primary glue role | Manual edges to seed |
|-----------|---|---|---|---|-------------------|----------------------|
| **Notion** | ✓ | ✓ | **✓✓** | **✓** | Hub for context; all synthesis lands here | `Project` ↔ Drive folder; `Person` ↔ Gmail contact email; `Decision` ↔ Calendar event (pre-meeting) |
| **Google Calendar** | ✓ | ✓ | **✓** | ✓ | Time + meetings → prep context | `calendar_event` → Notion `People` (attendee email); `event` → `Project` (recurring 1:1s) |
| **Gmail** | ✓ | ✓ | **✓** | ✓ | Follow-ups, drafts, thread context | `thread_id` → Notion `People`; `thread` → `Project` (stakeholder comms) |
| **Google Drive** | ✓ | ✓ | **✓** | **✓** | Artifacts at source; Notion holds pointers | `file_id` → Notion `Project`; `resume` doc → `Career` project (same_identity via LLM) |
| **Todoist** or **Linear** | ✓ | ✓ | **✓** | — | Next physical actions per project | `task` → Notion `Project`; `task.external_id` ↔ `project_slug` |
| **Brave** or **Tavily** | ✓ | — | **✓** | — | Research with quality filters | M only: `research_query` → Notion `Notes` (Type=research); skill rule for source filters |
| **Filesystem** | ✓ | ✓ | **✓** | — | Local PDFs, specs, manuals | `folder_path` → Notion `Project` (sauna/, deck/, labs/) |

**Phase 1 KG skills to write (MANUAL → Skills, or generate after 2 weeks):**

1. *"Never copy full email/file/workout into Notion — summary + source ID only."*
2. *"Before creating a Decision, search Decisions DB for same Project."*
3. *"Research mode: manufacturer specs + peer-reviewed only; exclude Reddit/vendor claims."*
4. *"Next action mode: max 3 actions, each must link to a Project with Decision gate."*

---

### Phase 2 — Technical operator stack

| Connector | S | O | M | L | Glue role | Manual edges |
|-----------|---|---|---|---|-----------|--------------|
| **Hevy** *(connected)* | ✓ | **✓✓** | **✓** | — | Workout facts at source | `workout_id` → Daily.hevy_workout_id; `routine` → Notion training plan |
| **GitHub** | ✓ | ✓ | **✓** | — | Agent infra, issues | `repo` → Notion `Projects` (anythingmcp, home_niagara_mcp); `issue` → task |
| **Docker** | ✓ | — | **✓** | — | Container health (sandboxed) | `container` → `anythingmcp` project; read-only skill |
| **SSH** | ✓ | — | **✓** | — | VPS ops (constrained) | M only: allowlist hosts; no observed value |
| **Cloudflare** | ✓ | — | **✓** | — | DNS/tunnel for GCE | `tunnel` → production MCP deployment project |

---

### Phase 3 — Optimization stack

| Connector | S | O | M | L | Glue role | Manual edges |
|-----------|---|---|---|---|-----------|--------------|
| **Apple Health** / **Whoop** | ✓ | ✓ | **✓** | ✓ | HRV, sleep, BP patterns | `metric_date` → Daily; skill: "hypotheses only, not conclusions" |
| **Home Assistant** | ✓ | ✓ | **✓** | ✓ | Energy, sauna, HVAC | `entity_id` → Projects (solar, sauna, HVAC) |
| **UniFi** | ✓ | — | **✓** | — | Network diagnostics | → `Home network` project |
| **Google Sheets** | ✓ | ✓ | **✓** | ✓ | ROI models, spend tracking | `spreadsheet_id` → Project (finance, solar ROI) |
| **PubMed** / **Semantic Scholar** | ✓ | — | **✓** | — | Peptide/TRT research | `pmid` → Notion Notes (Type=research); quality-filter skill |
| **Google Contacts** | ✓ | ✓ | **✓** | ✓ | Relationship CRM | `contact_id` ↔ Notion `People` (same_identity) |

---

### Explicitly deprioritize

| Connector | Why | KG tag |
|-----------|-----|--------|
| Obsidian | Chose Notion | — |
| Vector DB | Premature; tags suffice | — |
| Generic Wikipedia/calculator | Low leverage | — |
| Autonomous shell (broad root) | High risk | M: deny-by-default skill |
| LinkedIn MCP | Unreliable APIs | Phase 3+ if exists |

---

## Project → Notion + KG mapping

Each project gets a **Notion Project row** + **manual KG node** linked to its connectors:

| Project | Notion `Area` | Connectors (facts) | KG manual edges |
|---------|---------------|-------------------|-----------------|
| Sauna | Home | Drive, Filesystem, Research | `sauna/` folder ↔ Project; materials PDFs ↔ `drive_file_id` |
| Deck | Home | Drive, Filesystem, Research | soil report path ↔ Project; engineering assumptions → Decisions |
| Career / Product move | Work | Gmail, Calendar, Drive, People | Dimitri ↔ People; resume `file_id` ↔ Career |
| Training / body comp | Health | Hevy, (Whoop later) | `routine_id` ↔ training plan Note |
| Home energy | Home | Sheets, HA, (Enphase later) | ROI sheet ↔ Project; usage data read-only |
| Family ops | Life | Calendar, Gmail | recurring events ↔ Project |
| AnythingMCP / agent stack | Tech | GitHub, Docker, Hevy | repos ↔ Project; KG learns observed flows |
| Peptides / TRT research | Health | PubMed, Research, Notes | pmid ↔ Notes; skill: human data only |
| Solar / battery | Home | Sheets, HA, Research | same as home energy |

**Example Decision row (Notion):**

```
Project: Sauna
Decision: Aspen above bench exposure, pine below hidden zones
Assumption: 3.1" board face width
Open question: final door size, heater wall clearances
Status: open
```

---

## AnythingMCP KG configuration

### Org settings (Settings → Organization)

| Flag | Set to | Why |
|------|--------|-----|
| `kg_enabled` | **on** | Default |
| `kg_capture_intent` | **on** | OBSERVED layer needs user intent on tool calls |
| `kg_llm_enabled` | **on** (after Phase 1 connectors) | Cross-name aliasing (Person ↔ contact) |
| `kg_edge_auto_apply` | **off** initially | Review LLM edges before auto-promote |
| `skillAutoApply` | **off** initially | Review generated skills |

### MCP server layout

One server: **"Personal OS (Eric)"** — assign connectors as you add them. KG lookup is scoped per server, so Claude only sees entities for connectors on that server.

Current: `Default (Eric Theiss)` already has Hevy + Notion. Keep adding Phase 1 connectors there.

**MCP endpoint:** `http://localhost:4000/mcp/cmrbcfi1500042hnjhi6ra521`

### Weekly KG maintenance (~15 min)

1. **Knowledge Graph → Rebuild** (static sync)
2. Review **suggested** observed edges → promote or dismiss
3. **Skills → Generate** → apply high-confidence rules
4. **Skills → Consolidate** → dedupe overlapping rules

### Agent behaviors → Skills

| Mode | Skill `whenToUse` | KG layer used |
|------|-------------------|---------------|
| Find the thread | "pull all context on X" | `kg_how_to_obtain` + Notion search |
| Next action | "what should I do" | Projects DB + Todoist; OBSERVED priorities |
| Decision memo | "compare options for X" | Decisions DB + Research connector |
| Pre-meeting brief | "before 1:1 with Y" | Calendar → People → Gmail → Notion |
| Research (filtered) | "research X with quality" | Research MCP + Notes capture |
| Execution audit | "what am I forgetting" | Projects Blocking + Gmail follow-ups + stale Decisions |

---

## Gap analysis (deep-research pass, Jul 2026)

Seven gaps the architecture should account for. Each fix is tagged **in-scope** (configure via skills/settings) or **out-of-scope** (don't expand this project).

### 1. Pull-only interface — no proactive push (out-of-scope to automate)

Everything above is **pull-based**: you open Claude, you ask. Barkley externalization ideally means the system initiates — but that requires external schedulers, push infra, or custom agents. **Not part of this project.**

**In-scope substitute:**

- **`morning brief` skill** — when you say "morning brief" or "what's today," agent runs Today's 3 template from Notion + Calendar (if connected). Zero build; you trigger it.
- **`shutdown` skill** — "2-min shutdown" captures what moved to Daily DB.
- **Claude Project** (optional) — pin Personal OS connector + short system context so every chat in that project knows the modes.

**Future / separate project:** cron → API → push notification. Don't block Week 1 on it.

### 2. Novelty-decay survival (in-scope — skills + habits)

ADHD research: new-system engagement fades ~10–14 days ([summary](https://getmotivated.ai/blog/adhd-productivity-system-quitting)). The plan must work when you stop initiating daily.

**In-scope fixes (no code):**

- **Minimum viable loop = capture only.** "dump: X" always works via presenter + Notion connector.
- **Re-entry rule** in presenter skill: if user hasn't engaged in a while, 3-line catch-up — never a backlog dump.
- **No schema tinkering for 30 days** after Week 1 — friction goes to Inbox, not re-architecture (meta-tinkering is documented avoidance).

**Acknowledged tradeoff:** without push, habit formation is on you for the first two weeks. The skill layer makes re-entry painless when you do come back.

### 3. Cross-session memory (in-scope — skills + Notion + Claude)

Every new chat starts fresh. Claude native memory (on by default, ~24h synthesis) is a convenience layer, not something to depend on for presenter rules.

| Memory type | Where it lives (in scope) |
|-------------|---------------------------|
| **Procedural** (presenter, capture, write-gate rules) | AnythingMCP Skills |
| **Semantic** (decisions, projects, people) | Notion + KG |
| **Episodic** (what happened when) | Daily DB + source connectors (Hevy, Calendar) |
| **Working** | Current chat |

Keep skill text in this repo as **documentation** (markdown), not as a runtime dependency. Paste into AnythingMCP when skills change.

### 4. Memory hygiene (in-scope — skill rules)

Writes accumulate without discipline. Encode hygiene in skills, not scripts:

- **Dedup before write** — search Decisions/Actions/Notes first; update, don't duplicate.
- **Staleness** — Actions untouched 30+ days → agent proposes `Later` during "execution audit."
- **Contradiction** — conflicting Decision → surface old one, ask which wins.
- **Write confirm** — capture-confirm template on every write.

### 5. Security: prompt injection via connector content (in-scope — skills + settings)

Gmail/Drive content can carry hidden instructions. Mitigate via configuration:

- **Write-gate skill** — reads free; any write (Notion, draft email, calendar) shown before executing. No auto-writes from external content.
- **Notion scoping** — share only Personal OS databases with the integration.
- **AnythingMCP settings** — keep `kg_edge_auto_apply` and `skillAutoApply` **off**; review connector tool descriptions when adding connectors.

### 6. Backup / exit strategy (out-of-scope to automate)

Notion has no bulk-export API that's one-click. **Automated backup scripts are out of scope.**

**In-scope minimum:** occasional manual workspace export (Notion Settings → Export). Note the lock-in risk; revisit automation only if this becomes a separate project.

### 7. Operational realities (in-scope — skill rules + connector config)

Things that look like "the system is broken" but are configuration issues:

- **Page sharing** — every Notion DB must be shared with the integration; agent creates pages under an already-shared parent.
- **Rate limits** (3 req/s) — presenter skill says "partial results" when search may be incomplete.
- **Silent disconnects** — failure-honesty rule: name unreachable connectors; never fabricate.

### Explicitly out of scope (don't creep back in)

- Cron, schedulers, push notifications, heartbeat agents
- Backup/export automation, custom MCP servers
- Vector DB, Temporal/durable workflows, multi-agent orchestration
- Fine-grained OAuth beyond what AnythingMCP provides per connector

## Implementation timeline

All phases are **configuration work** in AnythingMCP, Notion, and Claude — no custom code.

### Week 1 — Foundation

- [ ] Create Notion **storage** databases (schema above)
- [ ] Share all DBs with Notion integration
- [ ] Write skills in AnythingMCP: **`personal-os-presenter`**, capture, write-gate, dedup-before-write
- [ ] Document skill text in this repo (`docs/skills/`) for version history
- [ ] Enable `kg_capture_intent` in AnythingMCP org settings
- [ ] Seed manual KG edges + 7 Projects + 2–3 Decisions (via Notion MCP in chat)
- [ ] Test loop: one capture → one "find the thread" → verify scannable output

### Weeks 2–3 — Phase 1 connectors

- [ ] Connect **one** connector first (Calendar *or* Gmail — not both at once)
- [ ] Seed manual KG edges for that connector
- [ ] Use daily: "morning brief," "dump:", "what's blocking X"
- [ ] Add remaining Phase 1 connectors as stable
- [ ] First **Skills → Generate** pass in AnythingMCP; review before applying

### Weeks 4–6 — Harden + remote

- [ ] Enable `kg_llm_enabled`; review suggested edges (keep auto-apply off)
- [ ] Phase 2 connectors as needed (GitHub, Docker — read-only skills)
- [ ] Deploy AnythingMCP to **Render** from GitHub ([guide](./render-deploy.md)); re-auth Notion + Hevy
- [ ] Connect Claude Mobile via OAuth MCP URL

### Month 2+ — Phase 3 connectors

- [ ] Health, HA, finance connectors — only if Phase 1 loop is stable
- [ ] Revisit vector DB only if tag search fails at scale (likely still no)

---

## Example query walkthrough

**"Before I message Dimitri, pull career thoughts and unresolved objections."**

1. **KG `kg_how_to_obtain`** → `Person.Dimitri` → tools: Notion `People`, Gmail search, Calendar
2. **Notion** → People row, related Projects/Decisions/Notes (context, not facts)
3. **Gmail** → recent threads (facts at source, thread IDs only)
4. **Calendar** → upcoming meetings (event IDs)
5. **Synthesis** → brief in chat; optional capture to Notion Inbox if new decision

No vector DB. No copying emails into Notion. KG chained the connectors; Notion held the glue-worthy context.

---

## Design principles

1. **What did I already decide?** → Notion Decisions DB
2. **What am I forgetting?** → Execution audit skill + KG observed edges
3. **What has the highest ROI now?** → Projects with `Blocking` + next-action skill
4. **What should I not spend time on?** → Stale project audit
5. **What draft/action can be prepared for approval?** → Agent gathers → proposes → you approve (not autonomous sends/changes)

**Agent pattern:** gather context → propose options → draft actions → you approve.

---

## Bottom line

| Area | How (configuration only) |
|------|--------------------------|
| **Interface** | Claude Mobile/Desktop → AnythingMCP MCP server |
| **Presentation** | Skills: ADHD templates, write-gate, re-entry rules |
| **Storage** | Notion databases + KG manual/observed edges |
| **Facts** | Connectors at source (Hevy, Calendar, Gmail, …) |

Highest-leverage work: **presenter skill + Notion schema + one connector** — then use it in chat. Not scripts. Not dashboards. Not connector bundles.

### Design principle

> **Messy graph in, clean brief out.**  
> Configure the stack. Talk to Claude. Don't build around it.

---

## References

- [AnythingMCP Knowledge Graph guide](https://anythingmcp.com/guides/knowledge-graph-mcp)
- [Notion MCP supported tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)
- [Notion Cookbook skills](https://github.com/makenotion/notion-cookbook/tree/main/skills/claude)
- Research: MRAgent [arXiv:2606.06036](https://arxiv.org/abs/2606.06036), GAM [arXiv:2604.12285](https://arxiv.org/abs/2604.12285), TAG [arXiv:2510.22956](https://arxiv.org/abs/2510.22956)
