"""Independent scientific formulas and concrete Stage3 integrity regressions."""

import hashlib
import io
import json
import math
import zipfile

import numpy as np
import pytest
import torch

from policyglass import checkpoint
from policyglass.agents import Learner
from policyglass.experiments import branch
from policyglass.networks import Policy
from policyglass.numerics import tensor
from policyglass.repository import Repository
from policyglass.trace import Trace


def metadata_bundle(blob, metadata):
    """Produce an intact but adversarial bundle, without writing/extracting it."""
    with zipfile.ZipFile(io.BytesIO(blob)) as source:
        files = {name: source.read(name) for name in source.namelist()}
    files["metadata.json"] = json.dumps(metadata).encode()
    manifest = json.loads(files["manifest.json"])
    manifest["files"]["metadata.json"] = hashlib.sha256(files["metadata.json"]).hexdigest()
    files["manifest.json"] = json.dumps(manifest).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


def test_repeated_tensor_references_rejected_before_loading_payload(monkeypatch):
    blob = checkpoint.encode({"tensor": torch.zeros(1024, dtype=torch.float64)})
    attack = metadata_bundle(blob, [{"__tensor__": "t0"}] * 1000)

    def forbidden_allocation(_):
        pytest.fail("Tensor loading occurred before duplicate-reference preflight")

    monkeypatch.setattr(checkpoint, "load_tensors", forbidden_allocation)
    with pytest.raises(ValueError, match="repeated tensor reference"):
        checkpoint.decode(attack)


def test_ordinary_repeated_values_roundtrip_with_independent_storage():
    value = tensor([1, 2])
    state, _ = checkpoint.decode(checkpoint.encode({"a": value, "b": [value]}))
    torch.testing.assert_close(state["a"], value, atol=0, rtol=0)
    torch.testing.assert_close(state["b"][0], value, atol=0, rtol=0)
    state["a"][0] = 99
    assert state["b"][0][0] == 1


@pytest.mark.parametrize("raw", [-5.001, -5.0, -4.999, 1.999, 2.0, 2.001])
def test_clamp_trace_matches_actual_gradient_and_marks_boundaries(raw):
    policy = Policy(2, 1, [2], torch.Generator().manual_seed(3))
    with torch.no_grad():
        for weight in policy.weights:
            weight.zero_()
        policy.biases[-1][1] = raw
    trace = Trace("boundary", 1)
    _, logstd = policy.distribution(tensor([[0, 0]]), trace)
    actual = torch.autograd.grad(logstd.sum(), policy.biases[-1])[0][1]
    event = next(e for e in trace.events if e["kind"] == "distribution")
    assert event["clamp_derivative"][0][0] == float(actual)
    assert event["nondifferentiable_boundary"][0][0] is (raw in (-5, 2))
    if raw in (-5, 2):
        assert actual == 1
        assert "undefined" in event["boundary_convention"]


def test_temperature_interventions_use_the_reloadable_range(tmp_path, small_config):
    small_config.algorithm = "sac"
    learner = Learner(small_config)
    original = checkpoint.encode(learner.state())
    repo = Repository(tmp_path / "temperature")
    children = []
    try:
        for value in (-51, 11):
            with pytest.raises(ValueError, match="Temperature outside"):
                branch(
                    learner,
                    {"kind": "parameter", "path": "temperature/log_alpha", "value": value},
                )
        for value in (-50, 10):
            child = branch(
                learner,
                {"kind": "parameter", "path": "temperature/log_alpha", "value": value},
            )
            children.append(child)
            experiment = repo.create(child)
            restored = repo.learner(experiment["checkpoint"])
            children.append(restored)
            assert float(restored.log_alpha.detach()) == value
        assert checkpoint.encode(learner.state()) == original
    finally:
        for child in children:
            child.env.close()
        learner.env.close()


def test_temperature_optimizer_crossing_cannot_commit_unreloadable_state(tmp_path, small_config):
    small_config.algorithm = "sac"
    small_config.sac.learning_rate = 0.05
    small_config.sac.target_entropy = 30
    learner = Learner(small_config)
    repo = Repository(tmp_path / "commit-guard")
    try:
        learner.collect_sac(6)
        batch = learner.sample_replay()
        with torch.no_grad():
            learner.log_alpha.fill_(9.9999)
        experiment = repo.create(learner)
        prior = repo.checkpoint_bytes(experiment["checkpoint"])
        prior_files = set((repo.root / "checkpoints").iterdir())
        learner.update_sac(batch, record=False)  # real alpha optimizer moves across upper bound
        assert float(learner.log_alpha.detach()) > 10
        with pytest.raises(ValueError, match="Temperature outside"):
            repo.save_checkpoint(learner, experiment["id"])
        assert set((repo.root / "checkpoints").iterdir()) == prior_files
        assert len(repo.checkpoints(experiment["id"])) == 1
        assert repo.experiment(experiment["id"])["checkpoint"] == experiment["checkpoint"]
        assert repo.checkpoint_bytes(experiment["checkpoint"]) == prior
    finally:
        learner.env.close()


def numpy_network(model, inputs):
    """Independent NumPy forward; no learner objective/density/target helper."""
    output = np.array(inputs, dtype=np.float64, copy=True)
    for index, (weight, bias) in enumerate(zip(model.weights, model.biases)):
        output = output @ weight.detach().numpy().T + bias.detach().numpy()
        if index < len(model.weights) - 1:
            output = np.tanh(output) if model.activation == "tanh" else np.maximum(output, 0)
    return output


def numpy_policy(model, normalized_obs, noise, scale):
    output = numpy_network(model, normalized_obs)
    mu, raw_logstd = output[:, :3], output[:, 3:]
    logstd = np.clip(raw_logstd, -5, 2)
    latent = mu + np.exp(logstd) * noise
    squashed = np.tanh(latent)
    # This test uses moderate latents, so the direct Jacobian formula is well conditioned.
    logp = np.sum(
        -0.5 * (noise**2 + 2 * logstd + math.log(2 * math.pi))
        - np.log1p(-(squashed**2))
        - np.log(scale),
        axis=-1,
    )
    return squashed * scale, logp


@pytest.mark.scientific
def test_sac_target_actor_temperature_and_polyak_against_independent_numpy(small_config):
    small_config.algorithm = "sac"
    small_config.sac.gamma = 0.91
    small_config.sac.tau = 0.13
    small_config.sac.initial_alpha = 0.7
    small_config.sac.target_entropy = -2.25
    small_config.sac.learning_rate = 0.001
    learner = Learner(small_config)
    try:
        learner.collect_sac(6)
        batch = learner.sample_replay()

        def normalize(obs):
            return (
                obs.numpy() - learner.observation_mean.numpy()
            ) / learner.observation_scale.numpy()

        next_obs = normalize(batch["next_obs"])
        obs = normalize(batch["obs"])
        scale = learner.scale.numpy()
        next_action, next_logp = numpy_policy(
            learner.models["actor"], next_obs, batch["next_noise"].numpy(), scale
        )
        target_input = np.concatenate([next_obs, next_action], axis=1)
        target_q = [
            numpy_network(learner.models[name], target_input).ravel()
            for name in ("target_q1", "target_q2")
        ]
        expected_target = batch["reward"].numpy() + 0.91 * (~batch["terminated"].numpy()) * (
            np.minimum(*target_q) - 0.7 * next_logp
        )
        replay_input = np.concatenate([obs, batch["action"].numpy()], axis=1)
        predicted_q = {
            name: numpy_network(learner.models[name], replay_input).ravel() for name in ("q1", "q2")
        }
        actor_action, actor_logp = numpy_policy(
            learner.models["actor"], obs, batch["actor_noise"].numpy(), scale
        )
        old_target_parameters = {
            name: {key: p.detach().numpy().copy() for key, p in model.named_parameters()}
            for name, model in learner.models.items()
            if name.startswith("target_")
        }
        _, trace = learner.update_sac(batch, record=True)
        objective = {e["label"]: e for e in trace["events"] if e["kind"] == "objective"}
        for name in ("q1", "q2"):
            event = objective[name]
            np.testing.assert_allclose(event["detached_target"], expected_target, atol=1e-12)
            np.testing.assert_allclose(event["prediction"], predicted_q[name], atol=1e-12)
            np.testing.assert_allclose(
                event["loss"], 0.5 * (predicted_q[name] - expected_target) ** 2, atol=1e-12
            )
            assert event["target_requires_grad"] is False
        actor_input = np.concatenate([obs, actor_action], axis=1)
        updated_q = [
            numpy_network(learner.models[name], actor_input).ravel() for name in ("q1", "q2")
        ]
        np.testing.assert_allclose(objective["actor"]["action"], actor_action, atol=1e-12)
        np.testing.assert_allclose(objective["actor"]["logp"], actor_logp, atol=1e-12)
        np.testing.assert_allclose(
            objective["actor"]["loss"], 0.7 * actor_logp - np.minimum(*updated_q), atol=1e-12
        )
        alpha = next(
            e for e in trace["events"] if e["kind"] == "optimizer" and e["label"] == "alpha"
        )
        expected_alpha_gradient = -float(np.mean(actor_logp - 2.25))
        np.testing.assert_allclose(
            objective["alpha"]["loss"], -math.log(0.7) * (actor_logp - 2.25), atol=1e-12
        )
        assert alpha["parameters"]["log_alpha"]["raw_gradient"] == pytest.approx(
            expected_alpha_gradient, abs=1e-12
        )
        clipped = expected_alpha_gradient * min(
            1.0, small_config.sac.max_gradient_norm / (abs(expected_alpha_gradient) + 1e-6)
        )
        expected_log_alpha = math.log(0.7) - 0.001 * clipped / (abs(clipped) + 1e-8)
        assert float(learner.log_alpha.detach()) == pytest.approx(expected_log_alpha, abs=1e-14)
        for target_name, before in old_target_parameters.items():
            online = dict(learner.models[target_name.removeprefix("target_")].named_parameters())
            for key, parameter in learner.models[target_name].named_parameters():
                expected = 0.87 * before[key] + 0.13 * online[key].detach().numpy()
                np.testing.assert_allclose(parameter.detach(), expected, atol=1e-14, rtol=1e-14)
                assert parameter.requires_grad is False
    finally:
        learner.env.close()
