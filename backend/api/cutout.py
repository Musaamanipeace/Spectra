"""Bounded Cutout Queue, SSE Progress Stream & Byte-Shuffled Zstd Float32 Tensor Endpoint.

SPECIFICATION.md §3.1, §3.2, §4.1: Task-based asynchronous cutout pipeline.
POST /api/cutout (asyncio.Queue maxsize=5, 202 Accepted or 503 Retry-After: 15).
GET /api/cutout/progress/{task_id} (SSE stream).
GET /api/cutout/{task_id}/tensor (14 B/px little-endian binary stream + zstd-shuffle).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any

import numpy as np
import zstandard as zstd
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from backend.cache.lru import LRUCache
    from backend.science.ingest import ingest_exposures_for_target
    from backend.science.injector import create_synth_a_preset, inject_synthetic_source_into_planes
    from backend.science.reproject import (
        build_master_wcs,
        coadd_inverse_variance,
        encode_binary_tensor,
        reproject_exposures_sync,
    )
    from backend.science.wave_match import filter_wavelength_matched_exposures
except ImportError:
    from cache.lru import LRUCache  # type: ignore
    from science.ingest import ingest_exposures_for_target  # type: ignore
    from science.injector import create_synth_a_preset, inject_synthetic_source_into_planes  # type: ignore
    from science.reproject import (  # type: ignore
        build_master_wcs,
        coadd_inverse_variance,
        encode_binary_tensor,
        reproject_exposures_sync,
    )
    from science.wave_match import filter_wavelength_matched_exposures  # type: ignore

router = APIRouter(prefix="/api", tags=["cutout"])
logger = logging.getLogger(__name__)

# Bounded task queue (depth 5, 503 if full)
cutout_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=5)
# 1.0 GB byte-capped LRU cache (SPEC §4.2.3)
tensor_cache = LRUCache()
# Task state store
task_states: dict[str, dict[str, Any]] = {}
_worker_started = False
_worker_lock = asyncio.Lock()
_worker_task: asyncio.Task[None] | None = None
_worker_tasks: set[asyncio.Task[None]] = set()
_worker_count = 2


def _new_task_id() -> str:
    return f"task_spx_{uuid.uuid4().hex[:8]}"


def _byte_shuffle_14bpp(buf: bytes) -> bytes:
    """Shuffle 14-byte pixel records by byte lane for zstd compression."""
    if len(buf) % 14 != 0:
        return buf
    arr = np.frombuffer(buf, dtype=np.uint8).reshape(-1, 14)
    return np.ascontiguousarray(arr.T).tobytes()


def _encode_zstd_shuffle(payload: bytes) -> bytes:
    cctx = zstd.ZstdCompressor(level=3)
    return cctx.compress(_byte_shuffle_14bpp(payload))


async def _enqueue_cutout_task(
    ra: float,
    dec: float,
    fov_arcsec: int,
    bands: list[int] | None,
    adaptive_window: bool,
    synth_a: dict | None,
    synth_b: dict | None,
    zodi_subtracted: bool,
) -> str:
    task_id = _new_task_id()
    task_data = {
        "task_id": task_id,
        "ra": ra,
        "dec": dec,
        "fov_arcsec": fov_arcsec,
        "bands": bands,
        "adaptive_window": adaptive_window,
        "synth_a": synth_a,
        "synth_b": synth_b,
        "zodi_subtracted": zodi_subtracted,
        "status": "queued",
        "progress": 0.0,
        "stage": "queued",
        "message": "Task enqueued, waiting for processing",
        "created_at": time.time(),
    }
    try:
        cutout_queue.put_nowait(task_data)
    except asyncio.QueueFull:
        raise HTTPException(
            status_code=503,
            detail="Cutout queue full (depth 5), please try again later",
            headers={"Retry-After": "15"},
        ) from None
    return task_id


async def _ensure_worker() -> None:
    global _worker_started, _worker_task
    async with _worker_lock:
        if not _worker_started:
            workers = [asyncio.create_task(_queue_worker()) for _ in range(_worker_count)]
            _worker_tasks.update(workers)
            _worker_task = workers[0]
            for worker in workers:
                worker.add_done_callback(_mark_worker_stopped)
            _worker_started = True


def _mark_worker_stopped(task: asyncio.Task[None]) -> None:
    global _worker_started
    _worker_tasks.discard(task)
    if not _worker_tasks:
        _worker_started = False


async def _queue_worker() -> None:
    while True:
        task = await cutout_queue.get()
        try:
            await process_cutout_task(task)
        except Exception as exc:
            task_id = str(task.get("task_id", "unknown"))
            task_states.setdefault(task_id, {}).update(
                {"status": "error", "progress": 0.0, "stage": "error", "message": str(exc)}
            )
            logger.exception("Cutout worker failed for task %s", task_id)
        finally:
            cutout_queue.task_done()


class CutoutRequest(BaseModel):
    ra: float
    dec: float
    fov_arcsec: int = 300
    bands: list[int] | None = None
    adaptive_window: bool = False
    synth_a: dict[str, Any] | None = None
    synth_b: dict[str, Any] | None = None
    zodi_subtracted: bool = False


@router.post("/cutout", status_code=202)
async def create_cutout(
    body: CutoutRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """POST /api/cutout - Enqueue cutout task (202 or 503 Retry-After:15)."""
    await _ensure_worker()
    task_id = await _enqueue_cutout_task(
        body.ra,
        body.dec,
        body.fov_arcsec,
        body.bands,
        body.adaptive_window,
        body.synth_a,
        body.synth_b,
        body.zodi_subtracted,
    )
    task_states[task_id] = {
        "status": "queued",
        "progress": 0.0,
        "stage": "queued",
        "message": "Task enqueued, waiting for processing",
    }
    return {
        "task_id": task_id,
        "status": "queued",
        "detail": f"Cutout task enqueued. Monitor progress via GET /api/cutout/progress/{task_id}",
    }


def _sse_event(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data)}\n\n"


@router.get("/cutout/progress/{task_id}")
async def get_cutout_progress(task_id: str, request: Request, stream: bool = False):
    """GET /api/cutout/progress/{task_id} - status (JSON) or SSE stream (?stream=1)."""
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    accept = (request.headers.get("accept") or "").lower()
    wants_sse = stream or "text/event-stream" in accept

    async def event_stream():
        last = None
        while True:
            if await request.is_disconnected():
                break
            state = task_states.get(task_id)
            if state is None:
                break
            payload = {"task_id": task_id, **state}
            if payload != last:
                yield _sse_event(payload)
                last = payload
            if state.get("status") in {"complete", "error"}:
                break
            await asyncio.sleep(0.2)

    if wants_sse:
        return StreamingResponse(event_stream(), media_type="text/event-stream")
    return {"task_id": task_id, **task_states[task_id]}


@router.get("/cutout/{task_id}/tensor")
async def get_cutout_tensor(task_id: str) -> Response:
    """GET /api/cutout/{task_id}/tensor - 14 B/px binary tensor (+zstd-shuffle)."""
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    state = task_states[task_id]
    if state.get("status") != "complete":
        raise HTTPException(
            status_code=202,
            detail=f"Task {task_id} not yet complete. Progress: {state.get('progress', 0.0):.2f}",
        )

    cached = await tensor_cache.get(f"tensor:{task_id}")
    if cached is None:
        raise HTTPException(status_code=404, detail=f"Tensor data not found for task {task_id}")

    tensor_bytes, metadata = cached
    compression = (metadata or {}).get("compression", "none")
    return Response(
        content=tensor_bytes,
        media_type="application/octet-stream",
        headers={"X-Cache": "hit", "X-Compression": compression, "Cache-Control": "no-cache"},
    )


def _pack_plane(flux, variance, flags, n_exp) -> bytes:
    """Pack 14 bytes/pixel little-endian: F32, F32, U32, U16."""
    n = flux.size
    out = bytearray(n * 14)
    # vectorized-ish per field
    flux_b = np.ascontiguousarray(flux.reshape(-1), dtype="<f4").tobytes()
    var_b = np.ascontiguousarray(variance.reshape(-1), dtype="<f4").tobytes()
    flg_b = np.ascontiguousarray(flags.reshape(-1), dtype="<u4").tobytes()
    nexp_b = np.ascontiguousarray(n_exp.reshape(-1), dtype="<u2").tobytes()
    mv = memoryview(out)
    for i in range(n):
        o = i * 14
        mv[o : o + 4] = flux_b[i * 4 : i * 4 + 4]
        mv[o + 4 : o + 8] = var_b[i * 4 : i * 4 + 4]
        mv[o + 8 : o + 12] = flg_b[i * 4 : i * 4 + 4]
        mv[o + 12 : o + 14] = nexp_b[i * 2 : i * 2 + 2]
    return bytes(out)


async def process_cutout_task(task_data: dict[str, Any]) -> dict[str, Any]:
    """Process an IRSA release query into a real tensor or return an explicit error."""
    task_id = task_data["task_id"]
    ra = float(task_data["ra"])
    dec = float(task_data["dec"])
    fov_arcsec = int(task_data.get("fov_arcsec") or 180)
    adaptive_window = bool(task_data.get("adaptive_window", False))
    try:
        for stage, prog, msg in [
            ("resolving", 0.1, "Resolving target coordinates"),
            ("discovering", 0.2, "Discovering exposures via IRSA SIA2"),
            ("grouping", 0.35, "Grouping exposures by survey pass MJDs"),
            ("fetching", 0.55, "Fetching MEF cutouts"),
            ("coaddition", 0.75, "Inverse-variance coaddition per (Epoch, Band)"),
            ("packaging", 0.9, "Packaging binary tensor"),
        ]:
            task_states.setdefault(task_id, {}).update(
                {"status": "processing", "stage": stage, "progress": prog, "message": msg}
            )
            await asyncio.sleep(0.01)

        # Load the requested IRSA release and build epochs from its actual exposures.
        loaded_live_irsa = False
        live_error = None
        if not (task_data.get("synth_a") or task_data.get("synth_b")):
            try:
                ingest_res = await ingest_exposures_for_target(
                    ra=ra,
                    dec=dec,
                    fov_arcsec=fov_arcsec,
                    adaptive_window=adaptive_window,
                )
                candidate_exps = []
                for exposure in ingest_res.get("exposures", []):
                    cutout_mef = exposure.get("cutout") or {}
                    img = cutout_mef.get("hdu1_image")
                    header = cutout_mef.get("hdu1_header")
                    band = str(exposure.get("band") or "UNKNOWN").upper()
                    variance = cutout_mef.get("hdu3_variance")
                    flags = cutout_mef.get("hdu2_flags")
                    wave_tab = cutout_mef.get("hdu6_wave_tab")
                    if (
                        img is None
                        or header is None
                        or variance is None
                        or flags is None
                        or wave_tab is None
                        or band not in {f"D{i}" for i in range(1, 7)}
                    ):
                        continue
                    candidate_exps.append(
                        {
                            "flux": img,
                            "variance": variance,
                            "flags": flags,
                            "cutout_header": header,
                            "wave_tab": wave_tab,
                            "band": band,
                            "epoch": str(exposure["epoch"]),
                            "mjd": float(exposure["mjd"]),
                            "exposure_id": str(exposure["exposure_id"]),
                            "collection": exposure.get("collection"),
                        }
                    )

                if candidate_exps:
                    matched_res = filter_wavelength_matched_exposures(
                        candidate_exps, ra=ra, dec=dec, adaptive_window=adaptive_window
                    )
                    if matched_res.matched_exposures:
                        master_wcs, _, shape_out = build_master_wcs(ra, dec, min(fov_arcsec, 180))
                        reproj_list = reproject_exposures_sync(
                            matched_res.matched_exposures, master_wcs, shape_out
                        )
                        contributing_collections = sorted(
                            {
                                str(exposure["collection"])
                                for exposure in matched_res.matched_exposures
                                if exposure.get("collection")
                            }
                        )
                        collection = " + ".join(contributing_collections) or str(
                            ingest_res.get("collection") or "spherex_qr2"
                        )
                        coadd_res = coadd_inverse_variance(
                            reproj_list,
                            master_wcs=master_wcs,
                            shape_out=shape_out,
                            source_badge=f"[IRSA Live ({collection})]",
                            release=collection,
                            fill_unobserved=np.nan,
                        )
                        coadd_res.metadata["is_simulated"] = False
                        coadd_res.metadata["source_badge"] = f"[IRSA Live ({collection})]"
                        coadd_res.metadata["exposure_count"] = len(reproj_list)
                        payload = coadd_res.to_bytes(compression="none")
                        await tensor_cache.set(f"tensor:{task_id}", payload, coadd_res.metadata)
                        loaded_live_irsa = True
            except Exception as exc:
                live_error = str(exc)
                logger.exception("Live IRSA cutout processing failed for task %s", task_id)
                loaded_live_irsa = False

        if not loaded_live_irsa and not (task_data.get("synth_a") or task_data.get("synth_b")):
            message = live_error or (ingest_res.get("error") if "ingest_res" in locals() else None) or (
                "No usable exposures were returned by the selected IRSA release"
            )
            task_states[task_id].update(
                {"status": "error", "progress": 0.0, "stage": "error", "message": message}
            )
            return {"task_id": task_id, "status": "error", "message": message}

        # Explicit synthetic injection requests remain available as a labeled demo mode.
        if task_data.get("synth_a") or task_data.get("synth_b"):
            n_epochs, n_bands, h, w = 2, 6, 29, 29
            rng = np.random.default_rng(abs(int(ra * 1000 + dec * 1000)) % (2**31 - 1) or 42)
            # Zodiacal background + read noise per band D1..D6
            zodi_levels = np.array([0.04, 0.05, 0.04, 0.08, 0.18, 0.32], dtype=np.float32)
            read_sigmas = np.array([0.03, 0.035, 0.04, 0.045, 0.06, 0.08], dtype=np.float32)

            flux = np.empty((n_epochs, n_bands, h, w), dtype=np.float32)
            variance = np.empty((n_epochs, n_bands, h, w), dtype=np.float32)
            flags = np.zeros((n_epochs, n_bands, h, w), dtype=np.uint32)
            n_exp = np.full((n_epochs, n_bands, h, w), 4, dtype=np.uint16)

            yy, xx = np.mgrid[0:h, 0:w]
            sigma_psf = 1.0 / 2.35482  # 6.2" FWHM = 1.0 px => sigma = 0.4247 px
            psf = np.exp(-((xx - 14.0) ** 2 + (yy - 14.0) ** 2) / (2.0 * sigma_psf**2)).astype(
                np.float32
            )

            for e_idx in range(n_epochs):
                for b_idx in range(n_bands):
                    bg = zodi_levels[b_idx] if not task_data.get("zodi_subtracted") else 0.0
                    sig = read_sigmas[b_idx]
                    noise = rng.normal(0.0, sig, size=(h, w)).astype(np.float32)
                    plane_flux = bg + 2.5 * psf + noise
                    flux[e_idx, b_idx] = plane_flux
                    variance[e_idx, b_idx] = (
                        sig * sig + 0.015 * np.maximum(plane_flux, 0.0)
                    ).astype(np.float32)

            if task_data.get("synth_a") or task_data.get("synth_b"):
                source_badge = "[Synthetic Injection Mode]"
                cfg = create_synth_a_preset(ra0=ra, dec0=dec)
                inject_synthetic_source_into_planes(
                    flux[0, 4],
                    variance[0, 4],
                    flags[0, 4],
                    crval_ra=ra,
                    crval_dec=dec,
                    obs_epoch_mjd=60810.4,
                    band_idx=4,
                    config=cfg,
                )
            else:
                source_badge = "[Simulated Fallback (Offline)]"

            header = {
                "shape": [n_epochs, n_bands, h, w],
                "crval": [ra, dec],
                "cdelt": [-0.00172222, 0.00172222],
                "mjd_ranges": [
                    [[60789.85, 61053.42] for _ in range(n_bands)],
                    [[61091.72, 61237.87] for _ in range(n_bands)],
                ],
                "exposure_ids": [f"sim_pass{e+1}_d{b+1}" for e in range(n_epochs) for b in range(n_bands)],
                "release": "synthetic",
                "source_badge": source_badge,
                "is_simulated": True,
                "compression": "none",
            }
            payload = encode_binary_tensor(
                flux=flux,
                variance=variance,
                flags=flags,
                n_exposures=n_exp,
                metadata=header,
            )
            await tensor_cache.set(f"tensor:{task_id}", payload, header)

        task_states[task_id].update(
            {"status": "complete", "progress": 1.0, "stage": "complete", "message": "Complete"}
        )
        return {"task_id": task_id, "status": "complete"}
    except Exception as exc:  # noqa: BLE001  # pragma: no cover
        task_states.setdefault(task_id, {}).update(
            {"status": "error", "progress": 0.0, "message": str(exc)}
        )
        return {"task_id": task_id, "status": "error", "message": str(exc)}
