"""Admin telemetry hub: WS /api/admin/ws/training and POST /api/admin/retrain.

Top-level imports are stdlib + FastAPI only. torch/sklearn load lazily, inside
backend/ml, the first time an /admin route actually needs them.
"""
import asyncio
import hmac
import json
import os
import threading
from collections import deque

from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

try:
    from .ml import MODEL_NAMES, RING_SIZE
except ImportError:  # running with backend/ on sys.path
    from ml import MODEL_NAMES, RING_SIZE

router = APIRouter(prefix="/api/admin")
_training_lock = threading.Lock()
_tasks: set = set()


def _ml_trainer():
    try:
        from .ml import trainer
    except ImportError:
        from ml import trainer
    return trainer


def _replay_exists(model: str) -> bool:
    try:
        from .ml import replay_exists
    except ImportError:
        from ml import replay_exists
    return replay_exists(model)


def mutations_enabled() -> bool:
    return os.getenv("ADMIN_MUTATIONS_ENABLED", "false").strip().lower() == "true"


def require_admin(x_admin_token: str | None = Header(default=None), authorization: str | None = Header(default=None)):
    """403 unless mutations are enabled AND a valid ADMIN_TOKEN is supplied."""
    expected = os.getenv("ADMIN_TOKEN", "")
    supplied = x_admin_token or ""
    if not supplied and authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:]
    if not mutations_enabled() or not expected or not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="Forbidden")


class AdminTelemetryHub:
    """Per-model 100-frame ring buffers fanned out to WebSocket clients."""

    def __init__(self, size: int = RING_SIZE):
        self.size = size
        self._buffers: dict = {}
        self._clients: dict = {}
        self._seq = 0
        self._fill_lock = asyncio.Lock()

    def buffer(self, model: str) -> deque:
        return self._buffers.setdefault(model, deque(maxlen=self.size))

    def _append(self, model: str, frame: dict) -> str:
        self._seq += 1
        frame["seq"] = self._seq  # clients de-duplicate on seq
        self.buffer(model).append(frame)
        return json.dumps(frame, separators=(",", ":"))

    def reset(self, model: str):
        self.buffer(model).clear()

    async def connect(self, ws: WebSocket, model: str):
        await ws.accept()
        self._clients.setdefault(model, set()).add(ws)

    def disconnect(self, ws: WebSocket, model: str):
        self._clients.get(model, set()).discard(ws)

    async def send_status(self, ws: WebSocket, model: str, detail: str = ""):
        await ws.send_text(json.dumps({
            "type": "status", "model": model, "mutations_enabled": mutations_enabled(),
            "mode": "live" if _training_lock.locked() else "replay", "ring_size": self.size, "detail": detail,
        }))

    async def ensure_replay(self, model: str, ws: WebSocket):
        """Fill an empty ring buffer from the pre-computed trajectory (CPU only)."""
        async with self._fill_lock:
            if self.buffer(model):
                return
            if not _replay_exists(model):
                await self.send_status(ws, model, "generating replay on CPU (first run only)")
            frames = await asyncio.to_thread(_ml_trainer().load_replay, model)
            for frame in frames[-self.size:]:
                self._append(model, dict(frame))

    async def replay(self, ws: WebSocket, model: str):
        for frame in list(self.buffer(model)):
            await ws.send_text(json.dumps(frame, separators=(",", ":")))

    async def publish(self, model: str, frame: dict):
        payload = self._append(model, frame)
        for ws in list(self._clients.get(model, ())):
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001
                self.disconnect(ws, model)


hub = AdminTelemetryHub()


@router.websocket("/ws/training")
async def training_ws(ws: WebSocket, model: str = "DipoleConvNet3D"):
    if model not in MODEL_NAMES:
        await ws.close(code=1008)
        return
    await hub.connect(ws, model)
    try:
        await hub.send_status(ws, model)
        await hub.ensure_replay(model, ws)
        await hub.replay(ws, model)
        while True:
            if (await ws.receive_text()).strip() == "replay":
                await hub.replay(ws, model)
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws, model)


class RetrainRequest(BaseModel):
    model: str = "DipoleConvNet3D"
    epochs: int = Field(default=50, ge=1, le=200)
    seed: int = 0


@router.post("/retrain", status_code=202, dependencies=[Depends(require_admin)])
async def retrain(req: RetrainRequest):
    if req.model not in MODEL_NAMES:
        raise HTTPException(status_code=422, detail=f"model must be one of {list(MODEL_NAMES)}")
    if not _training_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Training already running")
    loop = asyncio.get_running_loop()
    hub.reset(req.model)

    async def _run():
        try:
            trainer = _ml_trainer()

            def on_frame(frame):
                asyncio.run_coroutine_threadsafe(hub.publish(req.model, frame), loop)

            await asyncio.to_thread(trainer.run_training, req.model, req.epochs, req.seed, "live", on_frame)
        except Exception as exc:  # noqa: BLE001
            await hub.publish(req.model, {"type": "error", "detail": str(exc)})
        finally:
            _training_lock.release()

    task = asyncio.create_task(_run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"status": "started", "model": req.model, "epochs": req.epochs}
