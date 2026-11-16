import numpy as np
import torch

from policyglass.agents import Learner
from policyglass.experiments import branch
from policyglass.numerics import gae


def test_real_shuffled_minibatches_preserve_full_rollout_and_temporal_targets(small_config):
    small_config.ppo.rollout_steps = 5
    small_config.ppo.minibatch_size = 2
    small_config.ppo.target_kl = 1
    learner = Learner(small_config)
    outputs = learner.iteration(record=True)
    assert len(outputs) == 6  # two epochs of 2,2,1; normalization stays rollout-wide
    assert [summary["minibatch_size"] for summary, _ in outputs] == [2, 2, 1, 2, 2, 1]
    trace = next(trace for _, trace in outputs if trace is not None)
    assert trace["rollout_size"] == 5
    assert len(trace["batch"]["obs"]) == 2
    origin = Learner.from_state(learner.trace_origin_state)
    after = Learner.from_state(learner.trace_result_state)
    origin.update_ppo(origin.last_batch)
    for name in origin.models:
        for p, q in zip(origin.models[name].parameters(), after.models[name].parameters()):
            torch.testing.assert_close(p, q, atol=1e-14, rtol=1e-14)
    changed = branch(learner, {"kind": "hyperparameter", "path": "ppo.gamma", "value": 0.9})
    full = changed.rollout
    expected, returns, _ = gae(
        full["reward"],
        full["value"],
        full["next_value"],
        full["terminated"],
        full["boundary"],
        0.9,
        changed.config.ppo.gae_lambda,
    )
    np.testing.assert_allclose(full["raw_advantage"], expected, atol=1e-14)
    np.testing.assert_allclose(
        changed.last_batch["returns"], returns[changed.last_batch_indices], atol=1e-14
    )
