# 06 — Community Review Desk

## Decision

Replace the public chat-first feed with a case-based Review Desk. A visitor should arrive at a candidate, inspect its observation context, submit a structured assessment, and open a focused discussion attached to that same case. The navigation may say “Review”; retain the existing discussions tab query value and forum API.

This is a frontend product specification. It does not amend SPECIFICATION.md, change a backend schema, create an endpoint, or authorize work outside repository issue and role rules.

The design adapts two proven patterns:

1. Zooniverse's subject-first classification: a short optional tutorial, one bounded scientific task, clear response choices, then an optional subject-specific Talk thread.
2. GitHub Discussions' Q&A organization: separate the question from replies and keep the conversation attached to one topic.

Recreate those patterns with Spectra's own visual language and existing controls. Do not copy product branding, assets, code, or exact screens.

## Why the current layout should change

The current Discussions tab puts a dense technical sidebar beside a composer and a long feed. Every feed card mixes candidate metadata, free-form claims, classification buttons, and a reply box. This makes review feel like a chat activity instead of a repeatable scientific task. The fixed-width sidebar and dense cards also compete with the evidence.

The frontend already models structured classification shortcuts, per-thread vote totals, case coordinates, render mode, replies, and a live SSE connection. The forum API already supports listing threads, creating a thread, replies, and classification votes. Make these capabilities easier to use without inventing data or server behavior.

## Feature preservation guard

This is a hierarchy/layout change, not a scope cut. Every currently working public workspace and discussion capability stays reachable. “Review Desk” becomes the guided default; it does not replace the wider case/discussion index.

| Existing capability | Required place after redesign |
|---|---|
| All-sky and current-target discussion scopes | “Browse all cases” view inside Review, available in one click |
| Classification and supported channel filters | Retained in the case index; preserve all server-supported categories |
| Create a candidate/thread from the active scientific context | “New case” action available from both Review and Browse all cases; retain supported title/body/classification/context fields |
| Structured classification choices and per-case vote totals | Primary assessment panel; show totals only when returned by the server |
| Thread body, replies, author handle, timestamps, and verified moderator badge | Case discussion panel |
| Hashtags/tags and case metadata | Case details and index filters where the current API provides them |
| External archive cross-match links | “Evidence sources” disclosure on the case, retaining the current valid links |
| Saved URL-state snapshot and “Load in Workbench” behavior | “Open in TimeLens” (or the existing workspace destination) restores supported state |
| Server-sent live thread/reply/classification updates | Continue using the current SSE service |
| Observer identity and mutation headers | Preserve the current zero-auth behavior unchanged |
| Navigator, TimeLens, Spectrum, and Ice workspaces | Remain available in the public app; this proposal does not remove or rename their routes/query values |

The case index is the successor to the current feed, not a deleted feature. Case discussion remains available per item. The change is that review starts with a selected candidate and evidence, while the full list, filters, and new-case composer remain one click away.

Keep useful seeded examples only as an explicit demo/preview state with the correct synthetic or benchmark badge. Never silently present client seed content as live server data when the forum request fails.

## Main journey

1. Select a review case from the queue or open one from Navigator/TimeLens context.
2. Read a concise question that says what evidence to inspect.
3. Inspect available real observations or reopen the saved context in TimeLens.
4. Submit one supported assessment or choose “Not sure yet.”
5. Review aggregate signals with their real source and sample count.
6. Open the case discussion to compare evidence, ask a question, or reply.
7. Return to the case or choose another available case.

Never imply that votes, comments, or displayed confidence confirm a candidate. Use status language such as “awaiting expert review” only when that status is supplied by real data.

## Desktop layout

Target 1440 × 1000 and 1600 × 1000. Keep the global Spectra header outside the workspace. Below it, show a compact Review Desk header with case title, source/provenance, and a small set of actions.

| Region | Target width | Purpose |
|---|---:|---|
| Case queue | 250–290 px | Search/filter available cases and select one |
| Evidence workspace | Flexible, minimum 600 px | Show target, observation context, dates, band compatibility, and evidence |
| Assessment panel | 280–320 px | Present the structured task, response controls, and submission feedback |

At tablet widths, move the queue into a selectable drawer and keep evidence plus assessment visible. Do not squeeze all three regions into a tablet. Evidence remains the dominant region.

### Header, review queue, and full case index

- Header: back/breadcrumb, case title, coordinate line, accurate source badge, “Open in TimeLens,” and “Discuss this case.”
- Use “Cases” or “Review queue,” never “Live Chat.”
- Put a visible “Browse all cases” control next to the selected-case view. It opens the complete server-backed index with the existing all-sky/current-target scopes and filters.
- Keep “New case” visible from both the selected-case view and the full index. Pre-fill only values already available from the current scientific workspace; keep the existing composer fields and request shape.
- Each queue row: short title, target/coordinates, classification if present, source badge, and vote/reply counts only when returned by the API.
- Preserve the useful existing scopes (all/current target/classification) and expose only channels supported by the server.
- Mark the selected row with color and a second visual indicator. Do not fabricate activity counts.
- Keep the selected case and filters stable when background updates arrive. Do not add URL keys.
- Distinguish loading, empty, stale, disconnected, and failed states. A failed request must not fall back to seeded example threads that look live.

### Evidence workspace

- Show the known target name, RA/Dec, field of view, data source, and saved rendering mode.
- Show an epoch pair only when both observations were actually resolved. Put real dates/MJDs and band beside each frame.
- Show the selected pair/band for blink or difference. Disable difference unless both exposures pass the existing wavelength-matching guard. Never imply continuous unobserved epochs.
- If the thread has insufficient observation state for an image, show metadata and “Open in TimeLens.” Never generate a fake preview or substitute a benchmark image.
- A collapsible “Evidence & provenance” section contains actual source, observation IDs when available, band, processing state, and relevant quality flags. External catalog links appear only when coordinates are valid.
- Retain existing hashtags, supported external cross-match links, and saved-state/workbench actions in case details. Do not drop a field or link just because it is secondary in the new hierarchy.
- Synthetic/demo views retain a persistent synthetic badge on both the case and canvas.

### Assessment panel

Ask one focused question, for example: “What best describes the source in these matched-band observations?” Only offer categories supported by the current server taxonomy:

- Moving source
- Variable source
- Ice/spectral feature
- Likely blend or artifact
- Not sure yet

Map the first four to the existing approved classification keys. “Not sure yet” is a skip/no-vote action unless the active API contract explicitly supports an uncertainty class. Never send an invented vote key.

- Use a single-choice radio group, not tiny vote buttons mixed into each feed card.
- Require an explicit submit action; prevent duplicates while the request is in flight.
- Update the displayed selection and server count only after a successful response. On failure, restore the prior state and offer retry.
- Do not show a confidence slider unless the endpoint for this action accepts and persists confidence. The current thread-vote request uses a classification key; do not silently drop confidence.
- Provide short, task-specific guidance and a dismissible/reopenable first-use tutorial.
- After submission, explain that this is a community assessment and contributes evidence; do not claim consensus or discovery.

### Discussion panel: asynchronous case notes, not a chat room

Discussion is a secondary panel/tab attached to the selected case. It opens from “Discuss this case,” keeps the case identity visible, and does not compete with the evidence canvas or assessment.

- Show the original question/evidence post, chronological replies, author handle, timestamp, and server-verified moderator badge.
- Keep comments attached to their case; do not mix unrelated all-sky chat into the case view.
- Use a simple reply composer with the current API's 2,000-character limit, a remaining-character count, submit progress, and retry/error handling.
- Prompt for useful context (“Include the epoch, band, or coordinate you mean”) without creating a new required field.
- Do not add typing indicators, presence, read receipts, direct messages, or nested reply trees. The current service is an asynchronous forum with SSE updates.
- Announce new replies accessibly without moving keyboard focus. Keep unsent assessment state when opening discussion.
- Do not add report, resolve, accept-answer, or moderation actions unless the backend contract and role rules supply them.

This borrows Zooniverse's separation of task and subject-specific Talk and GitHub's Q&A topic organization. Do not mark an answer accepted or a case resolved without real service state.

## Mobile layout

Target 390 × 844 and 360 × 800. Use one primary column and no horizontal scrolling:

1. Compact header with reachable menu/search.
2. Case selector as a summary or full-screen drawer; do not leave the desktop queue open.
3. Case title, source badge, and coordinates.
4. Full-width evidence canvas; epoch/date actions directly below.
5. One-column assessment controls with touch targets at least 44 × 44 CSS px.
6. Evidence details and discussion in named disclosure sections or case tabs.

Keep the submit action visible after selection without covering evidence or browser controls. Discussion opens as a full-height panel with case title and clear close/back action. Restore prior scroll and selection on close.

## API and state boundaries

Use the existing forum contracts only:

- GET /api/forum/threads — server-backed case list.
- GET /api/forum/stream — live thread/reply/classification updates.
- POST /api/forum/threads — create a case post from current scientific context.
- POST /api/forum/threads/{thread_id}/classifications — the four supported votes.
- POST /api/forum/replies — case-specific comments.

Preserve X-Observer-ID and X-Observer-Key on mutations. Never expose the secret key or internal observer ID. Moderator trust labels remain server-authoritative.

Before implementation, verify request/response fields, supported filters, and event names against current route models and SPECIFICATION.md. This visual redesign does not authorize contract changes or a new classification endpoint. If required evidence fields are missing, link to TimeLens instead of manufacturing evidence.

Client requirements:

- Server data is authoritative. Demo content is labeled and never presented as live.
- Optimistic updates must be reversible. On failure, restore prior state, explain the error, and retain the draft.
- Handle SSE reconnect/disconnect; refresh the list after reconnect if the current hook does not reconcile missed events.
- Deduplicate events and do not change the selected case on background updates.
- Use stable case IDs, never list indexes, for selection.
- Preserve URL query keys, observer headers, and TimeLens deep links.

## Accessibility and interaction quality

- Use semantic headings/landmarks, labelled filters, a labelled radio group, and a labelled reply form.
- Support keyboard operation for queue, tabs, evidence controls, assessment, and discussion. Focus indication must not rely on color alone.
- Announce submission result and new replies in a polite live region; do not announce SSE heartbeats.
- Keep focus in the assessment after submit. Move focus to the discussion heading on open and restore it to the opener on close.
- Respect reduced motion. Blink has pause/step controls and never autoplays on mobile.
- Maintain WCAG AA contrast for body text, badges, chart overlays, controls, focus, and disabled states.
- Supply meaningful alternatives for evidence images; epoch labels and coordinates remain available as text.

## Required states

| State | Treatment |
|---|---|
| Initial load | Skeleton queue and bounded case loading state; retain shell |
| Empty queue | Explain there are no cases; offer Navigator and retry when appropriate |
| No compatible pair | Keep case visible, explain comparison limitation, link to available evidence |
| Archive/benchmark/synthetic | Accurate persistent source badge at case and canvas |
| Vote pending | Prevent duplicates; retain selection |
| Vote failed | Restore selection and show retry |
| SSE reconnecting | Small non-blocking status; existing cases stay usable |
| No comments | Explain there are no case notes; invite an evidence-based question |
| Reply failed | Preserve draft and offer retry |
| Narrow viewport | Queue drawer, one-column case, no clipped controls |

## Screenshot and references

- [Proposed desktop Review Desk screenshot](screenshots/proposed/review-desk-desktop.png)
- [Editable vector source for the mock](screenshots/proposed/review-desk-desktop.svg)
- [Current Discussions screenshot](screenshots/current/spectra-discussions.png)
- [Original Spectra Discovery Lab concept](screenshots/concept/05-discovery-lab.png)
- [Screenshot index](screenshots/README.md)
- [Reference pattern matrix](04-reference-patterns.md)

The proposed mock is an original illustrative layout, not archive data, not a third-party screenshot, and not a claim about current backend metrics.

## Future implementation order

1. Confirm the issue and E4 ownership of ObservationDiscussions.tsx; read the assigned issue acceptance criteria. Do not touch sibling role files.
2. Verify route models, frontend hooks, observer headers, event names, and error states.
3. Implement desktop case/assessment hierarchy with existing primitives; preserve APIs and query state.
4. Implement the case discussion panel, SSE reconciliation, and composer error handling.
5. Implement phone layout, keyboard, and focus behavior.
6. Verify server-backed examples and unavailable states; capture desktop and phone screenshots. This visual work does not amend or complete a phase gate.

## Acceptance

- The first screen presents a review case and assessment action, not a general chat composer.
- Discussion is visibly attached to its candidate and retains case context.
- Source, coordinates, and available real observations are visible before voting.
- Vote labels map to allowed server keys; “Not sure yet” never creates an unsupported vote.
- Unsupported confidence, accepted-answer, resolution, presence, and moderation controls are absent.
- No mock case or activity count is shown as live data.
- SSE updates do not steal focus or replace the selected case; reconnect refreshes missed state.
- Mutations preserve zero-auth headers and moderator badges are server-authoritative.
- Desktop and mobile states are usable at the specified viewports.
