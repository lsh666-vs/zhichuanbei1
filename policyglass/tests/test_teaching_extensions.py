import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from policyglass.agents import Learner
from policyglass.api import create_app
from policyglass.checkpoint import encode
from policyglass.experiments import actor_path_probe, loss_slice
from policyglass.repository import Repository


def test_detach_probe_is_real_derivative_ablation_and_keeps_parent(small_config):
    small_config.algorithm = "sac"
    learner = Learner(small_config)
    learner.iteration(record=False)
    before = encode(learner.state())
    result = actor_path_probe(learner)["variants"]
    a, b = result["frozen_critic_parameters"], result["detach_q"]
    np.testing.assert_array_equal(a["loss"], b["loss"])
    np.testing.assert_array_equal(a["action"], b["action"])
    assert b["d_loss_d_action"] is None
    assert np.linalg.norm(a["d_loss_d_action"]) > 0
    assert any(
        not np.array_equal(a["actor_gradients"][k], b["actor_gradients"][k])
        for k in a["actor_gradients"]
    )
    assert any(np.linalg.norm(v) > 0 for v in b["actor_gradients"].values())  # entropy remains
    assert encode(learner.state()) == before
    learner.env.close()


def test_loss_cancellation_restores_varied_parameters(small_config):
    learner = Learner(small_config)
    learner.iteration(record=False)
    before = encode(learner.state())
    points = 0

    def cancelled():
        nonlocal points
        points += 1
        return points == 5

    with pytest.raises(InterruptedError):
        loss_slice(
            learner,
            "actor/biases.2",
            [0],
            "actor/biases.2",
            [1],
            resolution=31,
            cancelled=cancelled,
        )
    assert points == 5
    assert encode(learner.state()) == before
    learner.env.close()


def test_async_slice_lifecycle_and_mass_damping_reset(tmp_path, small_config):
    root = tmp_path / "extensions"
    learner = Learner(small_config)
    learner.iteration(record=False)
    repo = Repository(root)
    exp = repo.create(learner)
    source = repo.checkpoint_bytes(exp["checkpoint"])
    learner.env.close()
    with TestClient(create_app(root)) as client:
        prefix = f"/api/experiments/{exp['id']}"
        start = client.post(
            prefix + "/slice-jobs",
            json={
                "kind": "loss",
                "loss": {"path_x": "actor/biases.2", "path_y": "actor/biases.2", "resolution": 3},
            },
        )
        assert start.status_code == 202, start.text
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = client.get("/api/slice-jobs/" + start.json()["id"]).json()
            if job["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.01)
        assert job["status"] == "completed", job
        assert job["result"]["source"] == "actual_fixed_batch_evaluation"
        assert (
            client.post(
                prefix + "/physics-branches", json={"mass_scale": 2, "steps": 0}
            ).status_code
            == 400
        )
        r = client.post(
            prefix + "/physics-branches",
            json={"mass_scale": 2, "damping": 0.4, "reset_environment": True, "steps": 0},
        )
        assert r.status_code == 201, r.text
        child = client.get("/api/experiments/" + r.json()["experiment"]["id"]).json()
        assert child["config"]["environment"]["mass_scale"] == 2
        assert child["geometry"]["masses_kg"] == [0.4, 1.6, 1]
        assert child["config"]["environment"]["damping"] == 0.4
        assert child["physics"]["time_s"] == 0
        assert not child["has_batch"]
        assert repo.checkpoint_bytes(exp["checkpoint"]) == source
        original = client.get(prefix).json()
        # Same reset seed gives identical q; static gravity scales exactly with masses.
        from policyglass.environment import static_gravity_torque
        a = static_gravity_torque(child["physics"]["qpos_rad"], mass_scale=2)
        np.testing.assert_allclose(a, child["physics"]["bias_torque_nm"], atol=1e-10)
        assert original["config"]["environment"]["mass_scale"] == 1
