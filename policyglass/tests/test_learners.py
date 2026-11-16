import copy

import numpy as np
import pytest
import torch

from policyglass.agents import Learner
from policyglass.environment import SpatialArm, forward_kinematics
from policyglass.numerics import sac_target, tensor


def assert_models_equal(a, b):
    for name in a.models:
        for x, y in zip(a.models[name].parameters(), b.models[name].parameters()):
            torch.testing.assert_close(x, y, atol=1e-14, rtol=1e-14)


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_trace_does_not_change_actual_update(small_config, algorithm):
    small_config.algorithm = algorithm
    a = Learner(small_config)
    if algorithm == "ppo":
        a.collect_ppo()
    else:
        a.collect_sac(6)
        a.sample_replay()
    b = Learner.from_state(a.state())
    batch = copy.deepcopy(a.last_batch)
    method_a, method_b = getattr(a, f"update_{algorithm}"), getattr(b, f"update_{algorithm}")
    summary_a, trace = method_a(batch, record=True)
    summary_b, _ = method_b(batch, record=False)
    assert summary_a == summary_b
    assert_models_equal(a, b)
    assert trace["mode"] == "actual_computation"
    assert any(e["kind"] == "layer" for e in trace["events"])
    for event in trace["events"]:
        if event["kind"] == "sample_gradients":
            opt = next(
                e
                for e in trace["events"]
                if e["kind"] == "optimizer" and e["label"] == event["label"]
            )
            for name, values in event["contributions"].items():
                np.testing.assert_allclose(
                    np.sum(values, axis=0), opt["parameters"][name]["raw_gradient"], atol=1e-12
                )


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_full_state_resume_matches_following_collection_and_updates(small_config, algorithm):
    small_config.algorithm = algorithm
    a = Learner(small_config)
    a.iteration()
    b = Learner.from_state(a.state())
    for _ in range(2):
        sa = a.iteration()
        sb = b.iteration()
        assert [s for s, _ in sa] == [s for s, _ in sb]
        assert_models_equal(a, b)
        np.testing.assert_allclose(a.env.data.qpos, b.env.data.qpos, atol=1e-14)


@pytest.mark.scientific
def test_sac_target_is_stopped_and_bootstraps_truncation():
    q = tensor([4, 4]).requires_grad_(True)
    result = sac_target(
        tensor([1, 1]), torch.tensor([False, True]), q, q + 1, tensor([-2, -2]), tensor(0.2), 0.9
    )
    np.testing.assert_allclose(result, [4.96, 1], atol=1e-14)
    assert not result.requires_grad


@pytest.mark.scientific
def test_sac_frozen_critic_keeps_action_path(small_config):
    small_config.algorithm = "sac"
    learner = Learner(small_config)
    learner.collect_sac(6)
    batch = learner.sample_replay()
    for name in ("q1", "q2"):
        learner.models[name].requires_grad_(False)
    losses, _ = learner.sac_actor_objective(batch)
    grad = torch.autograd.grad(losses.mean(), tuple(learner.models["actor"].parameters()))
    assert sum(float(g.abs().sum()) for g in grad) > 0
    parameter = learner.models["actor"].biases[-1]
    # Independent finite difference of one mean-head bias, including the Q action path.
    losses, _ = learner.sac_actor_objective(batch)
    derivative = float(torch.autograd.grad(losses.mean(), parameter)[0][0])
    original = float(parameter[0].detach())
    values = []
    for sign in (-1, 1):
        with torch.no_grad():
            parameter[0] = original + sign * 1e-6
            values.append(float(learner.sac_actor_objective(batch)[0].mean()))
    with torch.no_grad():
        parameter[0] = original
    assert (values[1] - values[0]) / 2e-6 == pytest.approx(derivative, abs=1e-8)
    assert all(p.grad is None for p in learner.models["q1"].parameters())


@pytest.mark.scientific
def test_real_spatial_forward_kinematics_and_restore(small_config):
    env = SpatialArm(small_config.environment, 4)
    rng = np.random.default_rng(5)
    for _ in range(20):
        env.set_joint_state(rng.uniform([-1, -1, -1], [1, 1, 1]))
        np.testing.assert_allclose(
            env.data.site_xpos[0], forward_kinematics(env.data.qpos), atol=1e-14
        )
    state = env.snapshot()
    expected = env.step(np.array([0.1, -0.2, 0.3]))
    env.restore(state)
    actual = env.step(np.array([0.1, -0.2, 0.3]))
    np.testing.assert_allclose(actual[0], expected[0], atol=1e-14)
    assert actual[1:4] == expected[1:4]
    assert env.geometry()["joint_axes_local"] == [[0, 0, 1], [0, 1, 0], [0, 1, 0]]


def test_physics_rejects_nonfinite_and_out_of_range(small_config):
    env = SpatialArm(small_config.environment)
    for action in ([float("nan"), 0, 0], [3, 0, 0], [0, 0]):
        with pytest.raises(ValueError):
            env.step(action)
