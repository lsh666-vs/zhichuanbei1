"""Original PPO/SAC reference learners. Updates and teaching traces share this code."""

import copy
import math

import numpy as np
import torch

from .config import ExperimentConfig
from .environment import SpatialArm, pack_frame, unpack_frame
from .networks import MLP, Policy
from .numerics import (
    DTYPE,
    gae,
    ppo_terms,
    sac_target,
    sample_policy,
    squash_log_probability,
    tensor,
    trace_policy_operation,
)
from .optimizer import Adam
from .trace import Trace, plain
from .validation import validate_state


class Learner:
    def __init__(self, config=None):
        torch.set_num_threads(1)
        self.config = config or ExperimentConfig()
        self.rng = torch.Generator(device="cpu").manual_seed(self.config.seed)
        self.sample_rng = np.random.default_rng(self.config.seed + 1)
        self.env = SpatialArm(self.config.environment, self.config.seed + 2)
        self.obs = tensor(self.env.observation())
        self.scale = tensor([self.config.environment.torque_limit] * 3)
        self.observation_mean = tensor([0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0.18, 0, 0, 0.18])
        self.observation_scale = tensor([1] * 6 + [5] * 3 + [0.6] * 6)
        net = self.config.network
        self.models = {"actor": Policy(15, 3, net.hidden, self.rng, net.activation)}
        if self.config.algorithm == "ppo":
            self.models["value"] = MLP([15, *net.hidden, 1], self.rng, net.activation)
            lr, norm = self.config.ppo.learning_rate, self.config.ppo.max_gradient_norm
            self.optimizers = {
                name: Adam(dict(model.named_parameters()), lr, norm)
                for name, model in self.models.items()
            }
        else:
            for name in ("q1", "q2"):
                self.models[name] = MLP([18, *net.hidden, 1], self.rng, net.activation)
                self.models[f"target_{name}"] = copy.deepcopy(self.models[name])
                self.models[f"target_{name}"].requires_grad_(False)
            cfg = self.config.sac
            self.log_alpha = torch.nn.Parameter(tensor(math.log(cfg.initial_alpha)))
            self.optimizers = {
                name: Adam(
                    dict(self.models[name].named_parameters()),
                    cfg.learning_rate,
                    cfg.max_gradient_norm,
                )
                for name in ("actor", "q1", "q2")
            }
            self.optimizers["alpha"] = Adam(
                {"log_alpha": self.log_alpha}, cfg.learning_rate, cfg.max_gradient_norm
            )
        capacity = self.config.sac.replay_capacity
        self.replay = {
            "obs": torch.zeros(capacity, 15, dtype=DTYPE),
            "action": torch.zeros(capacity, 3, dtype=DTYPE),
            "next_obs": torch.zeros(capacity, 15, dtype=DTYPE),
            "reward": torch.zeros(capacity, dtype=DTYPE),
            "terminated": torch.zeros(capacity, dtype=torch.bool),
            "truncated": torch.zeros(capacity, dtype=torch.bool),
            "sample_id": torch.zeros(capacity, dtype=torch.int64),
        }
        self.replay_size = self.replay_pointer = self.env_steps = self.updates = 0
        self.replay_physics = {
            "before": torch.zeros(capacity, 49, dtype=DTYPE),
            "after": torch.zeros(capacity, 49, dtype=DTYPE),
            "reward_parts": torch.zeros(capacity, 3, dtype=DTYPE),
        }
        self.last_batch = None
        self.rollout = None
        self.rollout_frames = []
        self.last_batch_indices = None
        self.last_frames = []

    def noise(self, n):
        return torch.randn(n, 3, dtype=DTYPE, generator=self.rng)

    def encode_observation(self, observation, trace=None, label="observation"):
        raw = observation.detach().requires_grad_(True) if trace else observation
        normalized = (raw - self.observation_mean) / self.observation_scale
        if trace is not None:
            trace.watch_transform(
                label, raw, normalized, self.observation_mean, self.observation_scale
            )
        return normalized

    def check_trace_budget(self, batch_size):
        parameters = sum(
            p.numel()
            for name, model in self.models.items()
            if not name.startswith("target_")
            for p in model.parameters()
        )
        if parameters * batch_size > 1_500_000:
            raise ValueError(
                "Full sample-gradient trace exceeds budget; reduce batch/network or train without trace"
            )

    def act(self, observation, noise=None, deterministic=False):
        with torch.no_grad():
            mu, logstd = self.models["actor"].distribution(
                self.encode_observation(observation.reshape(-1, 15))
            )
            noise = (
                torch.zeros_like(mu)
                if deterministic
                else (self.noise(len(mu)) if noise is None else noise)
            )
            action, logp, latent = sample_policy(mu, logstd, noise, self.scale)
        return action, logp, latent, noise

    def transition(self, action):
        before = self.env.frame()
        observation, reward, terminated, truncated, info = self.env.step(action)
        self.env_steps += 1
        frame = {
            "sample_id": self.env_steps,
            "before": before,
            "after": info["physics"],
            "reward_parts": info["reward_parts"],
            "reward": reward,
            "terminated": terminated,
            "truncated": truncated,
        }
        next_observation = tensor(observation)
        self.obs = tensor(self.env.reset()[0]) if terminated or truncated else next_observation
        return next_observation, reward, terminated, truncated, frame

    def collect_ppo(self, count=None):
        if self.config.algorithm != "ppo":
            raise ValueError("PPO collection on non-PPO learner")
        cfg = self.config.ppo
        count = count or cfg.rollout_steps
        rows, frames = [], []
        for _ in range(count):
            obs = self.obs.clone()
            action, logp, latent, noise = self.act(obs)
            with torch.no_grad():
                value = self.models["value"](self.encode_observation(obs.reshape(1, -1))).reshape(
                    ()
                )
            next_obs, reward, terminated, truncated, frame = self.transition(action[0].numpy())
            with torch.no_grad():
                next_value = self.models["value"](
                    self.encode_observation(next_obs.reshape(1, -1))
                ).reshape(())
            rows.append(
                {
                    "obs": obs,
                    "action": action[0],
                    "latent": latent[0],
                    "noise": noise[0],
                    "old_logp": logp[0],
                    "value": value,
                    "next_value": next_value,
                    "reward": tensor(reward),
                    "terminated": torch.tensor(terminated),
                    "boundary": torch.tensor(terminated or truncated),
                    "sample_id": torch.tensor(self.env_steps, dtype=torch.int64),
                }
            )
            frames.append(frame)
        batch = {key: torch.stack([row[key] for row in rows]) for key in rows[0]}
        raw_adv, returns, delta = gae(
            batch["reward"],
            batch["value"],
            batch["next_value"],
            batch["terminated"],
            batch["boundary"],
            cfg.gamma,
            cfg.gae_lambda,
        )
        batch.update(
            {
                "raw_advantage": raw_adv,
                "returns": returns,
                "delta": delta,
                "advantage": (raw_adv - raw_adv.mean()) / (raw_adv.std(unbiased=False) + 1e-8),
                "entropy_noise": self.noise(count),
            }
        )
        self.last_batch, self.last_frames = batch, frames
        self.rollout, self.rollout_frames = batch, frames
        self.last_batch_indices = torch.arange(count, dtype=torch.int64)
        return batch

    def select_ppo_batch(self, indices):
        if self.rollout is None:
            raise ValueError("PPO minibatch needs a complete temporal rollout")
        indices = torch.as_tensor(indices, dtype=torch.int64)
        if (
            indices.ndim != 1
            or len(indices) == 0
            or torch.any(indices < 0)
            or torch.any(indices >= len(self.rollout["obs"]))
        ):
            raise ValueError("Invalid rollout selection")
        self.last_batch = {key: value[indices].clone() for key, value in self.rollout.items()}
        self.last_batch_indices = indices.clone()
        self.last_frames = [self.rollout_frames[i] for i in indices.tolist()]
        return self.last_batch

    def ppo_objective(self, batch, trace=None):
        cfg = self.config.ppo
        mu, logstd = self.models["actor"].distribution(
            self.encode_observation(batch["obs"], trace, "actor_input"), trace
        )
        logp = squash_log_probability(mu, logstd, batch["latent"], self.scale)
        trace_policy_operation(
            trace, "ppo_behavior_likelihood", mu, logstd, batch["latent"], logp, self.scale
        )
        policy, ratio, clipped, flat = ppo_terms(
            logp, batch["old_logp"], batch["advantage"].detach(), cfg.clip_epsilon
        )
        entropy_action, entropy_logp, entropy_latent = sample_policy(
            mu, logstd, batch["entropy_noise"], self.scale
        )
        trace_policy_operation(
            trace,
            "ppo_entropy_sample",
            mu,
            logstd,
            entropy_latent,
            entropy_logp,
            self.scale,
            entropy_action,
            batch["entropy_noise"],
        )
        actor_losses = policy + cfg.entropy_coefficient * entropy_logp
        values = self.models["value"](
            self.encode_observation(batch["obs"], trace, "value_input"), trace, "value"
        ).squeeze(-1)
        value_losses = cfg.value_coefficient * 0.5 * (values - batch["returns"].detach()) ** 2
        metrics = {
            "policy_loss": policy.mean(),
            "value_loss": value_losses.mean(),
            "entropy_mc": -entropy_logp.mean(),
            "ratio": ratio,
            "clipped_ratio": clipped,
            "flat_policy_branch": flat,
            "logp": logp,
            "kl_approx": (ratio - 1 - (logp - batch["old_logp"])).mean(),
            "sampled_kl": (batch["old_logp"] - logp).mean(),
        }
        return actor_losses, value_losses, metrics

    def update_ppo(self, batch=None, record=False):
        batch = self.last_batch if batch is None else batch
        if batch is None:
            raise ValueError("Collect a real rollout first")
        self.last_batch = batch
        if record:
            self.check_trace_budget(len(batch["obs"]))
        self.updates += 1
        trace = Trace("ppo", self.updates) if record else None
        for opt in self.optimizers.values():
            opt.zero_grad()
        actor_losses, value_losses, metrics = self.ppo_objective(batch, trace)
        if trace is not None:
            trace.add(
                "objective",
                "ppo_clip",
                **metrics,
                actor_contribution=actor_losses,
                value_contribution=value_losses,
                advantage=batch["advantage"],
                raw_advantage=batch["raw_advantage"],
                returns=batch["returns"],
                td_delta=batch["delta"],
                old_logp=batch["old_logp"],
                convention="minimized mean loss; fixed rollout targets; MC transformed entropy",
            )
            trace.sample_gradients(
                "actor", actor_losses, dict(self.models["actor"].named_parameters())
            )
            trace.sample_gradients(
                "value", value_losses, dict(self.models["value"].named_parameters())
            )
        (actor_losses.mean() + value_losses.mean()).backward()
        if trace is not None:
            trace.flush_layers()
        self.optimizers["actor"].step(trace, "actor")
        self.optimizers["value"].step(trace, "value")
        summary = plain({k: v for k, v in metrics.items() if v.ndim == 0})
        summary.update({"update": self.updates, "env_steps": self.env_steps})
        return summary, trace.finish(
            batch=batch, frames=self.last_frames, architecture=self.architecture()
        ) if trace else None

    def collect_sac(self, count):
        frames = []
        for _ in range(count):
            obs = self.obs.clone()
            if self.env_steps < self.config.sac.warmup_steps:
                action = tensor(self.sample_rng.uniform(-1, 1, 3)) * self.scale
            else:
                action = self.act(obs)[0][0]
            next_obs, reward, terminated, truncated, frame = self.transition(action.numpy())
            index = self.replay_pointer
            row = {
                "obs": obs,
                "action": action,
                "next_obs": next_obs,
                "reward": reward,
                "terminated": terminated,
                "truncated": truncated,
                "sample_id": self.env_steps,
            }
            for key in self.replay:
                self.replay[key][index] = torch.as_tensor(row[key])
            self.replay_physics["before"][index] = tensor(pack_frame(frame["before"]))
            self.replay_physics["after"][index] = tensor(pack_frame(frame["after"]))
            self.replay_physics["reward_parts"][index] = tensor(
                [frame["reward_parts"][key] for key in ("distance", "control", "action_change")]
            )
            self.replay_pointer = (index + 1) % self.config.sac.replay_capacity
            self.replay_size = min(self.replay_size + 1, self.config.sac.replay_capacity)
            frames.append(frame)
        self.last_frames = frames
        return frames

    def sample_replay(self):
        size = self.config.sac.batch_size
        if self.replay_size < size:
            raise ValueError("Insufficient replay entries")
        indices = self.sample_rng.integers(0, self.replay_size, size)
        batch = {key: value[indices].clone() for key, value in self.replay.items()}
        batch.update(
            {
                "indices": torch.tensor(indices, dtype=torch.int64),
                "next_noise": self.noise(size),
                "actor_noise": self.noise(size),
            }
        )
        self.last_batch = batch
        self.last_frames = []
        for index in indices:
            self.last_frames.append(
                {
                    "sample_id": int(self.replay["sample_id"][index]),
                    "before": unpack_frame(self.replay_physics["before"][index].tolist()),
                    "after": unpack_frame(self.replay_physics["after"][index].tolist()),
                    "reward_parts": dict(
                        zip(
                            ("distance", "control", "action_change"),
                            self.replay_physics["reward_parts"][index].tolist(),
                        )
                    ),
                    "reward": float(self.replay["reward"][index]),
                    "terminated": bool(self.replay["terminated"][index]),
                    "truncated": bool(self.replay["truncated"][index]),
                }
            )
        return batch

    def sac_actor_objective(self, batch, trace=None, detach_q=False):
        mu, logstd = self.models["actor"].distribution(
            self.encode_observation(batch["obs"], trace, "actor_input"), trace
        )
        action, logp, latent = sample_policy(mu, logstd, batch["actor_noise"], self.scale)
        trace_policy_operation(
            trace,
            "sac_reparameterized_action",
            mu,
            logstd,
            latent,
            logp,
            self.scale,
            action,
            batch["actor_noise"],
        )
        inputs = torch.cat(
            [self.encode_observation(batch["obs"], trace, "actor_critic_input"), action], -1
        )
        q1 = self.models["q1"](inputs, trace, "q1_actor_path").squeeze(-1)
        q2 = self.models["q2"](inputs, trace, "q2_actor_path").squeeze(-1)
        minimum = torch.minimum(q1, q2)
        losses = self.log_alpha.exp().detach() * logp - (minimum.detach() if detach_q else minimum)
        return losses, {"logp": logp, "latent": latent, "action": action, "q1": q1, "q2": q2}

    def update_sac(self, batch=None, record=False):
        cfg = self.config.sac
        batch = self.sample_replay() if batch is None else batch
        self.last_batch = batch
        if record:
            self.check_trace_budget(len(batch["obs"]))
        self.updates += 1
        trace = Trace("sac", self.updates) if record else None
        with torch.no_grad():
            mu, logstd = self.models["actor"].distribution(
                self.encode_observation(batch["next_obs"])
            )
            next_a, next_logp, _ = sample_policy(mu, logstd, batch["next_noise"], self.scale)
            target_inputs = torch.cat([self.encode_observation(batch["next_obs"]), next_a], -1)
            tq1 = self.models["target_q1"](target_inputs).squeeze(-1)
            tq2 = self.models["target_q2"](target_inputs).squeeze(-1)
            target = sac_target(
                batch["reward"],
                batch["terminated"],
                tq1,
                tq2,
                next_logp,
                self.log_alpha.exp(),
                cfg.gamma,
            )
        inputs = torch.cat(
            [self.encode_observation(batch["obs"], trace, "replay_critic_input"), batch["action"]],
            -1,
        )
        critic_losses = []
        for name in ("q1", "q2"):
            self.optimizers[name].zero_grad()
            q = self.models[name](inputs, trace, name).squeeze(-1)
            loss = 0.5 * (q - target) ** 2
            critic_losses.append(loss)
            if trace is not None:
                trace.add(
                    "objective",
                    name,
                    prediction=q,
                    detached_target=target,
                    loss=loss,
                    target_q1=tq1,
                    target_q2=tq2,
                    next_logp=next_logp,
                    next_action=next_a,
                    target_requires_grad=target.requires_grad,
                )
                trace.sample_gradients(name, loss, dict(self.models[name].named_parameters()))
        (critic_losses[0].mean() + critic_losses[1].mean()).backward()
        if trace is not None:
            trace.flush_layers()
        for name in ("q1", "q2"):
            self.optimizers[name].step(trace, name)
            self.optimizers[name].zero_grad()
            self.models[name].requires_grad_(False)
        self.optimizers["actor"].zero_grad()
        try:
            actor_losses, actor_info = self.sac_actor_objective(batch, trace)
            if trace is not None:
                trace.add(
                    "objective",
                    "actor",
                    **actor_info,
                    loss=actor_losses,
                    alpha=self.log_alpha.exp(),
                    critics="parameters frozen; action differentiation retained",
                    critic_version="after_current_critic_step",
                )
                trace.sample_gradients(
                    "actor", actor_losses, dict(self.models["actor"].named_parameters())
                )
            actor_losses.mean().backward()
            if trace is not None:
                trace.flush_layers()
            self.optimizers["actor"].step(trace, "actor")
        finally:
            for name in ("q1", "q2"):
                self.models[name].requires_grad_(True)
        target_entropy = -3.0 if cfg.target_entropy is None else cfg.target_entropy
        alpha_losses = -self.log_alpha * (actor_info["logp"].detach() + target_entropy)
        self.optimizers["alpha"].zero_grad()
        if trace is not None:
            trace.add(
                "objective",
                "alpha",
                loss=alpha_losses,
                target_entropy=target_entropy,
                entropy_estimate=-actor_info["logp"].detach(),
                alpha_before=self.log_alpha.exp(),
            )
            trace.sample_gradients("alpha", alpha_losses, {"log_alpha": self.log_alpha})
        alpha_losses.mean().backward()
        self.optimizers["alpha"].step(trace, "alpha")
        with torch.no_grad():
            for name in ("q1", "q2"):
                pairs = zip(
                    self.models[name].named_parameters(), self.models[f"target_{name}"].parameters()
                )
                for (parameter_name, online), target_parameter in pairs:
                    before = target_parameter.clone()
                    target_parameter.mul_(1 - cfg.tau).add_(online, alpha=cfg.tau)
                    if trace is not None:
                        trace.add(
                            "target_update",
                            f"target_{name}/{parameter_name}",
                            before=before,
                            online=online,
                            after=target_parameter,
                            tau=cfg.tau,
                        )
        summary = plain(
            {
                "q1_loss": critic_losses[0].mean(),
                "q2_loss": critic_losses[1].mean(),
                "actor_loss": actor_losses.mean(),
                "alpha": self.log_alpha.exp(),
                "entropy_mc": -actor_info["logp"].mean(),
            }
        )
        summary.update({"update": self.updates, "env_steps": self.env_steps})
        return summary, trace.finish(
            batch=batch, frames=self.last_frames, architecture=self.architecture()
        ) if trace else None

    def iteration(self, record=False):
        self.trace_origin_state = None
        self.trace_result_state = None
        if self.config.algorithm == "ppo":
            rollout = self.collect_ppo()
            outputs = []
            for epoch in range(self.config.ppo.epochs):
                permutation = torch.randperm(len(rollout["obs"]), generator=self.rng)
                for start in range(0, len(permutation), self.config.ppo.minibatch_size):
                    selected = permutation[start : start + self.config.ppo.minibatch_size]
                    batch = self.select_ppo_batch(selected)
                    first_trace = record and not outputs
                    if first_trace:
                        self.trace_origin_state = self.state()
                    summary, trace = self.update_ppo(batch, record=first_trace)
                    summary.update({"epoch": epoch, "minibatch_size": len(selected)})
                    outputs.append((summary, trace))
                    if first_trace:
                        trace.update(
                            {
                                "epoch": epoch,
                                "rollout_size": len(rollout["obs"]),
                                "rollout_indices": selected.tolist(),
                            }
                        )
                        self.trace_result_state = self.state()
                    # KL stopping evaluates the full rollout AFTER the actual minibatch update.
                    with torch.no_grad():
                        post = self.ppo_objective(rollout)[2]
                    summary["post_update_kl"] = float(post["kl_approx"])
                    if summary["post_update_kl"] > self.config.ppo.target_kl:
                        return outputs
            return outputs
        need = max(
            self.config.sac.warmup_steps - self.env_steps,
            self.config.sac.batch_size - self.replay_size,
            1,
        )
        self.collect_sac(need)
        outputs = []
        for replay_update in range(self.config.sac.updates_per_step):
            batch = self.sample_replay()
            first_trace = record and replay_update == 0
            if first_trace:
                self.trace_origin_state = self.state()
            summary, trace = self.update_sac(batch, record=first_trace)
            summary["replay_update_index"] = replay_update
            outputs.append((summary, trace))
            if first_trace:
                self.trace_result_state = self.state()
        return outputs

    def architecture(self):
        return {
            name: {
                "sizes": model.sizes,
                "activation": model.activation,
                "parameters": {n: list(p.shape) for n, p in model.named_parameters()},
            }
            for name, model in self.models.items()
        }

    def state(self):
        return {
            "schema": "policyglass.learner.v1",
            "config": self.config.model_dump(),
            "observation_normalization": {
                "mean": self.observation_mean.clone(),
                "scale": self.observation_scale.clone(),
                "kind": "fixed_physical_units_v1",
            },
            "models": {
                name: {k: v.detach().clone() for k, v in model.state_dict().items()}
                for name, model in self.models.items()
            },
            "optimizers": {name: opt.state() for name, opt in self.optimizers.items()},
            "log_alpha": self.log_alpha.detach().clone() if hasattr(self, "log_alpha") else None,
            "torch_rng": self.rng.get_state(),
            "sample_rng": copy.deepcopy(self.sample_rng.bit_generator.state),
            "environment": self.env.snapshot(),
            "obs": self.obs.clone(),
            "replay": {k: v.clone() for k, v in self.replay.items()},
            "replay_physics": {k: v.clone() for k, v in self.replay_physics.items()},
            "replay_size": self.replay_size,
            "replay_pointer": self.replay_pointer,
            "env_steps": self.env_steps,
            "updates": self.updates,
            "last_batch": copy.deepcopy(self.last_batch),
            "last_frames": copy.deepcopy(self.last_frames),
            "rollout": copy.deepcopy(self.rollout),
            "rollout_frames": copy.deepcopy(self.rollout_frames),
            "last_batch_indices": copy.deepcopy(self.last_batch_indices),
        }

    @classmethod
    def from_state(cls, state):
        if state.get("schema") != "policyglass.learner.v1":
            raise ValueError("Unsupported learner schema")
        result = cls(validate_state(state))
        normalization = state["observation_normalization"]
        if (
            normalization["kind"] != "fixed_physical_units_v1"
            or not torch.equal(normalization["mean"], result.observation_mean)
            or not torch.equal(normalization["scale"], result.observation_scale)
        ):
            raise ValueError("Unsupported observation normalization")
        if set(result.models) != set(state["models"]):
            raise ValueError("Model names mismatch")
        for name, model in result.models.items():
            for key, expected in model.state_dict().items():
                supplied = state["models"][name].get(key)
                if (
                    supplied is None
                    or supplied.shape != expected.shape
                    or supplied.dtype != expected.dtype
                    or not torch.isfinite(supplied).all()
                ):
                    raise ValueError("Invalid model tensor")
            model.load_state_dict(state["models"][name], strict=True)
        for name, opt in result.optimizers.items():
            opt.load(state["optimizers"][name])
        if hasattr(result, "log_alpha"):
            with torch.no_grad():
                result.log_alpha.copy_(state["log_alpha"])
        result.rng.set_state(state["torch_rng"])
        result.sample_rng.bit_generator.state = copy.deepcopy(state["sample_rng"])
        result.env.restore(state["environment"])
        result.obs = state["obs"].clone()
        if not torch.allclose(result.obs, tensor(result.env.observation()), atol=1e-12, rtol=1e-12):
            raise ValueError("Observation does not match physical checkpoint")
        for key, expected in result.replay.items():
            supplied = state["replay"][key]
            if (
                supplied.shape != expected.shape
                or supplied.dtype != expected.dtype
                or not torch.isfinite(supplied).all()
            ):
                raise ValueError("Invalid replay shape or values")
            expected.copy_(supplied)
        for name in (
            "replay_size",
            "replay_pointer",
            "env_steps",
            "updates",
            "last_batch",
            "last_frames",
            "rollout",
            "rollout_frames",
            "last_batch_indices",
        ):
            setattr(result, name, copy.deepcopy(state[name]))
        for key, expected in result.replay_physics.items():
            supplied = state["replay_physics"][key]
            if (
                supplied.shape != expected.shape
                or supplied.dtype != expected.dtype
                or not torch.isfinite(supplied).all()
            ):
                raise ValueError("Invalid replay physical provenance")
            expected.copy_(supplied)
        return result
