"""Explicit Adam with the same formula as the real applied update."""

import math

import torch


class Adam:
    def __init__(self, parameters, lr, max_norm=10.0):
        self.parameters = dict(parameters)
        self.lr = lr
        self.max_norm = max_norm
        self.beta1, self.beta2, self.eps = 0.9, 0.999, 1e-8
        self.step_count = 0
        self.m = {n: torch.zeros_like(p) for n, p in self.parameters.items()}
        self.v = {n: torch.zeros_like(p) for n, p in self.parameters.items()}

    def zero_grad(self):
        for parameter in self.parameters.values():
            parameter.grad = None

    @torch.no_grad()
    def step(self, trace=None, label="adam"):
        active = {n: p for n, p in self.parameters.items() if p.grad is not None}
        if any(not torch.isfinite(p.grad).all() for p in active.values()):
            raise FloatingPointError("Non-finite gradient")
        norm = math.sqrt(sum(float((p.grad**2).sum()) for p in active.values()))
        factor = min(1.0, self.max_norm / (norm + 1e-6))
        self.step_count += 1
        t = self.step_count
        records = {}
        for name, parameter in active.items():
            raw = parameter.grad.detach().clone()
            gradient = raw * factor
            old_m, old_v = self.m[name].clone(), self.v[name].clone()
            self.m[name].mul_(self.beta1).add_(gradient, alpha=1 - self.beta1)
            self.v[name].mul_(self.beta2).addcmul_(gradient, gradient, value=1 - self.beta2)
            mhat = self.m[name] / (1 - self.beta1**t)
            vhat = self.v[name] / (1 - self.beta2**t)
            change = -self.lr * mhat / (vhat.sqrt() + self.eps)
            before = parameter.clone()
            parameter.add_(change)
            if trace is not None:
                records[name] = {
                    "before": before,
                    "raw_gradient": raw,
                    "gradient": gradient,
                    "moment_before": old_m,
                    "variance_before": old_v,
                    "moment": self.m[name],
                    "variance": self.v[name],
                    "corrected_moment": mhat,
                    "corrected_variance": vhat,
                    "delta": change,
                    "after": parameter.clone(),
                }
        if trace is not None:
            trace.add(
                "optimizer",
                label,
                step=t,
                lr=self.lr,
                beta1=self.beta1,
                beta2=self.beta2,
                epsilon=self.eps,
                gradient_norm=norm,
                clip_factor=factor,
                parameters=records,
            )

    def state(self):
        return {
            "step": self.step_count,
            "lr": self.lr,
            "max_norm": self.max_norm,
            "m": {n: x.clone() for n, x in self.m.items()},
            "v": {n: x.clone() for n, x in self.v.items()},
        }

    def load(self, state):
        self.step_count, self.lr, self.max_norm = state["step"], state["lr"], state["max_norm"]
        for slot in ("m", "v"):
            if set(state[slot]) != set(self.parameters):
                raise ValueError("Optimizer parameter names mismatch")
            for name, parameter in self.parameters.items():
                value = state[slot][name]
                if value.shape != parameter.shape or not torch.isfinite(value).all():
                    raise ValueError("Invalid optimizer tensor")
                getattr(self, slot)[name].copy_(value)
