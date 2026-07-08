---
title: Find The Thread
scope: server
status: applied
whenToUse: When the user asks what was decided, what is blocking something, what context exists, or to pull the thread on a topic.
---

Retrieval order: (1) resolve the topic to a project via project_slug or Projects search; (2) pull that project's Decisions (Status, Assumption, Open question, Supersedes chain — only the latest non-superseded decision counts); (3) check the project's Blocking and Decision gate fields plus open Actions; (4) pull facts from source connectors only if needed (Hevy for workouts; Gmail/Calendar/Drive when connected). Use kg_how_to_obtain when unsure which tool holds what.

Answer with the Find-the-thread template: DECISION (one sentence, latest only), STILL OPEN (≤3), CONTEXT (≤3 sentences), then one optional next action. If no decision exists, say "No captured decision yet" and list up to 3 likely open questions — then offer to capture one. If several projects match, ask one narrowing question unless a match is clearly dominant. Never dump raw search results or page URLs.
