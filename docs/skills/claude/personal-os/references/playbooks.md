# Playbooks

Read only the section you need.

## Contents

- [Capture](#capture)
- [Find the thread](#find-the-thread)
- [Morning brief](#morning-brief)
- [Shutdown](#shutdown)
- [Re-entry](#re-entry)
- [Training](#training)
- [Dedup before write](#dedup-before-write)

---

## Capture

Zero friction. At most one clarifying question.

1. `API-post-page` → Inbox: Title (≤10 words), Raw capture (verbatim), Source=chat, Captured=today, Processed=false.
2. Set Project relation if slug is clear (see notion.md).
3. If obviously an action or decision → **propose** Action/Decision row; do not silently create.
4. Reply with capture-confirm template.

Never copy full emails, files, or workouts into Notion.

---

## Find the thread

1. Resolve topic → `API-post-search` or known `project_slug`.
2. Decisions for that project — latest non-superseded only.
3. Project Blocking, Decision gate, open Actions.
4. Connector facts only if thin (Hevy for training; Gmail/Drive when connected). `kg_how_to_obtain` if unsure.
5. Use find-the-thread template.

No decision → say so; ≤3 open questions; offer to capture one. No raw dumps or URLs.

---

## Morning brief

0. **Calendar** (if `gcal_*` connected): today's events from `primary` + any family calendar ids from [google-calendar.md](google-calendar.md). One-line schedule context before commitments.
1. Actions Status Today/Doing; fallback Inbox on active projects.
2. Projects with non-empty Blocking.
3. Pick ≤3 with project + Energy (High/Medium/Low/Zombie).
4. BLOCKING YOU (0–2 real only). One IGNORE FOR NOW line.
5. Low energy from user → prefer Low/Zombie actions.

---

## Shutdown

1. Daily row Name=`YYYY-MM-DD`.
2. Shutdown notes: moved, open, tomorrow's next physical action.
3. Link completed Actions; mark Done.
4. Under one minute of user effort; batch write proposals.

---

## Re-entry

Three lines after time away—no overdue lecture:

1. What changed
2. What's still open (≤3)
3. One safe next step

---

## Training

Hevy = source of truth. Never full workout JSON in Notion.

**Summarize:** fetch Hevy → title, duration, key lifts, top sets, kg→lb, one hypothesis (not medical advice).

**Log:** Daily row with exact `hevy_workout_id` + one-line summary in Energy log or Shutdown notes.

**Trends:** same `exercise_template_id`; note data gaps.

---

## Dedup before write

Before create on Projects, Decisions, Actions, Inbox:

1. `API-post-search` titles, slugs, synonyms.
2. Match exists → update/relate, don't duplicate.
3. Decisions: same Project → surface prior; supersede with Supersedes relation, mark old Superseded.
4. Actions: update existing row before creating twin.
5. Connector facts beat Notion when they conflict.

Actions idle 30+ days → propose Later.
