# Spectra Frontend Redesign Packet

This packet specifies the frontend migration from the current mission-console presentation to a guided public experience built around real observations, comparison, evidence, and optional community review.

The packet proposes layout and hierarchy changes, not a feature reduction. See [07 — Whole-App Feature Preservation](07-feature-preservation-register.md) for the keep/move/change register and required justification for every proposal.

## Decision

Make **Explore → Coverage → Compare → Evidence → Review** the public product’s main path. Keep the existing scientific capabilities, API, URL state, and `/explore` versus `/admin` separation. Rework navigation and layouts so a visitor can use the app before learning its scientific modules.

## Reading order

1. [Product direction and information architecture](01-product-and-information-architecture.md)
2. [Screen-by-screen specifications](02-screen-specifications.md)
3. [Component migration map and ownership gates](03-component-migration-map.md)
4. [Reference patterns and reuse notes](04-reference-patterns.md)
5. [Acceptance criteria and implementation sequence](05-acceptance-and-verification.md)
6. [Community Review Desk specification](06-community-review-desk.md)
7. [Whole-app feature preservation and change register](07-feature-preservation-register.md)
8. [Admin Mission Control specification](08-admin-mission-control.md)
9. [Screenshot gallery](screenshots/README.md)

## Scope

The first redesign pass covers the public landing page, global public navigation, Navigator entry, and responsive behavior for TimeLens. The next pass recomposes the Navigator and comparator. A later pass improves provenance hierarchy and implements the case-based Review Desk. Admin Mission Control has a separate specification in [08 — Admin Mission Control](08-admin-mission-control.md); it remains isolated from the public suite and must retain all five workspaces and its security defaults.

This packet contains a visual audit, not a claim that the application’s live science pipeline was verified. During the review, FastAPI health was healthy while Supabase reported offline. Captured science screens therefore showed cached, preview, or fallback modes. Navigator rendering in headless Chrome was inconclusive, and the admin route capture showed only the global loading fallback, so its live workspaces still need runtime verification against the new acceptance criteria.

## Governing constraints

- `SPECIFICATION.md` and `AGENTS.md` remain authoritative.
- Preserve `/explore/*`, `/admin/*`, zero-auth behavior, observer headers, binary/API contracts, and shareable URL keys.
- Preserve the current `tab` values: `navigator`, `comparator`, `spectral`, `ice`, and `discussions`.
- Do not add dependencies or change lockfiles.
- Keep real, pre-cached, synthetic, and unavailable states visibly distinct. Never use concept art as a science image.
- Verify issue and role ownership for every file before implementation. This proposal spans E4, E3, and E5 file territories; `MissionHero.tsx` and `MissionLaunchpad.tsx` are not listed in the current role write-fence table.

## Quick start for the next chat

Read `AGENTS.md`, `SPECIFICATION.md`, then sections 01–07 here. Verify the issue/role gates before editing. Start with Pass A in section 05, and do not modify files outside the authorized owner’s write-fence.
