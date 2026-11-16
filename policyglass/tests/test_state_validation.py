import pytest
import torch

from policyglass.agents import Learner


@pytest.mark.parametrize(
    "field,value", [("replay_size", -1), ("replay_pointer", 999999), ("env_steps", "bad")]
)
def test_invalid_snapshot_counters_rejected_before_resume(small_config, field, value):
    state = Learner(small_config).state()
    state[field] = value
    with pytest.raises(ValueError):
        Learner.from_state(state)


def test_invalid_optimizer_variance_and_observation_rejected(small_config):
    learner = Learner(small_config)
    state = learner.state()
    name = next(iter(state["optimizers"]["actor"]["v"]))
    state["optimizers"]["actor"]["v"][name].fill_(-1)
    with pytest.raises(ValueError):
        Learner.from_state(state)
    state = learner.state()
    state["obs"][0] += 0.1
    with pytest.raises(ValueError, match="physical"):
        Learner.from_state(state)


def test_normalization_has_real_gradient_and_snapshot_provenance(small_config):
    learner = Learner(small_config)
    learner.collect_ppo()
    _, trace = learner.update_ppo(record=True)
    transform = next(e for e in trace["events"] if e["kind"] == "observation_transform")
    expected = (
        torch.tensor(transform["normalized_gradient"], dtype=torch.float64)
        / learner.observation_scale
    )
    torch.testing.assert_close(
        torch.tensor(transform["raw_gradient"], dtype=torch.float64),
        expected,
        atol=1e-14,
        rtol=1e-14,
    )
    assert learner.state()["observation_normalization"]["kind"] == "fixed_physical_units_v1"
