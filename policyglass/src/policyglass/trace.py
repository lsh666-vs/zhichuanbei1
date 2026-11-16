"""Record actual tensors without changing their arithmetic or update order."""

from dataclasses import dataclass, field

import torch


def plain(value):
    if isinstance(value, torch.Tensor):
        if not torch.isfinite(value).all():
            raise FloatingPointError("Non-finite numerical result")
        return value.detach().cpu().tolist()
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    return value


@dataclass
class Trace:
    algorithm: str
    update: int
    events: list = field(default_factory=list)
    pending: list = field(default_factory=list, repr=False)

    def add(self, kind, label, **data):
        event = {
            "id": f"u{self.update}/e{len(self.events)}",
            "kind": kind,
            "label": label,
            **plain(data),
        }
        self.events.append(event)
        return event["id"]

    def watch_layer(self, label, x, z, h, weight, bias, activation):
        for t in (x, z, h):
            if t.requires_grad:
                t.retain_grad()
        self.pending.append(
            (label, x, z, h, weight.detach().clone(), bias.detach().clone(), activation)
        )

    def flush_layers(self):
        for label, x, z, h, weight, bias, activation in self.pending:
            local = torch.ones_like(z)
            if activation == "tanh":
                local = 1 - h.detach() ** 2
            elif activation == "relu":
                local = (z.detach() > 0).to(z.dtype)
            self.add(
                "layer",
                label,
                input=x,
                preactivation=z,
                output=h,
                weight=weight,
                bias=bias,
                activation=activation,
                local_derivative=local,
                input_gradient=x.grad,
                preactivation_gradient=z.grad,
                output_gradient=h.grad,
            )
        self.pending.clear()

    def sample_gradients(self, label, losses, parameters):
        """The supplied vector is the exact loss contribution BEFORE batch mean."""
        names, params = zip(*parameters.items())
        collected = {name: [] for name in names}
        for loss in losses:
            grads = torch.autograd.grad(
                loss / len(losses), params, retain_graph=True, allow_unused=True
            )
            for name, parameter, gradient in zip(names, params, grads):
                collected[name].append(
                    torch.zeros_like(parameter) if gradient is None else gradient.detach()
                )
        self.add(
            "sample_gradients",
            label,
            contributions={name: torch.stack(values) for name, values in collected.items()},
            reduction="sum of these contributions equals raw batch gradient",
        )
        # retain_grad hooks also run during autograd.grad; only the subsequent actual
        # batch backward belongs in the displayed activation gradients.
        for _, x, z, h, *_ in self.pending:
            for node in (x, z, h):
                node.grad = None

    def finish(self, **metadata):
        if self.pending:
            raise RuntimeError("Unflushed layer trace")
        return {
            "schema": "policyglass.trace.v1",
            "algorithm": self.algorithm,
            "update": self.update,
            "mode": "actual_computation",
            **plain(metadata),
            "events": self.events,
        }
