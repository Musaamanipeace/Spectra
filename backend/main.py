"""Spectra Unified FastAPI Mission Science Engine.

Specification Anchor: SPECIFICATION.md §4.2, §10.4.8
Unified FastAPI service running on port 7860 orchestrating science pipelines,
zero-auth observer sessions, and binary tensor streaming.
"""

import asyncio
import os
import sys
from typing import Any

try:
    from backend.api.classify import router as classify_router
    from backend.api.admin import router as admin_router
    from backend.api.cutout import router as cutout_router
    from backend.api.export import router as export_router
    from backend.api.forum import router as forum_router
    from backend.api.resolve import router as resolve_router
    from backend.api.spectrum import router as spectrum_router
except ImportError:
    from api.classify import router as classify_router  # type: ignore
    from api.admin import router as admin_router  # type: ignore
    from api.cutout import router as cutout_router  # type: ignore
    from api.export import router as export_router  # type: ignore
    from api.forum import router as forum_router  # type: ignore
    from api.resolve import router as resolve_router  # type: ignore
    from api.spectrum import router as spectrum_router  # type: ignore
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from backend.science.similarity import find_similar
except ImportError:
    from science.similarity import find_similar  # type: ignore

# Setup uvloop event loop policy for high performance on Unix
if sys.platform != "win32":
    try:
        import uvloop

        asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
    except ImportError:
        pass

app = FastAPI(
    title="Spectra Mission Science Engine",
    description="Unified FastAPI Backend for SPHEREx Time-Domain & Hyperspectral Exploration",
    version="1.0.0",
)

# CORS Middleware (SPECIFICATION.md §10.4.8)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=[
        "Origin",
        "Content-Type",
        "Accept",
        "Authorization",
        "X-Observer-ID",
        "X-Observer-Key",
    ],
    expose_headers=["X-Observer-ID", "X-Cache"],
    max_age=600,
)

app.include_router(resolve_router)
app.include_router(cutout_router)
app.include_router(classify_router)
app.include_router(admin_router)
app.include_router(spectrum_router)
app.include_router(forum_router)
app.include_router(export_router)


@app.get("/api/health/live")
async def health_live() -> JSONResponse:
    """Process liveness check for container supervisor.

    Specification Anchor: SPECIFICATION.md §4.2, §6.1
    """
    return JSONResponse(status_code=200, content={"status": "live"})


@app.get("/api/health")
async def health_check() -> JSONResponse:
    """Dual-action keep-alive check.

    Specification Anchor: SPECIFICATION.md §4.2, §10.2, §10.6
    Touches both FastAPI and Supabase PostgreSQL in one request, updating heartbeat.
    """
    db_status = "offline"
    try:
        try:
            from backend.db.pool import close_pool, create_pool
            from backend.db.queries import PING_HEARTBEAT
        except ImportError:
            from db.pool import close_pool, create_pool  # type: ignore
            from db.queries import PING_HEARTBEAT  # type: ignore

        pool = await create_pool(min_size=1, max_size=1)
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(PING_HEARTBEAT)
                if row:
                    db_status = "updated"
        finally:
            await close_pool(pool)
    except Exception:  # noqa: BLE001
        db_status = "offline"

    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "service": "spectra-backend",
            "version": "1.0.0",
            "supabase": db_status,
            "engine": "fastapi",
        },
    )


@app.post("/api/subjects/similar")
async def subjects_similar(payload: dict[str, Any] | None = None) -> JSONResponse:
    """Return the top-k most similar spectra from the in-memory benchmark library.

    The endpoint accepts either a raw 102-channel NumPy-style list or a JSON object with
    a `spectrum`/`flux` field. It returns the top 5 matches with their names,
    spectral classes, similarity scores, and flux curves.
    """
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"error": "JSON object required"})

    spectrum = payload.get("spectrum")
    if spectrum is None:
        spectrum = payload.get("flux")
    if spectrum is None:
        spectrum = payload.get("query")
    if spectrum is None:
        spectrum = payload.get("spectrum_array")

    if spectrum is None:
        fallback = [0.0] * 102
        output = find_similar(fallback, k=5)
        return JSONResponse(status_code=200, content={"matches": output})

    try:
        query = [float(v) for v in spectrum]
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"error": "spectrum must be numeric"})

    if not query:
        return JSONResponse(status_code=400, content={"error": "spectrum cannot be empty"})

    if len(query) != 102:
        flat = []
        for item in query:
            if isinstance(item, (list, tuple)):
                flat.extend(float(v) for v in item)
            else:
                flat.append(float(item))
        if len(flat) != 102:
            return JSONResponse(
                status_code=400,
                content={"error": f"expected 102 spectral channels; got {len(query)}"},
            )
        query = flat

    return JSONResponse(status_code=200, content={"matches": find_similar(query, k=5)})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
