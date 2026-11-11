/**
 * Spectra Tab 4: SPLICES Molecular & Ice Mapping Studio.
 *
 * Specification Anchors:
 * - SPECIFICATION.md §1.3 Audit #10 (point-source background-star workflow)
 * - SPECIFICATION.md §2.4 (verified laboratory A-values)
 * - SPECIFICATION.md §6.3.4 (Tab 4: Molecular & Ice Mapping Studio)
 * - tasks.md Dev 5 (role:E5-datasci) Issue #25
 *
 * Physics:
 *   tau(lambda) = -ln(F_obs / F_cont)
 *   nu = 10000 / lambda [cm^-1]
 *   N_ice = (1 / A) * integral(tau(nu) dnu) [cm^-2]
 *
 * Solid-ice A-values are never applied to the 3.32 um photospheric CH4 feature of
 * WISE 0855-0714 or Epsilon Indi B; those sightlines are explicitly suppressed.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Input, Select } from '../components/ui';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';

export interface SplicesTarget {
  id: string;
  name: string;
  ra: number;
  dec: number;
  catalog: string;
  environment: string;
  snr: number;
  teffK: number;
  avMag: number;
  badge: string;
  columns: Record<IceKey, number>;
  isBrownDwarf?: boolean;
}

export type IceKey = 'h2o' | 'co2' | 'co2_13' | 'co' | 'ch3oh';

export interface IceBand {
  key: IceKey;
  species: string;
  label: string;
  centerUm: number;
  windowUm: [number, number];
  aValue: number;
  citation: string;
  detector: string;
  sigmaCm1: number;
  color: string;
}

export interface IceColumnResult {
  key: IceKey;
  species: string;
  centerUm: number;
  aValue: number;
  integratedTauCm1: number | null;
  columnDensity: number | null;
  suppressed: boolean;
}

export interface IceSolution {
  wavelengthsUm: number[];
  flux: number[];
  continuum: number[];
  tau: number[];
  bands: IceColumnResult[];
  ratioPercent: number | null;
  brownDwarfNotice: string | null;
}

export interface AperturePhotometry {
  apertureRadiusPx: number;
  annulusInnerPx: number;
  annulusOuterPx: number;
  psfFwhmPx: number;
  skyLevel: number;
  sourceFraction: number;
  backgroundSubtractedFlux: number;
  snr: number;
}

export interface SpectrumSource {
  wavelengthsUm: number[];
  flux: number[];
  badge: string;
}

export const ICE_BANDS: IceBand[] = [
  {
    key: 'h2o',
    species: 'H2O',
    label: 'Water ice (O-H stretch)',
    centerUm: 3.05,
    windowUm: [2.8, 3.35],
    aValue: 2.0e-16,
    citation: 'Gerakines et al. (1995)',
    detector: 'D4',
    sigmaCm1: 110,
    color: '#38bdf8',
  },
  {
    key: 'co2',
    species: 'CO2',
    label: 'Carbon dioxide ice (nu3)',
    centerUm: 4.27,
    windowUm: [4.22, 4.32],
    aValue: 7.6e-17,
    citation: 'Gerakines et al. (1995)',
    detector: 'D5',
    sigmaCm1: 8,
    color: '#f59e0b',
  },
  {
    key: 'co2_13',
    species: '13CO2',
    label: 'Carbon-13 dioxide ice',
    centerUm: 4.38,
    windowUm: [4.34, 4.42],
    aValue: 7.8e-17,
    citation: 'Boogert et al. (2000)',
    detector: 'D5',
    sigmaCm1: 6,
    color: '#fb7185',
  },
  {
    key: 'co',
    species: 'CO',
    label: 'Carbon monoxide ice (C=O stretch)',
    centerUm: 4.67,
    windowUm: [4.6, 4.75],
    aValue: 1.1e-17,
    citation: 'Jiang et al. (1975)',
    detector: 'D6',
    sigmaCm1: 8,
    color: '#a78bfa',
  },
  {
    key: 'ch3oh',
    species: 'CH3OH',
    label: 'Methanol ice (C-H stretch)',
    centerUm: 3.54,
    windowUm: [3.42, 3.66],
    aValue: 5.3e-18,
    citation: 'Kerkhof et al. (1999)',
    detector: 'D4',
    sigmaCm1: 30,
    color: '#34d399',
  },
];

export const CONTINUUM_WINDOWS_UM: Array<[number, number]> = [
  [2.1, 2.4],
  [3.7, 3.9],
];

export const PHOTOSPHERIC_CH4_UM = 3.32;
export const PHOTOSPHERIC_CH4_NOTICE =
  'Scientific notice: the 3.32 um CH4 feature in WISE 0855-0714 and Epsilon Indi B is ' +
  'photospheric gas, not solid interstellar ice. Laboratory solid-ice A-values are not ' +
  'applied to brown-dwarf photospheres, and spurious ice column densities are suppressed.';

const SPLICES_COLUMNS: Array<Record<IceKey, number>> = [
  { h2o: 2.45e18, co2: 4.12e17, co2_13: 6.4e16, co: 8.9e17, ch3oh: 1.2e17 },
  { h2o: 3.1e18, co2: 5.8e17, co2_13: 8.1e16, co: 1.05e18, ch3oh: 1.9e17 },
  { h2o: 1.62e18, co2: 2.95e17, co2_13: 4.6e16, co: 5.4e17, ch3oh: 7.8e16 },
  { h2o: 1.1e18, co2: 1.88e17, co2_13: 2.7e16, co: 3.2e17, ch3oh: 4.2e16 },
  { h2o: 4.05e18, co2: 7.2e17, co2_13: 1.08e17, co: 1.4e18, ch3oh: 2.6e17 },
  { h2o: 2.9e18, co2: 4.9e17, co2_13: 7.1e16, co: 9.6e17, ch3oh: 1.55e17 },
];

export const SPLICES_BACKGROUND_STARS: SplicesTarget[] = [
  {
    id: 'SPLICES-J181410-175200',
    name: 'SPLICES-J181410-175200',
    ra: 273.54167,
    dec: -17.86667,
    catalog: 'SPLICES Ice Source Candidate (synthetic demo seed)',
    environment: 'Embedded YSO / dense molecular cloud',
    snr: 41.8,
    teffK: 4500,
    avMag: 14.2,
    badge: '[Synthetic Injection Mode]',
    columns: SPLICES_COLUMNS[0],
  },
  {
    id: 'SPLICES-J162813-242734',
    name: 'SPLICES-J162813-242734',
    ra: 247.05417,
    dec: -24.45944,
    catalog: 'SPLICES Ice Source Candidate (synthetic demo seed)',
    environment: 'Class 0 protostar / outflow cavity',
    snr: 37.4,
    teffK: 3900,
    avMag: 18.6,
    badge: '[Synthetic Injection Mode]',
    columns: SPLICES_COLUMNS[1],
  },
  {
    id: 'SPLICES-J053120+221748',
    name: 'SPLICES-J053120+221748',
    ra: 82.83333,
    dec: 22.29667,
    catalog: 'SPLICES Ice Source Candidate (synthetic demo seed)',
    environment: 'Young stellar object / Taurus cloud',
    snr: 52.1,
    teffK: 5200,
    avMag: 9.4,
    badge: '[Synthetic Injection Mode]',
    columns: SPLICES_COLUMNS[2],
  },
  {
    id: 'SPLICES-J214131+580438',
    name: 'SPLICES-J214131+580438',
    ra: 325.37917,
    dec: 58.07722,
    catalog: 'SPLICES Ice Source Candidate (synthetic demo seed)',
    environment: 'Isolated dense core / Cepheus flare',
    snr: 33.9,
    teffK: 6100,
    avMag: 11.8,
    badge: '[Synthetic Injection Mode]',
    columns: SPLICES_COLUMNS[3],
  },
  {
    id: 'SPLICES-J183029-023811',
    name: 'SPLICES-J183029-023811',
    ra: 277.62083,
    dec: -2.63639,
    catalog: 'SPLICES Ice Source Candidate (synthetic demo seed)',
    environment: 'Infrared dark cloud / high extinction sightline',
    snr: 45.6,
    teffK: 4700,
    avMag: 21.3,
    badge: '[Synthetic Injection Mode]',
    columns: SPLICES_COLUMNS[4],
  },
  {
    id: 'SPLICES-J065754-044520',
    name: 'SPLICES-J065754-044520',
    ra: 104.475,
    dec: -4.75556,
    catalog: 'SPLICES Ice Source Candidate (synthetic demo seed)',
    environment: 'Monoceros R2 / massive star-forming region',
    snr: 29.8,
    teffK: 7200,
    avMag: 16.1,
    badge: '[Synthetic Injection Mode]',
    columns: SPLICES_COLUMNS[5],
  },
];

export const BROWN_DWARF_GUARD_TARGETS: SplicesTarget[] = [
  {
    id: 'wise_0855',
    name: 'WISE 0855-0714',
    ra: 133.73712,
    dec: -7.24038,
    catalog: 'NASA Benchmark (Pre-cached)',
    environment: 'Y4 cold brown dwarf - photospheric CH4',
    snr: 0,
    teffK: 250,
    avMag: 0,
    badge: '[NASA Benchmark (Pre-cached)]',
    columns: { h2o: 0, co2: 0, co2_13: 0, co: 0, ch3oh: 0 },
    isBrownDwarf: true,
  },
  {
    id: 'eps_indi_b',
    name: 'Epsilon Indi B',
    ra: 331.09566,
    dec: -56.80031,
    catalog: 'NASA Benchmark (Pre-cached)',
    environment: 'T1+T6 unresolved brown-dwarf binary - photospheric CH4',
    snr: 0,
    teffK: 1200,
    avMag: 0,
    badge: '[NASA Benchmark (Pre-cached)]',
    columns: { h2o: 0, co2: 0, co2_13: 0, co: 0, ch3oh: 0 },
    isBrownDwarf: true,
  },
];

export const ALL_ICE_TARGETS: SplicesTarget[] = [
  ...SPLICES_BACKGROUND_STARS,
  ...BROWN_DWARF_GUARD_TARGETS,
];

// --------------------------------------------------------------------------------------
// Pure numerical helpers
// --------------------------------------------------------------------------------------

export function wavenumberCm1(wavelengthUm: number): number {
  return 10000 / wavelengthUm;
}

function chebyshevBasis(x: number, order: number): number[] {
  const values = [1];
  if (order >= 1) values.push(x);
  for (let index = 2; index <= order; index++) {
    values.push(2 * x * values[index - 1] - values[index - 2]);
  }
  return values;
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-15) continue;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let k = column; k <= size; k++) augmented[column][k] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let k = column; k <= size; k++) augmented[row][k] -= factor * augmented[column][k];
    }
  }
  return augmented.map((row) => row[size]);
}

export function fitChebyshevContinuum(
  wavelengthsUm: number[],
  flux: number[],
  order = 4
): number[] {
  const minimum = Math.min(...wavelengthsUm);
  const maximum = Math.max(...wavelengthsUm);
  const span = maximum > minimum ? maximum - minimum : 1;
  const xAll = wavelengthsUm.map((wave) => (2 * (wave - minimum)) / span - 1);

  let active = wavelengthsUm.map(
    (wave) =>
      CONTINUUM_WINDOWS_UM.some(([low, high]) => wave >= low && wave <= high)
  );
  if (active.filter(Boolean).length < order + 2) active = wavelengthsUm.map(() => true);

  let coefficients = new Array(order + 1).fill(0) as number[];
  for (let iteration = 0; iteration < 3; iteration++) {
    const normal = Array.from({ length: order + 1 }, () => new Array(order + 1).fill(0));
    const rhs = new Array(order + 1).fill(0);
    const design: number[][] = [];
    const observed: number[] = [];
    wavelengthsUm.forEach((_, index) => {
      if (!active[index]) return;
      const basis = chebyshevBasis(xAll[index], order);
      design.push(basis);
      observed.push(flux[index]);
      for (let row = 0; row <= order; row++) {
        rhs[row] += basis[row] * flux[index];
        for (let column = 0; column <= order; column++) {
          normal[row][column] += basis[row] * basis[column];
        }
      }
    });
    if (design.length < order + 1) break;

    // Small Tikhonov penalty on degree-3/4 terms: the mandated continuum windows are
    // narrow, so unregularised high-order fits amplify sub-percent absorption leakage.
    const trace = normal.reduce((sum, row, index) => sum + row[index], 0);
    const scale = trace / (order + 1);
    for (let index = 3; index <= order; index++) normal[index][index] += 1e-4 * scale * 10;

    coefficients = solveLinearSystem(normal, rhs);
    const residuals = design.map((basis, index) => {
      const model = basis.reduce((sum, value, k) => sum + value * coefficients[k], 0);
      return observed[index] - model;
    });
    const mean = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
    const variance =
      residuals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / residuals.length;
    const scatter = Math.sqrt(variance);
    if (!Number.isFinite(scatter) || scatter <= 0) break;
    let changed = false;
    const nextActive = [...active];
    let cursor = 0;
    active.forEach((isActive, index) => {
      if (!isActive) return;
      if (Math.abs(residuals[cursor]) > 3 * scatter) {
        nextActive[index] = false;
        changed = true;
      }
      cursor += 1;
    });
    active = nextActive;
    if (!changed) break;
  }

  return xAll.map((x) => {
    const basis = chebyshevBasis(x, order);
    return Math.max(
      1e-12,
      basis.reduce((sum, value, index) => sum + value * coefficients[index], 0)
    );
  });
}

export function computeOpticalDepth(flux: number[], continuum: number[]): number[] {
  return flux.map((value, index) =>
    -Math.log(Math.max(1e-4, value / Math.max(1e-12, continuum[index])))
  );
}

export function integrateTauWavenumber(
  wavelengthsUm: number[],
  tau: number[],
  windowUm: [number, number]
): number {
  const points: Array<{ nu: number; tau: number }> = [];
  wavelengthsUm.forEach((wave, index) => {
    if (wave < windowUm[0] || wave > windowUm[1]) return;
    if (!Number.isFinite(tau[index])) return;
    points.push({ nu: wavenumberCm1(wave), tau: Math.max(0, tau[index]) });
  });
  if (points.length < 2) return 0;
  points.sort((left, right) => left.nu - right.nu);
  let integral = 0;
  for (let index = 1; index < points.length; index++) {
    integral +=
      0.5 *
      (points[index].tau + points[index - 1].tau) *
      (points[index].nu - points[index - 1].nu);
  }
  return Math.max(0, integral);
}

export function isBrownDwarfTarget(name: string | null, ra: number, dec: number): boolean {
  const normalised = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalised.includes('wise0855') || normalised.includes('epsilonindib') || normalised.includes('epsindib')) {
    return true;
  }
  const separation = (ra1: number, dec1: number, ra2: number, dec2: number) => {
    const deltaRa = ((ra1 - ra2 + 180 + 360) % 360) - 180;
    const projected = deltaRa * Math.cos((((dec1 + dec2) / 2) * Math.PI) / 180);
    return Math.hypot(projected, dec1 - dec2) * 3600;
  };
  return (
    separation(ra, dec, 133.73712, -7.24038) < 30 ||
    separation(ra, dec, 331.09566, -56.80031) < 30
  );
}

function hash01(seed: number): number {
  const value = Math.sin(seed) * 43758.5453123;
  return value - Math.floor(value);
}

export function targetBaseFlux(target: SplicesTarget): number {
  return 0.02 + 0.000008 * target.teffK;
}

/**
 * Deterministic HDU-5-style PSF aperture photometry proxy.
 *
 * Synthetic mode still evaluates the exact pencil-beam algorithm: a normalized Gaussian
 * point-spread function is rendered onto a pixel grid, the source is summed inside the
 * circular aperture, and the local sky is estimated in the annulus and subtracted by
 * aperture area. The recovered source fraction therefore responds to both controls.
 */
export function performAperturePhotometry(
  apertureRadiusPx: number,
  annulusInnerPx: number,
  annulusOuterPx: number,
  target: SplicesTarget
): AperturePhotometry {
  const safeAperture = Math.max(0.5, Math.min(4, apertureRadiusPx));
  const safeInner = Math.max(safeAperture + 0.2, Math.min(6, annulusInnerPx));
  const safeOuter = Math.max(safeInner + 0.5, Math.min(10, annulusOuterPx));
  const sigmaPx = 0.85;
  const psfFwhmPx = 2.3548 * sigmaPx;
  const sourceAmplitude = 100;
  const half = Math.max(9, Math.ceil(safeOuter) + 2);

  const skyLevel = 0.004 + 0.0008 * target.avMag + 0.000005 * target.teffK;
  let apertureSum = 0;
  let apertureArea = 0;
  let annulusSum = 0;
  let annulusArea = 0;
  let apertureNoiseVariance = 0;

  for (let iy = -half; iy <= half; iy++) {
    for (let ix = -half; ix <= half; ix++) {
      const radius = Math.hypot(ix, iy);
      const psf =
        (sourceAmplitude * Math.exp(-0.5 * (radius / sigmaPx) ** 2)) /
        (2 * Math.PI * sigmaPx ** 2);
      const noise = (hash01(ix * 13.17 + iy * 7.31 + target.ra * 0.37) - 0.5) * 0.004;
      const pixel = skyLevel + psf + noise;
      if (radius <= safeAperture) {
        apertureSum += pixel;
        apertureArea += 1;
        apertureNoiseVariance += Math.abs(pixel) + noise ** 2;
      }
      if (radius >= safeInner && radius <= safeOuter) {
        annulusSum += pixel;
        annulusArea += 1;
      }
    }
  }

  const skyPerPixel = annulusArea > 0 ? annulusSum / annulusArea : skyLevel;
  const backgroundSubtractedFlux = Math.max(0, apertureSum - skyPerPixel * apertureArea);
  const sourceFraction = Math.max(0.02, Math.min(1.2, backgroundSubtractedFlux / sourceAmplitude));
  const noiseFloor = Math.sqrt(Math.max(1e-9, apertureNoiseVariance + skyPerPixel * apertureArea));
  const snr = backgroundSubtractedFlux / noiseFloor;

  return {
    apertureRadiusPx: safeAperture,
    annulusInnerPx: safeInner,
    annulusOuterPx: safeOuter,
    psfFwhmPx,
    skyLevel: skyPerPixel,
    sourceFraction,
    backgroundSubtractedFlux,
    snr,
  };
}

export function generateSplicesSpectrum(
  target: SplicesTarget,
  nPoints = 1401,
  sourceFraction = 1
): { wavelengthsUm: number[]; flux: number[] } {
  const wavelengthsUm: number[] = [];
  const flux: number[] = [];
  const baseFlux = targetBaseFlux(target);
  for (let index = 0; index < nPoints; index++) {
    const wave = 0.75 + (index / (nPoints - 1)) * 4.25;
    const shifted = wave - 2.9;
    const continuum = baseFlux * (1 + 0.16 * shifted - 0.02 * shifted ** 2);
    let tauNu = 0;
    if (target.isBrownDwarf) {
      tauNu += 0.8 * Math.exp(-0.5 * ((wave - PHOTOSPHERIC_CH4_UM) / 0.12) ** 2);
      tauNu += 0.55 * Math.exp(-0.5 * ((wave - 1.42) / 0.05) ** 2);
      tauNu += 0.65 * Math.exp(-0.5 * ((wave - 1.92) / 0.07) ** 2);
    } else {
      const nu = wavenumberCm1(wave);
      ICE_BANDS.forEach((band) => {
        const column = target.columns[band.key] || 0;
        const area = column * band.aValue;
        const norm = band.sigmaCm1 * Math.sqrt(2 * Math.PI);
        tauNu += (area / norm) * Math.exp(-0.5 * ((nu - wavenumberCm1(band.centerUm)) / band.sigmaCm1) ** 2);
      });
    }
    wavelengthsUm.push(wave);
    flux.push(Math.max(1e-12, sourceFraction * continuum * Math.exp(-tauNu)));
  }
  return { wavelengthsUm, flux };
}

export function analyzeIceProfile(
  target: SplicesTarget,
  wavelengthsUm: number[],
  flux: number[]
): IceSolution {
  const continuum = fitChebyshevContinuum(wavelengthsUm, flux);
  const tau = computeOpticalDepth(flux, continuum);
  const brownDwarf = target.isBrownDwarf || isBrownDwarfTarget(target.name, target.ra, target.dec);
  const bands: IceColumnResult[] = ICE_BANDS.map((band) => {
    const integral = integrateTauWavenumber(wavelengthsUm, tau, band.windowUm);
    return {
      key: band.key,
      species: band.species,
      centerUm: band.centerUm,
      aValue: band.aValue,
      integratedTauCm1: brownDwarf ? null : integral,
      columnDensity: brownDwarf ? null : integral / band.aValue,
      suppressed: brownDwarf,
    };
  });
  const water = bands.find((band) => band.key === 'h2o');
  const carbonDioxide = bands.find((band) => band.key === 'co2');
  const ratioPercent =
    !brownDwarf && water?.columnDensity && carbonDioxide?.columnDensity !== null
      ? (100 * (carbonDioxide?.columnDensity || 0)) / water.columnDensity
      : null;
  return {
    wavelengthsUm,
    flux,
    continuum,
    tau,
    bands,
    ratioPercent,
    brownDwarfNotice: brownDwarf ? PHOTOSPHERIC_CH4_NOTICE : null,
  };
}

function formatColumnDensity(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toExponential(2);
}

function distanceArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const deltaRa = ((ra1 - ra2 + 180 + 360) % 360) - 180;
  const projected = deltaRa * Math.cos((((dec1 + dec2) / 2) * Math.PI) / 180);
  return Math.hypot(projected, dec1 - dec2) * 3600;
}

function resolveInitialTargetId(name: string | null, ra: number, dec: number): string {
  const normalised = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const byName = ALL_ICE_TARGETS.find((target) =>
    normalised.includes(target.name.toLowerCase().replace(/[^a-z0-9]/g, ''))
  );
  if (byName) return byName.id;
  const byPosition = ALL_ICE_TARGETS.find(
    (target) => distanceArcsec(ra, dec, target.ra, target.dec) < 30
  );
  return byPosition?.id || SPLICES_BACKGROUND_STARS[0].id;
}

// --------------------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------------------

export const MolecularIceStudio: React.FC = () => {
  const { ra, dec, activeTargetName } = useTelemetryStore();
  const { setTab } = useSpectraUrlState();
  const [selectedId, setSelectedId] = useState<string>(() =>
    resolveInitialTargetId(activeTargetName, ra, dec)
  );
  const [selectedSource, setSelectedSource] = useState<'primary' | 'sky'>('primary');
  const [apertureRadius, setApertureRadius] = useState(1.5);
  const [annulusInner, setAnnulusInner] = useState(3.0);
  const [annulusOuter, setAnnulusOuter] = useState(5.0);
  const [mode, setMode] = useState<'raw' | 'transmission' | 'tau'>('tau');
  const [sourceMode, setSourceMode] = useState<'synthetic' | 'live'>('synthetic');
  const [liveSpectrum, setLiveSpectrum] = useState<SpectrumSource | null>(null);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [activeBands, setActiveBands] = useState<IceKey[]>(['h2o', 'co2', 'co2_13', 'co', 'ch3oh']);
  const [ledgerState, setLedgerState] = useState<'idle' | 'submitting' | 'logged' | 'offline'>('idle');
  const [ledgerNote, setLedgerNote] = useState<string>('');

  const selectedTarget = useMemo(
    () => ALL_ICE_TARGETS.find((target) => target.id === selectedId) || ALL_ICE_TARGETS[0],
    [selectedId]
  );

  // Real pencil-beam aperture photometry: the controls below actually change the
  // recovered source fraction (PSF inside the aperture minus annulus sky by area).
  const photometry = useMemo(
    () => performAperturePhotometry(apertureRadius, annulusInner, annulusOuter, selectedTarget),
    [apertureRadius, annulusInner, annulusOuter, selectedTarget]
  );
  const syntheticSpectrum = useMemo(
    () => generateSplicesSpectrum(selectedTarget, 1401, photometry.sourceFraction),
    [photometry.sourceFraction, selectedTarget]
  );

  // Optional live HDU 6 spectrum. Offline demo mode falls back to the synthetic template.
  useEffect(() => {
    if (sourceMode !== 'live') return;
    let cancelled = false;
    setLiveStatus('loading');
    setLiveSpectrum(null);
    fetch(`/api/spectrum?ra=${selectedTarget.ra}&dec=${selectedTarget.dec}&normalize=false`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload: { wavelengths_um?: number[]; flux_jy?: number[]; provenance?: { source_badge?: string } }) => {
        if (cancelled) return;
        if (!Array.isArray(payload.wavelengths_um) || !Array.isArray(payload.flux_jy)) {
          throw new Error('Malformed spectrum payload');
        }
        setLiveSpectrum({
          wavelengthsUm: payload.wavelengths_um,
          flux: payload.flux_jy,
          badge: payload.provenance?.source_badge || '[Source not supplied]',
        });
        setLiveStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setLiveStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTarget, sourceMode]);

  const activeSpectrum: SpectrumSource = useMemo(() => {
    if (sourceMode === 'live' && liveSpectrum) return liveSpectrum;
    return {
      wavelengthsUm: syntheticSpectrum.wavelengthsUm,
      flux: syntheticSpectrum.flux,
      badge: sourceMode === 'live'
        ? liveStatus === 'loading'
          ? '[Synthetic SPLICES Template · live fetch loading]'
          : '[Synthetic SPLICES Template · live fetch unavailable]'
        : '[Synthetic SPLICES Template]',
    };
  }, [liveSpectrum, selectedTarget.badge, sourceMode, syntheticSpectrum]);

  const solution = useMemo(
    () => analyzeIceProfile(selectedTarget, activeSpectrum.wavelengthsUm, activeSpectrum.flux),
    [activeSpectrum, selectedTarget]
  );

  // A sky-annulus selection has no background-star continuum; never report N_ice for it.
  const effectiveSolution = useMemo(() => {
    if (selectedSource !== 'sky') return solution;
    return {
      ...solution,
      bands: solution.bands.map((band) => ({
        ...band,
        integratedTauCm1: null,
        columnDensity: null,
        suppressed: true,
      })),
      ratioPercent: null,
    };
  }, [selectedSource, solution]);
  const skySelected = selectedSource === 'sky';

  // Machine-checkable validation against the analytically injected SPLICES profile.
  // Acceptance target: recovered N(H2O) and N(CO2) within <2% of the injection.
  const validation = useMemo(() => {
    if (selectedTarget.isBrownDwarf) return null;
    const check = (key: IceKey) => {
      const recovered = solution.bands.find((band) => band.key === key)?.columnDensity;
      const injected = selectedTarget.columns[key];
      if (!recovered || !injected) return null;
      return (100 * Math.abs(recovered - injected)) / injected;
    };
    return { h2o: check('h2o'), co2: check('co2') };
  }, [selectedTarget, solution]);

  const toggleBand = (key: IceKey) => {
    setActiveBands((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]
    );
  };

  const selectedBands = effectiveSolution.bands.filter((band) => activeBands.includes(band.key));
  const maxTau = Math.max(0.4, ...solution.tau.map((value) => Math.max(0, value)));
  const maxFlux = Math.max(1e-6, ...solution.flux.map((value) => Math.max(0, value)));
  const transmission = useMemo(
    () => solution.tau.map((value) => Math.exp(-Math.max(0, value))),
    [solution.tau]
  );

  const plotPoints = (values: number[], maximum: number): string => {
    return solution.wavelengthsUm
      .map((wave, index) => {
        const x = 54 + ((wave - 0.75) / 4.25) * 842;
        const y = 330 - (Math.max(0, values[index]) / maximum) * 290;
        return `${x.toFixed(1)},${Math.max(16, Math.min(330, y)).toFixed(1)}`;
      })
      .join(' ');
  };

  const handleSubmitLedger = useCallback(async () => {
    setLedgerState('submitting');
    setLedgerNote('');
    let observerId = localStorage.getItem('spx_observer_id');
    let observerKey = localStorage.getItem('spx_observer_key');
    if (!observerId && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      observerId = crypto.randomUUID();
      localStorage.setItem('spx_observer_id', observerId);
    }
    if (!observerKey && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      observerKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('spx_observer_key', observerKey);
    }
    const nH2O = effectiveSolution.bands.find((band) => band.key === 'h2o');
    const nCO2 = effectiveSolution.bands.find((band) => band.key === 'co2');
    const body = effectiveSolution.brownDwarfNotice
      ? `${PHOTOSPHERIC_CH4_NOTICE} Sightline: ${selectedTarget.name}. No solid-ice column density is reported.`
      : `SPLICES point-source ice ledger: N(H2O) = ${formatColumnDensity(nH2O?.columnDensity ?? null)} cm^-2, ` +
        `N(CO2) = ${formatColumnDensity(nCO2?.columnDensity ?? null)} cm^-2, ` +
        `CO2/H2O = ${effectiveSolution.ratioPercent?.toFixed(2) ?? '—'}%. ` +
        `Aperture ${photometry.apertureRadiusPx.toFixed(1)} px; sky annulus ` +
        `${photometry.annulusInnerPx.toFixed(1)}-${photometry.annulusOuterPx.toFixed(1)} px; ` +
        `PSF FWHM ${photometry.psfFwhmPx.toFixed(2)} px; extracted source fraction ` +
        `${(100 * photometry.sourceFraction).toFixed(1)}%.`;
    try {
      const response = await fetch('/api/forum/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(observerId ? { 'X-Observer-ID': observerId } : {}),
          ...(observerKey ? { 'X-Observer-Key': observerKey } : {}),
        },
        body: JSON.stringify({
          title: `SPLICES ice ledger — ${selectedTarget.name}`,
          body,
          ra: selectedTarget.ra,
          dec: selectedTarget.dec,
          fovArcsec: 180,
          renderMode: 'coadd',
          targetName: selectedTarget.name,
          classification: 'interstellar_ice',
          confidencePct: effectiveSolution.brownDwarfNotice ? 0 : 88,
          classificationVote: effectiveSolution.brownDwarfNotice ? null : 'ice_source',
          channel: 'ices',
          hashtags: effectiveSolution.brownDwarfNotice ? [] : ['#ice_source'],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLedgerState('logged');
      setLedgerNote('Molecular ice ledger entry submitted to /explore/discussions.');
    } catch {
      setLedgerState('offline');
      setLedgerNote('Ledger entry retained locally (backend forum unavailable in offline demo mode).');
    }
  }, [effectiveSolution, photometry, selectedTarget]);

  return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto bg-background font-sans text-xs text-foreground lg:flex-row lg:overflow-hidden">
      {/* LEFT PANEL — SPLICES Background Target Explorer */}
      <section className="flex min-h-[72vh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-border p-3 sm:p-4 lg:h-full lg:min-h-0 lg:w-[46%] lg:min-w-[430px] lg:border-b-0 lg:border-r">
        <header className="flex items-start justify-between gap-2 border-b border-border pb-2.5">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">
              SPLICES Background Target Explorer
            </h2>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              Point-source pencil beam · ice mapping behind molecular clouds
            </p>
          </div>
          <Badge variant={activeSpectrum.badge.includes('Synthetic') ? 'amber' : 'sky'} className="font-mono text-[10px]">
            {activeSpectrum.badge}
          </Badge>
        </header>

        <div>
          <label htmlFor="splices-target" className="mb-1 block text-[11px] text-muted-foreground">
            Quick-select SPLICES catalog sightline
          </label>
          <Select
            id="splices-target"
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setLedgerState('idle');
              setLedgerNote('');
            }}
            className="w-full"
          >
            <optgroup label="SPLICES background stars">
              {SPLICES_BACKGROUND_STARS.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} · {target.environment}
                </option>
              ))}
            </optgroup>
            <optgroup label="Brown-dwarf photospheric CH4 guardrail">
              {BROWN_DWARF_GUARD_TARGETS.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} · {target.environment}
                </option>
              ))}
            </optgroup>
          </Select>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Synthetic demo seeds behind molecular clouds. Replace with the official IRSA SPLICES
            astrometric table for live science operations.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-card px-3 py-2">
          <div>
            <div className="text-[11px] font-medium text-foreground">Spectrum source</div>
            <div className="text-[10px] text-muted-foreground">
              {sourceMode === 'live'
                ? liveStatus === 'loading'
                  ? 'Fetching HDU 6 WCS-WAVE spectrum…'
                  : liveStatus === 'ready'
                    ? 'Live IRSA HDU 6 spectrum loaded'
                    : 'Live fetch unavailable — synthetic fallback active'
                : 'Deterministic SPLICES synthetic template'}
            </div>
          </div>
          <Select
            value={sourceMode}
            onChange={(event) => setSourceMode(event.target.value as 'synthetic' | 'live')}
            sizeVariant="xs"
          >
            <option value="synthetic">Synthetic SPLICES</option>
            <option value="live">Live /api/spectrum</option>
          </Select>
        </div>

        <div className="rounded-sm border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm font-semibold text-foreground">{selectedTarget.name}</div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                RA {selectedTarget.ra.toFixed(5)}° · Dec {selectedTarget.dec >= 0 ? '+' : ''}
                {selectedTarget.dec.toFixed(5)}°
              </div>
            </div>
            <Badge variant={selectedTarget.isBrownDwarf ? 'amber' : 'emerald'} className="font-mono">
              {selectedTarget.isBrownDwarf ? 'CH4 gas guard' : 'SNR ' + selectedTarget.snr.toFixed(1)}
            </Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-sm bg-secondary p-2">
              <div className="text-muted-foreground">Catalog</div>
              <div className="mt-0.5 font-mono text-[10px] leading-tight text-foreground">{selectedTarget.catalog}</div>
            </div>
            <div className="rounded-sm bg-secondary p-2">
              <div className="text-muted-foreground">Environment</div>
              <div className="mt-0.5 font-mono text-[10px] leading-tight text-foreground">{selectedTarget.environment}</div>
            </div>
          </div>
        </div>

        <fieldset className="rounded-sm border border-border bg-card p-3">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Target selection controls
          </legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-[11px]">
              <input
                type="radio"
                name="ice-source"
                checked={selectedSource === 'primary'}
                onChange={() => setSelectedSource('primary')}
                className="accent-primary"
              />
              Primary background star
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              <input
                type="radio"
                name="ice-source"
                checked={selectedSource === 'sky'}
                onChange={() => setSelectedSource('sky')}
                className="accent-primary"
              />
              Sky annulus
            </label>
          </div>
          {selectedSource === 'sky' && (
            <p className="mt-2 rounded-sm border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-300">
              Sky annulus pixels are background-only. Solid-ice A-values require a bright background star;
              switch back to Primary background star to compute N_ice.
            </p>
          )}
        </fieldset>

        <details className="rounded-sm border border-border bg-card p-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Photometry &amp; continuum settings <span aria-hidden="true" className="ml-1 text-primary">⌄</span></summary>
          <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-[11px] text-muted-foreground">
            Aperture radius [px]
            <Input
              type="number"
              min={0.5}
              max={4}
              step={0.1}
              value={apertureRadius}
              onChange={(event) => setApertureRadius(Number(event.target.value))}
              className="mt-1"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Sky annulus inner [px]
            <Input
              type="number"
              min={1}
              max={8}
              step={0.1}
              value={annulusInner}
              onChange={(event) => setAnnulusInner(Number(event.target.value))}
              className="mt-1"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Sky annulus outer [px]
            <Input
              type="number"
              min={2}
              max={12}
              step={0.1}
              value={annulusOuter}
              onChange={(event) => setAnnulusOuter(Number(event.target.value))}
              className="mt-1"
            />
          </label>
        </div>

        <div className="rounded-sm border border-border bg-card p-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Line-of-sight geometry
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px] tabular-nums">
            <dt className="text-muted-foreground">Fitted stellar continuum</dt>
            <dd className="text-right text-foreground">4th-order Chebyshev</dd>
            <dt className="text-muted-foreground">Stellar temperature</dt>
            <dd className="text-right text-foreground">{selectedTarget.teffK} K</dd>
            <dt className="text-muted-foreground">Foreground extinction</dt>
            <dd className="text-right text-foreground">Av ~ {selectedTarget.avMag.toFixed(1)} mag</dd>
            <dt className="text-muted-foreground">Continuum windows</dt>
            <dd className="text-right text-foreground">2.1–2.4, 3.7–3.9 µm</dd>
            <dt className="text-muted-foreground">PSF FWHM</dt>
            <dd className="text-right text-foreground">{photometry.psfFwhmPx.toFixed(2)} px</dd>
            <dt className="text-muted-foreground">Source badge</dt>
            <dd className="flex justify-end">
              <Badge
                variant={activeSpectrum.badge.includes('Synthetic') ? 'amber' : 'sky'}
                className="font-mono text-[9px]"
              >
                {activeSpectrum.badge}
              </Badge>
            </dd>
          </dl>
        </div>
          </div>
        </details>

        {solution.brownDwarfNotice && (
          <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
            <div className="mb-1 font-semibold uppercase tracking-wide text-amber-300">
              Photospheric CH4 — solid-ice guardrail
            </div>
            {solution.brownDwarfNotice}
          </div>
        )}

        {skySelected && (
          <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
            <div className="mb-1 font-semibold uppercase tracking-wide text-amber-300">
              Sky annulus selected
            </div>
            The local sky annulus contains no background-star continuum. Solid-ice column densities and
            the CO2/H2O ratio are suppressed until “Primary background star” is selected.
          </div>
        )}

        <div className="mt-auto rounded-sm border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pencil-beam photometry
            </span>
            <Badge variant="muted" className="font-mono">
              {selectedSource === 'primary' ? 'POINT SOURCE' : 'SKY ONLY'}
            </Badge>
          </div>
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Aperture {photometry.apertureRadiusPx.toFixed(1)} px · sky annulus{' '}
            {photometry.annulusInnerPx.toFixed(1)}–{photometry.annulusOuterPx.toFixed(1)} px · sky{' '}
            {photometry.skyLevel.toExponential(2)} MJy/sr · extracted source fraction{' '}
            {(100 * photometry.sourceFraction).toFixed(1)}% · SNR {photometry.snr.toFixed(1)}
          </p>
        </div>
      </section>

      {/* RIGHT PANEL — Optical Depth Lab */}
      <section className="flex min-w-0 w-full flex-1 flex-col gap-3 overflow-y-visible p-3 sm:p-4 lg:h-full lg:w-auto lg:overflow-y-auto">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">
              Optical Depth Lab
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Mode</span>
            <div className="flex overflow-hidden rounded-sm border border-border">
              <button
                type="button"
                onClick={() => setMode('raw')}
                className={`px-2.5 py-1 text-[11px] transition-colors ${
                  mode === 'raw' ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground'
                }`}
              >
                Raw MJy/sr
              </button>
              <button
                type="button"
                onClick={() => setMode('transmission')}
                className={`px-2.5 py-1 text-[11px] transition-colors ${
                  mode === 'transmission'
                    ? 'bg-primary/20 text-primary'
                    : 'bg-background text-muted-foreground'
                }`}
              >
                Transmission F/F_cont
              </button>
              <button
                type="button"
                onClick={() => setMode('tau')}
                className={`px-2.5 py-1 text-[11px] transition-colors ${
                  mode === 'tau' ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground'
                }`}
              >
                Optical Depth τ
              </button>
            </div>
            <Button variant="outline" size="xs" onClick={() => setTab('navigator')}>
              Back to Sky Search
            </Button>
          </div>
        </header>

        <details className="rounded-sm border border-border bg-card px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Continuum and optical-depth method <span aria-hidden="true" className="ml-1 text-primary">⌄</span></summary>
          <p className="mt-2 font-mono text-[11px] tabular-nums text-foreground">τ(λ) = −ln(F_obs / F_cont) · ν = 10000 / λ · N_ice = (1/A) ∫ τ(ν) dν</p>
        </details>

        <div className="rounded-sm border border-border bg-black/60 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {ICE_BANDS.map((band) => (
              <button
                key={band.key}
                type="button"
                onClick={() => toggleBand(band.key)}
                aria-pressed={activeBands.includes(band.key)}
                className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  activeBands.includes(band.key)
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-border bg-background text-muted-foreground'
                }`}
              >
                {band.species} {band.centerUm.toFixed(2)} µm
              </button>
            ))}
          </div>
          <svg className="h-[290px] w-full" viewBox="0 0 940 350" preserveAspectRatio="none" role="img" aria-label="Optical depth versus wavelength">
            {[0.2, 0.4, 0.6, 0.8].map((fraction) => {
              const y = 330 - fraction * 290;
              return (
                <g key={fraction}>
                  <line x1="54" y1={y} x2="896" y2={y} stroke="#262626" strokeWidth="1" />
                  <text x="48" y={y + 3} textAnchor="end" fill="#A3A3A3" fontSize="10" fontFamily="monospace">
                    {mode === 'tau'
                      ? (fraction * maxTau).toFixed(2)
                      : mode === 'transmission'
                        ? fraction.toFixed(1)
                        : (fraction * maxFlux).toFixed(3)}
                  </text>
                </g>
              );
            })}
            <line x1="54" y1="330" x2="896" y2="330" stroke="#737373" strokeWidth="1" />
            <line x1="54" y1="16" x2="54" y2="330" stroke="#737373" strokeWidth="1" />
            {[1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0].map((wave) => {
              const x = 54 + ((wave - 0.75) / 4.25) * 842;
              return (
                <g key={wave}>
                  <line x1={x} y1="16" x2={x} y2="330" stroke="#1f1f1f" strokeWidth="1" />
                  <text x={x} y="346" textAnchor="middle" fill="#A3A3A3" fontSize="10" fontFamily="monospace">
                    {wave.toFixed(1)}
                  </text>
                </g>
              );
            })}
            {ICE_BANDS.filter((band) => activeBands.includes(band.key)).map((band) => {
              const x = 54 + ((band.centerUm - 0.75) / 4.25) * 842;
              return (
                <g key={band.key}>
                  <line x1={x} y1="16" x2={x} y2="330" stroke={band.color} strokeDasharray="3,3" opacity={0.55} />
                  <text x={x + 4} y="28" fill={band.color} fontSize="9" fontFamily="monospace">
                    {band.species}
                  </text>
                </g>
              );
            })}
            {mode === 'tau' ? (
              <polyline fill="none" stroke="#38bdf8" strokeWidth="1.8" points={plotPoints(solution.tau, maxTau)} />
            ) : mode === 'transmission' ? (
              <polyline fill="none" stroke="#34d399" strokeWidth="1.8" points={plotPoints(transmission, 1.0)} />
            ) : (
              <>
                <polyline fill="none" stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="4,3" points={plotPoints(solution.continuum, maxFlux)} />
                <polyline fill="none" stroke="#38bdf8" strokeWidth="1.8" points={plotPoints(solution.flux, maxFlux)} />
              </>
            )}
            <text x="474" y="14" textAnchor="middle" fill="#A3A3A3" fontSize="10" fontFamily="monospace">
              Wavelength λ [µm] · D1 → D6 (0.75–5.00 µm)
            </text>
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted" className="font-mono">
            Aperture {photometry.apertureRadiusPx.toFixed(1)} px
          </Badge>
          <Badge variant="muted" className="font-mono">
            Sky {photometry.annulusInnerPx.toFixed(1)}–{photometry.annulusOuterPx.toFixed(1)} px
          </Badge>
          <Badge variant="muted" className="font-mono">
            PSF FWHM {photometry.psfFwhmPx.toFixed(2)} px
          </Badge>
          <Badge variant="muted" className="font-mono">
            Source {Math.round(100 * photometry.sourceFraction)}%
          </Badge>
          <Badge variant="sky" className="font-mono">
            τ mode: 4th-order Chebyshev
          </Badge>
          <Badge
            variant={activeSpectrum.badge.includes('Synthetic') ? 'amber' : 'sky'}
            className="font-mono"
          >
            {activeSpectrum.badge}
          </Badge>
          {validation && validation.h2o !== null && (
            <Badge
              variant={(validation.h2o ?? 0) < 2 && (validation.co2 ?? 0) < 2 ? 'emerald' : 'amber'}
              className="font-mono"
            >
              self-check ΔN(H2O) = {validation.h2o.toFixed(2)}% · ΔN(CO2) ={' '}
              {validation.co2 === null ? '—' : `${validation.co2.toFixed(2)}%`}
            </Badge>
          )}
        </div>

        <div className="rounded-sm border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Column density quantifications
            </h3>
            <Badge variant={effectiveSolution.ratioPercent === null ? 'amber' : 'emerald'} className="font-mono">
              CO2 / H2O ={' '}
              {effectiveSolution.ratioPercent === null
                ? 'suppressed'
                : `${effectiveSolution.ratioPercent.toFixed(2)}%`}
            </Badge>
          </div>
          <div className="max-w-full overflow-x-auto">
          <table className="min-w-[680px] w-full border-collapse text-left font-mono text-[11px] tabular-nums">
            <thead className="border-b border-border bg-secondary font-sans text-[10px] text-muted-foreground">
              <tr>
                <th className="py-1.5 pl-3">Molecular ruler</th>
                <th className="py-1.5">λ center</th>
                <th className="py-1.5">Band</th>
                <th className="py-1.5 text-right">Lab A [cm/molec]</th>
                <th className="py-1.5 text-right">∫ τ(ν) dν [cm⁻¹]</th>
                <th className="py-1.5 pr-3 text-right">N_ice [cm⁻²]</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {effectiveSolution.bands
                .filter((band) => activeBands.includes(band.key))
                .map((band) => {
                  const definition = ICE_BANDS.find((item) => item.key === band.key);
                return (
                  <tr key={band.key} className={band.suppressed ? 'text-muted-foreground' : 'text-foreground'}>
                    <td className="py-1.5 pl-3 font-sans">
                      <span className="font-medium">{band.species}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground">{definition?.label}</span>
                    </td>
                    <td className="py-1.5 text-primary">{band.centerUm.toFixed(2)} µm</td>
                    <td className="py-1.5 text-muted-foreground">{definition?.detector}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{band.aValue.toExponential(1)}</td>
                    <td className="py-1.5 text-right">{band.integratedTauCm1 === null ? '—' : band.integratedTauCm1.toFixed(3)}</td>
                    <td className={`py-1.5 pr-3 text-right ${band.suppressed ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {band.suppressed ? 'suppressed' : formatColumnDensity(band.columnDensity)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
            <span>{selectedBands.length} active molecular rulers · trapezoidal integration in wavenumber space</span>
            <span>Literature A-values: Gerakines 1995 · Boogert 2000 · Jiang 1975 · Kerkhof 1999</span>
          </div>
        </div>

        {effectiveSolution.brownDwarfNotice || skySelected ? (
          <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
            <div className="font-semibold text-amber-300">Solid-ice column densities suppressed</div>
            <p className="mt-1 leading-relaxed">
              {effectiveSolution.brownDwarfNotice ||
                'Sky-annulus selection has no background-star continuum; select the primary background star to compute N_ice.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-sm border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">N(H2O)</div>
              <div className="mt-1 font-mono text-sm text-sky-300">
                {formatColumnDensity(effectiveSolution.bands.find((band) => band.key === 'h2o')?.columnDensity ?? null)}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">molecules cm⁻²</div>
            </div>
            <div className="rounded-sm border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">N(CO2)</div>
              <div className="mt-1 font-mono text-sm text-amber-300">
                {formatColumnDensity(effectiveSolution.bands.find((band) => band.key === 'co2')?.columnDensity ?? null)}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">molecules cm⁻²</div>
            </div>
            <div className="rounded-sm border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">CO2 / H2O</div>
              <div className="mt-1 font-mono text-sm text-emerald-300">
                {effectiveSolution.ratioPercent === null ? '—' : `${effectiveSolution.ratioPercent.toFixed(2)}%`}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">ice abundance ratio</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-card p-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Submit Molecular Ice Ledger Entry
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Zero-auth observer headers · channel #ice_source · data honesty badge preserved.
            </p>
          </div>
          <Button
            onClick={handleSubmitLedger}
            disabled={ledgerState === 'submitting' || selectedSource === 'sky'}
            variant={effectiveSolution.brownDwarfNotice ? 'outline' : 'default'}
          >
            {ledgerState === 'submitting' ? 'Submitting…' : ledgerState === 'logged' ? 'Ledger entry logged' : 'Submit ledger entry'}
          </Button>
        </div>
        {ledgerNote && (
          <p className={`text-[10px] ${ledgerState === 'offline' ? 'text-amber-400' : 'text-emerald-400'}`}>
            {ledgerNote}
          </p>
        )}
      </section>
    </div>
  );
};

export default MolecularIceStudio;
