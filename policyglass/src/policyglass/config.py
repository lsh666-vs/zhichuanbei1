"""Strict, bounded configuration. No executable user expressions."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, validate_assignment=True)


class NetworkConfig(StrictModel):
    hidden: list[int] = Field(default_factory=lambda: [64, 64], min_length=1, max_length=3)
    activation: Literal["tanh", "relu"] = "tanh"

    @model_validator(mode="after")
    def bounded(self):
        if any(n < 2 or n > 128 for n in self.hidden):
            raise ValueError("Each hidden layer must have 2..128 units")
        return self


class EnvironmentConfig(StrictModel):
    horizon: int = Field(128, ge=8, le=2048)
    timestep: float = Field(0.01, ge=0.0005, le=0.02)
    substeps: int = Field(4, ge=1, le=20)
    damping: float = Field(0.15, ge=0, le=5)
    gravity: float = Field(9.81, ge=0, le=20)
    torque_limit: float = Field(2.0, gt=0, le=10)
    target: list[float] = Field(
        default_factory=lambda: [0.45, 0.12, 0.45], min_length=3, max_length=3
    )


class PPOConfig(StrictModel):
    learning_rate: float = Field(3e-4, gt=0, le=0.05)
    gamma: float = Field(0.99, ge=0, le=1)
    gae_lambda: float = Field(0.95, ge=0, le=1)
    clip_epsilon: float = Field(0.2, gt=0, le=1)
    value_coefficient: float = Field(0.5, ge=0, le=10)
    entropy_coefficient: float = Field(0.0, ge=0, le=1)
    max_gradient_norm: float = Field(0.5, gt=0, le=100)
    rollout_steps: int = Field(32, ge=2, le=512)
    epochs: int = Field(4, ge=1, le=20)
    target_kl: float = Field(0.03, gt=0, le=1)


class SACConfig(StrictModel):
    learning_rate: float = Field(3e-4, gt=0, le=0.05)
    gamma: float = Field(0.99, ge=0, le=1)
    tau: float = Field(0.005, gt=0, le=1)
    initial_alpha: float = Field(0.2, gt=0, le=10)
    target_entropy: float | None = Field(None, ge=-30, le=30)
    batch_size: int = Field(16, ge=2, le=128)
    replay_capacity: int = Field(4096, ge=128, le=100000)
    warmup_steps: int = Field(32, ge=2, le=10000)
    max_gradient_norm: float = Field(10, gt=0, le=100)


class ExperimentConfig(StrictModel):
    algorithm: Literal["ppo", "sac"] = "ppo"
    seed: int = Field(17, ge=0, le=2**31 - 1)
    network: NetworkConfig = Field(default_factory=NetworkConfig)
    environment: EnvironmentConfig = Field(default_factory=EnvironmentConfig)
    ppo: PPOConfig = Field(default_factory=PPOConfig)
    sac: SACConfig = Field(default_factory=SACConfig)


class Intervention(StrictModel):
    kind: Literal["hyperparameter", "parameter"]
    path: str = Field(min_length=1, max_length=100)
    value: float
    index: list[int] = Field(default_factory=list, max_length=2)
    reset_optimizer: bool = False
