"""Dataset Generator & 12-Dimensional Feature Vector Extractor for Spectra Classifier.

Specification Anchor: Implementation Plan Phase D (Issue D.1)
Normalized 12-Dimensional Feature Space:
- Time-domain (4): [dipole_snr, flux_variability_ratio, trajectory_linearity, mu_arcsec_yr]
- Spectral (4):    [sed_slope, water_band_index, methane_index, top_cosine_sim]
- Ice/Gas (4):     [tau_3_0_h2o, tau_4_27_co2, snr_continuum, flag_mask_fraction]
"""

from __future__ import annotations

import math
import random
from typing import Any

FEATURE_NAMES = [
    # Time-Domain
    "dipole_snr",
    "flux_variability_ratio",
    "trajectory_linearity",
    "mu_arcsec_yr",
    # Spectral
    "sed_slope",
    "water_band_index",
    "methane_index",
    "top_cosine_sim",
    # Ice/Gas
    "tau_3_0_h2o",
    "tau_4_27_co2",
    "snr_continuum",
    "flag_mask_fraction",
]

CLASS_NAMES = [
    "High-PM Brown Dwarf",
    "Variable Star",
    "Ice Core",
    "Artifact",
    "Unresolved",
]


def extract_12d_features(measurements: dict[str, Any]) -> list[float]:
    """Convert astronomical measurements into a normalized 12-dimensional feature vector."""
    # 1. Time-Domain
    dipole_snr = float(measurements.get("dipole_snr", 0.0))
    flux_var = float(measurements.get("flux_variability_ratio", 0.0))
    traj_lin = float(measurements.get("trajectory_linearity", 0.9))
    mu = float(measurements.get("mu_arcsec_yr", 0.0))

    # 2. Spectral
    sed_slope = float(measurements.get("sed_slope", -0.5))
    h2o_idx = float(measurements.get("water_band_index", 0.1))
    ch4_idx = float(measurements.get("methane_index", 0.0))
    top_sim = float(measurements.get("top_cosine_sim", 0.85))

    # 3. Ice/Gas
    tau_h2o = float(measurements.get("tau_3_0_h2o", 0.0))
    tau_co2 = float(measurements.get("tau_4_27_co2", 0.0))
    snr_cont = float(measurements.get("snr_continuum", 25.0))
    flag_mask = float(measurements.get("flag_mask_fraction", 0.0))

    return [
        round(dipole_snr, 3),
        round(flux_var, 3),
        round(traj_lin, 3),
        round(mu, 3),
        round(sed_slope, 3),
        round(h2o_idx, 3),
        round(ch4_idx, 3),
        round(top_sim, 3),
        round(tau_h2o, 3),
        round(tau_co2, 3),
        round(snr_cont, 3),
        round(flag_mask, 3),
    ]


def build_training_dataset(seed: int = 42) -> tuple[list[list[float]], list[int], list[dict[str, Any]]]:
    """Build a balanced training dataset from gold-standard archetypes and synthetic augmentations."""
    rng = random.Random(seed)
    X: list[list[float]] = []
    y: list[int] = []
    metadata: list[dict[str, Any]] = []

    # 1. High-PM Brown Dwarfs (Class 0)
    # Archetypes: Barnard's Star (mu=10.39), WISE 0855 (mu=8.15), Eps Indi B (mu=4.68)
    for _ in range(40):
        mu = rng.uniform(4.0, 11.5)
        snr = mu * rng.uniform(2.8, 3.6)
        vec = extract_12d_features({
            "dipole_snr": snr,
            "flux_variability_ratio": rng.uniform(0.05, 0.20),
            "trajectory_linearity": rng.uniform(0.92, 0.99),
            "mu_arcsec_yr": mu,
            "sed_slope": rng.uniform(-1.2, -0.2),
            "water_band_index": rng.uniform(0.3, 0.7),
            "methane_index": rng.uniform(0.4, 0.85),
            "top_cosine_sim": rng.uniform(0.92, 0.99),
            "tau_3_0_h2o": 0.0,
            "tau_4_27_co2": 0.0,
            "snr_continuum": rng.uniform(30.0, 80.0),
            "flag_mask_fraction": rng.uniform(0.0, 0.02),
        })
        X.append(vec)
        y.append(0)
        metadata.append({"name": "High-PM Brown Dwarf Sample", "class": CLASS_NAMES[0]})

    # 2. Variable Stars (Class 1)
    # Archetypes: RW Aurigae, R Draconis
    for _ in range(40):
        vec = extract_12d_features({
            "dipole_snr": rng.uniform(1.5, 3.5),
            "flux_variability_ratio": rng.uniform(0.60, 1.80),
            "trajectory_linearity": rng.uniform(0.1, 0.4),
            "mu_arcsec_yr": rng.uniform(0.01, 0.06),
            "sed_slope": rng.uniform(-0.8, 0.2),
            "water_band_index": rng.uniform(0.1, 0.3),
            "methane_index": 0.0,
            "top_cosine_sim": rng.uniform(0.91, 0.98),
            "tau_3_0_h2o": rng.uniform(0.0, 0.05),
            "tau_4_27_co2": 0.0,
            "snr_continuum": rng.uniform(40.0, 120.0),
            "flag_mask_fraction": rng.uniform(0.0, 0.01),
        })
        X.append(vec)
        y.append(1)
        metadata.append({"name": "Variable Star Sample", "class": CLASS_NAMES[1]})

    # 3. Ice Cores (Class 2)
    # Archetype: Taurus Molecular Cloud
    for _ in range(40):
        vec = extract_12d_features({
            "dipole_snr": rng.uniform(0.5, 1.5),
            "flux_variability_ratio": rng.uniform(0.01, 0.08),
            "trajectory_linearity": rng.uniform(0.0, 0.2),
            "mu_arcsec_yr": rng.uniform(0.0, 0.03),
            "sed_slope": rng.uniform(0.2, 1.1),
            "water_band_index": rng.uniform(0.2, 0.4),
            "methane_index": 0.0,
            "top_cosine_sim": rng.uniform(0.93, 0.99),
            "tau_3_0_h2o": rng.uniform(0.65, 1.85),
            "tau_4_27_co2": rng.uniform(0.40, 1.20),
            "snr_continuum": rng.uniform(20.0, 60.0),
            "flag_mask_fraction": rng.uniform(0.0, 0.02),
        })
        X.append(vec)
        y.append(2)
        metadata.append({"name": "Molecular Ice Core Sample", "class": CLASS_NAMES[2]})

    # 4. Artifacts (Class 3)
    # Cosmic rays, bad pixels, optical diffraction spikes
    for _ in range(40):
        vec = extract_12d_features({
            "dipole_snr": rng.uniform(4.0, 18.0),
            "flux_variability_ratio": rng.uniform(0.4, 3.0),
            "trajectory_linearity": rng.uniform(0.0, 0.3),
            "mu_arcsec_yr": rng.uniform(0.0, 0.1),
            "sed_slope": rng.uniform(-3.0, 3.0),
            "water_band_index": 0.0,
            "methane_index": 0.0,
            "top_cosine_sim": rng.uniform(0.25, 0.65),
            "tau_3_0_h2o": 0.0,
            "tau_4_27_co2": 0.0,
            "snr_continuum": rng.uniform(2.0, 10.0),
            "flag_mask_fraction": rng.uniform(0.15, 0.85),
        })
        X.append(vec)
        y.append(3)
        metadata.append({"name": "Instrumental Artifact Sample", "class": CLASS_NAMES[3]})

    # 5. Unresolved / Standard stars (Class 4)
    for _ in range(40):
        vec = extract_12d_features({
            "dipole_snr": rng.uniform(0.4, 1.8),
            "flux_variability_ratio": rng.uniform(0.01, 0.06),
            "trajectory_linearity": rng.uniform(0.0, 0.3),
            "mu_arcsec_yr": rng.uniform(0.0, 0.15),
            "sed_slope": rng.uniform(-0.8, -0.2),
            "water_band_index": rng.uniform(0.05, 0.2),
            "methane_index": 0.0,
            "top_cosine_sim": rng.uniform(0.88, 0.94),
            "tau_3_0_h2o": 0.0,
            "tau_4_27_co2": 0.0,
            "snr_continuum": rng.uniform(25.0, 70.0),
            "flag_mask_fraction": rng.uniform(0.0, 0.01),
        })
        X.append(vec)
        y.append(4)
        metadata.append({"name": "Unresolved Standard Star", "class": CLASS_NAMES[4]})

    return X, y, metadata
