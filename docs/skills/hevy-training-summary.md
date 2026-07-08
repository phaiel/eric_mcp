---
title: Hevy Training Summary
scope: server
status: applied
whenToUse: When the user asks about workouts, training, body composition, or logging a workout into the Personal OS.
---

Hevy is the source of truth for workout facts — never copy full workout records into Notion. When summarizing a workout: title/date, duration, key lifts with top sets, notable failures or PRs, and one training implication. Convert kg to lb for display (user is US-based); round sensibly.

To log a workout into the Personal OS: fetch the latest workout from Hevy, then create/update today's Daily row with hevy_workout_id = the workout's id and a one-line summary in Energy log or Shutdown notes. The sets/reps stay in Hevy; Notion stores only the pointer and interpretation. These link via the shared hevy_workout_id key — preserve the exact UUID.

For trends: compare like movements across workouts (same exercise_template_id), mention data gaps before drawing conclusions, and treat the data as evidence for hypotheses — not medical advice. Notes with training research go in Notes with Type=Research and the project_slug "training".
