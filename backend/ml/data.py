"""Synthetic datasets + the pinned WISE 0855 probe.

Real survey data can be dropped in later. To pin a real WISE 0855 probe, set
WISE0855_PROBE_DIR to a folder containing <ModelName>.npy (shape without the batch dim).
"""
import math
import os
from pathlib import Path

import numpy as np
import torch

DATASET_SIZE = {"DipoleConvNet3D": 240, "SpectralResNet102": 480, "AstroFeatureSVM": 600}


def _dipole(y, g, T=4, S=32):
    n = len(y)
    x = torch.randn(n, 6, T, S, S, generator=g) * 0.3
    ax = torch.arange(S).float()
    yy, xx = torch.meshgrid(ax, ax, indexing="ij")

    def blob(cy, cx, s=2.0):
        return torch.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * s * s))

    for i in torch.nonzero(y).flatten().tolist():
        jy, jx = ((torch.rand(2, generator=g) - 0.5) * 6).tolist()
        for t in range(T):
            drift = 0.5 * t
            x[i, :, t] += 1.2 * (blob(13 + jy + drift, 16 + jx) - blob(19 + jy + drift, 16 + jx))
    return x


def _spectral(y, g, L=102):
    n = len(y)
    lam = torch.linspace(0, 1, L)
    sigma = 0.05 + 0.10 * torch.rand(n, 1, generator=g)
    base = 1 + 0.3 * torch.sin(2 * math.pi * lam)[None]
    dip = 0.5 * torch.exp(-((lam - 0.42) ** 2) / (2 * 0.03 ** 2)) + 0.4 * torch.exp(-((lam - 0.8) ** 2) / (2 * 0.03 ** 2))
    flux = base - y[:, None].float() * dip[None] + sigma * torch.randn(n, L, generator=g)
    ivar = (1 / sigma ** 2).expand(n, L) / 400.0
    return torch.stack([flux, ivar], dim=1)


def _astro(n, g):
    x = torch.rand(n, 3, generator=g) * 2 - 1
    score = 0.8 * x[:, 0] + 0.6 * x[:, 1] + 0.4 * x[:, 2] + 0.5 * torch.sin(3 * x[:, 0] * x[:, 2])
    y = (score > 0.1).long()
    flip = torch.rand(n, generator=g) < 0.03
    return x, torch.where(flip, 1 - y, y)


def make_dataset(model_name: str, n: int, seed: int = 0):
    g = torch.Generator().manual_seed(seed)
    if model_name == "AstroFeatureSVM":
        return _astro(n, g)
    y = (torch.rand(n, generator=g) < 0.5).long()
    if model_name == "DipoleConvNet3D":
        return _dipole(y, g), y
    if model_name == "SpectralResNet102":
        return _spectral(y, g), y
    raise ValueError(f"Unknown model: {model_name}")


def make_probe(model_name: str):
    """Pinned WISE 0855 probe, shape [1, ...]. Deterministic across epochs and runs."""
    d = os.getenv("WISE0855_PROBE_DIR")
    if d and (Path(d) / f"{model_name}.npy").is_file():
        return torch.from_numpy(np.load(Path(d) / f"{model_name}.npy")).float()[None]
    g = torch.Generator().manual_seed(855)
    pos = torch.ones(1, dtype=torch.long)
    if model_name == "DipoleConvNet3D":
        return _dipole(pos, g)
    if model_name == "SpectralResNet102":
        return _spectral(pos, g)
    if model_name == "AstroFeatureSVM":
        return torch.tensor([[0.9, 0.95, 0.9]])  # very red, high motion SNR, deep methane
    raise ValueError(f"Unknown model: {model_name}")
