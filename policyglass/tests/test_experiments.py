import io
import json
import zipfile

import numpy as np
import pytest
import torch

from policyglass.agents import Learner
from policyglass.checkpoint import decode, encode
from policyglass.experiments import branch, loss_slice, q_slice


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_safe_bundle_roundtrip_is_deterministic_and_resumes(small_config, algorithm):
    small_config.algorithm = algorithm
    a = Learner(small_config)
    a.iteration()
    blob = encode(a.state())
    assert encode(a.state()) == blob
    state, manifest = decode(blob)
    b = Learner.from_state(state)
    assert manifest["mode"] == "cpu_float64"
    assert [s for s, _ in a.iteration()] == [s for s, _ in b.iteration()]


def test_bundle_tampering_and_path_entries_are_rejected(small_config):
    blob = encode(Learner(small_config).state())
    with zipfile.ZipFile(io.BytesIO(blob)) as source:
        files = {name: source.read(name) for name in source.namelist()}
    metadata = json.loads(files["metadata.json"])
    metadata["config"]["seed"] = 99
    files["metadata.json"] = json.dumps(metadata).encode()
    destination = io.BytesIO()
    with zipfile.ZipFile(destination, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    with pytest.raises(ValueError, match="integrity"):
        decode(destination.getvalue())
    destination = io.BytesIO()
    with zipfile.ZipFile(destination, "w") as archive:
        archive.writestr("../escape", "no")
    with pytest.raises(ValueError):
        decode(destination.getvalue())


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_controlled_branch_changes_only_selected_hyperparameter_before_update(
    small_config, algorithm
):
    small_config.algorithm = algorithm
    a = Learner(small_config)
    a.iteration()
    change = {"kind": "hyperparameter", "path": f"{algorithm}.learning_rate", "value": 0.001}
    b = branch(a, change)
    for name in a.models:
        for p, q in zip(a.models[name].parameters(), b.models[name].parameters()):
            assert torch.equal(p, q)
    assert getattr(a.config, algorithm).learning_rate == 3e-4
    assert getattr(b.config, algorithm).learning_rate == 0.001
    update_a, update_b = getattr(a, f"update_{algorithm}"), getattr(b, f"update_{algorithm}")
    update_a(a.last_batch)
    update_b(b.last_batch)
    assert any(
        not torch.equal(p, q)
        for p, q in zip(a.models["actor"].parameters(), b.models["actor"].parameters())
    )


def test_parameter_branch_is_whitelisted_and_preserves_parent(small_config):
    a = Learner(small_config)
    before = float(a.models["actor"].weights[0][0, 0].detach())
    b = branch(a, {"kind": "parameter", "path": "actor/weights.0", "index": [0, 0], "value": 0.7})
    assert float(a.models["actor"].weights[0][0, 0].detach()) == before
    assert float(b.models["actor"].weights[0][0, 0].detach()) == 0.7
    with pytest.raises(ValueError):
        branch(a, {"kind": "parameter", "path": "__import__/os", "value": 1})


@pytest.mark.scientific
def test_actual_q_grid_random_point_matches_direct_evaluation(small_config):
    small_config.algorithm = "sac"
    learner = Learner(small_config)
    learner.iteration()
    surface = q_slice(learner, axes=(0, 2), fixed_action=[0, 0.3, 0], resolution=7)
    action = torch.tensor([surface["x"][2], 0.3, surface["y"][4]], dtype=torch.float64)
    with torch.no_grad():
        expected = float(learner.models["q1"](torch.cat([learner.obs, action]).reshape(1, -1)))
    assert surface["q1"][2][4] == pytest.approx(expected, abs=1e-13)
    np.testing.assert_allclose(surface["minimum"], np.minimum(surface["q1"], surface["q2"]), atol=0)


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_loss_slice_center_is_actual_loss_and_does_not_mutate_state(small_config, algorithm):
    small_config.algorithm = algorithm
    learner = Learner(small_config)
    learner.iteration()
    before = encode(learner.state())
    surface = loss_slice(learner, "actor/biases.1", [0], "actor/biases.1", [1], resolution=5)
    with torch.no_grad():
        expected = (
            learner.ppo_objective(learner.last_batch)[0]
            if algorithm == "ppo"
            else learner.sac_actor_objective(learner.last_batch)[0]
        )
    assert surface["loss"][2][2] == pytest.approx(float(expected.mean()), abs=1e-14)
    assert encode(learner.state()) == before
