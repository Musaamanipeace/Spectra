# 04 — Reference Patterns and Reuse Notes

The goal is to borrow a proven interaction or layout pattern, then implement it with Spectra’s own language and real data. The reference library itself warns against copying proprietary branding, assets, text, or full screens. Its screenshots and the copied concept mockups are illustrative, not scientific data.

| Reference | Inspect | Adapt for Spectra | Avoid |
|---|---|---|---|
| [NASA Eyes](https://science.nasa.gov/eyes/) | Story-led entry, a small set of clickable exploration journeys | Home hero, guided object stories, clear “start exploring” paths | NASA identity, mission branding, generic 3D tour as the core data UI |
| [Aladin Lite v3](https://aladin.cds.unistra.fr/AladinLite/doc/API/) | Sky view, catalog/layer controls, source selection/callbacks, coordinates and view changes | Keep the current Aladin map; connect its selected source/region to Spectra’s inspector and coverage results | Replacing Aladin with another map engine without a specific scientific need |
| [IRSA SPHEREx data-access docs](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/) | Official product naming and access/search model | Observation result metadata and filters for position, band, time, ID, instrument; preserve source/product provenance | Inventing archive fields or treating a local preview as an archive match |
| [ESASky](https://sky.esa.int/) | Map-first multi-wavelength exploration and layer context | Optional multi-survey/context layer ideas after first-use coverage works | Porting a second atlas or presenting unrelated survey layers as SPHEREx |
| [NASA Worldview](https://worldview.earthdata.nasa.gov/) | Date controls, layer toggles, opacity/layer discovery | Timeline/layer control interaction patterns for actual discrete observation epochs | Geographic map assumptions or continuous interpolation between unobserved epochs |
| [WiseView](http://byw.tools/wiseview) | Discrete-epoch blinking and source-following intuition | Fast blink, pair stepping, contrast consistency, date labels | WISE-specific calibration/data assumptions |
| [Zooniverse Project Builder](https://help.zooniverse.org/getting-started/), [Talk board practices](https://help.zooniverse.org/next-steps/talk/), and [Backyard Worlds](https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9) | Subject-first classification, brief optional tutorial, one bounded task, subject-specific notes/Talk after classification; Backyard Worlds demonstrates astronomy imagery and artifact-vs-mover explanation | Replace the first-screen chat feed with one case, matched evidence, supported response choices, then a case-specific asynchronous discussion | Importing WISE assumptions into SPHEREx; claiming a volunteer label is a discovery; copying Zooniverse styling |
| [GitHub Discussions Q&A categories](https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions) and [About Discussions](https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions) | Topic categories, question-and-answer separation, chronological comments, answer organization | Keep one question and its evidence together; attach discussion to the selected case instead of a global chat stream | “Accepted answer” and “resolved” states unless Spectra's backend supports them; GitHub branding |
| [JS9 guide](https://www.js9.org/help/user.html) | Pixel readout, contrast/bias, regions, multiple images, WCS-oriented inspection | Advanced image-inspection controls in a contextual panel | Replacing the existing WebGL compositor wholesale |
| [shadcn dashboard blocks](https://ui.shadcn.com/blocks/dashboard) | Grouped sidebar, section cards, tables, chart panels | Use existing primitives to compose clean workspaces and denser admin views | Copying a generic analytics dashboard as the public home |
| [Linear](https://linear.app/) | Keyboard search, compact hierarchy, contextual detail and useful empty states | Search/command palette and candidate/object detail patterns | Copying product branding or project-management metaphors into science labels |

## Inspection limits

NASA Eyes, Aladin Lite docs/live viewer, Zooniverse pages, JS9 docs, shadcn blocks, Linear, and IRSA archive documentation were accessible during the review. ESASky, Worldview’s interactive UI, the official IRSA search application, and WiseView did not render reliably through the browsing tool. Validate those live screens before implementing details beyond the patterns described in the concept kit.

The Review Desk adapts Zooniverse's documented separation between a classification workflow and subject-specific Talk, with GitHub's Q&A topic organization used only for discussion detail. These are implementation references, not requests to embed their product UI.

## Screenshot policy

This packet copies only Spectra’s current-app captures and the original Spectra concept mockups. It does not package third-party product screenshots. Use the direct links above to inspect the original products; keep attribution, license, and API terms with any later implementation.
