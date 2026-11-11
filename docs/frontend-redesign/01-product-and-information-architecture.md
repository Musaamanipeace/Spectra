# 01 — Product Direction and Information Architecture

## Product direction

Spectra is an independent community product for exploring public SPHEREx observations. Its strongest user-facing promise is that people can see how a target changes across real, discrete observations and inspect the evidence behind a possible change.

The first-use journey is:

1. Choose a curated target or search by name/coordinates.
2. See what observations are actually available and whether any pair is scientifically compatible.
3. Open the pair in TimeLens and blink or compare the frames at their actual dates.
4. Inspect the source, quality, and provenance details.
5. Optionally submit a structured candidate review; follow the candidate’s discussion afterward.

The same target context should carry across Navigator, TimeLens, Spectrum, Ice, and Review. Advanced tools remain available as a research mode.

## Public navigation

Use a small set of goal-based destinations:

| Destination | User goal | Existing workspaces surfaced here |
|---|---|---|
| Explore | Find a target or region and check coverage | Navigator, curated targets, observation matches |
| Discover | Inspect notable changes or review a candidate | Candidate detail, guided review task, discovery stories |
| Science | Examine data in depth | Time-Domain Comparator, Spectrum Lab, Ice Studio |
| Review | Assess a candidate and compare evidence | Review queue, case evidence, structured assessment, case discussion |
| Learn | Understand a concept or guided path | Short explainers and tutorials, only when real content exists |

Keep universal search and the command palette. Keep existing query-state values and deep links. Present the existing scientific workspaces as contextual destinations or a secondary workspace switcher inside Science; do not remove them or silently rename their query state.

Keep Mission Control under `/admin/*`. Do not put operator navigation in the public shell.

## Landing-page structure

1. **Brand and source statement:** Spectra name, independent-product disclosure, public-data attribution.
2. **Hero:** “The universe doesn’t stand still.” One short sentence explaining that users can compare infrared observations through time.
3. **Primary action:** “Start exploring” opens `/explore?tab=navigator`.
4. **Secondary action:** “Try a discovery mission” opens a real review tutorial/task when available.
5. **Three starter cards:** Explore an object · Watch the sky change · Review a candidate.
6. **Featured investigation:** one correctly sourced example with coverage and next action.
7. **Mission context, curated catalog, and educational material:** lower on the page; retain useful facts, source links, and discovery groupings from the current launchpad.

Replace NASA/JPL-branded presentation on Spectra-owned surfaces with Spectra's independent identity. Keep factual NASA/SPHEREx/IRSA attribution in a clearly labeled source area; do not imply ownership or partnership.

## Research mode

Research controls are progressively disclosed from an object or region. They include coordinates and reference epoch, collection/release, detector/band, WCS and pixel readout, uncertainty/flags, processing parameters, and export/provenance. A new visitor should not need to see these fields before choosing a target.

## Content and state rules

- Distinguish archive, pre-cached benchmark, synthetic/demo, and unavailable content at the point of use.
- Show coverage before offering analysis. The “Open in TimeLens” action appears only when usable observations exist.
- Distinguish “no observations,” “observations exist but are incompatible,” “loading,” and “request failed.”
- Use candidate language until a result is independently reviewed. Community classifications are evidence, not a majority-vote discovery claim.
- Keep guided explanation separate from measured values. Never silently substitute generated data for an archive product.
