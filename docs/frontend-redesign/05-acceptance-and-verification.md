# 05 — Acceptance Criteria and Implementation Sequence

## Pass A — Public entry and shell

1. Root page says Spectra and describes an independent community product using public SPHEREx data.
2. Spectra-owned header/footer do not imply NASA/JPL ownership or partnership.
3. “Start exploring” opens `tab=navigator`; any “compare” CTA opens `tab=comparator`.
4. Home presents three starter paths: Explore an object, Watch the sky change, Review a candidate.
5. Global navigation fits at desktop and collapses accessibly at phone width. Search/command palette remains discoverable.

## Pass B — Navigator and TimeLens

1. Navigator retains Aladin Lite and connects map/source selection to an observation-aware inspector.
2. Observation cards show actual date, collection/release, band/detector, and source/provenance.
3. `Open in TimeLens` appears only when a valid comparison set exists.
4. Loading, no coverage, insufficient epochs, incompatible band, and request failure are distinct states.
5. Comparator keeps the image dominant, dates visible, and timeline discrete. Advanced controls are grouped/collapsible.
6. At 390 × 844, the comparator has no horizontal page scroll, clipping, or overlapping controls.

## Pass C — Source honesty and review flow

1. Spectrum/Ice source labels sit by the displayed product title and describe the actual data, not only the target.
2. Synthetic/demo mode is visibly distinct at the chart/canvas and remains distinct in any shared state.
3. Review Desk has one clear assessment task, a short optional tutorial, a supported “Not sure yet” path, evidence, and an attached case discussion; it does not invent confidence or resolution states.

## Invariants for all passes

- No current user-visible feature is removed. Every changed label, location, or default must have a reason and preservation path in [07 — Whole-App Feature Preservation](07-feature-preservation-register.md).
- The full case feed and new-case composer remain reachable from Review.
- Advanced controls may be grouped or collapsed, but must remain functional, keyboard accessible, and directly reachable.
- Keep current URL keys and current `tab` values.
- Keep `/explore/*` and `/admin/*` separated and preserve zero-auth public behavior.
- Preserve observer mutation headers, tensor/API contracts, science guards, real observation timestamps, and source badges.
- Do not add dependencies or lockfile changes.
- Do not create false live metrics or reuse concept mockup art as scientific imagery.
- Do not edit files outside the verified role/issue write-fence.

## Visual review matrix

For each authorized pass, capture and review:

| View | Required checks |
|---|---|
| Home, desktop 1440 × 1000 | Clear purpose, CTA destination, readable hierarchy, starter paths in first-use view |
| Navigator, desktop 1440 × 1000 | Map dominance, selection inspector, coverage and observation source details |
| Comparator, desktop 1440 × 1000 | Image/timeline hierarchy, dates, modes, advanced controls grouped |
| Comparator, phone 390 × 844 | No horizontal scrolling, overlap, clipped navigation, or inaccessible epoch actions |
| Spectrum and Ice, desktop | Product source badge adjacent to plot, units/quality/provenance reachable |
| Review Desk, desktop and phone | Single-task focus, response controls, source provenance, and attached case discussion |

Test live data only with a working backend/archive and record which data state was displayed. A healthy `/api/health` response alone does not prove that the archive, database, or scientific processing path is live.

## Suggested next-chat instruction

Start with Pass A only after confirming the assigned issue and role owners. Pass B belongs across E4/E3 territories; Pass C spans E5/E4. `MissionHero.tsx`, `MissionLaunchpad.tsx`, and `CandidateCatalogDrawer.tsx` need an explicit owner before edits because the current role fence does not list them.
