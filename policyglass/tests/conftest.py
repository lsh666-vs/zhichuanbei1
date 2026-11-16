import pytest
import torch

from policyglass.config import ExperimentConfig


@pytest.fixture(autouse=True)
def cpu_reference():
    torch.set_num_threads(1)


@pytest.fixture
def small_config():
    return ExperimentConfig(
        network={"hidden": [4, 4]},
        ppo={"rollout_steps": 6, "epochs": 2},
        sac={"batch_size": 4, "warmup_steps": 6, "replay_capacity": 128},
        environment={"horizon": 8},
    )
