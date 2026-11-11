import subprocess
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import admin_ws


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(admin_ws, "hub", admin_ws.AdminTelemetryHub())
    app = FastAPI()
    app.include_router(admin_ws.router)
    return TestClient(app)


def test_retrain_403_when_mutations_disabled(client, monkeypatch):
    monkeypatch.setenv("ADMIN_MUTATIONS_ENABLED", "false")
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    assert client.post("/api/admin/retrain", headers={"X-Admin-Token": "s3cret"}, json={}).status_code == 403


def test_retrain_403_on_bad_token(client, monkeypatch):
    monkeypatch.setenv("ADMIN_MUTATIONS_ENABLED", "true")
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    assert client.post("/api/admin/retrain", headers={"X-Admin-Token": "nope"}, json={}).status_code == 403
    assert client.post("/api/admin/retrain", json={}).status_code == 403


def test_retrain_202_with_valid_token(client, monkeypatch):
    from backend.ml import trainer
    monkeypatch.setattr(trainer, "run_training", lambda *a, **k: [])
    monkeypatch.setenv("ADMIN_MUTATIONS_ENABLED", "true")
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    r = client.post("/api/admin/retrain", headers={"Authorization": "Bearer s3cret"}, json={"epochs": 2})
    assert r.status_code == 202


def test_ws_replays_cached_frames(client, monkeypatch):
    from backend.ml import trainer
    frames = [{"type": "epoch", "epoch": i} for i in range(1, 4)]
    monkeypatch.setattr("backend.ml.replay_exists", lambda m: True)
    monkeypatch.setattr(trainer, "load_replay", lambda m: frames)
    with client.websocket_connect("/api/admin/ws/training?model=AstroFeatureSVM") as ws:
        assert ws.receive_json()["type"] == "status"
        assert [ws.receive_json()["epoch"] for _ in range(3)] == [1, 2, 3]


def test_no_torch_or_sklearn_on_import():
    code = "import sys, backend.admin_ws; assert 'torch' not in sys.modules and 'sklearn' not in sys.modules"
    subprocess.run([sys.executable, "-c", code], check=True)
