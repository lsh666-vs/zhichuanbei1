"""Small numerical definitions shared by exact trace and training paths."""

import math

import torch
from torch.nn import functional as F

DTYPE = torch.float64


def tensor(value):
    return torch.as_tensor(value, dtype=DTYPE, device="cpu")


def squash_log_probability(mu, logstd, latent, scale):
    """Density in physical action units, using a stable exact tanh Jacobian."""
    normal = -0.5 * (((latent - mu) / logstd.exp()) ** 2 + 2 * logstd + math.log(2 * math.pi))
    log_jacobian = 2 * (math.log(2) - latent - F.softplus(-2 * latent))
    return (normal - log_jacobian - torch.log(scale)).sum(-1)


def sample_policy(mu, logstd, noise, scale):
    latent = mu + logstd.exp() * noise
    return latent.tanh() * scale, squash_log_probability(mu, logstd, latent, scale), latent


def ppo_terms(logp, old_logp, advantage, epsilon):
    ratio = (logp - old_logp.detach()).exp()
    clipped = ratio.clamp(1 - epsilon, 1 + epsilon)
    raw_term, clipped_term = ratio * advantage, clipped * advantage
    loss = -torch.minimum(raw_term, clipped_term)
    flat = ((advantage > 0) & (ratio > 1 + epsilon)) | ((advantage < 0) & (ratio < 1 - epsilon))
    return loss, ratio, clipped, flat


def trace_policy_operation(trace, label, mu, logstd, latent, logp, scale, action=None, noise=None):
    """Named partials hold the stated arguments fixed; total gradients are actual autograd values."""
    if trace is None:
        return
    sigma = logstd.exp()
    partials = {
        "d_logp_d_mu_at_fixed_latent": (latent - mu) / sigma**2,
        "d_logp_d_logstd_at_fixed_latent": ((latent - mu) / sigma) ** 2 - 1,
        "d_logp_d_latent_at_fixed_distribution": -(latent - mu) / sigma**2 + 2 * latent.tanh(),
        "d_action_d_latent": scale * (1 - latent.tanh() ** 2),
    }
    nodes = {"mean": mu, "logstd": logstd, "latent": latent, "logp": logp}
    if action is not None:
        nodes["action"] = action
    if noise is not None:
        partials["d_latent_d_logstd"] = sigma * noise
        partials["d_latent_d_mu"] = torch.ones_like(mu)
        nodes["noise"] = noise
    trace.watch_operation(
        "policy_operation",
        label,
        nodes,
        partial_derivatives=partials,
        scale=scale,
        latent_mode="reparameterized" if noise is not None else "fixed_behavior_latent",
        logp_units="density in physical torque units; includes action-scale Jacobian",
    )


def gae(reward, value, next_value, terminated, boundary, gamma, lam):
    """Bootstrap truncations, but never recurse across an episode reset."""
    delta = reward + gamma * (~terminated).to(DTYPE) * next_value - value
    advantage = torch.zeros_like(delta)
    running = torch.zeros((), dtype=DTYPE)
    for i in reversed(range(len(delta))):
        running = delta[i] + gamma * lam * (~boundary[i]).to(DTYPE) * running
        advantage[i] = running
    return advantage, advantage + value, delta


def sac_target(reward, terminated, next_q1, next_q2, next_logp, alpha, gamma):
    return (
        reward
        + gamma * (~terminated).to(DTYPE) * (torch.minimum(next_q1, next_q2) - alpha * next_logp)
    ).detach()
