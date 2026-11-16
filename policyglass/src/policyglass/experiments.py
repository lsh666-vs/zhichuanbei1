"""Controlled interventions and actual numerical slices; no generated code."""

import numpy as np
import torch

from .agents import Learner
from .config import ExperimentConfig, Intervention
from .numerics import gae, tensor
from .trace import plain

ALLOWED_HYPERPARAMETERS = {
    "ppo.learning_rate",
    "ppo.clip_epsilon",
    "ppo.entropy_coefficient",
    "ppo.value_coefficient",
    "ppo.gamma",
    "ppo.gae_lambda",
    "ppo.max_gradient_norm",
    "ppo.target_kl",
    "ppo.epochs",
    "ppo.minibatch_size",
    "sac.learning_rate",
    "sac.gamma",
    "sac.tau",
    "sac.target_entropy",
    "sac.max_gradient_norm",
    "sac.updates_per_step",
}


def parameter_at(learner, path, index):
    if path == "temperature/log_alpha" and hasattr(learner, "log_alpha"):
        parameter = learner.log_alpha
    else:
        pieces = path.split("/")
        if len(pieces) != 2 or pieces[0] not in learner.models or pieces[0].startswith("target_"):
            raise ValueError("Unknown or frozen target parameter")
        parameter = dict(learner.models[pieces[0]].named_parameters()).get(pieces[1])
        if parameter is None:
            raise ValueError("Unknown parameter name")
    if len(index) != parameter.ndim or any(
        i < 0 or i >= size for i, size in zip(index, parameter.shape)
    ):
        raise ValueError("Parameter index outside shape")
    return parameter, tuple(index)


def branch(learner, intervention):
    intervention = Intervention.model_validate(intervention)
    result = Learner.from_state(learner.state())
    if intervention.kind == "hyperparameter":
        if intervention.path not in ALLOWED_HYPERPARAMETERS or not intervention.path.startswith(
            result.config.algorithm
        ):
            raise ValueError("Unsupported hyperparameter")
        group, key = intervention.path.split(".")
        config = result.config.model_dump()
        config[group][key] = (
            int(intervention.value)
            if key in ("epochs", "minibatch_size", "updates_per_step")
            and intervention.value.is_integer()
            else intervention.value
        )
        result.config = ExperimentConfig.model_validate(config)
        cfg = getattr(result.config, group)
        for opt in result.optimizers.values():
            opt.lr = cfg.learning_rate
            opt.max_norm = cfg.max_gradient_norm
        if group == "ppo" and result.last_batch is not None and key in ("gamma", "gae_lambda"):
            b = result.rollout
            raw, returns, delta = gae(
                b["reward"],
                b["value"],
                b["next_value"],
                b["terminated"],
                b["boundary"],
                cfg.gamma,
                cfg.gae_lambda,
            )
            b.update(
                {
                    "raw_advantage": raw,
                    "returns": returns,
                    "delta": delta,
                    "advantage": (raw - raw.mean()) / (raw.std(unbiased=False) + 1e-8),
                }
            )
            result.select_ppo_batch(result.last_batch_indices)
    elif intervention.kind == "reward":
        if (
            result.config.algorithm != "ppo"
            or result.rollout is None
            or intervention.path != "rollout.reward"
            or len(intervention.index) != 1
            or not 0 <= intervention.index[0] < len(result.rollout["reward"])
            or abs(intervention.value) > 100
        ):
            raise ValueError("Reward intervention requires a bounded PPO temporal rollout index")
        b = result.rollout
        b["reward"][intervention.index[0]] = intervention.value
        cfg = result.config.ppo
        raw, returns, delta = gae(
            b["reward"],
            b["value"],
            b["next_value"],
            b["terminated"],
            b["boundary"],
            cfg.gamma,
            cfg.gae_lambda,
        )
        b.update(
            raw_advantage=raw,
            returns=returns,
            delta=delta,
            advantage=(raw - raw.mean()) / (raw.std(unbiased=False) + 1e-8),
        )
        result.select_ppo_batch(result.last_batch_indices)
    else:
        if abs(intervention.value) > 100:
            raise ValueError("Parameter edit exceeds numerical budget")
        parameter, index = parameter_at(result, intervention.path, intervention.index)
        with torch.no_grad():
            parameter[index] = intervention.value
        if intervention.reset_optimizer:
            model_name = intervention.path.split("/")[0]
            optimizer = result.optimizers["alpha" if model_name == "temperature" else model_name]
            for buffer in (*optimizer.m.values(), *optimizer.v.values()):
                buffer.zero_()
            optimizer.step_count = 0
    return result


def q_slice(learner, axes=(0, 1), fixed_action=None, observation=None, resolution=21):
    if learner.config.algorithm != "sac":
        raise ValueError("Q slice requires SAC")
    if len(axes) != 2 or axes[0] == axes[1] or any(axis not in range(3) for axis in axes):
        raise ValueError("Choose two distinct action dimensions")
    if not 2 <= resolution <= 65:
        raise ValueError("Resolution must be 2..65")
    obs = learner.obs if observation is None else tensor(observation)
    fixed = tensor([0, 0, 0] if fixed_action is None else fixed_action)
    if (
        obs.shape != (15,)
        or fixed.shape != (3,)
        or not torch.isfinite(obs).all()
        or not torch.isfinite(fixed).all()
    ):
        raise ValueError("Invalid observation or fixed action")
    if torch.any(fixed.abs() > learner.scale):
        raise ValueError("Fixed action exceeds torque limit")
    coordinates = [
        torch.linspace(
            -float(learner.scale[a]), float(learner.scale[a]), resolution, dtype=obs.dtype
        )
        for a in axes
    ]
    x, y = torch.meshgrid(*coordinates, indexing="ij")
    actions = fixed.repeat(resolution**2, 1)
    actions[:, axes[0]], actions[:, axes[1]] = x.flatten(), y.flatten()
    inputs = torch.cat([learner.encode_observation(obs.repeat(len(actions), 1)), actions], -1)
    with torch.no_grad():
        q1 = learner.models["q1"](inputs).reshape(resolution, resolution)
        q2 = learner.models["q2"](inputs).reshape(resolution, resolution)
    return plain(
        {
            "schema": "policyglass.q_slice.v1",
            "update": learner.updates,
            "axes": list(axes),
            "coordinate_unit": "Nm",
            "fixed_action": fixed,
            "observation": obs,
            "x": coordinates[0],
            "y": coordinates[1],
            "q1": q1,
            "q2": q2,
            "minimum": torch.minimum(q1, q2),
            "source": "actual_critic_evaluation",
        }
    )


def actor_path_probe(learner):
    if learner.config.algorithm != "sac" or learner.last_batch is None:
        raise ValueError("Actor path probe requires a real SAC replay batch")
    rows = {}
    flags = {
        name: [p.requires_grad for p in learner.models[name].parameters()] for name in ("q1", "q2")
    }
    try:
        for name in flags:
            learner.models[name].requires_grad_(False)
        for detach in (False, True):
            losses, info = learner.sac_actor_objective(learner.last_batch, detach_q=detach)
            parameters = dict(learner.models["actor"].named_parameters())
            gradients = torch.autograd.grad(
                losses.mean(), [info["action"], *parameters.values()], allow_unused=True
            )
            rows["detach_q" if detach else "frozen_critic_parameters"] = plain(
                {
                    "loss": losses,
                    "action": info["action"],
                    "q1": info["q1"],
                    "q2": info["q2"],
                    "d_loss_d_action": gradients[0],
                    "actor_gradients": dict(zip(parameters, gradients[1:])),
                    "critic_parameters_updated": False,
                }
            )
        return {
            "source": "actual_autograd_fixed_batch_noise_no_optimizer_step",
            "variants": rows,
            "scope": "detaching Q removes its action derivative; entropy actor path remains",
        }
    finally:
        for name, values in flags.items():
            for parameter, flag in zip(learner.models[name].parameters(), values):
                parameter.requires_grad_(flag)


def loss_slice(
    learner, path_x, index_x, path_y, index_y, extent=0.1, resolution=15, cancelled=None
):
    if learner.last_batch is None:
        raise ValueError("A real collected/sampled batch is required")
    if not 0 < extent <= 1 or not 2 <= resolution <= 31:
        raise ValueError("Loss slice resource budget exceeded")
    if not path_x.startswith("actor/") or not path_y.startswith("actor/"):
        raise ValueError("Reference loss slices vary actor parameters only")
    px, ix = parameter_at(learner, path_x, index_x)
    py, iy = parameter_at(learner, path_y, index_y)
    if px is py and ix == iy:
        raise ValueError("Directions must be independent parameter coordinates")
    original_x, original_y = float(px[ix].detach()), float(py[iy].detach())
    axis = np.linspace(-extent, extent, resolution)
    grid = np.empty((resolution, resolution))
    batch = learner.last_batch
    try:
        with torch.no_grad():
            origin_loss = float(
                (
                    learner.ppo_objective(batch)[0]
                    if learner.config.algorithm == "ppo"
                    else learner.sac_actor_objective(batch)[0]
                ).mean()
            )
            for i, dx in enumerate(axis):
                for j, dy in enumerate(axis):
                    if cancelled is not None and cancelled():
                        raise InterruptedError("Slice cancelled at grid-point boundary")
                    px[ix], py[iy] = original_x + dx, original_y + dy
                    if learner.config.algorithm == "ppo":
                        losses = learner.ppo_objective(batch)[0]
                    else:
                        losses = learner.sac_actor_objective(batch)[0]
                    grid[i, j] = float(losses.mean())
    finally:
        with torch.no_grad():
            px[ix], py[iy] = original_x, original_y
    return {
        "schema": "policyglass.loss_slice.v1",
        "source": "actual_fixed_batch_evaluation",
        "update": learner.updates,
        "algorithm": learner.config.algorithm,
        "directions": [
            {"path": path_x, "index": index_x, "origin": original_x},
            {"path": path_y, "index": index_y, "origin": original_y},
        ],
        "x": axis.tolist(),
        "y": axis.tolist(),
        "loss": grid.tolist(),
        "origin_loss": origin_loss,
        "frozen": "batch, old targets/probabilities, noise, other parameters, critics, alpha",
        "scope": "two scalar coordinate directions; not the full high-dimensional landscape",
    }
