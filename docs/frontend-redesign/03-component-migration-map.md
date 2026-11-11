# 03 — Component Migration Map and Ownership Gates

This is a proposed UI-only migration map. It does not authorize a role to edit files outside its `AGENTS.md` write-fence. Resolve ownership before implementation.

| UI surface | Current source files | Proposed work | Current role gate |
|---|---|---|---|
| Root route and public shell | `web-client/src/App.tsx` | Keep routes/query state; align landing actions and grouped navigation with user goals | E4 owns `App.tsx` |
| Mission-style landing | `web-client/src/components/MissionHero.tsx`, `MissionLaunchpad.tsx` | Independent Spectra identity, user-facing hero, correct CTA destinations, curated starter paths | Neither file is listed in the role write-fence table; resolve owner before edit |
| Global workspaces/search | `web-client/src/components/GlobalCommandHeader.tsx`, `CommandPalette.tsx` | Group destinations, keep search/command palette, prevent desktop and phone clipping | E4 owns both listed files |
| Sky Navigator | `web-client/src/tabs/CelestialNavigator.tsx` | Coverage-first inspector, observation result rows, useful loading/empty/error states; preserve Aladin | E4 owns the tab |
| Candidate catalog drawer | `web-client/src/components/CandidateCatalogDrawer.tsx` | Consider making it a clear “Explore targets” entry; do not change in this pass unless its owner authorizes it | Not listed in the current role write-fence table |
| TimeLens/comparator | `web-client/src/tabs/TimeDomainComparator.tsx`, `web-client/src/components/WebGLComparatorCanvas.tsx` | Group advanced analysis, emphasize frame comparison/timeline, add single-column phone composition | E3 owns both listed files |
| Spectrum | `web-client/src/tabs/SpectrophotometricLab.tsx` | Promote spectrum source badge, progressive disclosure for technical controls | E5 owns this tab |
| Ice Studio | `web-client/src/tabs/MolecularIceStudio.tsx` | Distinguish target/catalog identity from actual spectrum source; group advanced controls | E5 owns this tab |
| Review Desk | `web-client/src/tabs/ObservationDiscussions.tsx` | Replace chat-first feed with a case queue, structured review task, and attached asynchronous discussion; preserve forum APIs | E4 owns this tab |

## Shared constraints

- Preserve the `tab` query values `navigator`, `comparator`, `spectral`, `ice`, `discussions` and all other keys named in `AGENTS.md`.
- Do not change the telemetry store or URL-state hook; they are marked frozen in `AGENTS.md`.
- Do not add packages or alter package/lock files.
- Keep `/explore/*` public and `/admin/*` route-isolated.
- Keep existing backend request/response shapes and observer headers. The redesign is not a backend/data-model migration.
- Use existing component primitives and Tailwind tokens. A component library or CSS architecture change requires a separate decision.

## Safe work split

The screen redesign touches E4, E3, and E5 territories. Assign and verify one issue per role-owned slice. Landing components and the candidate drawer have no owner in the current fence table; do not edit them until governance specifies an owner. Do not ask one role to modify a sibling role’s files just to make a visual pass appear atomic.
