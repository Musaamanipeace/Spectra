"""Read-only Mission Control data backed by persisted Spectra records."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/admin", tags=["Mission Control"])


def _database_pool_functions():
    try:
        from backend.db.pool import close_pool, create_pool
    except ImportError:
        from db.pool import close_pool, create_pool  # type: ignore
    return create_pool, close_pool


def _decode_json(value: Any, fallback: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value if value is not None else fallback


@router.get("/training/latest")
async def get_latest_training_run() -> dict[str, Any]:
    """Return the latest persisted run; never synthesize telemetry for an empty store."""
    create_pool, close_pool = _database_pool_functions()
    pool = None
    try:
        pool = await create_pool(min_size=1, max_size=2)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT run_id, model_architecture, hyperparameters, epochs_completed,
                       final_train_loss, final_val_loss, final_val_f1,
                       telemetry_frames, status, created_at
                FROM ml_training_runs
                ORDER BY created_at DESC
                LIMIT 1
                """
            )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="Training history is unavailable") from exc
    finally:
        await close_pool(pool)

    if row is None:
        return {"available": False, "detail": "No persisted training runs are available."}

    run = dict(row)
    run["hyperparameters"] = _decode_json(run.get("hyperparameters"), {})
    run["telemetry_frames"] = _decode_json(run.get("telemetry_frames"), [])
    if run.get("created_at") is not None:
        run["created_at"] = run["created_at"].isoformat()
    return {"available": True, "run": run}


@router.get("/triage")
async def get_triage_queue(limit: int = 100) -> dict[str, Any]:
    """Return pending subjects with persisted community classifications and model output."""
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 500")

    create_pool, close_pool = _database_pool_functions()
    pool = None
    try:
        pool = await create_pool(min_size=1, max_size=2)
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT s.subject_id, s.title, s.ra, s.dec, s.category,
                       s.ai_predicted_class, s.ai_probabilities, s.ai_anomaly_score,
                       s.consensus_class, s.consensus_score, s.shannon_entropy,
                       s.classification_count, s.verification_status, s.data_release,
                       s.ai_explanation, s.created_at, COUNT(c.id)::int AS vote_count
                FROM subjects AS s
                LEFT JOIN classifications AS c ON c.subject_id = s.subject_id
                WHERE s.verification_status = 'pending'
                  AND s.classification_count > 0
                GROUP BY s.subject_id
                ORDER BY s.shannon_entropy DESC, s.ai_anomaly_score DESC
                LIMIT $1
                """,
                limit,
            )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="Triage records are unavailable") from exc
    finally:
        await close_pool(pool)

    cases = []
    for row in rows:
        case = dict(row)
        case["ai_probabilities"] = _decode_json(case.get("ai_probabilities"), {})
        case["created_at"] = case["created_at"].isoformat() if case.get("created_at") else None
        cases.append(case)
    return {"cases": cases, "count": len(cases), "source": "Community Product"}


@router.get("/reliability")
async def get_observer_reliability() -> dict[str, Any]:
    """Return aggregate reliability values from observer records without exposing IDs."""
    create_pool, close_pool = _database_pool_functions()
    pool = None
    try:
        pool = await create_pool(min_size=1, max_size=2)
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT reliability_weight FROM observers ORDER BY reliability_weight"
            )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="Observer reliability records are unavailable") from exc
    finally:
        await close_pool(pool)

    weights = [float(row["reliability_weight"]) for row in rows]
    return {
        "observer_count": len(weights),
        "mean_reliability_weight": sum(weights) / len(weights) if weights else None,
        "weights": weights,
        "source": "persisted observer records",
    }


@router.get("/calibration")
async def get_calibration_records(limit: int = 200) -> dict[str, Any]:
    """Return persisted calibration subjects and observed classification accuracy."""
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 500")

    create_pool, close_pool = _database_pool_functions()
    pool = None
    try:
        pool = await create_pool(min_size=1, max_size=2)
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT s.subject_id, s.title, s.category, s.ra, s.dec,
                       s.expert_ground_truth, s.verification_status, s.data_release,
                       COUNT(c.id)::int AS classifications,
                       COUNT(c.id) FILTER (WHERE c.primary_class = s.expert_ground_truth)::int AS correct_classifications
                FROM subjects AS s
                LEFT JOIN classifications AS c ON c.subject_id = s.subject_id
                WHERE s.is_calibration = TRUE AND s.expert_ground_truth IS NOT NULL
                GROUP BY s.subject_id
                ORDER BY s.created_at DESC
                LIMIT $1
                """,
                limit,
            )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="Calibration records are unavailable") from exc
    finally:
        await close_pool(pool)

    records = []
    for row in rows:
        record = dict(row)
        record["accuracy"] = (
            record["correct_classifications"] / record["classifications"]
            if record["classifications"]
            else None
        )
        records.append(record)
    return {"records": records, "count": len(records), "source": "persisted calibration subjects"}
