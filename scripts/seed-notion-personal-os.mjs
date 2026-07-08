#!/usr/bin/env node
/**
 * Seed the Personal OS storage layer in Notion through the AnythingMCP endpoint.
 *
 * Creates (in dependency order, so relations resolve):
 *   Personal OS page → Areas → Projects → Decisions → Actions → Inbox → Daily
 *   → Notes → People → Tag Definitions
 * then seeds golden rows (areas, 7 projects, decisions, tags, sample capture).
 *
 * Writes all created IDs to docs/personal-os-notion-manifest.json — that file is
 * the source of truth for data source IDs used by skills and KG edges.
 *
 * Usage: node scripts/seed-notion-personal-os.mjs
 * Env:   MCP_URL, MCP_API_KEY override the defaults below.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'docs', 'personal-os-notion-manifest.json');

const MCP_URL =
  process.env.MCP_URL || 'https://personal-os-mcp.onrender.com/mcp/cmrbfay0e00032eh39ymrpfw7';
const MCP_API_KEY =
  process.env.MCP_API_KEY ||
  JSON.parse(readFileSync(path.join(ROOT, '.cursor', 'mcp.json'), 'utf8')).mcpServers[
    'personal-os'
  ].headers['x-api-key'];

let rpcId = 0;
async function mcpCall(name, args) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'x-api-key': MCP_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body,
        signal: AbortSignal.timeout(30000),
      });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.warn(`fetch retry ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  const raw = await res.text();
  const line = raw.split('\n').find((l) => l.startsWith('data: '));
  const payload = line ? JSON.parse(line.slice(6)) : JSON.parse(raw);
  let text = payload?.result?.content?.[0]?.text ?? '';
  let isError = !!payload?.result?.isError;
  // AnythingMCP's MCP-bridge wraps the remote tool's envelope as text — unwrap.
  for (let i = 0; i < 3; i++) {
    try {
      const inner = JSON.parse(text);
      if (inner && Array.isArray(inner.content) && inner.content[0]?.type === 'text') {
        isError = isError || !!inner.isError;
        text = inner.content[0].text;
        continue;
      }
    } catch {
      /* not an envelope */
    }
    break;
  }
  if (isError) throw new Error(`${name} failed: ${text.slice(0, 600)}`);
  return text;
}

const dsId = (text) => {
  const m = text.match(/collection:\/\/([0-9a-f-]{36})/);
  if (!m) throw new Error(`No data source id in response: ${text.slice(0, 400)}`);
  return m[1];
};
const pageRefs = (text) => {
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json.pages)) return json.pages.map((p) => ({ id: p.id, url: p.url }));
  } catch {
    /* fall through to regex */
  }
  return [...text.matchAll(/(https:\/\/[a-z.]*notion\.(?:so|com)\/[^\s)"']*?([0-9a-f]{32}))/g)].map(
    (m) => ({ id: m[2], url: m[1] }),
  );
};
const pageIds = (text) => pageRefs(text).map((p) => p.id);

async function createDb(parentPageId, title, description, schema) {
  const text = await mcpCall('notion-create-database', {
    parent: { page_id: parentPageId },
    title,
    description,
    schema,
    _intent: `Seed Personal OS storage: create ${title} database`,
  });
  const id = dsId(text);
  console.log(`db: ${title} → ${id}`);
  return id;
}

/**
 * Create rows in a data source. Relation property values MUST be page URLs
 * (e.g. https://app.notion.com/p/<id>), not bare page IDs — the Notion MCP
 * rejects bare IDs for relations with "Invalid agent URL".
 */
async function createPages(dataSourceId, pages, intent) {
  const text = await mcpCall('notion-create-pages', {
    parent: { data_source_id: dataSourceId },
    pages,
    _intent: intent,
  });
  const refs = pageRefs(text);
  if (refs.length !== pages.length) {
    throw new Error(`Expected ${pages.length} rows, created ${refs.length}: ${text.slice(0, 300)}`);
  }
  console.log(`rows: ${pages.length} created`);
  return { text, ids: refs.map((r) => r.id), urls: refs.map((r) => r.url) };
}

async function main() {
  if (existsSync(MANIFEST_PATH)) {
    console.error(`Manifest already exists (${MANIFEST_PATH}). Delete it to re-seed.`);
    process.exit(1);
  }

  // ── Parent page ───────────────────────────────────────────────────────────
  if (process.env.PARENT_PAGE_ID) {
    console.log(`parent page (reused): ${process.env.PARENT_PAGE_ID}`);
  }
  const parentText = process.env.PARENT_PAGE_ID
    ? JSON.stringify({ pages: [{ id: process.env.PARENT_PAGE_ID, url: '' }] })
    : await mcpCall('notion-create-pages', {
    pages: [
      {
        properties: { title: 'Personal OS' },
        icon: '🧠',
        content: [
          '# Personal OS — storage layer',
          '',
          'This page holds the Personal OS databases. The agent (Claude via AnythingMCP) reads and writes them; you normally interact through chat, not here.',
          '',
          'Conventions:',
          '- `project_slug` is the cross-database key (kebab-case, e.g. `sauna`).',
          '- Cross-connector IDs use shared property names: `hevy_workout_id`, `gmail_thread_id`, `calendar_event_id`, `drive_file_id`.',
          '- Facts live in source systems (Hevy, Gmail…); Notion holds decisions, context, and synthesis.',
          '- Tags used on Notes/Inbox are defined in the Tag Definitions database.',
        ].join('\n'),
      },
    ],
    _intent: 'Seed Personal OS parent page',
  });
  const parentPageId = pageIds(parentText)[0];
  if (!parentPageId) throw new Error(`No parent page id: ${parentText.slice(0, 400)}`);
  const parentUrl = parentText.match(/https:\/\/[a-z.]*notion\.(?:so|com)\/[^\s"']+/)?.[0] ?? '';
  console.log(`parent page: ${parentPageId}`);

  // ── Databases (dependency order) ─────────────────────────────────────────
  const areas = await createDb(
    parentPageId,
    'Areas',
    'PARA Areas — ongoing life domains. Projects roll up here.',
    `CREATE TABLE ("Name" TITLE, "Review cadence" SELECT('Weekly':blue, 'Monthly':green, 'Quarterly':yellow), "Description" RICH_TEXT)`,
  );

  const projects = await createDb(
    parentPageId,
    'Projects',
    'Active projects with outcomes. project_slug is the cross-database key.',
    `CREATE TABLE ("Name" TITLE, "project_slug" RICH_TEXT COMMENT 'kebab-case key used across all databases and connectors', "Status" SELECT('Active':green, 'Paused':yellow, 'Done':gray, 'Someday':blue), "Blocking" RICH_TEXT COMMENT 'What is blocked or blocking right now', "Decision gate" RICH_TEXT COMMENT 'Decision that must be made before next action', "Next action" RICH_TEXT, "Area" RELATION('${areas}', DUAL 'Projects'))`,
  );

  const decisions = await createDb(
    parentPageId,
    'Decisions',
    'Decision log — prevents re-litigating. One row per decision; supersede instead of editing history.',
    `CREATE TABLE ("Decision" TITLE, "Project" RELATION('${projects}', DUAL 'Decisions'), "Assumption" RICH_TEXT COMMENT 'What this decision assumes true', "Open question" RICH_TEXT, "Status" SELECT('Open':yellow, 'Decided':green, 'Superseded':gray), "Date" DATE, "Source" RICH_TEXT COMMENT 'Where this came from: chat, email thread id, meeting')`,
  );
  // Self-relation must be added after creation (needs own data source id).
  await mcpCall('notion-update-data-source', {
    data_source_id: decisions,
    statements: `ADD COLUMN "Supersedes" RELATION('${decisions}', DUAL 'Superseded by' 'superseded_by')`,
    _intent: 'Add Supersedes self-relation to Decisions',
  });
  console.log('db: Decisions self-relation added');

  const actions = await createDb(
    parentPageId,
    'Actions',
    'GTD next actions. Agent filters by Status + Energy. Every action should link a Project.',
    `CREATE TABLE ("Name" TITLE, "Status" SELECT('Inbox':gray, 'Today':red, 'Doing':orange, 'Done':green, 'Later':blue), "Energy" SELECT('High':red, 'Medium':yellow, 'Low':green, 'Zombie':gray) COMMENT 'Energy needed: Zombie = <15min win to break freeze', "Size" SELECT('Quick':green, 'Standard':yellow, 'Deep':red), "Project" RELATION('${projects}', DUAL 'Actions'), "Next physical action" RICH_TEXT COMMENT 'Concrete physical step, not a vague goal', "Blocked" CHECKBOX, "Due" DATE)`,
  );

  const inbox = await createDb(
    parentPageId,
    'Inbox',
    'Capture landing zone. Agent writes raw dumps here, then files them. Processed = filed.',
    `CREATE TABLE ("Title" TITLE, "Raw capture" RICH_TEXT COMMENT 'Verbatim user text', "Source" SELECT('chat':blue, 'email':orange, 'manual':gray), "Processed" CHECKBOX, "Captured" DATE, "Project" RELATION('${projects}', DUAL 'Inbox items'))`,
  );

  const daily = await createDb(
    parentPageId,
    'Daily',
    'Daily log: energy, shutdown notes, workout link. One row per day.',
    `CREATE TABLE ("Name" TITLE COMMENT 'YYYY-MM-DD', "Date" DATE, "Energy log" RICH_TEXT, "Shutdown notes" RICH_TEXT COMMENT 'What moved, what is open, next physical action for tomorrow', "hevy_workout_id" RICH_TEXT COMMENT 'Hevy workout id — facts stay in Hevy', "Actions completed" RELATION('${actions}', DUAL 'Daily'))`,
  );

  const notes = await createDb(
    parentPageId,
    'Notes',
    'PARA Resources — stable context and synthesis. Tags are defined in Tag Definitions.',
    `CREATE TABLE ("Name" TITLE, "Type" SELECT('Research':purple, 'Reference':blue, 'Synthesis':green, 'Journal':gray), "Tags" MULTI_SELECT('research':purple, 'decision-support':yellow, 'reference':blue, 'idea':green, 'followup':red), "Status" SELECT('Active':green, 'Archive':gray), "project_slug" RICH_TEXT, "Project" RELATION('${projects}', DUAL 'Notes'), "Source pointer" RICH_TEXT COMMENT 'External id or URL: drive_file_id, pmid, thread id — never full copies')`,
  );
  await mcpCall('notion-update-data-source', {
    data_source_id: notes,
    statements: `ADD COLUMN "Parent" RELATION('${notes}', DUAL 'Children' 'children')`,
    _intent: 'Add Parent/Children self-relation to Notes',
  });
  console.log('db: Notes self-relation added');

  const people = await createDb(
    parentPageId,
    'People',
    'Relationship graph — context for meetings and follow-ups.',
    `CREATE TABLE ("Name" TITLE, "Role" RICH_TEXT, "Org" RICH_TEXT, "Incentives" RICH_TEXT COMMENT 'What they care about / their likely angle', "Last touch" DATE, "Email" EMAIL, "Related projects" RELATION('${projects}', DUAL 'People'))`,
  );

  const tags = await createDb(
    parentPageId,
    'Tag Definitions',
    'Agent routing table: what each tag means and its synonyms. Keep small.',
    `CREATE TABLE ("Tag" TITLE, "Definition" RICH_TEXT, "Synonyms" RICH_TEXT, "Applies to" RICH_TEXT COMMENT 'Which databases use this tag')`,
  );

  // ── Goldens ───────────────────────────────────────────────────────────────
  console.log('\nSeeding goldens…');

  const { urls: areaUrls } = await createPages(
    areas,
    [
      { properties: { Name: 'Home', 'Review cadence': 'Monthly', Description: 'House projects: sauna, deck, energy.' } },
      { properties: { Name: 'Work', 'Review cadence': 'Weekly', Description: 'Career, product move, stakeholders.' } },
      { properties: { Name: 'Health', 'Review cadence': 'Weekly', Description: 'Training, body comp, labs.' } },
      { properties: { Name: 'Life', 'Review cadence': 'Monthly', Description: 'Family ops, recurring commitments.' } },
      { properties: { Name: 'Tech', 'Review cadence': 'Monthly', Description: 'AnythingMCP stack, agent infra, homelab.' } },
    ],
    'Seed Personal OS areas',
  );
  const [homeId, workId, healthId, lifeId, techId] = areaUrls;

  const projectRows = [
    ['Sauna build', 'sauna', homeId, 'Final door size + heater wall clearances', 'Confirm door rough opening measurement'],
    ['Deck rebuild', 'deck', homeId, 'Engineering assumptions on soil report', 'Review soil report against footing plan'],
    ['Career / product move', 'career', workId, '', 'Draft framing for next Dimitri conversation'],
    ['Training & body comp', 'training', healthId, '', 'Log workouts in Hevy; weekly summary to Daily'],
    ['Home energy', 'home-energy', homeId, '', 'Update ROI sheet with current usage'],
    ['Family ops', 'family-ops', lifeId, '', 'Review recurring calendar commitments'],
    ['AnythingMCP stack', 'anythingmcp-stack', techId, '', 'Week 1 loop test: capture → find the thread'],
  ];
  const { urls: projectUrls } = await createPages(
    projects,
    projectRows.map(([name, slug, areaUrl, blocking, next]) => ({
      properties: {
        Name: name,
        project_slug: slug,
        Status: 'Active',
        ...(blocking ? { Blocking: blocking } : {}),
        'Next action': next,
        Area: areaUrl,
      },
    })),
    'Seed Personal OS projects',
  );
  const projBySlug = Object.fromEntries(projectRows.map(([, slug], i) => [slug, projectUrls[i]]));

  await createPages(
    decisions,
    [
      {
        properties: {
          Decision: 'Sauna cladding: aspen above bench exposure, pine below in hidden zones',
          Project: projBySlug['sauna'],
          Assumption: '3.1" board face width',
          'Open question': 'Final door size; heater wall clearances',
          Status: 'Open',
          'date:Date:start': '2026-07-01',
          'date:Date:is_datetime': 0,
          Source: 'chat',
        },
      },
      {
        properties: {
          Decision: 'Notion over Obsidian for Personal OS storage; AnythingMCP on Render as the gateway',
          Project: projBySlug['anythingmcp-stack'],
          Assumption: 'Claude Mobile needs a public HTTPS MCP endpoint with OAuth',
          'Open question': 'Render free tier cold starts — upgrade if annoying',
          Status: 'Decided',
          'date:Date:start': '2026-07-07',
          'date:Date:is_datetime': 0,
          Source: 'chat',
        },
      },
      {
        properties: {
          Decision: 'Workout facts stay in Hevy; Notion Daily gets summary + hevy_workout_id only',
          Project: projBySlug['training'],
          Assumption: 'Hevy API remains the source of truth for sets/reps',
          Status: 'Decided',
          'date:Date:start': '2026-07-07',
          'date:Date:is_datetime': 0,
          Source: 'chat',
        },
      },
    ],
    'Seed Personal OS golden decisions',
  );

  await createPages(
    actions,
    [
      {
        properties: {
          Name: 'Measure sauna door rough opening',
          Status: 'Today',
          Energy: 'Low',
          Size: 'Quick',
          Project: projBySlug['sauna'],
          'Next physical action': 'Tape measure to the framed opening; write W×H in inches',
        },
      },
      {
        properties: {
          Name: 'Confirm heater wall clearances from manual',
          Status: 'Today',
          Energy: 'Medium',
          Size: 'Standard',
          Project: projBySlug['sauna'],
          'Next physical action': 'Open heater manual PDF; note min clearances for walls/ceiling',
        },
      },
      {
        properties: {
          Name: 'Run Week 1 loop test (capture → find the thread)',
          Status: 'Today',
          Energy: 'Low',
          Size: 'Quick',
          Project: projBySlug['anythingmcp-stack'],
          'Next physical action': 'In Claude: "dump: test capture" then "what\'s blocking sauna?"',
        },
      },
    ],
    'Seed Personal OS golden actions',
  );

  await createPages(
    inbox,
    [
      {
        properties: {
          Title: 'GOLDEN EXAMPLE — check sauna door size before ordering cladding',
          'Raw capture': 'dump: need to check door size for sauna before the cladding order',
          Source: 'chat',
          Processed: '__YES__',
          'date:Captured:start': '2026-07-07',
          'date:Captured:is_datetime': 0,
          Project: projBySlug['sauna'],
        },
        content:
          'This row shows the capture pattern: verbatim text in Raw capture, Source=chat, linked to a Project, marked Processed once filed (here it became the "Measure sauna door rough opening" action).',
      },
    ],
    'Seed Personal OS golden inbox capture',
  );

  await createPages(
    daily,
    [
      {
        properties: {
          Name: '2026-07-07',
          'date:Date:start': '2026-07-07',
          'date:Date:is_datetime': 0,
          'Energy log': 'PM: medium',
          'Shutdown notes':
            'Personal OS deployed: Render + Hevy + Notion + skills. Tomorrow: run Week 1 loop test.',
          hevy_workout_id: 'ed9744a2-7bb5-45d5-9519-dc4622b7b0c2',
        },
        content:
          'Golden Daily row: workout referenced by hevy_workout_id only — sets/reps live in Hevy. Shutdown notes say what moved and the next physical action.',
      },
    ],
    'Seed Personal OS golden daily row',
  );

  await createPages(
    people,
    [
      {
        properties: {
          Name: 'Dimitri',
          Role: 'Career stakeholder',
          Incentives: 'Fill in: what he optimizes for, likely angle in conversations',
          'Related projects': projBySlug['career'],
        },
      },
    ],
    'Seed Personal OS golden person',
  );

  await createPages(
    tags,
    [
      { properties: { Tag: 'research', Definition: 'Quality-filtered findings: specs, papers, primary sources. Never vendor blurbs.', Synonyms: 'study, evidence, spec', 'Applies to': 'Notes' } },
      { properties: { Tag: 'decision-support', Definition: 'Context gathered to make a specific pending decision.', Synonyms: 'options, tradeoffs', 'Applies to': 'Notes' } },
      { properties: { Tag: 'reference', Definition: 'Stable how-to or lookup info, rarely changes.', Synonyms: 'manual, doc', 'Applies to': 'Notes' } },
      { properties: { Tag: 'idea', Definition: 'Unvalidated thought worth keeping; not a commitment.', Synonyms: 'someday, maybe', 'Applies to': 'Notes, Inbox' } },
      { properties: { Tag: 'followup', Definition: 'Owes or is owed a response; check during execution audit.', Synonyms: 'waiting-on, owed', 'Applies to': 'Notes, Inbox' } },
    ],
    'Seed Personal OS tag definitions',
  );

  // ── Manifest ──────────────────────────────────────────────────────────────
  const manifest = {
    seededAt: new Date().toISOString(),
    parentPage: { id: parentPageId, url: parentUrl },
    dataSources: { areas, projects, decisions, actions, inbox, daily, notes, people, tagDefinitions: tags },
    projectPageUrlsBySlug: projBySlug,
    conventions: {
      crossDatabaseKey: 'project_slug',
      crossConnectorIds: ['hevy_workout_id', 'gmail_thread_id', 'calendar_event_id', 'drive_file_id', 'github_issue_id'],
    },
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nmanifest → ${MANIFEST_PATH}`);
  console.log(`Personal OS page: ${parentUrl}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
