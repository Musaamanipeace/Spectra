# 02 — Screen-by-Screen Specifications

These are layout and interaction requirements, not new science or backend requirements. Existing data models, routes, and query state remain in force.

## A. Public home (`/`)

### Desktop

- Compact Spectra header with goal-based navigation, persistent search, and one primary action.
- Hero headline, short promise, primary/secondary actions, and one visual preview explicitly labeled illustrative if it is not archive data.
- Three starter cards below the hero. Keep the curated target catalog below this first-use layer.
- Move the verified mission facts/stat block below the first-use actions; do not remove its sourced content. Use Spectra's own identity and retain clear NASA/SPHEREx/IRSA data attribution without implying ownership/partnership.

### Phone

- Stack headline, copy, actions, and starter cards in one column.
- Keep search reachable without horizontal scrolling.
- Do not force the desktop global header into a narrow viewport; use the existing accessible menu primitives.

### Required action mapping

- “Start exploring” → `/explore?tab=navigator`.
- “Compare observations” → `/explore?tab=comparator`.
- “Try a discovery mission” → a real tutorial/task route or an explicit unavailable state until one exists.

## B. Public shell and navigation

- Keep one global search/command entry. Group keyboard shortcuts and expose them in a discoverable help/tooltip surface.
- Replace the current dense row of numbered workspaces with goal-based primary navigation. Keep a secondary workspace selector where technical modes are needed.
- Ensure the header fits at 1440 px and collapses at phone widths without clipping labels or actions.
- Keep route and query state shareable. Header selection must reflect the current route and query state.

## C. Navigator (`/explore?tab=navigator`)

### Desktop composition

- Search/coordinate command row at the top of the workspace.
- Aladin Lite remains the dominant sky canvas.
- Selected-region inspector sits beside the map. It contains target/coordinates, observation coverage, available epochs, collection/release, band/detector summary, and quality/provenance.
- Observation matches are selectable rows. Each row shows actual timestamp, source/release, band or detector, and relevant availability/quality state.
- “Open in TimeLens” appears only for a usable comparison set. Archive and advanced constraints live in a collapsible filter drawer.

### Loading and empty states

- While tiles/catalog/archive requests load, show a bounded progress state with the operation name and a retry/cancel route where supported.
- If the map base layer fails, preserve search and inspector and show a visible map error; do not leave an unexplained black canvas.
- Show explicit no-coverage, insufficient-epochs, incompatible-band, and failed-query states.
- Any synthetic preview must say “Synthetic preview” in the canvas and inspector and must not look like a returned archive observation.

## D. TimeLens / Comparator (`/explore?tab=comparator`)

### Desktop composition

- Keep the comparison canvas as the largest region.
- Keep selected target and provenance above the canvas.
- Make the primary comparison controls easy to scan: selected epochs, Blink / Side-by-side / Difference, and timeline.
- Put actual observation dates on the frame/timeline. Preserve wavelength/band compatibility and difference guards.
- Group Asinh/stretch, color map, coverage matrix, light curve, motion calculator, co-add, and pixel diagnostics under clearly named analysis sections. The current simultaneous right-hand stack is too dense for the default path.
- Preserve the existing persistent simulated-data watermark when a simulated frame is displayed.

### Phone composition

- One-column layout with full-width canvas and no horizontal overflow.
- Keep epoch stepping/playback close to the image. Place advanced controls in a bottom sheet or accordion below it.
- Text, controls, and comparison mode labels must remain readable and non-overlapping at 390 × 844.
- Do not remove discrete survey timestamps or imply unobserved continuous frames.

## E. Spectrum (`/explore?tab=spectral`)

- Keep the spectrum and uncertainty visualization prominent.
- Put a source chip directly next to the spectrum title, describing the spectrum being plotted: archive, benchmark cache, synthetic/demo, or unavailable.
- Keep units, wavelength metadata, uncertainty/flags, selected pixel/target, and observation epoch reachable without placing all technical details in the first-use path.
- If a generated preview is used, show a persistent preview label in the chart header and explain how to switch to available archive data. Do not present a deterministic preview as extracted WCS-WAVE data.
- Preserve the pixel-to-spectrum link and scientific query state.

## F. Ice (`/explore?tab=ice`)

- Keep the spectral plot and molecular result table, but group controls into source/target, photometry, continuum/optical-depth, and results sections.
- Source badge describes the actual displayed spectrum. Distinguish the target’s benchmark identity from a synthetic SPLICES template source.
- Keep scientific guardrails and suppressed/unavailable results visible beside the result they qualify.
- Collapse formulas, tuning values, and advanced aperture options by default; expose them on request.

## G. Review Desk (`/explore?tab=discussions`)

- Replace the general post-and-reply feed as the first screen with a selected case, evidence workspace, and structured assessment.
- Keep the existing discussions URL value and forum service. The public navigation label may become “Review.”
- Case-specific asynchronous discussion is secondary to the review task and remains attached to the candidate.
- Do not show confidence, status, answer acceptance, or moderation controls unless the current server contract supplies them.
- Use an optional first-use tutorial, accurate source labels, and the server's existing vote categories.
- See [06 — Community Review Desk](06-community-review-desk.md) for layout, interaction, responsive states, API constraints, accessibility, and acceptance details.

## H. Admin (`/admin/*`)

Redesign the presentation of Mission Control while keeping it route-isolated and zero-auth. Preserve all five workspaces and the existing read-only-by-default behavior. See [08 — Admin Mission Control](08-admin-mission-control.md) for the full screen and component specification.
