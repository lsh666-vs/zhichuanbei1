"""Inspectable MLPs; architecture and displayed activations share this implementation."""

from itertools import pairwise

import torch
from torch import nn

from .numerics import DTYPE


class MLP(nn.Module):
    def __init__(self, sizes, generator, activation="tanh", output_gain=1.0):
        super().__init__()
        self.sizes = list(sizes)
        self.activation = activation
        self.weights = nn.ParameterList()
        self.biases = nn.ParameterList()
        for i, (n_in, n_out) in enumerate(pairwise(sizes)):
            w = torch.empty(n_out, n_in, dtype=DTYPE)
            nn.init.orthogonal_(
                w, gain=output_gain if i == len(sizes) - 2 else 2**0.5, generator=generator
            )
            self.weights.append(nn.Parameter(w))
            self.biases.append(nn.Parameter(torch.zeros(n_out, dtype=DTYPE)))

    def forward(self, x, trace=None, label="network"):
        if trace is not None and not x.requires_grad:
            x = x.detach().requires_grad_(True)
        for i, (weight, bias) in enumerate(zip(self.weights, self.biases)):
            z = x @ weight.T + bias
            activation = self.activation if i < len(self.weights) - 1 else "linear"
            h = z.tanh() if activation == "tanh" else (z.relu() if activation == "relu" else z)
            if trace is not None:
                trace.watch_layer(f"{label}/layer{i}", x, z, h, weight, bias, activation)
            x = h
        return x


class Policy(MLP):
    def __init__(self, observation_dim, action_dim, hidden, generator, activation="tanh"):
        super().__init__([observation_dim, *hidden, 2 * action_dim], generator, activation, 0.01)
        self.action_dim = action_dim
        with torch.no_grad():
            self.biases[-1][action_dim:] = -0.5

    def distribution(self, obs, trace=None, label="actor"):
        output = self(obs, trace, label)
        mu, raw_logstd = output.split(self.action_dim, dim=-1)
        logstd = raw_logstd.clamp(-5, 2)
        if trace is not None:
            trace.add(
                "distribution",
                label,
                mean=mu,
                raw_logstd=raw_logstd,
                logstd=logstd,
                clamp_derivative=((raw_logstd >= -5) & (raw_logstd <= 2)).to(output.dtype),
                nondifferentiable_boundary=(raw_logstd == -5) | (raw_logstd == 2),
                boundary_convention="PyTorch clamp uses gradient 1 at either endpoint; classical derivative is undefined there",
            )
        return mu, logstd
