import time

import pytest
from fastapi.testclient import TestClient

from policyglass.api import create_app
from policyglass.repository import Repository


def wait_done(client, job_id, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("completed", "cancelled", "failed"):
            return job
        time.sleep(0.05)
    pytest.fail("Actual worker did not finish within test budget")


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_actual_api_job_trace_branch_and_import(tmp_path, small_config, algorithm):
    small_config.algorithm = algorithm
    with TestClient(create_app(tmp_path / algorithm)) as client:
        response = client.post(
            "/api/experiments",
            json={"label": "Numerical integration", "config": small_config.model_dump()},
        )
        assert response.status_code == 201, response.text
        experiment = response.json()
        detail = client.get(f"/api/experiments/{experiment['id']}").json()
        assert detail["geometry"]["link_lengths_m"] == [0.32, 0.28]
        started = client.post(
            f"/api/experiments/{experiment['id']}/jobs", json={"record": True}
        ).json()
        job = wait_done(client, started["id"])
        assert job["status"] == "completed", job
        trace = client.get(f"/api/traces/{job['trace']}").json()
        assert trace["algorithm"] == algorithm
        index = client.get(f"/api/traces/{job['trace']}/index").json()
        assert len(index["events"]) == len(trace["events"])
        assert index["events"][0]["kind"] == trace["events"][0]["kind"]
        assert client.get(f"/api/traces/{job['trace']}/events/0").json() == trace["events"][0]
        frames = client.get(f"/api/traces/{job['trace']}/frames").json()
        assert frames["sample_ids"] == [f["sample_id"] for f in frames["frames"]]
        if algorithm == "ppo":
            full = client.get(f"/api/traces/{job['trace']}/rollout").json()
            assert len(full["rollout"]["obs"]) == small_config.ppo.rollout_steps
            assert [full["rollout"]["sample_id"][i] for i in full["selected_indices"]] == trace[
                "batch"
            ]["sample_id"]
        assert trace["origin_checkpoint"] != trace["output_checkpoint"]
        child = client.post(
            f"/api/experiments/{experiment['id']}/branches",
            json={
                "checkpoint": trace["origin_checkpoint"],
                "intervention": {
                    "kind": "hyperparameter",
                    "path": f"{algorithm}.learning_rate",
                    "value": 0.001,
                },
            },
        )
        assert child.status_code == 201, child.text
        assert child.json()["parent_checkpoint"] == trace["origin_checkpoint"]
        counterfactual = client.post(
            f"/api/experiments/{child.json()['id']}/jobs", json={"mode": "fixed_batch"}
        ).json()
        assert wait_done(client, counterfactual["id"])["status"] == "completed"
        bundle = client.get(f"/api/checkpoints/{job['checkpoint']}/download")
        imported = client.post(
            "/api/import",
            content=bundle.content,
            headers={"content-type": "application/octet-stream"},
        )
        assert imported.status_code == 201, imported.text
        assert imported.json()["source_manifest"]["mujoco_wasm"] == "4.0.1"
        if algorithm == "sac":
            surface = client.post(
                f"/api/experiments/{experiment['id']}/q-slice", json={"resolution": 5}
            )
            assert surface.status_code == 200
            assert len(surface.json()["q1"]) == 5
        surface = client.post(
            f"/api/experiments/{experiment['id']}/loss-slice",
            json={"path_x": "actor/biases.1", "path_y": "actor/biases.1", "resolution": 3},
        )
        assert surface.status_code == 200, surface.text
        with client.websocket_connect(f"/api/jobs/{job['id']}/events") as websocket:
            assert websocket.receive_json()["status"] == "completed"


def test_real_pause_resume_cancel_controls(tmp_path, small_config):
    with TestClient(create_app(tmp_path / "control")) as client:
        exp = client.post("/api/experiments", json={"config": small_config.model_dump()}).json()
        job = client.post(
            f"/api/experiments/{exp['id']}/jobs", json={"iterations": 100, "record": False}
        ).json()
        assert client.post(f"/api/jobs/{job['id']}/control/pause").status_code == 200
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            current = client.get(f"/api/jobs/{job['id']}").json()
            if current["status"] == "paused":
                break
            time.sleep(0.05)
        assert current["status"] == "paused", current
        assert client.post(f"/api/experiments/{exp['id']}/jobs", json={}).status_code == 400
        assert client.post(f"/api/jobs/{job['id']}/control/run").status_code == 200
        assert client.post(f"/api/jobs/{job['id']}/control/cancel").status_code == 200
        final = wait_done(client, job["id"])
        assert final["status"] == "cancelled", final
        assert client.post(f"/api/jobs/{job['id']}/control/run").status_code == 400


def test_import_validation_origin_and_request_budget(tmp_path):
    with TestClient(create_app(tmp_path / "bad")) as client:
        assert client.post("/api/import", content=b"not a bundle").status_code == 400
        from policyglass.checkpoint import encode

        assert client.post("/api/import", content=encode({"invalid": True})).status_code == 400
        assert (
            client.post(
                "/api/experiments", json={}, headers={"origin": "https://untrusted.example"}
            ).status_code
            == 403
        )
        assert (
            client.post("/api/experiments", content=b" " * (2 * 1024 * 1024 + 1)).status_code == 413
        )
        assert client.get("/api/experiments/../../escape").status_code != 200
        assert (
            client.post(
                "/api/experiments", json={"config": {"network": {"hidden": [1000000]}}}
            ).status_code
            == 422
        )


def test_restart_marks_unfinished_jobs_with_committed_recovery_checkpoint(tmp_path, small_config):
    from policyglass.agents import Learner
    from policyglass.jobs import JobManager

    repository = Repository(tmp_path / "restart")
    experiment = repository.create(Learner(small_config))
    job = repository.create_job(experiment["id"], 1, False, "train")
    manager = JobManager(repository)
    current = repository.job(job["id"])
    assert current["status"] == "failed"
    assert current["checkpoint"] == experiment["checkpoint"]
    assert "restarted" in current["error"]
    manager.close()


def test_physical_intervention_creates_new_experiment_without_mutating_parent(
    tmp_path, small_config
):
    with TestClient(create_app(tmp_path / "physics")) as client:
        experiment = client.post(
            "/api/experiments", json={"config": small_config.model_dump()}
        ).json()
        before = client.get(f"/api/experiments/{experiment['id']}").json()
        response = client.post(
            f"/api/experiments/{experiment['id']}/physics-branches",
            json={
                "target": [0.4, 0.1, 0.4],
                "force_newtons": [1, 0, 0],
                "force_steps": 2,
                "steps": 2,
            },
        )
        assert response.status_code == 201, response.text
        assert len(response.json()["frames"]) == 2
        after = client.get(f"/api/experiments/{experiment['id']}").json()
        assert before["checkpoint"] == after["checkpoint"]
        assert before["physics"] == after["physics"]


def test_input_and_weight_interaction_uses_real_forward_without_mutating_parent(
    tmp_path, small_config
):
    with TestClient(create_app(tmp_path / "forward")) as client:
        experiment = client.post(
            "/api/experiments", json={"config": small_config.model_dump()}
        ).json()
        endpoint = f"/api/experiments/{experiment['id']}/predict"
        prediction = client.post(endpoint, json={})
        assert prediction.status_code == 200
        before = prediction.json()
        assert before["phase"] == "forward_only_no_parameter_update"
        assert not any(e["kind"] == "backward" for e in before["events"])
        child = client.post(
            f"/api/experiments/{experiment['id']}/branches",
            json={
                "intervention": {
                    "kind": "parameter",
                    "path": f"actor/biases.{len(small_config.network.hidden)}",
                    "index": [0],
                    "value": 1.0,
                }
            },
        ).json()
        after = client.post(f"/api/experiments/{child['id']}/predict", json={}).json()
        assert abs(after["action"][0][0] - before["action"][0][0]) > 0.5
        assert client.post(endpoint, json={}).json()["action"] == before["action"]


def test_second_server_cannot_reset_an_active_store(tmp_path):
    from policyglass.jobs import JobManager

    repository = Repository(tmp_path / "exclusive")
    first = JobManager(repository)
    try:
        with pytest.raises(ValueError, match="already owns"):
            JobManager(repository)
    finally:
        first.close()
    reopened = JobManager(repository)
    reopened.close()
