"""Native Yee-grid flux monitors; independent of display interpolation.

Surface coordinates are grid nodes. Tangential E is already on the surface;
tangential H is averaged from the two neighboring staggered faces. The
transverse node coordinate has trapezoidal endpoint weights. This is the
discrete Poynting flux associated with the centered curl operator.
"""

from __future__ import annotations

import numpy as np

from .geometry import physical_bounds
from .solver import Z0, MaxwellSystem, _split


def native_box_power(system: MaxwellSystem, electric: np.ndarray, bounds_um: np.ndarray) -> dict:
    """Power on a grid-aligned closed box wholly within the physical domain.

    Requires one neighboring cell on each side of its boundary. Source work
    and dielectric absorption use the same dual-volume quadrature as flux.
    No mode normalization or efficiency is inferred from this identity.
    """
    grid = system.grid
    bounds = np.asarray(bounds_um, dtype=float)
    if bounds.shape != (3, 2) or not np.isfinite(bounds).all():
        raise ValueError("bounds must be a finite 3 by 2 array")
    physical = physical_bounds(system.spec)
    if np.any(bounds[:, 0] <= physical[:, 0] + 1e-10) or np.any(
        bounds[:, 1] >= physical[:, 1] - 1e-10
    ):
        raise ValueError("power box must be strictly inside physical domain, outside PML")
    if electric.shape != (grid.n_edges,) or not np.isfinite(electric).all():
        raise ValueError("invalid native electric field")
    indices = []
    for axis, (lo, hi) in zip(grid.axes, bounds):
        i, j = int(np.argmin(abs(axis - lo))), int(np.argmin(abs(axis - hi)))
        if i < 1 or j >= len(axis) - 1 or i >= j:
            raise ValueError("box needs increasing node bounds and a neighboring cell")
        if not np.allclose(axis[[i, j]], [lo, hi], rtol=0, atol=1e-10):
            raise ValueError("power box bounds must coincide with native grid nodes")
        indices.append((i, j))
    k0 = 2 * np.pi / system.spec.wavelength_um
    magnetic = system.mu_inverse_faces * (grid.curl @ electric) / (1j * k0 * Z0)
    es = _split(electric, grid.edge_shapes)
    hs = _split(magnetic, grid.face_shapes)
    fluxes = []
    for normal in range(3):
        first, second = (normal + 1) % 3, (normal + 2) % 3
        for sign, plane in [(-1, indices[normal][0]), (1, indices[normal][1])]:
            integral = 0.0
            for ec, hc, cross_sign in [(first, second, 1), (second, first, -1)]:
                slices = []
                weights = 1
                for d, (lo, hi) in enumerate(indices):
                    if d == normal:
                        slices.append(plane)
                    elif d == ec:
                        slices.append(slice(lo, hi))
                    else:
                        slices.append(slice(lo, hi + 1))
                        w = np.ones(hi - lo + 1)
                        w[[0, -1]] = 0.5
                        shape = [1, 1]
                        shape[[a for a in range(3) if a != normal].index(d)] = len(w)
                        weights = w.reshape(shape)
                before, after = list(slices), list(slices)
                before[normal], after[normal] = plane - 1, plane
                h = (hs[hc][tuple(before)] + hs[hc][tuple(after)]) / 2
                e = es[ec][tuple(slices)]
                integral += cross_sign * float(np.real(np.sum(weights * e * h.conj())))
            area = float(np.prod(np.delete(grid.spacing, normal))) * 1e-12
            fluxes.append(
                {
                    "axis": "xyz"[normal],
                    "normal_sign": sign,
                    "coordinate_um": float(grid.axes[normal][plane]),
                    "outward_power_w": sign * 0.5 * integral * area,
                }
            )
    edge_weights = []
    for component, shape in enumerate(grid.edge_shapes):
        w = np.ones(shape)
        for d, (lo, hi) in enumerate(indices):
            one = np.zeros(shape[d])
            one[lo : hi + (d != component)] = 1
            if d != component:
                one[[lo, hi]] = 0.5
            dims = [1, 1, 1]
            dims[d] = len(one)
            w *= one.reshape(dims)
        edge_weights.append(w.ravel())
    weights = np.concatenate(edge_weights)
    dv = float(np.prod(grid.spacing)) * 1e-12
    current = system.current_edges
    supplied = (
        None
        if current is None
        else float(-0.5 / Z0 * np.real(np.vdot(current, weights * electric)) * dv)
    )
    absorbed = float(
        0.5 * k0 / Z0 * np.sum(weights * system.epsilon_edges.imag * abs(electric) ** 2) * dv
    )
    outward = sum(p["outward_power_w"] for p in fluxes)
    return {
        "method": "native_staggered_dual_volume",
        "bounds_um": bounds.tolist(),
        "planes": fluxes,
        "outward_power_w": outward,
        "absorbed_power_w": absorbed,
        "source_power_w": supplied,
        "relative_balance_error": None
        if not supplied
        else abs(outward + absorbed - supplied) / abs(supplied),
    }
