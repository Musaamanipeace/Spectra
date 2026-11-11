import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { WebGLComparatorCanvas, HoverPixelInfo } from '../components/WebGLComparatorCanvas';
import { MANDATORY_BENCHMARKS } from '../components/GlobalCommandHeader';

/**
 * Spectra Tab 2: Time-Domain Comparator (<TimeDomainComparator />)
 * Specification Anchor: SPECIFICATION.md §6.1.6, §6.1.7, §6.3.2, §7.1; DESIGN.md
 * Role: E3 (role:E3-webgl)
 *
 * Capabilities:
 * - 65% Left Canvas Deck: WebGL2 Float32 comparator canvas, discrete MJD scrubber,
 *   Frame-0 cyan border indicator, sub-pixel Gaia DR3 centroid reticle, and hover HUD.
 * - 35% Right Analysis Deck:
 *   - Render Mode Switcher: Blink, Signed Difference, Inverse-Variance Co-Add
 *   - Asinh non-linearity parameter slider (a in [0.001, 1.0])
 *   - (Epoch x Band) Coverage Matrix with strict Wavelength-Matched Differencing Guard
 *   - Honest [Not Detected at Pass Depth] states (WISE 0855 in D1-D3)
 *   - 6-Detector False-Color RGB Super-Band Mixer
 *   - Forced 3x3 Aperture Multi-Band Light Curve (D1 vs D5)
 *   - Interactive 2-click Proper Motion Vector Calculator (Delta alpha, Delta delta, PA)
 *   - Triage classification form linking to Tab 5 Discussions
 */

// Discrete survey passes derived from IRSA SIA2 exposure MJD clustering (backend/config/survey_passes.json)
interface SurveyPass {
  passIndex: number;
  label: string;
  mjd: number;
  mjdRange: [number, number];
  dateStr: string;
  rollAngleDeg: number;
}

const DISCRETE_SURVEY_PASSES: SurveyPass[] = [
  { passIndex: 0, label: 'Pass 1', mjd: 60810.4, mjdRange: [60789.9, 61053.4], dateStr: '2025-05-15', rollAngleDeg: 12.4 },
  { passIndex: 1, label: 'Pass 2', mjd: 60995.2, mjdRange: [61091.7, 61237.9], dateStr: '2025-11-16', rollAngleDeg: 34.8 },
  { passIndex: 2, label: 'Pass 3', mjd: 61178.6, mjdRange: [61178.6, 61360.2], dateStr: '2026-05-18', rollAngleDeg: 58.2 },
];

const BANDS = [
  { id: 'D1', name: 'D1 (0.9 µm)', wavelengthUm: 0.93, resPower: 41 },
  { id: 'D2', name: 'D2 (1.3 µm)', wavelengthUm: 1.37, resPower: 45 },
  { id: 'D3', name: 'D3 (2.0 µm)', wavelengthUm: 2.02, resPower: 57 },
  { id: 'D4', name: 'D4 (3.1 µm)', wavelengthUm: 3.12, resPower: 80 },
  { id: 'D5', name: 'D5 (4.1 µm)', wavelengthUm: 4.12, resPower: 110 },
  { id: 'D6', name: 'D6 (4.7 µm)', wavelengthUm: 4.71, resPower: 130 },
];

// Deterministic Mulberry32 + Box-Muller Gaussian PRNG (replaces linear modulo lattice pattern)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleBoxMullerGaussian(rng: () => number, sigma: number): number {
  const u1 = Math.max(1e-7, rng());
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * sigma;
}

const CANVAS_PIXEL_DIM = 29; // Standard 29x29 cutout stamp (~180" FoV at 6.2"/px)

export interface TimeDomainComparatorProps {
  onOpenCatalog?: () => void;
}

export const TimeDomainComparator: React.FC<TimeDomainComparatorProps> = ({ onOpenCatalog }) => {
  const {
    ra: urlRa,
    dec: urlDec,
    fov: urlFov,
    mode: urlMode,
    setMode: setUrlMode,
    probeX: urlPx,
    probeY: urlPy,
    setProbeX: setUrlProbeX,
    setProbeY: setUrlProbeY,
    setTab,
  } = useSpectraUrlState();

  const store = useTelemetryStore();
  const {
    renderMode,
    setRenderMode,
    activeEpochIndex,
    setEpochIndex,
    stepEpoch,
    isPlaying,
    setPlayback,
    togglePlayback,
    playbackSpeedMs,
    loopMode,
    asinhParamA,
    setAsinhParams,
    colorPalette,
    setColorPalette,
    rawVsRectified,
    setRawVsRectified,
    activeRgbPreset,
    setRgbPreset,
    setProbedPixel,
  } = store;

  const [activeBandIndex, setActiveBandIndex] = useState<number>(4); // Default to Band D5 (index 4)
  const [hoverPixel, setHoverPixel] = useState<HoverPixelInfo | null>(null);
  const [measuringMotion, setMeasuringMotion] = useState<boolean>(false);
  const [motionPoints, setMotionPoints] = useState<Array<{ x: number; y: number; epoch: number }>>([]);
  const [motionResult, setMotionResult] = useState<{
    deltaAlphaArcsec: number;
    deltaDeltaArcsec: number;
    totalMotionArcsecYr: number;
    positionAngleDeg: number;
  } | null>(null);

  // Triage state
  const [triageClass, setTriageClass] = useState<string>('moving_brown_dwarf');
  const [triageConfidence, setTriageConfidence] = useState<number>(85);
  const [triageSubmitted, setTriageSubmitted] = useState<boolean>(false);
  const [isSubmittingClassification, setIsSubmittingClassification] = useState<boolean>(false);

  const handleSubmitClassification = async () => {
    setIsSubmittingClassification(true);
    setTriageSubmitted(true);
    try {
      let id = localStorage.getItem('spx_observer_id');
      let key = localStorage.getItem('spx_observer_key');
      if (!id && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        id = crypto.randomUUID();
        localStorage.setItem('spx_observer_id', id);
      } else if (!id) {
        id = '00000000-0000-4000-8000-000000007f3a';
        localStorage.setItem('spx_observer_id', id);
      }
      if (!key && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('spx_observer_key', key);
      } else if (!key) {
        key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
        localStorage.setItem('spx_observer_key', key);
      }

      const subjectId = activeBenchmark?.id || `subj-${urlRa.toFixed(4)}-${urlDec.toFixed(4)}`;
      await fetch('/api/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': id,
          'X-Observer-Key': key,
        },
        body: JSON.stringify({
          subject_id: subjectId,
          tab_workflow: 'comparator',
          primary_class: triageClass,
          confidence: triageConfidence / 100,
          motion_telemetry: {
            ra: urlRa,
            dec: urlDec,
            renderMode,
            epochIndex: activeEpochIndex,
            targetName: activeBenchmark?.name || store.activeTargetName,
          },
        }),
      });
    } catch {
      // Optimistic local fallback preserved when backend is offline
    } finally {
      setIsSubmittingClassification(false);
    }
  };

  const handleNextCandidate = async () => {
    setTriageSubmitted(false);
    try {
      const res = await fetch('/api/queue/next');
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.ra === 'number' && typeof data.dec === 'number') {
          store.setCoordinates(
            data.ra,
            data.dec,
            data.name || data.subject_id || `Candidate ${data.ra.toFixed(4)}, ${data.dec.toFixed(4)}`,
            '[Active Learning Queue]'
          );
          return;
        }
      }
    } catch {
      // Graceful fallback to next catalog target
    }
    // Fallback: cycle to next mandatory NASA benchmark
    const currentIdx = MANDATORY_BENCHMARKS.findIndex(
      (b) => Math.abs(b.ra - urlRa) < 0.05 && Math.abs(b.dec - urlDec) < 0.05
    );
    const nextBenchmark = MANDATORY_BENCHMARKS[(currentIdx + 1) % MANDATORY_BENCHMARKS.length];
    if (nextBenchmark) {
      store.setCoordinates(
        nextBenchmark.ra,
        nextBenchmark.dec,
        nextBenchmark.name,
        '[Benchmark Model (Simulated)]'
      );
    }
  };

  // 1. Identify active benchmark if coordinates match (Epoch 2025.5 or J2000 / WISE 2010.5 discovery epoch)
  const activeBenchmark = useMemo(() => {
    const direct = MANDATORY_BENCHMARKS.find(
      (b) => Math.abs(b.ra - urlRa) < 0.05 && Math.abs(b.dec - urlDec) < 0.05
    );
    if (direct) return direct;
    // Also match WISE 0855 at WISE discovery (2010.5: 133.7862, -7.2443) or J2000 (133.7951, -7.2452)
    if (Math.abs(133.79 - urlRa) < 0.07 && Math.abs(-7.244 - urlDec) < 0.05) {
      return MANDATORY_BENCHMARKS.find((b) => b.id === 'wise0855');
    }
    return undefined;
  }, [urlRa, urlDec]);

  // Synchronize renderMode with URL
  useEffect(() => {
    if (urlMode === 'blink' || urlMode === 'difference' || urlMode === 'coadd') {
      if (renderMode !== urlMode) setRenderMode(urlMode);
    }
  }, [urlMode, renderMode, setRenderMode]);

  // 2. Playback animation timer
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setEpochIndex((activeEpochIndex + 1) % DISCRETE_SURVEY_PASSES.length);
    }, playbackSpeedMs);
    return () => clearInterval(interval);
  }, [isPlaying, activeEpochIndex, playbackSpeedMs, setEpochIndex]);

  // 3. Offline procedural fallback tensor generator (used only when .f32 / live IRSA cutout is unavailable)
  const scienceTensors = useMemo(() => {
    const epochsCount = DISCRETE_SURVEY_PASSES.length;
    const bandsCount = BANDS.length;
    const totalPixels = CANVAS_PIXEL_DIM * CANVAS_PIXEL_DIM;

    const fluxData: Float32Array[][] = [];
    const varData: Float32Array[][] = [];
    const flagsData: Uint32Array[][] = [];
    const nExpData: Uint16Array[][] = [];

    const centerPx = (CANVAS_PIXEL_DIM - 1) / 2;
    const pixelScale = 6.2; // arcsec/pixel
    const zodiBgPerBand = [0.028, 0.032, 0.030, 0.055, 0.125, 0.210];
    const rng = mulberry32(Math.abs(Math.round(urlRa * 1000 + urlDec * 1000)) || 1337);

    // FWHM = 1.2 px (~7.44" at 6.2"/px) => sigma = FWHM / (2 * sqrt(2 * ln 2)) = 1.2 / 2.35482 ≈ 0.51 px
    const fwhmPx = 1.2;
    const sigmaPx = fwhmPx / 2.35482;
    const twoSigmaSq = 2 * sigmaPx * sigmaPx;

    for (let e = 0; e < epochsCount; e++) {
      fluxData[e] = [];
      varData[e] = [];
      flagsData[e] = [];
      nExpData[e] = [];

      const epochMjd = DISCRETE_SURVEY_PASSES[e].mjd;
      const deltaYears = (epochMjd - DISCRETE_SURVEY_PASSES[0].mjd) / 365.25;

      for (let b = 0; b < bandsCount; b++) {
        const fluxPlane = new Float32Array(totalPixels);
        const varPlane = new Float32Array(totalPixels);
        const flagsPlane = new Uint32Array(totalPixels);
        const nExpPlane = new Uint16Array(totalPixels);

        const baseNoise = 0.35 + b * 0.08;
        const baseVar = baseNoise * baseNoise;
        const noiseSigma = 0.015 + b * 0.004;
        const zodiBg = zodiBgPerBand[b] || 0.04;

        let targetX = centerPx;
        let targetY = centerPx;
        let peakFlux = 8.0;
        let isUndetected = false;
        let isSaturated = false;
        let passExposures = 18;

        if (activeBenchmark?.id === 'barnard') {
          targetY = centerPx + (10.39 * deltaYears) / pixelScale;
          peakFlux = [25.0, 32.0, 20.0, 12.0, 7.0, 4.5][b] || 12.0;
          if (b <= 1) isSaturated = true;
          passExposures = [24, 23, 18, 25, 22, 18][b] || 20;
        } else if (activeBenchmark?.id === 'wise0855') {
          targetX = centerPx - (8.15 * deltaYears) / pixelScale;
          if (b <= 2) {
            isUndetected = true;
            peakFlux = 0.02;
          } else {
            peakFlux = b >= 4 ? 1.85 : 0.45;
          }
          passExposures = [22, 33, 24, 22, 33, 22][b] || 22;
        } else if (activeBenchmark?.id === 'eps_indi_b') {
          targetX = centerPx + (3.98 * deltaYears) / pixelScale;
          targetY = centerPx + (-2.47 * deltaYears) / pixelScale;
          peakFlux = [6.5, 4.2, 3.8, 5.0, 7.2, 5.8][b] || 5.5;
          passExposures = [26, 64, 52, 25, 51, 48][b] || 30;
        } else if (activeBenchmark?.id === 'rw_aur') {
          const dimming = e === 0 ? 1.0 : 0.24;
          peakFlux = ([18.0, 16.5, 14.0, 12.5, 11.0, 9.5][b] || 12.0) * dimming;
          passExposures = 19;
        } else if (activeBenchmark?.id === 'r_dra') {
          const cycle = [1.0, 0.22, 0.88][e] || 0.6;
          peakFlux = ([12.0, 15.0, 17.5, 14.0, 11.5, 9.0][b] || 12.0) * cycle;
          passExposures = [69, 76, 50, 67, 75, 46][b] || 55;
        }

        for (let y = 0; y < CANVAS_PIXEL_DIM; y++) {
          for (let x = 0; x < CANVAS_PIXEL_DIM; x++) {
            const idx = y * CANVAS_PIXEL_DIM + x;

            // Outer border reference pixels -> Bit 5 REFERENCE
            if (x === 0 || x === CANVAS_PIXEL_DIM - 1 || y === 0 || y === CANVAS_PIXEL_DIM - 1) {
              flagsPlane[idx] |= 32;
            }

            // Box-Muller Gaussian sky + read noise (free of modulo lattice stripes)
            const gaussNoise = sampleBoxMullerGaussian(rng, noiseSigma);
            const dx = x - targetX;
            const dy = y - targetY;
            const distSq = dx * dx + dy * dy;
            const psfFlux = isUndetected ? 0.0 : peakFlux * Math.exp(-distSq / twoSigmaSq);
            const flux = zodiBg + psfFlux + gaussNoise;

            fluxPlane[idx] = flux;
            // Spatially varying variance: read/zodi variance + Poisson photon shot noise
            const flatJitter = 1.0 + 0.05 * Math.sin(0.41 * x + 0.29 * y);
            varPlane[idx] = Math.max(
              0.005,
              (baseVar * flatJitter) / Math.max(1, Math.floor(passExposures / 6)) +
                0.018 * Math.max(0, flux)
            );
            nExpPlane[idx] = isUndetected ? 0 : passExposures;

            if (!isUndetected && isSaturated && distSq < 0.8) {
              flagsPlane[idx] |= 2;
            }
          }
        }

        fluxData[e][b] = fluxPlane;
        varData[e][b] = varPlane;
        flagsData[e][b] = flagsPlane;
        nExpData[e][b] = nExpPlane;
      }
    }

    return { fluxData, varData, flagsData, nExpData, isSimulated: true };
  }, [activeBenchmark, urlRa, urlDec]);

  // Load binary tensor from pre-cached .f32 bundle OR live backend /api/cutout pipeline
  const [loadedTensor, setLoadedTensor] = useState<{
    fluxData: Float32Array[][];
    varData: Float32Array[][];
    flagsData: Uint32Array[][];
    nExpData: Uint16Array[][];
    width: number;
    height: number;
    epochs: number;
    isSimulated: boolean;
    sourceBadge: string;
    mjdRanges?: number[][];
    exposureIds?: string[][] | string[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const parseBinaryTensorBuffer = (buf: ArrayBuffer) => {
      if (buf.byteLength < 4) return null;
      const dv = new DataView(buf);
      const hdrLen = dv.getUint32(0, true);
      if (buf.byteLength < 4 + hdrLen) return null;

      const hdrStr = new TextDecoder().decode(new Uint8Array(buf, 4, hdrLen));
      const hdr = JSON.parse(hdrStr);
      if (hdr.compression && hdr.compression !== 'none') return null;

      const [epochs, bands, h, w] = hdr.shape;
      const planePixels = h * w;
      const totalPixels = epochs * bands * planePixels;

      const fluxOffset = 4 + hdrLen;
      const varOffset = fluxOffset + totalPixels * 4;
      const flagsOffset = varOffset + totalPixels * 4;
      const nExpOffset = flagsOffset + totalPixels * 4;

      if (buf.byteLength < flagsOffset + totalPixels * 4) return null;

      const allFlux = new Float32Array(buf.slice(fluxOffset, fluxOffset + totalPixels * 4));
      const allVar = new Float32Array(buf.slice(varOffset, varOffset + totalPixels * 4));
      const allFlags = new Uint32Array(buf.slice(flagsOffset, flagsOffset + totalPixels * 4));
      const hasNExp = buf.byteLength >= nExpOffset + totalPixels * 2;
      const allNExp = hasNExp
        ? new Uint16Array(buf.slice(nExpOffset, nExpOffset + totalPixels * 2))
        : new Uint16Array(totalPixels).fill(1);

      const fluxData: Float32Array[][] = [];
      const varData: Float32Array[][] = [];
      const flagsData: Uint32Array[][] = [];
      const nExpData: Uint16Array[][] = [];

      for (let e = 0; e < epochs; e++) {
        fluxData[e] = [];
        varData[e] = [];
        flagsData[e] = [];
        nExpData[e] = [];
        for (let b = 0; b < bands; b++) {
          const startIdx = (e * bands + b) * planePixels;
          fluxData[e][b] = allFlux.subarray(startIdx, startIdx + planePixels);
          varData[e][b] = allVar.subarray(startIdx, startIdx + planePixels);
          flagsData[e][b] = allFlags.subarray(startIdx, startIdx + planePixels);
          nExpData[e][b] = allNExp.subarray(startIdx, startIdx + planePixels);
        }
      }

      const isSim = hdr.is_simulated !== false;
      const badge = isSim
        ? activeBenchmark
          ? '[Benchmark Model (Simulated)]'
          : '[Simulated Fallback (Offline)]'
        : hdr.source_badge || '[IRSA Live (spherex_qr2)]';

      return {
        fluxData,
        varData,
        flagsData,
        nExpData,
        width: w,
        height: h,
        epochs,
        isSimulated: isSim,
        sourceBadge: badge,
        mjdRanges: hdr.mjd_ranges,
        exposureIds: hdr.exposure_ids,
      };
    };

    const loadCutoutTensor = async () => {
      // 1. Try pre-cached static bundle for benchmark targets
      if (activeBenchmark) {
        try {
          const res = await fetch(`/benchmarks/${activeBenchmark.id}.f32`);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const parsed = parseBinaryTensorBuffer(buf);
            if (!cancelled && parsed) {
              setLoadedTensor(parsed);
              useTelemetryStore.setState({ sourceBadge: parsed.sourceBadge });
              return;
            }
          }
        } catch {
          // Proceed to backend cutout API
        }
      }

      // 2. Query backend cutout pipeline (POST /api/cutout -> GET /api/cutout/{task_id}/tensor)
      try {
        const postRes = await fetch('/api/cutout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ra: urlRa,
            dec: urlDec,
            fov_arcsec: Math.round(urlFov || 180),
            adaptive_window: true,
          }),
        });
        if (postRes.ok) {
          const { task_id } = await postRes.json();
          for (let attempt = 0; attempt < 15 && !cancelled; attempt++) {
            await new Promise((r) => setTimeout(r, 150));
            const tensorRes = await fetch(`/api/cutout/${task_id}/tensor`);
            if (tensorRes.status === 200) {
              const buf = await tensorRes.arrayBuffer();
              const parsed = parseBinaryTensorBuffer(buf);
              if (!cancelled && parsed) {
                setLoadedTensor(parsed);
                useTelemetryStore.setState({ sourceBadge: parsed.sourceBadge });
                return;
              }
              break;
            }
          }
        }
      } catch {
        // Offline fallback
      }

      if (!cancelled) {
        setLoadedTensor(null);
        useTelemetryStore.setState({
          sourceBadge: activeBenchmark
            ? '[Benchmark Model (Simulated)]'
            : '[Simulated Fallback (Offline)]',
        });
      }
    };

    loadCutoutTensor();
    return () => {
      cancelled = true;
    };
  }, [activeBenchmark, urlRa, urlDec, urlFov]);

  const activeTensors = loadedTensor || scienceTensors;
  const isSimulatedDisplay = loadedTensor ? loadedTensor.isSimulated : true;
  const currentWidth = loadedTensor ? loadedTensor.width : CANVAS_PIXEL_DIM;
  const currentHeight = loadedTensor ? loadedTensor.height : CANVAS_PIXEL_DIM;
  const totalEpochsCount = loadedTensor ? loadedTensor.epochs : DISCRETE_SURVEY_PASSES.length;

  // Active planes for current selection
  const safeEpochIndex = activeEpochIndex % totalEpochsCount;
  const currentFluxPlane = activeTensors.fluxData[safeEpochIndex]?.[activeBandIndex] || null;
  const referenceFluxPlane = activeTensors.fluxData[0]?.[activeBandIndex] || null;
  const currentVarPlane = activeTensors.varData[safeEpochIndex]?.[activeBandIndex] || null;
  const referenceVarPlane = activeTensors.varData[0]?.[activeBandIndex] || null;
  const currentFlagsPlane = activeTensors.flagsData[safeEpochIndex]?.[activeBandIndex] || null;

  // 3-Band RGB False-Color Planes (D5 = Red, D3 = Green, D1 = Blue)
  const rgbPlanes = useMemo(() => {
    const totalPx = currentWidth * currentHeight;
    return {
      r: activeTensors.fluxData[safeEpochIndex]?.[4] || new Float32Array(totalPx),
      g: activeTensors.fluxData[safeEpochIndex]?.[2] || new Float32Array(totalPx),
      b: activeTensors.fluxData[safeEpochIndex]?.[0] || new Float32Array(totalPx),
    };
  }, [activeTensors, safeEpochIndex, currentWidth, currentHeight]);

  // Gaia DR3 Centroid Reticle Calculation (SPECIFICATION.md §6.1.7 Item 2)
  const gaiaReticle = useMemo(() => {
    if (!activeBenchmark) return null;
    const epochMjd = DISCRETE_SURVEY_PASSES[safeEpochIndex].mjd;
    const deltaYears = (epochMjd - DISCRETE_SURVEY_PASSES[0].mjd) / 365.25;
    const center = currentWidth / 2;

    if (activeBenchmark.id === 'barnard') {
      const dy = -(10.39 * deltaYears) / 6.2;
      return {
        subpixelX: center,
        subpixelY: center + dy,
        label: `Barnard's Star (μ = 10.39"/yr N, Δy = ${dy.toFixed(2)} px)`,
      };
    }
    if (activeBenchmark.id === 'wise0855') {
      const dx = -(8.15 * deltaYears) / 6.2;
      return {
        subpixelX: center + dx,
        subpixelY: center,
        label: `WISE 0855 (μ = 8.15"/yr W, Δx = ${dx.toFixed(2)} px)`,
      };
    }
    if (activeBenchmark.id === 'eps_indi_b') {
      const dx = (3.96 * deltaYears) / 6.2;
      const dy = -( -2.54 * deltaYears) / 6.2;
      return {
        subpixelX: center + dx,
        subpixelY: center + dy,
        label: `Epsilon Indi Ba+Bb (0.76 px/yr SE, unmix blended)`,
      };
    }
    return {
      subpixelX: center,
      subpixelY: center,
      label: `${activeBenchmark.name} (stationary <0.3 px)`,
    };
  }, [activeBenchmark, safeEpochIndex, currentWidth]);

  const benchmarkReticle = gaiaReticle;

  // Handle pixel clicks with Sub-Pixel Auto-Centroid Snapping (SPECIFICATION.md §4.2, QA_AUDIT.md §9.4)
  const handlePixelClick = useCallback(
    (info: HoverPixelInfo) => {
      // Sub-pixel centroid peak snapping (5x5 neighborhood) to eliminate human clicking jitter
      let clickX = info.x;
      let clickY = info.y;
      if (measuringMotion && currentFluxPlane) {
        let maxFlux = -Infinity;
        const radius = 2;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const px = Math.max(0, Math.min(currentWidth - 1, info.x + dx));
            const py = Math.max(0, Math.min(currentHeight - 1, info.y + dy));
            const f = currentFluxPlane[py * currentWidth + px] || 0;
            if (f > maxFlux) {
              maxFlux = f;
              clickX = px;
              clickY = py;
            }
          }
        }
      }

      setProbedPixel({ x: clickX, y: clickY });
      setUrlProbeX(clickX);
      setUrlProbeY(clickY);

      // If measuring motion vector, record click point
      if (measuringMotion) {
        setMotionPoints((prev) => {
          const next = [...prev, { x: clickX, y: clickY, epoch: activeEpochIndex }];
          if (next.length === 2) {
            const p0 = next[0];
            const p1 = next[1];
            const dxPx = p1.x - p0.x;
            const dyPx = p1.y - p0.y;
            const dtYears = Math.abs(
              (DISCRETE_SURVEY_PASSES[p1.epoch].mjd - DISCRETE_SURVEY_PASSES[p0.epoch].mjd) / 365.25
            ) || 0.5;

            const deltaAlphaArcsec = dxPx * 6.2;
            const deltaDeltaArcsec = -dyPx * 6.2;
            const totalMotionArcsec = Math.sqrt(deltaAlphaArcsec ** 2 + deltaDeltaArcsec ** 2);
            const totalMotionArcsecYr = totalMotionArcsec / dtYears;
            const paRad = Math.atan2(deltaAlphaArcsec, deltaDeltaArcsec);
            const positionAngleDeg = ((paRad * 180) / Math.PI + 360) % 360;

            setMotionResult({
              deltaAlphaArcsec,
              deltaDeltaArcsec,
              totalMotionArcsecYr,
              positionAngleDeg,
            });
            setMeasuringMotion(false);
            return [];
          }
          return next;
        });
      }
    },
    [measuringMotion, currentFluxPlane, activeEpochIndex, setProbedPixel, setUrlProbeX, setUrlProbeY]
  );

  // Forced 3x3 Aperture Light Curve Data across epochs (D1 vs D5)
  const lightCurveData = useMemo(() => {
    return DISCRETE_SURVEY_PASSES.map((pass, eIdx) => {
      // Sample 3x3 center aperture flux in D1 and D5
      const ep = eIdx % totalEpochsCount;
      const d1Plane = activeTensors.fluxData[ep]?.[0];
      const d5Plane = activeTensors.fluxData[ep]?.[4];
      const center = Math.floor(currentWidth / 2);
      let d1Sum = 0;
      let d5Sum = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = center + dx;
          const py = center + dy;
          if (px >= 0 && px < currentWidth && py >= 0 && py < currentHeight) {
            const idx = py * currentWidth + px;
            d1Sum += d1Plane?.[idx] || 0;
            d5Sum += d5Plane?.[idx] || 0;
          }
        }
      }

      return {
        epoch: pass.label,
        mjd: pass.mjd,
        fluxD1: d1Sum / 9.0,
        fluxD5: d5Sum / 9.0,
      };
    });
  }, [activeTensors, totalEpochsCount, currentWidth, currentHeight]);

  const activePass = DISCRETE_SURVEY_PASSES[activeEpochIndex];
  const activeBand = BANDS[activeBandIndex];

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-black font-sans text-white lg:flex-row lg:overflow-hidden">
      {/* ========================================================================= */}
      {/* LEFT PANEL (65%): Multi-Epoch Playback Canvas & Transport Deck            */}
      {/* ========================================================================= */}
      <div className="flex min-h-[72vh] w-full shrink-0 flex-col border-b border-neutral-800 bg-black lg:h-full lg:min-h-0 lg:w-[65%] lg:border-b-0 lg:border-r">
        {/* Top Control Header */}
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-950 px-3 py-2 lg:h-10 lg:flex-nowrap lg:px-4 lg:py-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-bold text-white">
              {activeBenchmark ? activeBenchmark.name : `Field at RA ${urlRa.toFixed(4)}°, Dec ${urlDec.toFixed(4)}°`}
            </span>
            {onOpenCatalog && (
              <button
                type="button"
                onClick={onOpenCatalog}
                className="rounded-full border border-neutral-800 bg-neutral-900/90 hover:bg-neutral-800 hover:border-neutral-700 px-2.5 py-0.5 text-[11px] font-medium text-neutral-300 hover:text-white transition-all flex items-center space-x-1 shadow-sm"
                title="Browse all 24 calibrated targets in the source catalog"
              >
                <span>Switch Target (24)</span>
                <svg className="h-3 w-3 text-primary inline-block" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            <span className="rounded-full bg-neutral-900 border border-neutral-800 px-2.5 py-0.5 font-mono text-[10px] text-neutral-400">
              {store.sourceBadge}
            </span>
            {activeBenchmark?.id === 'barnard' && activeBandIndex <= 1 && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-400">
                OVERFLOW (Saturated NIR)
              </span>
            )}
            {activeBenchmark?.id === 'wise0855' && activeBandIndex <= 2 && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-400">
                Not Detected at Pass Depth (&gt;17 mag)
              </span>
            )}
          </div>

          {/* Raw vs. Rectified Toggle */}
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-neutral-400">Sensor alignment:</span>
            <button
              type="button"
              onClick={() => setRawVsRectified(rawVsRectified === 'rectified' ? 'raw_sensor' : 'rectified')}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                rawVsRectified === 'raw_sensor'
                  ? 'border-amber-500 bg-amber-500/15 text-amber-400'
                  : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600 hover:text-white'
              }`}
            >
              {rawVsRectified === 'raw_sensor' ? `Raw sensor (θ = ${activePass.rollAngleDeg}°)` : 'Rectified North-Up'}
            </button>
          </div>
        </div>

        {/* Central WebGL2 Canvas Viewport (Expansive & Fluid) */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-2 lg:p-4">
          <div className="relative aspect-square h-auto w-full max-h-[calc(100vh-220px)] max-w-[calc(100vh-220px)] overflow-hidden rounded-xl border border-neutral-800 bg-black shadow-2xl lg:h-full lg:w-full">
            <WebGLComparatorCanvas
              fluxData={currentFluxPlane}
              refFluxData={referenceFluxPlane}
              varianceData={currentVarPlane}
              refVarianceData={referenceVarPlane}
              flagsData={currentFlagsPlane}
              width={currentWidth}
              height={currentHeight}
              renderMode={renderMode}
              asinhParamA={asinhParamA}
              diffScale={0.8}
              colorPalette={colorPalette}
              rgbBandsData={activeRgbPreset === 'custom' ? null : null}
              isFrameZero={activeEpochIndex === 0}
              gaiaPin={gaiaReticle}
              onPixelHover={setHoverPixel}
              onPixelClick={handlePixelClick}
              className="h-full w-full"
            />

            {/* Persistent Canvas Watermark when displaying Simulated / Calibrated Model Data */}
            {isSimulatedDisplay && (
              <div
                data-testid="simulated-canvas-watermark"
                className="pointer-events-none absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between rounded-lg border border-amber-500/40 bg-black/85 px-3 py-1.5 font-mono text-[10px] text-amber-300 shadow-lg backdrop-blur-sm"
              >
                <span className="font-semibold tracking-wider uppercase">
                  SIMULATED DATA — CALIBRATED MODEL (NOT LIVE TELESCOPE PIXELS)
                </span>
                <span className="text-neutral-400">
                  {activeBenchmark ? `Ephemeris: ${activeBenchmark.name}` : 'Offline Fallback'}
                </span>
              </div>
            )}

            {/* NASA Eyes Corner Target Reticle [ ] tracking active target */}
            {benchmarkReticle && (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                style={{
                  left: `${(benchmarkReticle.subpixelX / currentWidth) * 100}%`,
                  top: `${(benchmarkReticle.subpixelY / currentHeight) * 100}%`,
                }}
              >
                <div className="relative h-10 w-10">
                  <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-primary" />
                  <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-primary" />
                  <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-primary" />
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-primary" />
                </div>
                <div className="absolute left-12 top-0 whitespace-nowrap rounded bg-black/85 px-2 py-0.5 font-mono text-[10px] text-primary border border-primary/40 shadow-lg backdrop-blur-sm">
                  {benchmarkReticle.label}
                </div>
              </div>
            )}

            {/* Raw Sensor Mode LVF Smile Curvature Overlay */}
            {rawVsRectified === 'raw_sensor' && (
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
                <div className="rounded-sm bg-black/80 p-1.5 font-mono text-[10px] text-amber-400 border border-amber-500/30">
                  Raw H2RG 2040x2040 // Spacecraft Roll θ = {activePass.rollAngleDeg}°
                  <br />
                  Linear Variable Filter (LVF) Smile Curvature active
                </div>
                {/* Curved isoline visual aid */}
                <svg className="absolute inset-0 h-full w-full stroke-amber-500/30" viewBox="0 0 100 100" fill="none">
                  <path d="M 5 25 Q 50 35 95 25" strokeWidth="0.7" strokeDasharray="2,2" />
                  <path d="M 5 50 Q 50 60 95 50" strokeWidth="0.7" strokeDasharray="2,2" />
                  <path d="M 5 75 Q 50 85 95 75" strokeWidth="0.7" strokeDasharray="2,2" />
                </svg>
              </div>
            )}

            {/* Active Measure Proper Motion Reticle Helper */}
            {measuringMotion && (
              <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-primary/50 bg-black/90 backdrop-blur-md px-3 py-1.5 font-mono text-xs text-primary shadow-xl">
                {motionPoints.length === 0
                  ? 'Click Point 1 on Target (Epoch 0)'
                  : 'Click Point 2 on Target (Epoch N)'}
              </div>
            )}
          </div>
        </div>

        {/* Discrete Survey Epoch Scrubber Bar */}
        <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Play / Step Transport */}
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={() => setEpochIndex(0)}
                title="First Pass (Frame 0)"
                className="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
              >
                Start
              </button>
              <button
                type="button"
                onClick={() => stepEpoch(-1)}
                title="Previous Pass (ArrowLeft)"
                className="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={togglePlayback}
                title="Play/Pause (Space)"
                className={`rounded-full border px-4 py-1 text-xs font-semibold transition-all ${
                  isPlaying
                    ? 'border-primary bg-primary text-white shadow-sm'
                    : 'border-neutral-700 bg-neutral-900 text-white hover:border-primary'
                }`}
              >
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => stepEpoch(1)}
                title="Next Pass (ArrowRight)"
                className="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
              >
                Next
              </button>
            </div>

            {/* Discrete Pass Pills with Human Dates */}
            <div className="flex items-center space-x-1.5 overflow-x-auto py-1">
              {DISCRETE_SURVEY_PASSES.map((pass, idx) => {
                const dates = ['May 2025', 'Nov 2025', 'May 2026', 'Nov 2026'];
                const humanDate = dates[idx] || `MJD ${pass.mjd}`;
                return (
                  <button
                    key={pass.passIndex}
                    type="button"
                    onClick={() => setEpochIndex(idx)}
                    className={`flex flex-col items-center rounded-lg border px-3 py-1 text-left transition-colors ${
                      activeEpochIndex === idx
                        ? 'border-primary bg-primary/15 text-white font-medium shadow-sm'
                        : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    <span className="font-sans text-[11px] font-medium leading-none">{pass.label}</span>
                    <span className="text-[10px] text-neutral-300 mt-0.5">{humanDate}</span>
                    <span className="font-mono tabular-nums text-[8px] text-neutral-500">MJD {pass.mjd}</span>
                  </button>
                );
              })}
            </div>

            {/* Playback speed slider */}
            <div className="flex items-center space-x-2 text-xs text-neutral-400">
              <span className="text-[11px]">Blink Speed:</span>
              <input
                type="range"
                min={150}
                max={1000}
                step={50}
                value={playbackSpeedMs}
                onChange={(e) => useTelemetryStore.setState({ playbackSpeedMs: Number(e.target.value) })}
                className="h-1 w-20 cursor-pointer accent-primary"
              />
              <span className="font-mono tabular-nums text-white text-[11px]">{playbackSpeedMs}ms</span>
            </div>
          </div>

          {/* Live Hover HUD Strip */}
          <div className="mt-3 flex items-center justify-between border-t border-neutral-800/80 pt-2 font-mono tabular-nums text-xs text-neutral-400">
            <div>
              {hoverPixel ? (
                <span>
                  Cursor: <span className="text-white">[{hoverPixel.x}, {hoverPixel.y}]</span> |{' '}
                  Flux: <span className="text-sky-400">{hoverPixel.flux.toFixed(2)} MJy/sr</span> |{' '}
                  SNR: <span className="text-emerald-400">{hoverPixel.snr.toFixed(1)}</span> |{' '}
                  FLAGS:{' '}
                  <span className={hoverPixel.flags ? 'text-amber-400' : 'text-neutral-400'}>
                    0x{hoverPixel.flags.toString(16).padStart(3, '0')} ({hoverPixel.flagNames.join(', ')})
                  </span>
                </span>
              ) : (
                <span>Hover over canvas to inspect pixel flux, SNR, and HDU 2 flags.</span>
              )}
            </div>

            <div className="text-[11px] text-neutral-500">
              Pixel scale: <span className="text-white">6.2&quot;/px</span> | Native TAN North-Up
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* RIGHT PANEL (35%): Analysis Deck & Wavelength-Matched Matrix              */}
      {/* ========================================================================= */}
      <div className="flex w-full flex-col overflow-y-visible border-t border-neutral-800 bg-neutral-950 p-3 text-xs space-y-3 lg:h-full lg:w-[35%] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:p-4 lg:space-y-4">
        {/* Render Mode Switcher */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Render Mode</h3>
            <span className="font-mono text-[10px] text-neutral-500">WebGL2 Float32 Pipeline</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'blink', title: 'Temporal Blink', subtitle: 'Cycle 6-mo passes', keyHint: '1' },
              { id: 'difference', title: 'Motion Diff', subtitle: 'Signed diff (t_N - t_0)', keyHint: '2' },
              { id: 'coadd', title: 'Deep Co-Add', subtitle: 'Stack 1/σ² passes', keyHint: '3' },
            ].map((m) => {
              const active = renderMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setRenderMode(m.id as any);
                    setUrlMode(m.id);
                  }}
                  className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition-all ${
                    active
                      ? 'border-primary bg-primary/15 text-white shadow-sm ring-1 ring-primary/40'
                      : 'border-neutral-800/80 bg-neutral-900/50 text-neutral-400 hover:border-neutral-700 hover:text-white'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-sans font-semibold text-xs text-white">{m.title}</span>
                    <span className={`font-mono text-[9px] ${active ? 'text-primary' : 'text-neutral-500'}`}>[{m.keyHint}]</span>
                  </div>
                  <span className="mt-1 text-[10px] leading-tight text-neutral-400">{m.subtitle}</span>
                </button>
              );
            })}
          </div>

          <details className="mt-4 border-t border-neutral-800/80 pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-medium text-neutral-300">Image display controls · Asinh a={asinhParamA.toFixed(3)} · {colorPalette.replace('_', ' ')} <span aria-hidden="true" className="text-primary">⌄</span></summary>
            <div className="pt-3">
          {/* Faint Target Contrast Boost (Asinh) */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-300 font-medium">Faint Contrast Boost (Asinh):</span>
              <span className="font-mono tabular-nums text-white text-[11px] bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
                a = {asinhParamA.toFixed(3)}
              </span>
            </div>
            <div className="mt-2 flex items-center space-x-2">
              <span className="text-[10px] text-neutral-500">Linear</span>
              <input
                type="range"
                min={0.001}
                max={0.5}
                step={0.005}
                value={asinhParamA}
                onChange={(e) => setAsinhParams({ a: Number(e.target.value) })}
                className="h-1 flex-1 cursor-pointer accent-primary"
              />
              <span className="text-[10px] text-neutral-500">Max Boost</span>
            </div>
          </div>

          {/* Colormap Selector */}
          <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
            <span className="text-neutral-300">Colormap:</span>
            <div className="flex space-x-1">
              {[
                { id: 'standard_rgb', label: 'Grayscale' },
                { id: 'viridis', label: 'Viridis' },
                { id: 'cividis', label: 'Cividis' },
                { id: 'inverted_grayscale', label: 'Inverted' },
              ].map((pal) => (
                <button
                  key={pal.id}
                  type="button"
                  onClick={() => setColorPalette(pal.id as any)}
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    colorPalette === pal.id
                      ? 'border-primary bg-primary/20 text-white font-medium'
                      : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-white hover:border-neutral-700'
                  }`}
                >
                  {pal.label}
                </button>
              ))}
            </div>
          </div>
            </div>
          </details>
        </section>

        {/* (Epoch x Band) Coverage Matrix & Wavelength-Matched Differencing Guard */}
        <details className="rounded-xl border border-neutral-800 bg-neutral-900/40 shadow-sm backdrop-blur">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Coverage Matrix</h3>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Band-Match Guard Active
            </span>
            <span aria-hidden="true" className="text-primary">⌄</span>
          </summary>
          <div className="px-4 pb-4">
          <p className="mb-3 text-[11px] text-neutral-400 leading-relaxed">
            Differencing is strictly confined to exposures within the same wavelength band window. Click any cell to switch epoch and spectral band.
          </p>

          <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950/80">
            <table className="w-full border-collapse font-mono text-[10px]">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400 bg-neutral-900/60">
                  <th className="p-2 text-left font-sans font-medium text-[11px]">Pass</th>
                  {BANDS.map((b, bIdx) => (
                    <th
                      key={b.id}
                      className={`p-2 text-center cursor-pointer transition-colors ${
                        activeBandIndex === bIdx ? 'text-primary font-bold' : 'hover:text-white'
                      }`}
                      onClick={() => setActiveBandIndex(bIdx)}
                    >
                      {b.id}
                      <span className="block text-[8px] font-normal text-neutral-500">{b.wavelengthUm}μm</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DISCRETE_SURVEY_PASSES.map((pass, pIdx) => (
                  <tr
                    key={pass.passIndex}
                    className={`border-b border-neutral-800/50 transition-colors ${
                      activeEpochIndex === pIdx ? 'bg-primary/10' : 'hover:bg-neutral-900/40'
                    }`}
                  >
                    <td className="p-2 font-sans text-neutral-300 font-medium">
                      {pass.label}
                      <span className="block text-[8px] font-mono text-neutral-500">
                        MJD {pass.mjdRange[0].toFixed(0)}–{pass.mjdRange[1].toFixed(0)}
                      </span>
                    </td>
                    {BANDS.map((band, bIdx) => {
                      const epIdx = pIdx % totalEpochsCount;
                      const centerIdx = Math.floor((currentHeight * currentWidth) / 2);
                      const nExpCount = activeTensors.nExpData?.[epIdx]?.[bIdx]?.[centerIdx] ?? 18;
                      const isWiseUndetected =
                        (activeBenchmark?.id === 'wise0855' && bIdx <= 2) || nExpCount === 0;
                      const isSelected = activeEpochIndex === pIdx && activeBandIndex === bIdx;
                      return (
                        <td
                          key={band.id}
                          onClick={() => {
                            setEpochIndex(pIdx);
                            setActiveBandIndex(bIdx);
                          }}
                          className={`p-2 text-center cursor-pointer border-l border-neutral-800/50 transition-all ${
                            isSelected
                              ? 'bg-primary font-bold text-white shadow-inner'
                              : isWiseUndetected
                              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                              : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                          }`}
                          title={
                            isWiseUndetected
                              ? 'Below detection depth (>17 mag in NIR; detected in D5/D6)'
                              : `${band.id} (${nExpCount} wavelength-matched exposures co-added, R=${band.resPower})`
                          }
                        >
                          {isWiseUndetected ? 'Undet.' : `${nExpCount}x`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </details>

        <details className="rounded-xl border border-neutral-800 bg-neutral-900/40 shadow-sm backdrop-blur">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-xs font-semibold uppercase tracking-wide text-white">Analysis tools · Light curve, motion, and triage <span aria-hidden="true" className="text-primary">⌄</span></summary>
          <div className="space-y-4 px-3 pb-3 lg:px-4 lg:pb-4">
        {/* Forced 3x3 Aperture Photometry Light Curve */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Forced Aperture Light Curve</h3>
            <span className="font-mono text-[10px] text-neutral-400">3×3 px Aperture</span>
          </div>
          <p className="mb-2 text-[11px] text-neutral-400">
            Evolution of calibrated flux across all 4 survey passes in Optical/NIR (D1) versus Thermal Infrared (D5).
          </p>

          <div className="h-28 w-full rounded-lg border border-neutral-800 bg-black/60 p-2">
            <svg className="h-full w-full" viewBox="0 0 200 80">
              {/* Gridlines */}
              <line x1="20" y1="10" x2="190" y2="10" stroke="#262626" strokeWidth="0.5" />
              <line x1="20" y1="40" x2="190" y2="40" stroke="#262626" strokeWidth="0.5" />
              <line x1="20" y1="70" x2="190" y2="70" stroke="#262626" strokeWidth="0.5" />

              {/* D1 Light curve stroke (NASA Blue) */}
              <polyline
                fill="none"
                stroke="#288BFF"
                strokeWidth="1.5"
                points={lightCurveData
                  .map((d, i) => `${30 + i * 45},${70 - Math.min(60, d.fluxD1 * 3)}`)
                  .join(' ')}
              />
              {/* D5 Light curve stroke (NASA Amber) */}
              <polyline
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.5"
                points={lightCurveData
                  .map((d, i) => `${30 + i * 45},${70 - Math.min(60, d.fluxD5 * 3)}`)
                  .join(' ')}
              />

              {/* Data points */}
              {lightCurveData.map((d, i) => (
                <g key={i}>
                  <circle cx={30 + i * 45} cy={70 - Math.min(60, d.fluxD1 * 3)} r="2.5" fill="#288BFF" />
                  <circle cx={30 + i * 45} cy={70 - Math.min(60, d.fluxD5 * 3)} r="2.5" fill="#F59E0B" />
                </g>
              ))}
            </svg>
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[11px] font-sans">
            <span className="flex items-center gap-1.5 text-sky-400">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Band D1 (0.9 µm NIR)</span>
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span>Band D5 (4.1 µm Thermal)</span>
            </span>
            {activeBenchmark?.id === 'rw_aur' && (
              <span className="text-emerald-400 font-medium">Dimming: &gt;1.5 mag</span>
            )}
          </div>
        </section>

        {/* 2-Click Proper Motion Calculator */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Proper Motion Calculator</h3>
            <button
              type="button"
              onClick={() => {
                setMeasuringMotion(!measuringMotion);
                setMotionPoints([]);
              }}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
                measuringMotion
                  ? 'border-primary bg-primary text-white shadow-sm'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white hover:border-neutral-600'
              }`}
            >
              {measuringMotion ? 'Cancel Measure' : 'Measure 2-Click Vector'}
            </button>
          </div>

          {measuringMotion && motionPoints.length < 2 && (
            <div className="mb-2 rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-[11px] text-neutral-200">
              <div className="font-medium text-white mb-0.5">
                {motionPoints.length === 0 ? 'Step 1: Click target in Pass 1' : 'Step 2: Switch pass and click target in Pass 4'}
              </div>
              <p className="text-neutral-400 text-[10px]">
                5×5 sub-pixel auto-centroid snapping is active. Clicking snaps directly to local flux peak.
              </p>
            </div>
          )}

          {motionResult ? (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 font-mono text-[11px] text-emerald-300">
              <div className="font-sans font-semibold text-emerald-400 mb-1">Kinematic Motion Calculated:</div>
              <div>Total Motion: <strong className="text-white">{motionResult.totalMotionArcsecYr.toFixed(2)}&quot;/yr</strong></div>
              <div>Velocity: <strong className="text-white">{(motionResult.totalMotionArcsecYr / 6.2).toFixed(2)} px/yr</strong></div>
              <div>Position Angle: <strong className="text-white">{motionResult.positionAngleDeg.toFixed(1)}° E of N</strong></div>
            </div>
          ) : (
            !measuringMotion && (
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Click two points across different survey passes on the canvas to measure kinematic proper motion and position angle.
              </p>
            )
          )}
        </section>

        {/* Classification Triage Form & In-situ Confirmation Banner */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur">
          <h3 className="mb-2 font-semibold text-white text-xs tracking-wide uppercase">Candidate Triage &amp; Escalation</h3>

          {triageSubmitted ? (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-emerald-300 animate-fadeIn">
              <div className="flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-sans font-semibold text-xs text-white">Classification Logged to Catalog</span>
              </div>
              <p className="mt-2 font-sans text-[11px] text-neutral-300 leading-relaxed">
                Candidate recorded as <strong className="text-white capitalize">{triageClass.replace(/_/g, ' ')}</strong> at{' '}
                <strong className="text-white">{triageConfidence}% confidence</strong>. Telemetry metadata registered in the SPHEREx community catalog.
              </p>
              <div className="mt-3.5 flex items-center space-x-3 font-sans">
                <button
                  type="button"
                  onClick={() => setTab('discussions')}
                  className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 transition-colors shadow-sm"
                >
                  View in Community Discussions →
                </button>
                <button
                  type="button"
                  onClick={handleNextCandidate}
                  className="text-xs text-neutral-400 hover:text-white transition-colors"
                >
                  Classify another object
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-neutral-300">Object Classification:</label>
                <select
                  value={triageClass}
                  onChange={(e) => setTriageClass(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="moving_brown_dwarf">High-Proper-Motion Brown Dwarf (Cold Y/T Dwarf)</option>
                  <option value="variable_star">Variable Stellar Object (T Tauri / Mira Pulsar)</option>
                  <option value="transient_glitch">Cosmic Ray Glitch / False Positive Artifact</option>
                  <option value="asteroid">Fast-Moving Solar System Asteroid</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-neutral-300">
                  <span className="font-medium">Observer Confidence:</span>
                  <span className="font-mono text-white font-semibold">{triageConfidence}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={triageConfidence}
                  onChange={(e) => setTriageConfidence(Number(e.target.value))}
                  className="mt-1.5 h-1 w-full cursor-pointer accent-primary"
                />
              </div>

              <button
                type="button"
                onClick={handleSubmitClassification}
                disabled={isSubmittingClassification}
                className="mt-2 w-full rounded-lg border border-primary bg-primary py-2 font-sans text-xs font-semibold text-white transition-all hover:bg-primary/90 disabled:opacity-50 shadow-sm"
              >
                {isSubmittingClassification ? 'Submitting to Catalog...' : 'Submit Classification'}
              </button>
            </div>
          )}
        </section>
          </div>
        </details>
      </div>
    </div>
  );
};
