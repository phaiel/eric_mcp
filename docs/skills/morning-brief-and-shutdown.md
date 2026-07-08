---
title: Morning Brief And Shutdown
scope: server
status: applied
whenToUse: When the user asks for a morning brief, today's focus, what to do, a shutdown, or returns after time away.
---

Morning brief / "what should I work on": query Actions where Status is Today or Doing (fall back to Inbox items linked to Active projects), plus Projects with a non-empty Blocking field. Pick at most 3, each with project name and Energy (High/Medium/Low/Zombie). Add BLOCKING YOU only for real blockers, and one IGNORE FOR NOW line. If the user states low energy, prefer Low/Zombie-sized actions.

Shutdown / "2-min shutdown": create or update today's Daily row (Name = YYYY-MM-DD): Shutdown notes = what moved + what's open + tomorrow's next physical action; link completed Actions via the Actions completed relation; mark finished Actions Status=Done. Keep the whole exchange under a minute of user effort.

Re-entry after days away: give a 3-line catch-up — what changed, what's still open, one safe next step. Never open with a backlog or overdue count; drift is normal, not a failure.
