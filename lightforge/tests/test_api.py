import io
import json
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from lightforge.api import create_app
from lightforge.models import ExperimentSpec
from lightforge.store import Store


def test_strict_http_inputs_origins_and_queue(tmp_path):
    app = create_app(tmp_path, start_jobs=False)
    with TestClient(app) as client:
        assert client.get("/api/health").json()["stage"] == 1
        assert client.post("/api/experiments", json={"wavelength_um": -1}).status_code == 422
        assert client.post("/api/experiments", json={"extra": 1}).status_code == 422
        assert (
            client.post(
                "/api/experiments", json={}, headers={"Origin": "https://evil.example"}
            ).status_code
            == 403
        )
        assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
        assert client.post("/api/import", content=b"x" * (1024 * 1024 + 1)).status_code == 413
        exp = client.post("/api/import", json={}).json()
        assert (
            client.get("/api/experiments/" + exp["id"]).json()["hash"] == ExperimentSpec().spec_hash
        )
        for _ in range(8):
            assert client.post("/api/experiments/" + exp["id"] + "/runs").status_code == 202
        assert client.post("/api/experiments/" + exp["id"] + "/runs").status_code == 429
        assert client.get("/api/runs/missing").status_code == 404
        assert client.get("/api/experiments").json()[0]["id"] == exp["id"]


def test_atomic_queue_and_terminal_states(tmp_path):
    store = Store(tmp_path)
    exp = store.create_experiment(ExperimentSpec())

    def create(_):
        try:
            return store.create_run(exp["id"])["id"]
        except OverflowError:
            return None

    with ThreadPoolExecutor(16) as pool:
        created = [r for r in pool.map(create, range(32)) if r]
    assert len(created) == 8
    ident = created[0]
    store.event(ident, "cancelled", "cancelled", 0)
    assert not store.event(ident, "completed", "completed", 1, manifest={"fake": 1})
    assert store.run(ident)["state"] == "cancelled"
    assert store.run(ident)["manifest"] is None


def test_cancel_sse_replay_and_restart_recovery(tmp_path):
    app = create_app(tmp_path, start_jobs=False)
    with TestClient(app) as client:
        exp = client.post("/api/experiments", json={}).json()
        ident = client.post("/api/experiments/" + exp["id"] + "/runs").json()["id"]
        assert (
            client.get(f"/api/runs/{ident}/probe", params={"x": 0, "y": 0, "z": 0}).status_code
            == 409
        )
        assert client.post(f"/api/runs/{ident}/cancel").json()["state"] == "cancelled"
        response = client.get(f"/api/runs/{ident}/events")
        assert response.status_code == 200
        assert "cancelled" in response.text
        rows = app.state.store.events(ident)
        assert len(rows) == 2
        assert rows[0]["id"] < rows[1]["id"]
        assert (
            client.get(
                f"/api/runs/{ident}/events", headers={"Last-Event-ID": str(rows[-1]["id"])}
            ).text
            == ""
        )
        assert (
            client.get(
                f"/api/runs/{ident}/events", headers={"Last-Event-ID": "invalid"}
            ).status_code
            == 400
        )
        interrupted = app.state.store.create_run(exp["id"])["id"]
        app.state.store.event(interrupted, "running", "assembling", 0.1)
    restarted = create_app(tmp_path, start_jobs=False)
    restarted.state.store.recover()
    assert restarted.state.store.run(interrupted)["stage"] == "interrupted"
    assert len(restarted.state.store.experiments()) == 1


@pytest.mark.scientific
def test_real_worker_export_field_probes_and_integrity(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        exp = client.post("/api/experiments", json={"mesh": {"maxh_um": 0.2}}).json()
        ident = client.post("/api/experiments/" + exp["id"] + "/runs").json()["id"]
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            run = client.get("/api/runs/" + ident).json()
            if run["state"] in ("completed", "failed"):
                break
            time.sleep(0.05)
        assert run["state"] == "completed", run
        assert run["manifest"]["spec_hash"] == exp["hash"]
        probe = client.get(f"/api/runs/{ident}/probe", params={"x": 0, "y": 0, "z": 0})
        assert probe.status_code == 200
        assert probe.json()["E"]["real"][1] == pytest.approx(1, abs=0.02)
        for point in [(100, 0, 0), ("nan", 0, 0)]:
            assert (
                client.get(f"/api/runs/{ident}/probe", params=dict(zip("xyz", point))).status_code
                == 422
            )
        field = client.get(f"/api/runs/{ident}/field", params={"max_points": 27}).json()
        assert len(field["values"]) <= 27
        assert field["spec_hash"] == exp["hash"]
        exported = client.get(f"/api/runs/{ident}/export")
        assert exported.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            assert set(archive.namelist()) >= {
                "result.json",
                "spec.json",
                "fields.h5",
                "coefficients.npy",
            }
            assert "worker.log" not in archive.namelist()
            assert "input.json" not in archive.namelist()
            assert json.loads(archive.read("spec.json"))["schema_version"] == 1
        assert client.get(f"/api/runs/{ident}/artifacts/worker.log").status_code == 404
        directory = app.state.store.run_dir(ident)
        (directory / "coefficients.npy").write_bytes(b"changed")
        assert (
            client.get(f"/api/runs/{ident}/probe", params={"x": 0, "y": 0, "z": 0}).status_code
            == 409
        )


def test_directory_escape_rejected(tmp_path):
    store = Store(tmp_path)
    for ident in ["../escape", "a" * 31, "g" * 32, "a" * 32 + "/../.."]:
        with pytest.raises(KeyError):
            store.run_dir(ident)


def test_worker_failure_does_not_stall_queue(tmp_path, monkeypatch):
    from lightforge.jobs import JobManager

    store = Store(tmp_path)
    exp = store.create_experiment(ExperimentSpec())
    run = store.create_run(exp["id"])
    manager = JobManager(store)

    def fail(*args, **kwargs):
        raise OSError("simulated disk failure")

    monkeypatch.setattr(store, "run_dir", fail)
    manager.start()
    try:
        deadline = time.monotonic() + 3
        while store.run(run["id"])["state"] != "failed" and time.monotonic() < deadline:
            time.sleep(0.02)
        assert store.run(run["id"])["state"] == "failed"
        assert manager.thread.is_alive()
    finally:
        manager.stop()
