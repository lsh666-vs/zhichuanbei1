"""Reject structurally unsafe/unbounded learner states before resuming computation."""

import torch

from .config import ExperimentConfig
from .numerics import DTYPE


def _integer(value, lower, upper, name):
    if type(value) is not int or not lower <= value <= upper:
        raise ValueError(f"Invalid {name}")


def _tensor(value, shape, dtype, name):
    if (
        not isinstance(value, torch.Tensor)
        or tuple(value.shape) != tuple(shape)
        or value.dtype != dtype
    ):
        raise ValueError(f"Invalid {name} shape or dtype")
    if not torch.isfinite(value).all():
        raise ValueError(f"Non-finite {name}")


def validate_state(state):
    config = ExperimentConfig.model_validate(state["config"])
    capacity = config.sac.replay_capacity
    for name, lower, upper in (
        ("replay_size", 0, capacity),
        ("replay_pointer", 0, capacity - 1),
        ("env_steps", 0, 10**12),
        ("updates", 0, 10**10),
    ):
        _integer(state[name], lower, upper, name)
    _tensor(state["obs"], (15,), DTYPE, "current observation")
    expected_rng = torch.Generator().get_state()
    _tensor(state["torch_rng"], expected_rng.shape, expected_rng.dtype, "torch RNG")
    if len(state["last_frames"]) > 10000:
        raise ValueError("Too many saved frames")
    if config.algorithm == "sac":
        _tensor(state["log_alpha"], (), DTYPE, "temperature")
        if not -50 <= float(state["log_alpha"]) <= 10:
            raise ValueError("Temperature outside safe numerical range")
    for batch in (state["last_batch"], state["rollout"]):
        if batch is None:
            continue
        if not isinstance(batch, dict) or "obs" not in batch or batch["obs"].ndim != 2:
            raise ValueError("Invalid stored batch")
        count = len(batch["obs"])
        if not 1 <= count <= 512:
            raise ValueError("Stored batch exceeds budget")
        shapes = {"obs": (count, 15)}
        if config.algorithm == "ppo":
            shapes.update(
                {key: (count, 3) for key in ("action", "latent", "noise", "entropy_noise")}
            )
            shapes.update(
                {
                    key: (count,)
                    for key in (
                        "old_logp",
                        "value",
                        "next_value",
                        "reward",
                        "raw_advantage",
                        "returns",
                        "delta",
                        "advantage",
                    )
                }
            )
            booleans, integers = ("terminated", "boundary"), ("sample_id",)
        else:
            shapes.update(
                {
                    "action": (count, 3),
                    "next_obs": (count, 15),
                    "reward": (count,),
                    "next_noise": (count, 3),
                    "actor_noise": (count, 3),
                }
            )
            booleans, integers = ("terminated", "truncated"), ("sample_id", "indices")
        for key, shape in shapes.items():
            _tensor(batch.get(key), shape, DTYPE, f"batch/{key}")
        for key in booleans:
            _tensor(batch.get(key), (count,), torch.bool, f"batch/{key}")
        for key in integers:
            _tensor(batch.get(key), (count,), torch.int64, f"batch/{key}")
        if set(batch) != set(shapes) | set(booleans) | set(integers):
            raise ValueError("Unexpected batch fields")
    if config.algorithm == "ppo" and state["last_batch"] is not None:
        indices = state["last_batch_indices"]
        rollout = state["rollout"]
        if rollout is None or len(state["rollout_frames"]) != len(rollout["obs"]):
            raise ValueError("Missing full temporal PPO rollout")
        _tensor(indices, (len(state["last_batch"]["obs"]),), torch.int64, "minibatch selection")
        if torch.any(indices < 0) or torch.any(indices >= len(rollout["obs"])):
            raise ValueError("Minibatch indices outside rollout")
        if not torch.equal(rollout["sample_id"][indices], state["last_batch"]["sample_id"]):
            raise ValueError("Minibatch provenance mismatch")
    return config
