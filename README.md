# Spectra (SPHEREx Spectral Explorers)

[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Target Mission: NASA SPHEREx](https://img.shields.io/badge/Mission-NASA%20SPHEREx-red.svg)](https://spherex.caltech.edu/)
[![Archive: NASA IRSA SPHEREx QR2 and QR3](https://img.shields.io/badge/Archive-IRSA%20SPHEREx%20QR2%20%2F%20QR3-orange.svg)](https://irsa.ipac.caltech.edu/Missions/spherex.html)
[![Backend: FastAPI + uv](https://img.shields.io/badge/Backend-FastAPI%20%2B%20uv-009688.svg)](backend/)
[![Database: Supabase Postgres](https://img.shields.io/badge/Database-Supabase%20Postgres-3ECF8E.svg)](https://supabase.com)
[![Frontend: React 18 + WebGL2](https://img.shields.io/badge/Frontend-React%2018%20%2B%20WebGL2%20%2B%20Aladin-61DAFB.svg)](web-client/)
[![Hosting: HF Spaces + Cloudflare Pages](https://img.shields.io/badge/Hosting-HF%20Spaces%20%2B%20Cloudflare-yellow.svg)](https://huggingface.co/spaces)

> **Finite minds trying to understand an infinite universe.**  
> An institutional-grade, zero-auth, time-domain celestial blink comparator and 102-channel spectrophotometric exploration workbench for the **NASA SPHEREx** mission.

---

## 1. Executive Summary & Challenge Alignment

**Spectra** is an open-source time-domain blink comparator and 102-channel spectrophotometric exploration workbench built for the **NASA Space Apps Challenge: "Display images of the sky from the SPHEREx mission, making it easy for anyone to quickly see how they change over time."**

> **Data Provenance & Simulation Transparency:** Spectra queries the NASA/IPAC Infrared Science Archive through IRSA SIA2 and its Cutout API. The time-domain viewer uses `IRSA_COLLECTION` (default `spherex_qr3`; set `spherex_qr2` to use QR2), constructs passes from returned exposure MJDs, and renders only verified archive cutouts. If the selected release returns no usable data, it shows an unavailable state instead of simulated pixels. The checked-in benchmark `.f32` bundles remain simulated fixtures and are not used by the time-domain viewer.

NASA's SPHEREx satellite (launched in early 2025) maps the entire sky every six months across **102 near-infrared spectral channels** ($0.75\,\mu\text{m} - 5.00\,\mu\text{m}$) at a native spatial resolution of $\approx 6.2''/\text{pixel}$, observing over a billion astronomical objects across four full all-sky passes and $>50$ deep-field passes over the ecliptic poles.

Traditional astronomical portals fail citizen scientists and researchers attempting to blink SPHEREx data:
1. **Geometric Aitoff & MOC Distortion:** 2D galactic projections distort target shapes near survey boundaries.
2. **Spacecraft Roll & Optical TAN-SIP Distortion:** Raw $2040 \times 2040$ detector arrays rotate with satellite roll ($\theta$) across epochs; raw frame blinking causes starfields to spin.
3. **Linear Variable Filter (LVF) "Smile":** Wavelength shifts continuously along the detector $Y$-axis. Raw detector cutouts are *not* monochromatic.
4. **Large Pixel Crowding ($6.2''$):** Dense starfields blend multiple sources into single spatial elements.

**Spectra solves all four challenges:** It provides an immersed full-viewport tangent-plane sky survey navigator (Aladin Lite v3 WebGL2 + procedural astrometric starfield) that de-warps detector footprints into North-Up tangent planes, executes zero-copy 32-bit floating-point wavelength-matched difference math in GPU shaders, extracts calibrated 102-band spectra via `WCS-WAVE` smile inversion, and enables instant in-memory spectral similarity search.

---

## 2. Core Architecture: 5 Public Tabs + 5 Admin Modules

```
                           +-------------------------------------------------------+
                           |                   SPECTRA WORKBENCH                   |
                           +-------------------------------------------------------+
                                    |                                       |
                +---------------------------------------+   +---------------------------------------+
                |    PORTAL A: PUBLIC EXPLORER SUITE    |   |     PORTAL B: ADMIN MISSION CONTROL   |
                |               (/explore)              |   |               (/admin)                |
                +---------------------------------------+   +---------------------------------------+
                | Tab 1: Celestial Navigator (3D Dome)  |   | Tab 1: Training Dynamics & Loss Studio|
                | Tab 2: Time-Domain Comparator (Blink) |   | Tab 2: Parameter & Activation Inspector|
                | Tab 3: Spectrophotometric Lab (102-ch)|   | Tab 3: Decision Boundary Animator (3D)|
                | Tab 4: Molecular & Ice Mapping Studio |   | Tab 4: Disagreement & Escalation Queue|
                | Tab 5: Observation Discussions (Feed) |   | Tab 5: Calibration & Data Product Hub |
                +---------------------------------------+   +---------------------------------------+
```

### Public Discovery Workspaces (`/explore`)
- **Tab 1: Celestial Navigator (`/explore?tab=navigator`):** Full-bleed immersed tangent-plane sky survey window (`TAN` projection in Aladin Lite v3 WebGL2 + continuous starfield fallback) with all-direction pan, smooth zoom (`60°` to `1'`), SPHEREx coverage MOC, Gaia DR3 proper-motion vectors, universal coordinate parsing, and docked instrument strip (`DESIGN.md`).
- **Tab 2: Time-Domain Comparator (`/explore?tab=comparator`):** WebGL2 multi-epoch player with Asinh stretch slider, pairwise difference subtraction ($t_N - t_0$), inverse-variance co-add mode for faint brown dwarfs, sub-pixel Gaia DR3 centroid pins ($0.77\,\text{px/yr}$ deblending), discrete 6-month survey epoch stepping, and live hover HUD.
- **Tab 3: Spectrophotometric Lab (`/explore?tab=spectrophotometer`):** Canvas `uPlot` chart rendering 102 calibrated flux channels with `VARIANCE` error bars at 60 FPS, synchronized epoch animation, two-component composite spectral unmixing ($a \cdot T_1 + b \cdot T_2$), automated galaxy photo-$z$ solver ($P(z)$, lookback time, Mpc distance), and instant 102-band in-memory NumPy cosine similarity search ($<20\,\text{ms}$).
- **Tab 4: Molecular & Ice Mapping Studio (`/explore?tab=ice_studio`):** Continuum-normalized optical depth ($\tau_\lambda$), point-source background star aperture photometry (seeded from the IRSA SPLICES catalog), and quantitative biogenic ice column density integration ($N_{\text{ice}}$ in $\text{cm}^{-2}$) using verified laboratory $A$-values for $\text{H}_2\text{O}$ ($3.05\,\mu\text{m}$), $\text{CO}_2$ ($4.27\,\mu\text{m}$), $^{13}\text{CO}_2$ ($4.38\,\mu\text{m}$), $\text{CO}$ ($4.67\,\mu\text{m}$), and $\text{CH}_3\text{OH}$ ($3.54\,\mu\text{m}$).
- **Tab 5: Observation Discussions (`/explore?tab=discussions`):** Zooniverse Talk-style scientific forum with channel taxonomy (`#movers`, `#spectra`, `#ices`, `#artifacts`, `#confirmed`), interactive deep-link state snapshots, live synchronization via FastAPI SSE (`/api/forum/stream`), and Bayesian consensus ranking.

### Admin Mission Control (`/admin`)
- **Tab 1: Training Dynamics & Loss Studio (`/admin/dynamics`):** Real-time scalar learning curves, gradient L2 norms, learning rate annealing, and early-stopping monitors via `uPlot`.
- **Tab 2: Parameter & Activation Inspector (`/admin/internals`):** Sequential 3D ridgeline weight/bias histograms across epochs, layer activations, and Grad-CAM saliency heatmaps.
- **Tab 3: Decision Boundary Animator (`/admin/boundaries`):** Dynamic 3D decision boundary surfaces morphing across epochs in physical and UMAP latent space using `react-plotly.js` WebGL surfaces.
- **Tab 4: Hard-Negative & Escalation Queue (`/admin/triage`):** AI-vs-human divergence mining ($|P_{\text{AI}} - P_{\text{Human}}|$) with raw Multi-Extension FITS (MEF HDUs 1–6) inspection and 1-click candidate promotion.
- **Tab 5: Calibration & Data Product Hub (`/admin/exports`):** Volunteer Bayesian reliability audits ($w_u$), gold-standard controls, and 1-click export of the 4 official SPHEREx community data products (CSV, VOTable, JSON, PyTorch HDF5 training tensors).

---

## 3. Mandatory NASA Benchmark Ground Truths (Epoch 2025.5)

All coordinates, proper motions, and spectral features are mathematically propagated to the SPHEREx mission midpoint ($t = 2025.5$):

| Target | Object Class | Propagated Coordinates (2025.5) | Time-Domain Behavior (Tab 2) | Spectral Signatures (Tabs 3 & 4) |
|---|---|---|---|---|
| **Barnard's Star** | M4V Red Dwarf | `269.44639°, +4.76676°` | Moves $+10.39''/\text{yr} = 1.68\,\text{px/yr}$ North; saturation handling | Peaks at $1.1\,\mu\text{m}$; deep $\text{H}_2\text{O}$ steam absorption |
| **WISE 0855-0714** | Y4 Sub-Brown Dwarf | `133.73712°, -7.24038°` | Faint $<3.5\,\mu\text{m}$; moves Westward in D5 ($8.15''/\text{yr}$); honest non-detection | Deep $\text{CH}_4$ ($3.3\,\mu\text{m}$) & $\text{H}_2\text{O}$ ($3.05\,\mu\text{m}$) valleys; $4.5\,\mu\text{m}$ peak |
| **Epsilon Indi B** | T1 + T6 Binary | `331.09566°, -56.80031°` | Moves $4.68''/\text{yr} = 0.76\,\text{px/yr}$ SE; corrected $1/\cos \delta$ (46″ fix); blended in 6.2″ px | Blended 6.2" pixel unmixes into T1+T6 brown dwarf templates |
| **RW Aurigae** | T Tauri Variable | `76.95647°, +30.40130°` | Stationary ($<0.3\,\text{px}$); flashing monopole ring ($>1.5\,\text{mag}$ dimming) | Multi-epoch spectrum dims in D1 with thermal IR dust excess in D4/D5 |
| **R Draconis** | Mira AGB Variable | `248.16773°, +66.75504°` | Stationary pulsating monopole ($245\,\text{d}$ period; $8.61°$ from NEP) | Animated spectrum reveals $\text{H}_2\text{O}$ and $\text{CO}$ bands non-simultaneous |

---

## 4. Zero-Auth Identity Model

To remove all login friction for hackathon judges while maintaining cryptographic authenticity, security, and calibration:
- **No blocking login walls:** Routes `/explore` and `/admin` are directly accessible without passwords or sign-up forms.
- **Client Session Fingerprinting:** On initial mount, the browser generates:
  1. `spx_observer_id`: Public UUIDv4 stored in `localStorage`.
  2. `spx_observer_key`: Secret 32-byte cryptographic string stored in `localStorage`.
  3. Celestial callsign (e.g. `Observer-Vega-409`).
- **HTTP Header Injection:** Mutating requests transmit:
  ```http
  X-Observer-ID: 7b3d1f8a-4092-4e8c-a1e9-5cf287a911e3
  X-Observer-Key: <secret_32_byte_string>
  ```
- **Hashed Storage & Privacy:** The backend stores strictly `sha256(observer_key)` in the `observers` table (`key_hash`). Neither the raw key nor internal observer ID is ever exposed in read endpoints or public discussions.
- **Admin Moderation & Badging:** `/admin` is read-only by default (`ADMIN_MUTATIONS_ENABLED=false`). Mutations require a server-held `ADMIN_TOKEN`. Verified admin replies receive the gold `[Moderator]` badge.
- **Data Honesty:** All catalogs, candidates, and artifacts are branded `Community Product` (no false NASA endorsement).

---

## 5. Technology Stack & Institutional Tooling

| Layer | Technologies | Key Responsibility |
|---|---|---|
| **Frontend UI** | React 18, Vite 5, TypeScript 5.5, Tailwind CSS | High-performance single-page application with isolated route chunks. |
| **Sky Visualizer** | Aladin Lite v3 (WebGL2), Canvas 2D | Immersed full-bleed tangent-plane sky window (`TAN` projection) with SPHEREx coverage MOC and astrometric starfield. |
| **Float32 Comparator** | WebGL2 fragment shaders, IEEE-754 `Float32Array` | Zero-copy 32-bit floating point Asinh stretch, wavelength-matched differencing, and coverage matrix. |
| **URL State** | `nuqs` (query strings) | Type-safe URL parameters (`tab`, `ra`, `dec`, `band`, `win`, `mode`, `epoch`, `px`, `py`, `z`, `embed`). |
| **Async Caching** | `@tanstack/react-query` v5 | Background prefetching on target hover; 30-min stale time; deduplication. |
| **Fast Plotting** | `uPlot` (Canvas 2D) | Ultra-fast 60 FPS rendering (<1.5ms/frame) for 102-band spectra and MJD scatter points. |
| **UI Primitives** | Radix UI, `cmdk` (Ctrl+K palette), TanStack Virtual | Accessible unstyled primitives, instant command bar, virtualized feeds. |
| **Backend Service** | Python 3.11, FastAPI, `uv`, `Ruff` | Single-service architecture on port 7860 (HF Spaces native), sub-3s environment resolution (`uv.lock`). |
| **Astro Pipeline** | `astropy`, `pyvo`, `reproject`, `scipy`, `numpy` | IRSA Cutout API client, SIA2 discovery, WAVE-TAB smile evaluation, `reproject_exact`, PSF centroid fitting. |
| **Vector Similarity** | In-Memory NumPy Cosine Search | Instant sub-20ms spectral template matching without database memory bloat. |
| **Database** | Supabase Postgres 16 (Session Pooler) | IPv4 port 5432 session-mode pooler, RLS enabled on all tables with zero anon policies. |
| **Dev Runner** | `Taskfile.yml` + Supabase CLI | One-command orchestration across Python, React, and local DB. |

---

## 6. Local Quickstart

### Prerequisites Check
Ensure you have the following installed (see [prerequisites.md](prerequisites.md) for full rationale):
- **Docker** & **Docker Compose** (for local Supabase PostgreSQL 16)
- **Python 3.11+** with **`uv`** (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **Node.js 20+** & **npm**
- **Task** (`sh -c "$(curl --location https://taskfile.dev/install.sh) -- -d"`)
- **Supabase CLI** (`npm install -g supabase`)

### One-Command Setup & Launch
```bash
# 1. Install all dependencies across Python and React (<10 seconds)
task setup

# 2. Start local Supabase Postgres, apply schema and seed 5 NASA benchmarks
task db:up

# 3. Synchronize OpenAPI TypeScript definitions
task types:sync

# 4. Start all services concurrently (FastAPI Backend :7860, Vite Client :3000)
task dev
```

Visit **`http://localhost:3000/explore`** to begin exploring the sky.

---

## 7. Implementation Roadmap: 4 Sequential Priority-Gated Phases

Implementation is structured into **four strictly sequential, priority-gated phases**. On completion of each phase, the system reaches a 100% self-contained, demonstrable milestone before the next phase begins:

1. **Phase 1 (P0 Priority — Core NASA Challenge Foundation):**
   - Unified FastAPI backend (`uv`) on port 7860 with IRSA SIA2 client, IRSA Cutout API ingestion, WCS North-Up reprojection, and Float32 binary streaming.
   - Pre-seeded database with the 5 NASA benchmark targets (`seed_benchmarks.sql`).
   - In-memory benchmark cache delivering $<10\,\text{ms}$ responses.
   - Frontend Tab 1 (Navigator / Aladin 3D dome + camera dive) and Tab 2 (Comparator / WebGL2 Float32 blinker, difference subtraction, Asinh slider, discrete survey epoch snapping).
   - *Milestone Gate 1:* 100% of the NASA challenge prompt satisfied and immediately shippable.
2. **Phase 2 (P1 Priority — Scientific Differentiator & Community Intelligence):**
   - HDU 6 `WCS-WAVE` smile lookup and 102-channel hyperspectral extraction.
   - In-memory NumPy cosine similarity evaluating 10,000 spectra in $<20\,\text{ms}$.
   - Frontend Tab 3 (Spectrophotometric Lab with `uPlot` 60 FPS 102-band plot, composite unmixing, and photo-$z$ solver).
   - Frontend Tab 5 (Observation Discussions with embedded deep-link snapshots and live FastAPI SSE feed).
   - *Milestone Gate 2:* Hyperspectral analysis and live community peer review fully operational.
3. **Phase 3 (P2 Priority — Institutional Polish & Mission Control Suite):**
   - Frontend Tab 4 (Molecular & Ice Studio with quantitative column density integrator $N_{\text{ice}}$ for SPLICES background stars).
   - Hidden Admin Mission Control (`/admin`): 5 isolated tabs (Dynamics, Internals, Boundaries 3D, Triage, Exports).
   - PyTorch live training hook WebSocket feed (`/api/admin/ws/training`) with pre-trained diagnostic weights.
   - *Milestone Gate 3:* 10-tab flagship suite operational with live machine learning observability.
4. **Phase 4 (Production Deployment, Operational Hardening & Compliance):**
   - Hugging Face Spaces single-container deployment (FastAPI on port 7860 via `uv` in 16 GB RAM Docker).
   - Cloudflare Pages CDN deployment with edge-cached `/benchmarks/*.json` and `*.f32` fallback cutouts.
   - Supabase Cloud setup with Session Pooler (port 5432, IPv4) and Row Level Security (RLS) policies.
   - Dual-action `/api/health` keep-alive via cron-job.org (every 5 min) + GitHub Actions backup.
   - Offline demo laptop mirror (`task dev`) and 24-hour pre-judging code freeze.
   - *Milestone Gate 4:* 24/7 warm cloud deployment + 100% offline venue presentation guarantee.

---

## 8. Documentation Index

- **[SPECIFICATION.md](SPECIFICATION.md):** Complete, authoritative technical specification (v3.0.0-PROD) detailing all mathematical formulas, WCS reprojection pipelines, database DDL schemas, component wireframes, and deployment runbooks.
- **[SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md):** Comprehensive Systems Architecture & Design Document (v3.0.0-PROD) covering the 4+1 View Model, 10 core SDD sections, ADRs, and verification matrices.
- **[prerequisites.md](prerequisites.md):** Comprehensive guide to all build essentials, environment runtimes, and developer acceleration tools (`uv`, `Taskfile`, `nuqs`, etc.).
- **[.agents/CONTEXT.md](.agents/CONTEXT.md):** Chronological architectural log recording Exchanges #1 through #42 of the project ideation.

---

## 9. Scientific Data Acknowledgement & Citations

This platform utilizes data products from the **NASA SPHEREx** mission:
- **Primary Archive:** NASA/IPAC Infrared Science Archive (IRSA), SPHEREx Quick Release 3 by default (`spherex_qr3`); set `IRSA_COLLECTION=spherex_qr2` to select QR2.
- **Archive Documentation:** [IRSA SPHEREx Mission Portal](https://irsa.ipac.caltech.edu/Missions/spherex.html) & [SPLICES Ice Catalog](https://irsa.ipac.caltech.edu/data/SPHEREx/SPLICES/)
- **External Catalogs:** European Space Agency (ESA) Gaia DR3, NASA/IPAC Wide-field Infrared Survey Explorer (AllWISE), Pan-STARRS1 Surveys (STScI).
- **Sky Engine:** Aladin Lite v3 (developed by CDS, Observatoire Astronomique de Strasbourg, France; licensed under GNU GPL-3.0).

---

## 10. License

Spectra is licensed under the **GNU General Public License v3.0 (GPL-3.0)** to maintain compatibility with astronomical libraries including Aladin Lite v3. See [LICENSE](LICENSE) for details.
