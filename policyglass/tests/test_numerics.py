import math

import numpy as np
import pytest
import torch

from policyglass.networks import MLP
from policyglass.numerics import (
    gae,
    ppo_terms,
    sample_policy,
    squash_log_probability,
    tensor,
)
from policyglass.optimizer import Adam
from policyglass.trace import Trace


@pytest.mark.scientific
def test_forward_and_chain_rule_against_numpy():
    model = MLP([2, 3, 1], torch.Generator().manual_seed(2))
    x = tensor([[0.2, -0.3], [0.7, 0.1]])
    y = tensor([[0.6], [-0.1]])
    weights = [p.detach().numpy().copy() for p in model.weights]
    biases = [p.detach().numpy().copy() for p in model.biases]
    hidden = np.tanh(x.numpy() @ weights[0].T + biases[0])
    prediction = hidden @ weights[1].T + biases[1]
    dout = (prediction - y.numpy()) / len(x)
    expected_w1 = dout.T @ hidden
    dhidden = (dout @ weights[1]) * (1 - hidden**2)
    expected_w0 = dhidden.T @ x.numpy()
    trace = Trace("unit", 1)
    output = model(x, trace)
    losses = (0.5 * (output - y) ** 2).squeeze(-1)
    trace.sample_gradients("network", losses, dict(model.named_parameters()))
    losses.mean().backward()
    trace.flush_layers()
    np.testing.assert_allclose(output.detach(), prediction, atol=1e-14)
    np.testing.assert_allclose(model.weights[0].grad, expected_w0, atol=1e-14)
    np.testing.assert_allclose(model.weights[1].grad, expected_w1, atol=1e-14)
    event = next(e for e in trace.events if e["kind"] == "sample_gradients")
    for name, parameter in model.named_parameters():
        np.testing.assert_allclose(
            np.sum(event["contributions"][name], axis=0), parameter.grad, atol=1e-14
        )
    layers = [e for e in trace.events if e["kind"] == "layer"]
    np.testing.assert_allclose(layers[0]["preactivation_gradient"], dhidden, atol=1e-14)
    np.testing.assert_allclose(layers[1]["preactivation_gradient"], dout, atol=1e-14)


@pytest.mark.scientific
@pytest.mark.parametrize(
    "advantage,ratio,expected_gradient", [(1, 1.4, 0), (-1, 0.6, 0), (1, 0.8, -0.8), (-1, 1.4, 1.4)]
)
def test_ppo_branch_derivative(advantage, ratio, expected_gradient):
    logp = tensor([math.log(ratio)]).requires_grad_(True)
    loss, _, _, _ = ppo_terms(logp, tensor([0]), tensor([advantage]), 0.2)
    loss.sum().backward()
    assert float(logp.grad[0]) == pytest.approx(expected_gradient)


@pytest.mark.scientific
def test_gae_truncation_bootstraps_but_breaks_recursion():
    reward, value, next_value = tensor([1, 2, 3]), tensor([0.4, 0.5, 0.6]), tensor([0.5, 8, 0.7])
    terminated = torch.tensor([False, False, True])
    boundary = torch.tensor([False, True, True])
    advantage, returns, delta = gae(reward, value, next_value, terminated, boundary, 0.9, 0.8)
    expected_delta = np.array([1 + 0.9 * 0.5 - 0.4, 2 + 0.9 * 8 - 0.5, 3 - 0.6])
    expected = expected_delta.copy()
    expected[0] += 0.9 * 0.8 * expected[1]
    np.testing.assert_allclose(delta, expected_delta, atol=1e-14)
    np.testing.assert_allclose(advantage, expected, atol=1e-14)
    np.testing.assert_allclose(returns, expected + value.numpy(), atol=1e-14)


@pytest.mark.scientific
def test_squashed_density_and_reparameterized_gradient():
    mu, logstd = (
        tensor([[0.2, -0.1]]).requires_grad_(True),
        tensor([[-0.5, 0.3]]).requires_grad_(True),
    )
    noise, scale = tensor([[0.7, -1.2]]), tensor([2, 3])
    action, logp, latent = sample_policy(mu, logstd, noise, scale)
    normal = torch.distributions.Normal(mu, logstd.exp())
    independent = (
        normal.log_prob(latent) - torch.log(1 - torch.tanh(latent) ** 2) - scale.log()
    ).sum(-1)
    torch.testing.assert_close(logp, independent, atol=1e-13, rtol=1e-13)
    objective = logp.sum() + 0.3 * (action**2).sum()
    grad_mu, grad_std = torch.autograd.grad(objective, (mu, logstd))
    for variable, expected in ((mu, grad_mu), (logstd, grad_std)):
        for index in range(2):
            before = float(variable[0, index].detach())
            vals = []
            for sign in (-1, 1):
                with torch.no_grad():
                    variable[0, index] = before + sign * 1e-6
                    a, lp, _ = sample_policy(mu, logstd, noise, scale)
                    vals.append(float(lp.sum() + 0.3 * (a**2).sum()))
            with torch.no_grad():
                variable[0, index] = before
            assert (vals[1] - vals[0]) / 2e-6 == pytest.approx(float(expected[0, index]), abs=1e-8)


def test_extreme_latent_density_is_finite():
    result = squash_log_probability(
        tensor([[0, 0]]), tensor([[0, 0]]), tensor([[30, -30]]), tensor([1, 1])
    )
    assert torch.isfinite(result).all()


@pytest.mark.scientific
def test_adam_matches_independent_torch_optimizer_and_zero_gradient_momentum():
    p = torch.nn.Parameter(tensor([0.2, -0.4]))
    q = torch.nn.Parameter(p.detach().clone())
    ours = Adam({"w": p}, 0.003, max_norm=0.5)
    reference = torch.optim.Adam([q], lr=0.003, eps=1e-8, foreach=False)
    for gradient in ([0.8, -0.7], [0.1, 0.2], [0, 0]):
        p.grad = tensor(gradient)
        q.grad = tensor(gradient)
        torch.nn.utils.clip_grad_norm_([q], 0.5)
        before = p.detach().clone()
        ours.step()
        reference.step()
        torch.testing.assert_close(p, q, atol=1e-14, rtol=1e-14)
    assert not torch.equal(before, p)  # actual zero gradient can still produce a momentum update
