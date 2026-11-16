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
    transforms: list = field(default_factory=list, repr=False)
    operations: list = field(default_factory=list, repr=False)

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
        )
        self.pending.append((self.events[-1], x, z, h))

    def watch_transform(self, label, raw, normalized, mean, scale):
        raw.retain_grad()
        normalized.retain_grad()
        self.add(
            "observation_transform",
            label,
            raw=raw,
            normalized=normalized,
            mean=mean,
            scale=scale,
            derivative=1 / scale,
            statistics="fixed physical-unit scaling; no running estimates",
        )
        self.transforms.append((self.events[-1], raw, normalized))

    def flush_layers(self, backward=True):
        for event, x, z, h in self.pending:
            event.update(
                plain(
                    {
                        "input_gradient": x.grad,
                        "preactivation_gradient": z.grad,
                        "output_gradient": h.grad,
                    }
                )
            )
        for event, raw, normalized in self.transforms:
            event.update(plain({"raw_gradient": raw.grad, "normalized_gradient": normalized.grad}))
        for event, nodes in self.operations:
            event["gradients"] = plain(
                {name: node.grad if node.requires_grad else None for name, node in nodes.items()}
            )
        if backward:
            self.add(
                "backward",
                "actual_batch_backward",
                layer_events=[event["id"] for event, *_ in self.pending],
            )
        self.pending.clear()
        self.transforms.clear()
        self.operations.clear()

    def watch_operation(self, kind, label, nodes, **details):
        for node in nodes.values():
            if node.requires_grad:
                node.retain_grad()
        self.add(kind, label, values=nodes, **details)
        self.operations.append((self.events[-1], nodes))

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
        for _, x, z, h in self.pending:
            for node in (x, z, h):
                node.grad = None
        for _, raw, normalized in self.transforms:
            raw.grad = normalized.grad = None
        for _, nodes in self.operations:
            for node in nodes.values():
                if node.requires_grad:
                    node.grad = None

    def finish(self, **metadata):
        if self.pending or self.transforms or self.operations:
            raise RuntimeError("Unflushed layer trace")
        return {
            "schema": "policyglass.trace.v1",
            "algorithm": self.algorithm,
            "update": self.update,
            "mode": "actual_computation",
            **plain(metadata),
            "events": self.events,
        }
