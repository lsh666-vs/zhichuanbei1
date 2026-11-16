import numpy as np
import pytest
import torch

from policyglass.agents import Learner
from policyglass.numerics import squash_log_probability, tensor


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_probability_operation_partials_and_actual_action_gradients(small_config, algorithm):
    small_config.algorithm = algorithm
    learner = Learner(small_config)
    outputs = learner.iteration(record=True)
    trace = next(t for _, t in outputs if t is not None)
    operations = [event for event in trace["events"] if event["kind"] == "policy_operation"]
    for event in operations:
        values = event["values"]
        mu = tensor(values["mean"]).requires_grad_(True)
        logstd = tensor(values["logstd"]).requires_grad_(True)
        latent = tensor(values["latent"]).requires_grad_(True)
        lp = squash_log_probability(mu, logstd, latent, tensor(event["scale"]))
        derivatives = torch.autograd.grad(lp.sum(), (mu, logstd, latent))
        for name, derivative in zip(
            (
                "d_logp_d_mu_at_fixed_latent",
                "d_logp_d_logstd_at_fixed_latent",
                "d_logp_d_latent_at_fixed_distribution",
            ),
            derivatives,
        ):
            np.testing.assert_allclose(derivative, event["partial_derivatives"][name], atol=1e-13)
    if algorithm == "sac":
        event = next(e for e in operations if e["label"] == "sac_reparameterized_action")
        assert event["gradients"]["action"] is not None
        assert np.linalg.norm(event["gradients"]["action"]) > 0
