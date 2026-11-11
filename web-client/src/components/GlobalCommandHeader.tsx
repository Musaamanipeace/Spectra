import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { queryClient } from '../App';
import { Button, Badge, Input } from './ui';
import { cn } from '../lib/utils';

export interface BenchmarkPill {
  id: string;
  name: string;
  label: string;
  ra: number;
  dec: number;
  preset?: 'brown_dwarf' | 'true_nir' | 'water_ice' | 'comet_outgassing' | 'custom';
  description: string;
  category?: 'SPHEREx Verification' | 'Deep Field' | 'Galactic / Nebular' | 'Extragalactic';
}

/**
 * Reference Calibration Targets (SPECIFICATION.md §1.1, §4.0)
 * Exported for search resolution and calibration verification across workspaces.
 */
export const MANDATORY_BENCHMARKS: BenchmarkPill[] = [
  {
    id: 'barnard',
    name: "Barnard's Star",
    label: "Barnard's (Speed Demon)",
    ra: 269.44639,
    dec: 4.76676,
    preset: 'true_nir',
    description: 'The Cosmic Speed Demon — Fastest-moving star sprinting at +10.39"/yr North (1.68 px/yr)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'wise0855',
    name: 'WISE 0855-0714',
    label: 'WISE 0855 (Frozen Dwarf)',
    ra: 133.73712,
    dec: -7.24038,
    preset: 'brown_dwarf',
    description: 'The Frozen Brown Dwarf — Cold as ice (-10°C), glowing in SPHEREx mid-IR (8.15"/yr West)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'eps_indi_b',
    name: 'Epsilon Indi B',
    label: 'Eps Indi B (Twin Worlds)',
    ra: 331.09566,
    dec: -56.80031,
    preset: 'brown_dwarf',
    description: 'The Invisible Twin Worlds — T1+T6 binary pair blended in a single pixel (4.68"/yr SE)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'rw_aur',
    name: 'RW Aurigae',
    label: 'RW Aurigae (Flashing Star)',
    ra: 76.95647,
    dec: 30.4013,
    preset: 'comet_outgassing',
    description: 'The Flashing Baby Star — Violent dust clouds blocking 75% of light across seasons',
    category: 'SPHEREx Verification',
  },
  {
    id: 'r_dra',
    name: 'R Draconis',
    label: 'R Draconis (Pulsing Giant)',
    ra: 248.16773,
    dec: 66.75504,
    preset: 'water_ice',
    description: 'The Beating Giant Heart — Red giant pulsating in brightness every 245 days',
    category: 'SPHEREx Verification',
  },
];

/**
 * Extended Astronomical Catalog for Instant Local Name Resolution
 * Complements CDS Sesame (SIMBAD/NED/VizieR) and backend /api/resolve.
 */
export const SEARCHABLE_SKY_CATALOG: BenchmarkPill[] = [
  ...MANDATORY_BENCHMARKS,
  {
    id: 'nep_tdf',
    name: 'SPHEREx / JWST NEP Deep Field',
    label: 'NEP Deep Field',
    ra: 260.7,
    dec: 65.8,
    preset: 'true_nir',
    description: 'North Ecliptic Pole calibration zone (>50 SPHEREx passes/yr)',
    category: 'Deep Field',
  },
  {
    id: 'sep_df',
    name: 'SPHEREx SEP Deep Field (LMC Adjacent)',
    label: 'SEP Deep Field',
    ra: 90.0,
    dec: -66.5607,
    preset: 'water_ice',
    description: 'South Ecliptic Pole deep coverage zone (~100 deg²)',
    category: 'Deep Field',
  },
  {
    id: 'm42_orion',
    name: 'Orion Nebula (M42 / Trapezium)',
    label: 'M42 Orion',
    ra: 83.82208,
    dec: -5.39111,
    preset: 'water_ice',
    description: 'Massive star-forming region; strong H2O/CO2 3.0–4.27 µm ice absorption',
    category: 'Galactic / Nebular',
  },
  {
    id: 'trappist1',
    name: 'TRAPPIST-1 (2MASS J23062928-0502285)',
    label: 'TRAPPIST-1',
    ra: 346.62233,
    dec: -5.04144,
    preset: 'brown_dwarf',
    description: 'M8V ultra-cool dwarf exoplanet host (1.10"/yr proper motion)',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm31_core',
    name: 'Andromeda Galaxy (M31 / NGC 224)',
    label: 'M31 Andromeda',
    ra: 10.68471,
    dec: 41.26875,
    preset: 'true_nir',
    description: 'Local Group giant spiral; 220,000 ly disk with dust lanes and satellite dwarf galaxies',
    category: 'Extragalactic',
  },
  {
    id: 'm51_whirlpool',
    name: 'Whirlpool Galaxy (M51 / NGC 5194)',
    label: 'M51 Whirlpool',
    ra: 202.46958,
    dec: 47.19528,
    preset: 'true_nir',
    description: 'Grand-design face-on spiral galaxy interacting with dwarf galaxy NGC 5195',
    category: 'Extragalactic',
  },
  {
    id: 'm82_cigar',
    name: 'Cigar Galaxy (M82 / NGC 3034)',
    label: 'M82 Cigar',
    ra: 148.96846,
    dec: 69.6797,
    preset: 'water_ice',
    description: 'Prototypical starburst galaxy; superwind bipolar outflows and intense infrared PAH emission',
    category: 'Extragalactic',
  },
  {
    id: 'm87_virgo',
    name: 'Virgo A (M87 / NGC 4486)',
    label: 'M87 Virgo A',
    ra: 187.70593,
    dec: 12.39112,
    preset: 'true_nir',
    description: 'Supergiant elliptical galaxy in Virgo cluster; host of 6.5B M☉ supermassive black hole and relativistic jet',
    category: 'Extragalactic',
  },
  {
    id: 'ngc253_sculptor',
    name: 'Sculptor Galaxy (NGC 253 / Silver Coin)',
    label: 'NGC 253 Sculptor',
    ra: 11.88806,
    dec: -25.28822,
    preset: 'water_ice',
    description: 'Nearby starburst intermediate spiral; heavy interstellar dust lanes and nuclear star cluster',
    category: 'Extragalactic',
  },
  {
    id: 'm101_pinwheel',
    name: 'Pinwheel Galaxy (M101 / NGC 5457)',
    label: 'M101 Pinwheel',
    ra: 210.80227,
    dec: 54.34895,
    preset: 'true_nir',
    description: 'Face-on grand spiral galaxy; prominent HII starburst regions and pristine spiral structure',
    category: 'Extragalactic',
  },
  {
    id: 'cdfs',
    name: 'Chandra Deep Field South (GOODS-S)',
    label: 'CDFS / GOODS-S',
    ra: 53.1225,
    dec: -27.805,
    preset: 'true_nir',
    description: 'Extragalactic deep survey field (z = 0.5–4.0 galaxy spectrophotometry)',
    category: 'Extragalactic',
  },
  {
    id: 'vega',
    name: 'Vega (Alpha Lyrae / CALSPEC Standard)',
    label: 'Vega',
    ra: 279.23473,
    dec: 38.78369,
    preset: 'true_nir',
    description: 'A0V primary spectrophotometric zero-point standard',
    category: 'Galactic / Nebular',
  },
  {
    id: 'sgra_star',
    name: 'Sagittarius A* (Galactic Center)',
    label: 'Sagittarius A*',
    ra: 266.41682,
    dec: -29.00782,
    preset: 'true_nir',
    description: 'Supermassive black hole at the dynamical center of the Milky Way',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm1_crab',
    name: 'Crab Nebula (M1 / NGC 1952)',
    label: 'M1 Crab Nebula',
    ra: 83.63308,
    dec: 22.0145,
    preset: 'true_nir',
    description: 'Supernova remnant with central pulsar powering synchrotron nebula',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm45_pleiades',
    name: 'Pleiades (M45 / Seven Sisters)',
    label: 'M45 Pleiades',
    ra: 56.75,
    dec: 24.1167,
    preset: 'true_nir',
    description: 'Open cluster embedded in bright reflection nebulosity',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm104_sombrero',
    name: 'Sombrero Galaxy (M104 / NGC 4594)',
    label: 'M104 Sombrero',
    ra: 189.99763,
    dec: -11.62305,
    preset: 'true_nir',
    description: 'Unbarred spiral galaxy with prominent circumstellar dust lane',
    category: 'Extragalactic',
  },
  {
    id: 'm33_triangulum',
    name: 'Triangulum Galaxy (M33 / NGC 598)',
    label: 'M33 Triangulum',
    ra: 23.4621,
    dec: 30.65994,
    preset: 'true_nir',
    description: 'Third-largest member of the Local Group; rich in starburst HII complexes',
    category: 'Extragalactic',
  },
  {
    id: 'betelgeuse',
    name: 'Betelgeuse (Alpha Orionis)',
    label: 'Betelgeuse',
    ra: 88.79294,
    dec: 7.40706,
    preset: 'water_ice',
    description: 'Red supergiant pulsating variable with circumstellar molecular dust shells',
    category: 'Galactic / Nebular',
  },
  {
    id: 'sirius',
    name: 'Sirius (Alpha Canis Majoris)',
    label: 'Sirius',
    ra: 101.28716,
    dec: -16.71612,
    preset: 'true_nir',
    description: 'Brightest star in night sky; A1V + DA white dwarf binary',
    category: 'Galactic / Nebular',
  },
  {
    id: 'proxima',
    name: 'Proxima Centauri (Alpha Centauri C)',
    label: 'Proxima Centauri',
    ra: 217.42894,
    dec: -62.67949,
    preset: 'brown_dwarf',
    description: 'M5.5Ve flare star and closest known star to the Solar System (1.30 pc)',
    category: 'Galactic / Nebular',
  },
  {
    id: 'polaris',
    name: 'Polaris (Alpha Ursae Minoris)',
    label: 'Polaris',
    ra: 37.95456,
    dec: 89.26411,
    preset: 'true_nir',
    description: 'North celestial pole Classical Cepheid variable standard',
    category: 'Galactic / Nebular',
  },
];

const TABS = [
  { id: 'navigator', label: 'Navigator', number: '1' },
  { id: 'comparator', label: 'Time-Domain', number: '2' },
  { id: 'spectral', label: '102-Band Spectrum', number: '3' },
  { id: 'ice', label: 'Ice Studio', number: '4' },
  { id: 'discussions', label: 'Community Forum', number: '5' },
];

/**
 * Official NASA Insignia (Meatball) Vector
 */
export const NasaMeatballSvg: React.FC<{ className?: string }> = ({ className = 'h-6 w-7' }) => (
  <svg
    viewBox="0 0 110 92"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-label="NASA Logo"
  >
    <circle cx="55" cy="46" r="42" fill="#0B3D91" />
    <path
      d="M14 62L62 18L56 42L96 34L54 48L60 68L14 62Z"
      fill="#F64137"
    />
    <ellipse
      cx="55"
      cy="46"
      rx="46"
      ry="19"
      transform="rotate(-28 55 46)"
      stroke="#FFFFFF"
      strokeWidth="2.5"
      fill="none"
    />
    <text
      x="55"
      y="54"
      textAnchor="middle"
      fill="#FFFFFF"
      fontFamily="Impact, Arial Black, sans-serif"
      fontWeight="900"
      fontSize="26"
      letterSpacing="1.5"
    >
      NASA
    </text>
  </svg>
);

/**
 * Client-Side Coordinate & Sexagesimal Parser
 * Handles:
 * - Decimal: "133.73712, -7.24038" or "133.73712 -7.24038"
 * - Sexagesimal: "08h54m56.91s -07d14m25.4s" or "08:54:56.91 -07:14:25.4"
 */
export function parseCoordinateInput(input: string): { ra: number; dec: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pattern 1: Sexagesimal (e.g. 08h54m56.91s, -07d14m25.4s or 08:54:56.91, -07:14:25.4)
  const sexaRegex =
    /^(\d{1,2})[h:\s]\s*(\d{1,2})[m:\s]\s*(\d{1,2}(?:\.\d+)?)[s]?[\s,]+\s*([+-]?\d{1,2})[d°:\s]\s*(\d{1,2})[m':\s]\s*(\d{1,2}(?:\.\d+)?)[s"]?$/i;
  const sexaMatch = trimmed.match(sexaRegex);
  if (sexaMatch) {
    const rh = parseFloat(sexaMatch[1]);
    const rm = parseFloat(sexaMatch[2]);
    const rs = parseFloat(sexaMatch[3]);
    const raDeg = (rh + rm / 60 + rs / 3600) * 15;

    const decSign = sexaMatch[4].startsWith('-') ? -1 : 1;
    const dd = Math.abs(parseFloat(sexaMatch[4]));
    const dm = parseFloat(sexaMatch[5]);
    const ds = parseFloat(sexaMatch[6]);
    const decDeg = decSign * (dd + dm / 60 + ds / 3600);

    if (raDeg >= 0 && raDeg <= 360 && decDeg >= -90 && decDeg <= 90) {
      return { ra: parseFloat(raDeg.toFixed(6)), dec: parseFloat(decDeg.toFixed(6)) };
    }
  }

  // Pattern 2: Decimal (e.g. 133.73712, -7.24038 or 133.73712 -7.24038)
  const decimalRegex = /^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/;
  const decMatch = trimmed.match(decimalRegex);
  if (decMatch) {
    const ra = parseFloat(decMatch[1]);
    const dec = parseFloat(decMatch[2]);
    if (ra >= 0 && ra <= 360 && dec >= -90 && dec <= 90) {
      return { ra: parseFloat(ra.toFixed(6)), dec: parseFloat(dec.toFixed(6)) };
    }
  }

  return null;
}

export interface GlobalCommandHeaderProps {
  onOpenCommandPalette?: () => void;
  onToggleMissionBriefing?: () => void;
  isMissionBriefingActive?: boolean;
  onOpenCatalog?: () => void;
}

export const GlobalCommandHeader: React.FC<GlobalCommandHeaderProps> = ({
  onOpenCommandPalette,
  onToggleMissionBriefing,
  isMissionBriefingActive = false,
  onOpenCatalog,
}) => {
  const {
    ra,
    dec,
    fovArcsec,
    activeTargetName,
    sourceBadge,
    totalEpochs,
    setCoordinates,
    setRgbPreset,
  } = useTelemetryStore();

  const { tab, setTab, setRa, setDec, setPreset } = useSpectraUrlState();

  const [searchInput, setSearchInput] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isBackendLive, setIsBackendLive] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isScienceMenuOpen, setIsScienceMenuOpen] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const scienceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const scienceTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);

  // Close autocomplete dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchFocused(false);
      }
      if (scienceMenuRef.current && !scienceMenuRef.current.contains(e.target as Node)) {
        setIsScienceMenuOpen(false);
      }
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Backend Health Ping (/api/health/live)
  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health/live', { method: 'GET' });
        if (active) setIsBackendLive(res.ok);
      } catch {
        if (active) setIsBackendLive(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Compute 14 Bytes/Pixel Payload Gauge (SPECIFICATION.md §6.2.4)
  const payloadMb = useMemo(() => {
    const nEpochs = Math.max(1, totalEpochs || 4);
    const nPixelsPerBand = Math.pow(fovArcsec / 6.2, 2);
    const totalBytes = nEpochs * 6 * nPixelsPerBand * 14;
    return totalBytes / 1e6;
  }, [fovArcsec, totalEpochs]);

  // Filter local catalog suggestions as user types
  const filteredCatalog = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return SEARCHABLE_SKY_CATALOG;
    const normQ = q.replace(/[-'\s]/g, '');
    return SEARCHABLE_SKY_CATALOG.filter(
      (item) =>
        item.name.toLowerCase().replace(/[-'\s]/g, '').includes(normQ) ||
        item.description.toLowerCase().includes(q) ||
        `${item.ra.toFixed(4)} ${item.dec.toFixed(4)}`.includes(q)
    );
  }, [searchInput]);

  const applyResolvedTarget = useCallback(
    (
      targetRa: number,
      targetDec: number,
      name: string,
      badge: string,
      preset?: BenchmarkPill['preset']
    ) => {
      setCoordinates(targetRa, targetDec, name, badge);
      setRa(targetRa);
      setDec(targetDec);
      if (preset) {
        setRgbPreset(preset);
        setPreset(preset);
      }
      setSearchInput('');
      setIsSearchFocused(false);
    },
    [setCoordinates, setDec, setPreset, setRa, setRgbPreset]
  );

  // Execute Universal Coordinate or Name Resolution (ICRS Decimal, Sexagesimal, Local Catalog, Backend /api/resolve, CDS Sesame SIMBAD/NED)
  const executeSearchResolution = useCallback(
    async (rawQuery: string) => {
      const value = rawQuery.trim();
      if (!value) return;

      // 1. Direct Coordinate Parse (<1 ms)
      const parsedCoords = parseCoordinateInput(value);
      if (parsedCoords) {
        const matched = MANDATORY_BENCHMARKS.find(
          (b) =>
            Math.abs(b.ra - parsedCoords.ra) < 0.05 &&
            Math.abs(b.dec - parsedCoords.dec) < 0.05
        );
        applyResolvedTarget(
          parsedCoords.ra,
          parsedCoords.dec,
          matched ? matched.name : `J2000 ${parsedCoords.ra.toFixed(4)}°, ${parsedCoords.dec >= 0 ? '+' : ''}${parsedCoords.dec.toFixed(4)}°`,
          matched ? '[NASA Benchmark (Pre-cached)]' : '[Synthetic Injection Mode]',
          matched?.preset
        );
        return;
      }

      // 2. Local Catalog Match
      const norm = value.toLowerCase().replace(/[-'\s]/g, '');
      const catalogHit = SEARCHABLE_SKY_CATALOG.find(
        (item) =>
          item.name.toLowerCase().replace(/[-'\s]/g, '').includes(norm) ||
          item.label.toLowerCase().replace(/[-'\s]/g, '').includes(norm)
      );
      if (catalogHit) {
        const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === catalogHit.id);
        applyResolvedTarget(
          catalogHit.ra,
          catalogHit.dec,
          catalogHit.name,
          isBench ? '[NASA Benchmark (Pre-cached)]' : '[Synthetic Injection Mode]',
          catalogHit.preset
        );
        return;
      }

      setIsResolving(true);
      try {
        // 3. Try Backend /api/resolve (with 1.5s timeout)
        try {
          const backendCtrl = new AbortController();
          const backendTimer = setTimeout(() => backendCtrl.abort(), 1500);
          try {
            const res = await fetch(`/api/resolve?q=${encodeURIComponent(value)}`, {
              signal: backendCtrl.signal,
            });
            if (res.ok) {
              const data = await res.json();
              if (typeof data.ra === 'number' && typeof data.dec === 'number') {
                applyResolvedTarget(
                  data.ra,
                  data.dec,
                  data.target_name || value,
                  data.source_badge || '[IRSA Live (spherex_qr2)]'
                );
                setIsResolving(false);
                return;
              }
            }
          } finally {
            clearTimeout(backendTimer);
          }
        } catch {
          // Proceed to CDS Sesame resolver
        }

        // 4. Try CDS Sesame (SIMBAD / NED / VizieR) Universal Astronomical Name Resolver (with 2.5s timeout)
        const sesameCtrl = new AbortController();
        const sesameTimer = setTimeout(() => sesameCtrl.abort(), 2500);
        const sesameUrl = `https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp/SNV?${encodeURIComponent(
          value
        )}`;
        try {
          const sesameRes = await fetch(sesameUrl, { signal: sesameCtrl.signal });
          if (sesameRes.ok) {
            const xmlText = await sesameRes.text();
            const jradegMatch = xmlText.match(/<jradeg>([+-]?\d+(?:\.\d+)?)<\/jradeg>/i);
            const jdedegMatch = xmlText.match(/<jdedeg>([+-]?\d+(?:\.\d+)?)<\/jdedeg>/i);
            const onameMatch = xmlText.match(/<oname>([^<]+)<\/oname>/i);
            if (jradegMatch && jdedegMatch) {
              const resolvedRa = parseFloat(jradegMatch[1]);
              const resolvedDec = parseFloat(jdedegMatch[1]);
              const resolvedName = onameMatch ? onameMatch[1].trim() : value;
              if (Number.isFinite(resolvedRa) && Number.isFinite(resolvedDec)) {
                applyResolvedTarget(
                  resolvedRa,
                  resolvedDec,
                  resolvedName,
                  '[SIMBAD / IRSA Resolved]'
                );
              }
            }
          }
        } finally {
          clearTimeout(sesameTimer);
        }
      } catch {
        // Graceful fallback
      } finally {
        setIsResolving(false);
      }
    },
    [applyResolvedTarget]
  );

  const prefetchBenchmark = useCallback((name: string) => {
    queryClient.prefetchQuery({
      queryKey: ['benchmark_cache', name],
      queryFn: async () => {
        try {
          const res = await fetch(`/benchmarks/${encodeURIComponent(name)}.json`);
          return res.ok ? await res.json() : null;
        } catch {
          return null;
        }
      },
      staleTime: 1000 * 60 * 60,
    });
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setShareFeedback('Deep link copied to clipboard!');
    setTimeout(() => setShareFeedback(null), 2500);
  };

  const handleCopyIframe = () => {
    const embedUrl = new URL(window.location.href);
    embedUrl.searchParams.set('embed', '1');
    const iframeCode = `<iframe src="${embedUrl.toString()}" width="100%" height="600" frameborder="0" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(iframeCode);
    setShareFeedback('iFrame embed snippet copied!');
    setTimeout(() => setShareFeedback(null), 2500);
  };

  const selectWorkspace = (nextTab: string) => {
    setTab(nextTab);
    setIsScienceMenuOpen(false);
    setIsWorkspaceMenuOpen(false);
    if (isMissionBriefingActive) onToggleMissionBriefing?.();
  };

  const closeWorkspaceMenus = () => {
    const returnFocusTo = isWorkspaceMenuOpen
      ? workspaceTriggerRef.current
      : scienceTriggerRef.current;
    setIsScienceMenuOpen(false);
    setIsWorkspaceMenuOpen(false);
    returnFocusTo?.focus();
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex h-[56px] items-center justify-between gap-2 border-b border-border bg-black/90 backdrop-blur-md px-2 sm:px-4 font-sans text-xs text-foreground">
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <a href="/" aria-label="Spectra home" className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-300/50 bg-sky-300/10 text-sky-200" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M4 16.5 9.2 6l2.8 5.5L14 8l6 10H4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <circle cx="17.5" cy="5.5" r="1" fill="currentColor" />
            </svg>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-extrabold tracking-[0.12em] text-white leading-none">SPECTRA</span>
            <span className="hidden sm:inline truncate text-[9px] tracking-wide text-neutral-400">Community Product · SPHEREx data</span>
          </span>
        </a>

        <span
          className={cn(
            'hidden lg:flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium',
            isBackendLive
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/25 bg-amber-500/10 text-amber-300'
          )}
          title={isBackendLive ? 'The backend health endpoint responded.' : 'The backend health endpoint is unavailable; data-source badges describe the displayed content.'}
          aria-label={isBackendLive ? 'Backend online' : 'Backend unavailable'}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', isBackendLive ? 'bg-emerald-400' : 'bg-amber-400')} />
          {isBackendLive ? 'API online' : 'API unavailable'}
        </span>

        <Badge
          variant="secondary"
          className="hidden 2xl:inline-flex shrink-0 font-mono text-[10px] tabular-nums bg-neutral-900 border-neutral-800 text-neutral-400"
          title="Source of the currently displayed data"
        >
          {sourceBadge}
        </Badge>

        {onOpenCatalog && (
          <button
            type="button"
            onClick={onOpenCatalog}
            className="hidden lg:flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/80 px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 hover:text-white"
            title={`Browse ${SEARCHABLE_SKY_CATALOG.length} targets in the source catalog`}
          >
            <svg className="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            <span>Catalog</span>
            <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-mono text-primary">{SEARCHABLE_SKY_CATALOG.length}</span>
          </button>
        )}
      </div>

      {/* 2. Universal Coordinate & Object Name Resolver (SIMBAD / NED / ICRS / Catalog) */}
      <div ref={searchContainerRef} className="relative flex-1 max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeSearchResolution(searchInput);
          }}
          className="relative flex items-center"
        >
          <label htmlFor="spectra-coord-search" className="sr-only">
            Search sky coordinates (J2000 decimal or sexagesimal) or astronomical object name
          </label>
          <svg
            className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
          <Input
            id="spectra-coord-search"
            type="text"
            value={searchInput}
            onFocus={() => setIsSearchFocused(true)}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setIsSearchFocused(true);
            }}
            placeholder={
              activeTargetName
                ? `${activeTargetName} (${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°) — Search RA/Dec or object...`
                : "Search RA/Dec (e.g. 269.44, 4.76) or object (Barnard's Star, WISE 0855)..."
            }
            className="w-full pl-8 pr-16 bg-neutral-950/90 border border-neutral-800 focus:border-primary font-mono text-xs tabular-nums text-foreground placeholder:text-muted-foreground rounded-full"
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            {isResolving && (
              <span className="px-1 font-sans text-[10px] text-primary">Resolving…</span>
            )}
            <Button
              variant="outline"
              size="xs"
              onClick={onOpenCommandPalette}
              className="h-5 px-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              title="Open command palette (⌘K / Ctrl+K)"
              aria-label="Open command palette"
            >
              ⌘&nbsp;K
            </Button>
          </div>
        </form>

        {/* Search Resolver Autocomplete & Coordinate Format Helper Popover */}
        {isSearchFocused && (
          <div className="absolute left-0 right-0 top-9 z-50 max-h-80 overflow-y-auto rounded-sm border border-border bg-popover p-1.5 shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
              <span>Enter J2000 decimal, sexagesimal (HH:MM:SS ±DD:MM:SS), or SIMBAD object name</span>
              <span className="font-mono">↵ Enter</span>
            </div>

            {parseCoordinateInput(searchInput) && (
              <button
                type="button"
                onClick={() => executeSearchResolution(searchInput)}
                className="mt-1 flex w-full items-center justify-between rounded-sm border border-primary/40 bg-secondary/80 px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-primary/10 transition-colors"
              >
                <span>Go to J2000 coordinates</span>
                <span className="font-mono text-primary">
                  {parseCoordinateInput(searchInput)?.ra.toFixed(5)}°,{' '}
                  {parseCoordinateInput(searchInput)?.dec.toFixed(5)}°
                </span>
              </button>
            )}

            <div className="mt-1 flex flex-col gap-0.5">
              {filteredCatalog.map((item) => {
                const isCurrent =
                  Math.abs(ra - item.ra) < 0.01 && Math.abs(dec - item.dec) < 0.01;
                const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => {
                      if (isBench) prefetchBenchmark(item.name);
                    }}
                    onClick={() =>
                      applyResolvedTarget(
                        item.ra,
                        item.dec,
                        item.name,
                        isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]',
                        item.preset
                      )
                    }
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors duration-150',
                      isCurrent
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">{item.name}</span>
                        {item.category && (
                          <Badge variant="outline" className="text-[10px]">
                            {item.category}
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {item.description}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-primary">
                      {item.ra.toFixed(3)}° {item.dec >= 0 ? `+${item.dec.toFixed(3)}` : item.dec.toFixed(3)}°
                    </span>
                  </button>
                );
              })}

              {searchInput.trim().length > 1 && !parseCoordinateInput(searchInput) && (
                <button
                  type="button"
                  onClick={() => executeSearchResolution(searchInput)}
                  className="mt-1 flex w-full items-center justify-between rounded-sm border border-border bg-secondary px-2.5 py-1.5 text-left text-xs text-foreground hover:border-primary transition-colors"
                >
                  <span>
                    Query SIMBAD / NED / IRSA resolver for &ldquo;{searchInput.trim()}&rdquo;
                  </span>
                  <span className="font-mono text-[11px] text-primary">Resolve ↵</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Workspace Tab Switcher & Share */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Compact Tensor Memory Readout */}
        <div
          className={cn(
            'hidden xl:flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] tabular-nums',
            payloadMb >= 2.0
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
              : 'border-border bg-background text-muted-foreground'
          )}
          title={`Cutout FoV: ${fovArcsec}" · Uncompressed float32 tensor payload (${
            totalEpochs || 4
          } passes × 6 bands × 14 B/px)`}
        >
          <span>{fovArcsec}&quot;</span>
          <span className="text-border">|</span>
          <span>{payloadMb.toFixed(2)}&nbsp;MB</span>
        </div>

        <nav
          aria-label="Primary navigation"
          className="hidden xl:flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-950/90 p-0.5"
        >
          <Button
            variant={tab === 'navigator' && !isMissionBriefingActive ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => selectWorkspace('navigator')}
            aria-current={tab === 'navigator' && !isMissionBriefingActive ? 'page' : undefined}
            className={cn('h-7 rounded-full px-3 text-xs', tab === 'navigator' && !isMissionBriefingActive ? 'bg-primary font-medium text-white' : 'text-neutral-300 hover:bg-neutral-900 hover:text-white')}
            title="Celestial Navigator"
          >
            Explore
          </Button>

          <div ref={scienceMenuRef} className="relative">
            <button
              ref={scienceTriggerRef}
              type="button"
              onClick={() => setIsScienceMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeWorkspaceMenus();
                }
              }}
              aria-expanded={isScienceMenuOpen}
              aria-controls="science-workspaces-menu"
              aria-current={['comparator', 'spectral', 'ice'].includes(tab) && !isMissionBriefingActive ? 'page' : undefined}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs transition-colors',
                ['comparator', 'spectral', 'ice'].includes(tab) && !isMissionBriefingActive
                  ? 'bg-primary font-medium text-white'
                  : 'text-neutral-300 hover:bg-neutral-900 hover:text-white'
              )}
            >
              Science
              <svg viewBox="0 0 16 16" className={cn('h-3 w-3 transition-transform', isScienceMenuOpen && 'rotate-180')} fill="none" aria-hidden="true">
                <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {isScienceMenuOpen && (
              <div
                id="science-workspaces-menu"
                className="absolute left-0 top-10 z-50 w-64 rounded-xl border border-border bg-popover p-2 shadow-2xl"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeWorkspaceMenus();
                  }
                }}
              >
                <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Science workspaces</p>
                {TABS.slice(1, 4).map((workspace) => {
                  const isActive = tab === workspace.id && !isMissionBriefingActive;
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => selectWorkspace(workspace.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                        isActive ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-secondary'
                      )}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">{workspace.number.padStart(2, '0')}</span>
                      <span>{workspace.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Button
            variant={tab === 'discussions' && !isMissionBriefingActive ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => selectWorkspace('discussions')}
            aria-current={tab === 'discussions' && !isMissionBriefingActive ? 'page' : undefined}
            className={cn('h-7 rounded-full px-3 text-xs', tab === 'discussions' && !isMissionBriefingActive ? 'bg-primary font-medium text-white' : 'text-neutral-300 hover:bg-neutral-900 hover:text-white')}
            title="Observation Discussions and candidate review"
          >
            Review
          </Button>
        </nav>

        <div ref={workspaceMenuRef} className="relative xl:hidden">
          <button
            ref={workspaceTriggerRef}
            type="button"
            onClick={() => setIsWorkspaceMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeWorkspaceMenus();
              }
            }}
            aria-expanded={isWorkspaceMenuOpen}
            aria-controls="compact-workspaces-menu"
            aria-label="Open workspaces and target catalog"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-neutral-700 bg-neutral-900 px-2 sm:px-3 text-xs text-neutral-100 hover:border-neutral-500"
          >
            <span className="hidden sm:inline">Workspaces</span>
            <span className="sm:hidden">Menu</span>
            <svg viewBox="0 0 16 16" className={cn('h-3 w-3 transition-transform', isWorkspaceMenuOpen && 'rotate-180')} fill="none" aria-hidden="true">
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {isWorkspaceMenuOpen && (
            <div
              id="compact-workspaces-menu"
              className="absolute right-0 top-10 z-50 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-popover p-2 shadow-2xl"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeWorkspaceMenus();
                }
              }}
            >
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Explore Spectra</p>
              <button type="button" onClick={() => selectWorkspace('navigator')} className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-secondary">
                Explore · Celestial Navigator
              </button>
              <div role="group" aria-label="Science workspaces" className="mt-1 border-t border-border pt-1">
                <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Science</p>
                {TABS.slice(1, 4).map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => selectWorkspace(workspace.id)}
                    aria-current={tab === workspace.id && !isMissionBriefingActive ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                      tab === workspace.id && !isMissionBriefingActive ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-secondary'
                    )}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">{workspace.number.padStart(2, '0')}</span>
                    <span>{workspace.label}</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => selectWorkspace('discussions')} className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-secondary">
                Review · Observation Discussions
              </button>
              {onOpenCatalog && (
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkspaceMenuOpen(false);
                    onOpenCatalog();
                  }}
                  className="mt-1 flex w-full items-center border-t border-border px-2.5 pt-3 pb-2 text-left text-xs text-primary hover:text-sky-200"
                >
                  Browse target catalog
                </button>
              )}
            </div>
          )}
        </div>

        {/* Share & Embed Exporter Dropdown */}
        <div className="relative">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsShareOpen(!isShareOpen)}
            aria-expanded={isShareOpen}
          >
            Share
          </Button>

          {isShareOpen && (
            <div className="absolute right-0 top-9 z-50 w-64 rounded-sm border border-border bg-popover p-3 shadow-xl">
              <div className="mb-2 text-xs font-medium text-foreground">
                Share current view state
              </div>
              <div className="flex flex-col gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyLink}
                  className="w-full justify-start text-xs font-normal"
                >
                  Copy deep link URL
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyIframe}
                  className="w-full justify-start text-xs font-normal"
                >
                  Copy iframe embed (?embed=1)
                </Button>
              </div>
              {shareFeedback && (
                <div role="status" aria-live="polite" className="mt-2 text-[11px] text-emerald-400">
                  {shareFeedback}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
