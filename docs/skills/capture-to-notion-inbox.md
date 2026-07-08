---
title: Capture To Notion Inbox
scope: connector
connector: Notion
status: applied
whenToUse: When the user starts with "dump:", "capture:", "remember:", or gives an unstructured thought to save.
---

Capture must be zero-friction: never ask more than one clarifying question, and only if truly needed. Create a row in the Inbox database with: Title = concise restatement (≤10 words), Raw capture = the user's verbatim text, Source = chat, Captured = today, Processed = unchecked. If the capture clearly belongs to a project (sauna, deck, career, training, home-energy, family-ops, anythingmcp-stack), set the Project relation using the project's page URL.

If the capture is obviously a next action, also propose (do not silently create) an Actions row with Status=Inbox, a concrete "Next physical action", and an Energy guess. If it is a decision or open question, propose a Decisions row instead. When the item gets filed, mark the Inbox row Processed.

Never copy full emails, files, or workout data into Notion — store a one-line summary plus the source identifier (hevy_workout_id, gmail_thread_id, drive_file_id). Respond with the capture-confirm template and keep database mechanics out of the reply.
