import pytest
import torch
from fastapi.testclient import TestClient

from policyglass.agents import Learner
from policyglass.api import create_app
from policyglass.checkpoint import encode
from policyglass.experiments import branch


def test_reward_counterfactual_temporal_propagation_and_parent_immutable(small_config):
    learner = Learner(small_config)
    learner.collect_ppo()
    original = encode(learner.state())
    t = len(learner.rollout["reward"]) - 1
    change = 1.25
    child = branch(
        learner,
        {
            "kind": "reward",
            "path": "rollout.reward",
            "index": [t],
            "value": float(learner.rollout["reward"][t]) + change,
        },
    )
    assert encode(learner.state()) == original
    difference = child.rollout["raw_advantage"] - learner.rollout["raw_advantage"]
    expected = torch.tensor(
        [
            change * (small_config.ppo.gamma * small_config.ppo.gae_lambda) ** (t - i)
            for i in range(t + 1)
        ],
        dtype=torch.float64,
    )
    torch.testing.assert_close(difference, expected, rtol=1e-12, atol=1e-12)
    for name in learner.models:
        for a, b in zip(learner.models[name].parameters(), child.models[name].parameters()):
            assert torch.equal(a, b)
    assert torch.equal(
        child.last_batch["reward"], child.rollout["reward"][child.last_batch_indices]
    )
    learner.env.close()
    child.env.close()


def test_reward_edit_rejects_non_temporal_or_unbounded_request(small_config):
    learner = Learner(small_config)
    learner.collect_ppo()
    for path, index, value in [
        ("replay.reward", [0], 1),
        ("rollout.reward", [-1], 1),
        ("rollout.reward", [0], 101),
    ]:
        with pytest.raises(ValueError):
            branch(learner, {"kind": "reward", "path": path, "index": index, "value": value})
    learner.env.close()


def test_teaching_notes_persist_and_evaluation_never_updates_source(tmp_path, small_config):
    root = tmp_path / "teaching"
    with TestClient(create_app(root)) as client:
        exp = client.post("/api/experiments", json={"config": small_config.model_dump()}).json()
        prefix = f"/api/experiments/{exp['id']}"
        source = client.get(f"/api/checkpoints/{exp['checkpoint']}/download").content
        note = {
            "text": "Observed actual gradient",
            "prediction": "zero?",
            "explanation": "not known yet",
            "course": 3,
            "experiment_id": exp["id"],
            "checkpoint": exp["checkpoint"],
            "trace_id": "",
            "event_id": "",
            "sample_id": 0,
            "created": "2026-11-16",
        }
        assert client.post(prefix + "/notebook", json={"notes": [note]}).status_code == 200
        a = client.post(prefix + "/evaluate", json={"seeds": [7, 9], "steps": 5})
        assert a.status_code == 200, a.text
        b = client.post(prefix + "/evaluate", json={"seeds": [7, 9], "steps": 5}).json()
        assert a.json()["results"] == b["results"]
        assert len(b["results"][0]["frames"]) == 5
        assert client.get(prefix).json()["env_steps"] == 0
        assert client.get(f"/api/checkpoints/{exp['checkpoint']}/download").content == source
        assert (
            client.post(
                prefix + "/notebook", json={"notes": [{**note, "text": "x" * 10001}]}
            ).status_code
            == 422
        )
        assert client.post(prefix + "/evaluate", json={"seeds": [-1]}).status_code == 400
    with TestClient(create_app(root)) as client:
        assert client.get(prefix + "/notebook").json() == {"notes": [note]}
