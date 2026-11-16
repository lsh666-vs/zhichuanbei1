"""Original, staggered-grid three-dimensional frequency-domain Maxwell solver.

The oriented edge-to-face curl is a discrete de Rham operator. Tangential
electric edges on the exterior PEC boundary are eliminated. Open models use
an exterior diagonal complex-coordinate PML, not an unvalidated scalar sponge.
No empirical optical efficiency is invented for impressed-current excitation.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import scipy.sparse as sp
from scipy.interpolate import RegularGridInterpolator
from scipy.sparse.linalg import splu

from . import __version__
from .geometry import build_scene, epsilon_at, material_at, physical_bounds
from .models import ExperimentSpec

Z0 = 376.730313668


@dataclass
class YeeGrid:
    axes: tuple[np.ndarray, np.ndarray, np.ndarray]
    edge_shapes: tuple[tuple[int, int, int], ...]
    face_shapes: tuple[tuple[int, int, int], ...]
    edge_axes: tuple[tuple[np.ndarray, ...], ...]
    face_axes: tuple[tuple[np.ndarray, ...], ...]
    edge_points: np.ndarray
    face_points: np.ndarray
    free: np.ndarray
    curl: sp.csr_matrix

    @property
    def spacing(self) -> np.ndarray:
        return np.array([a[1] - a[0] for a in self.axes])

    @property
    def n_edges(self) -> int:
        return len(self.edge_points)


@dataclass
class MaxwellSystem:
    spec: ExperimentSpec
    grid: YeeGrid
    matrix: sp.csc_matrix
    rhs: np.ndarray
    epsilon_edges: np.ndarray
    mu_inverse_faces: np.ndarray
    exact_edges: np.ndarray | None
    current_edges: np.ndarray | None


def _points(axes: tuple[np.ndarray, ...]) -> np.ndarray:
    return np.stack(np.meshgrid(*axes, indexing="ij"), axis=-1).reshape(-1, 3)


def _ceil_cells(length: np.ndarray | float, spacing: np.ndarray | float) -> np.ndarray:
    # Do not create an extra cell when 0.6 / 0.2 rounds to 3.0000000000000004.
    return np.ceil(np.asarray(length) / spacing - 1e-12).astype(int)


def make_grid(spec: ExperimentSpec) -> YeeGrid:
    g = spec.geometry
    bounds = physical_bounds(spec)
    nc_physical = _ceil_cells(np.diff(bounds, axis=1).ravel(), spec.mesh.maxh_um)
    h_physical = np.diff(bounds, axis=1).ravel() / nc_physical
    padding = np.zeros(3, dtype=int)
    if g.kind != "manufactured_cavity":
        padding = _ceil_cells(g.pml_thickness_um, h_physical)
    nc = nc_physical + 2 * padding
    if np.any(nc < 2):
        raise ValueError("grid requires at least two cells along every axis")
    nx, ny, nz = map(int, nc)
    nfree = nx * (ny - 1) * (nz - 1) + (nx - 1) * ny * (nz - 1) + (nx - 1) * (ny - 1) * nz
    if nfree > spec.mesh.max_dofs:
        raise ValueError(f"actual Yee unknown count {nfree} exceeds max_dofs")
    # Keep physical cells and interface sampling identical when PML is doubled.
    # Padding is rounded up to whole cells and explicitly reported in results.
    axes = tuple(
        lo + np.arange(-pad, n + pad + 1) * h
        for (lo, _), n, pad, h in zip(bounds, nc_physical, padding, h_physical)
    )
    mid = tuple((a[1:] + a[:-1]) / 2 for a in axes)
    ea = ((mid[0], axes[1], axes[2]), (axes[0], mid[1], axes[2]), (axes[0], axes[1], mid[2]))
    fa = ((axes[0], mid[1], mid[2]), (mid[0], axes[1], mid[2]), (mid[0], mid[1], axes[2]))
    es = tuple(tuple(map(len, a)) for a in ea)
    fs = tuple(tuple(map(len, a)) for a in fa)
    offsets_e = np.cumsum([0] + [math.prod(s) for s in es])
    offsets_f = np.cumsum([0] + [math.prod(s) for s in fs])
    edge_ids = [np.arange(offsets_e[c], offsets_e[c + 1]).reshape(es[c]) for c in range(3)]
    rows, cols, vals = [], [], []
    h = np.array([a[1] - a[0] for a in axes])
    # curl_x = dy Ez - dz Ey; cyclic permutations for y,z.
    for c in range(3):
        first, second = (c + 1) % 3, (c + 2) % 3
        ids = np.arange(offsets_f[c], offsets_f[c + 1]).reshape(fs[c])
        for component, derivative, sign in [(second, first, 1), (first, second, -1)]:
            for shift, factor in [(0, -1), (1, 1)]:
                slices = [slice(None)] * 3
                slices[derivative] = slice(shift, fs[c][derivative] + shift)
                rows.append(ids.ravel())
                cols.append(edge_ids[component][tuple(slices)].ravel())
                vals.append(np.full(ids.size, sign * factor / h[derivative]))
    curl = sp.coo_matrix(
        (np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))),
        shape=(offsets_f[-1], offsets_e[-1]),
    ).tocsr()
    free_parts = []
    for c, shape in enumerate(es):
        mask = np.ones(shape, dtype=bool)
        for d in range(3):
            if c != d:
                sl = [slice(None)] * 3
                sl[d] = [0, shape[d] - 1]
                mask[tuple(sl)] = False
        free_parts.append(edge_ids[c][mask])
    free = np.concatenate(free_parts)
    return YeeGrid(
        axes,
        es,
        fs,
        ea,
        fa,
        np.concatenate([_points(a) for a in ea]),
        np.concatenate([_points(a) for a in fa]),
        free,
        curl,
    )


def _pml_diagonal(
    spec: ExperimentSpec, points: np.ndarray, component: int, inverse: bool = False
) -> np.ndarray:
    if spec.geometry.kind == "manufactured_cavity":
        return np.ones(len(points), dtype=complex)
    half = physical_bounds(spec)[:, 1]
    physical_cells = _ceil_cells(2 * half, spec.mesh.maxh_um)
    spacing = 2 * half / physical_cells
    thickness = _ceil_cells(spec.geometry.pml_thickness_um, spacing) * spacing
    depth = np.maximum(np.abs(points) - half, 0) / thickness
    # Integrates to 3 wavelengths of optical attenuation at the termination.
    k0 = 2 * np.pi / spec.wavelength_um
    strength = 12 / (k0 * thickness)
    stretch = 1 + 1j * strength * depth**3
    determinant = np.prod(stretch, axis=1)
    return (
        stretch[:, component] ** 2 / determinant
        if inverse
        else determinant / stretch[:, component] ** 2
    )


def assemble(spec: ExperimentSpec) -> MaxwellSystem:
    grid = make_grid(spec)
    k0 = 2 * np.pi / spec.wavelength_um
    eps_parts, mu_parts = [], []
    exact_parts, current_parts = [], []
    for c in range(3):
        ep, fp = _points(grid.edge_axes[c]), _points(grid.face_axes[c])
        eps_parts.append(epsilon_at(spec, ep) * _pml_diagonal(spec, ep, c))
        mu_parts.append(_pml_diagonal(spec, fp, c, inverse=True))
        exact = np.zeros(len(ep), dtype=complex)
        current = np.zeros(len(ep), dtype=complex)
        if spec.geometry.kind == "manufactured_cavity":
            if c == 1:
                g = spec.geometry
                exact = (
                    spec.excitation.amplitude
                    * np.sin(np.pi * (ep[:, 0] / g.length_um + 0.5))
                    * np.sin(np.pi * (ep[:, 2] / g.height_um + 0.5))
                )
        elif c == "xyz".index(spec.excitation.component):
            center = np.array(spec.excitation.center_um or (-spec.geometry.length_um / 4, 0, 0))
            sigma = spec.excitation.width_um
            if np.any(np.abs(center) + 3 * sigma >= physical_bounds(spec)[:, 1]):
                raise ValueError("compact source support (3 sigma) must fit in physical domain")
            radius2 = np.sum(((ep - center) / sigma) ** 2, axis=1)
            # C1 compact Gaussian window: source is exactly zero before PML.
            window = np.maximum(1 - radius2 / 9, 0) ** 2
            current = spec.excitation.amplitude * np.exp(-radius2 / 2) * window
        exact_parts.append(exact)
        current_parts.append(current)
    eps, muinv = np.concatenate(eps_parts), np.concatenate(mu_parts)
    cfree = grid.curl[:, grid.free]
    matrix = (cfree.T @ sp.diags(muinv) @ cfree - k0**2 * sp.diags(eps[grid.free])).tocsc()
    if spec.geometry.kind == "manufactured_cavity":
        g = spec.geometry
        eigen = (np.pi / g.length_um) ** 2 + (np.pi / g.height_um) ** 2
        denominator = eigen - k0**2 * g.core_index**2
        if abs(denominator) < 1e-6 * max(eigen, k0**2 * g.core_index**2):
            raise ValueError("analytic manufactured forcing degenerates at this cavity resonance")
        exact = np.concatenate(exact_parts)
        rhs = denominator * exact[grid.free]
        return MaxwellSystem(spec, grid, matrix, rhs, eps, muinv, exact, None)
    current = np.concatenate(current_parts)
    rhs = 1j * k0 * current[grid.free]
    if np.linalg.norm(rhs) == 0:
        raise ValueError("source is unresolved on this grid")
    return MaxwellSystem(spec, grid, matrix, rhs, eps, muinv, None, current)


def _split(values: np.ndarray, shapes: tuple[tuple[int, int, int], ...]) -> list[np.ndarray]:
    offset = 0
    result = []
    for shape in shapes:
        n = math.prod(shape)
        result.append(values[offset : offset + n].reshape(shape))
        offset += n
    return result


class NativeField:
    """Trilinear sampling of the original staggered samples, never GPU textures."""

    def __init__(self, spec: ExperimentSpec, grid: YeeGrid, electric: np.ndarray):
        self.spec, self.grid, self.electric = spec, grid, electric
        # Physical samples have mu_r=1, but interpolation at a physical/PML
        # interface can involve exterior faces. Faraday there uses the full
        # transformed permeability tensor, not free-space mu.
        muinv = np.concatenate(
            [_pml_diagonal(spec, _points(grid.face_axes[c]), c, inverse=True) for c in range(3)]
        )
        self.magnetic = (
            muinv * (grid.curl @ electric) / (1j * (2 * np.pi / spec.wavelength_um) * Z0)
        )
        self.evaluators_e = [
            RegularGridInterpolator(a, v, bounds_error=False, fill_value=None)
            for a, v in zip(grid.edge_axes, _split(electric, grid.edge_shapes))
        ]
        self.evaluators_h = [
            RegularGridInterpolator(a, v, bounds_error=False, fill_value=None)
            for a, v in zip(grid.face_axes, _split(self.magnetic, grid.face_shapes))
        ]

    def evaluate(self, points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        points = np.asarray(points, dtype=float).reshape(-1, 3)
        bounds = physical_bounds(self.spec)
        if (
            not np.all(np.isfinite(points))
            or np.any(points < bounds[:, 0] - 1e-10)
            or np.any(points > bounds[:, 1] + 1e-10)
        ):
            raise ValueError("field evaluation requires finite coordinates inside physical domain")
        e = np.column_stack([f(points) for f in self.evaluators_e])
        h = np.column_stack([f(points) for f in self.evaluators_h])
        return e, h


def _flux_planes(field: NativeField, resolution: int = 19) -> list[dict]:
    bounds = physical_bounds(field.spec)
    planes = []
    for axis in range(3):
        others = [d for d in range(3) if d != axis]
        lengths = bounds[others, 1] - bounds[others, 0]
        # Midpoint integration avoids grid-boundary ambiguity at PML interface.
        uv = [
            np.linspace(bounds[d, 0], bounds[d, 1], resolution, endpoint=False)
            + (bounds[d, 1] - bounds[d, 0]) / (2 * resolution)
            for d in others
        ]
        aa, bb = np.meshgrid(*uv, indexing="ij")
        for sign in [-1, 1]:
            p = np.zeros((resolution**2, 3))
            p[:, axis] = bounds[axis, 0 if sign == -1 else 1]
            p[:, others[0]], p[:, others[1]] = aa.ravel(), bb.ravel()
            e, h = field.evaluate(p)
            s = 0.5 * np.real(np.cross(e, np.conjugate(h)))
            watts = float(sign * np.mean(s[:, axis]) * np.prod(lengths) * 1e-12)
            planes.append(
                {
                    "axis": "xyz"[axis],
                    "normal_sign": sign,
                    "coordinate_um": float(p[0, axis]),
                    "outward_power_w": watts,
                    "quadrature": f"{resolution}x{resolution} midpoint on original-grid interpolant",
                }
            )
    return planes


def _write_json(path: Path, value: dict) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )


def solve(
    spec: ExperimentSpec,
    output_dir: str | Path,
    progress: Callable | None = None,
    cancelled: Callable | None = None,
) -> dict:
    """Solve and save a complete raw three-dimensional experiment result."""
    started = time.perf_counter()
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    def event(stage: str, fraction: float) -> None:
        if cancelled and cancelled():
            raise InterruptedError("calculation cancelled at safe boundary")
        if progress:
            progress(stage, fraction)

    event("assembling", 0.05)
    system = assemble(spec)
    event("factorizing", 0.2)
    lu = splu(system.matrix)
    event("solving", 0.55)
    free_solution = lu.solve(system.rhs)
    denominator = np.linalg.norm(system.rhs)
    residual = float(np.linalg.norm(system.matrix @ free_solution - system.rhs) / denominator)
    if not np.isfinite(residual) or residual > 1e-8:
        raise ArithmeticError(f"linear solve residual {residual} exceeds 1e-8")
    electric = np.zeros(system.grid.n_edges, dtype=complex)
    electric[system.grid.free] = free_solution
    field = NativeField(spec, system.grid, electric)
    metrics = {
        "relative_residual": residual,
        "unknowns": len(system.grid.free),
        "cells": [len(a) - 1 for a in system.grid.axes],
        "spacing_um": system.grid.spacing.tolist(),
    }
    if spec.geometry.kind != "manufactured_cavity":
        metrics["pml_actual_thickness_um_xyz"] = [
            float(-a[0] - b[1]) for a, b in zip(system.grid.axes, physical_bounds(spec))
        ]
        metrics["pml_requested_thickness_um"] = spec.geometry.pml_thickness_um
    if system.exact_edges is not None:
        metrics["relative_electric_l2_error"] = float(
            np.linalg.norm(electric - system.exact_edges) / np.linalg.norm(system.exact_edges)
        )
        g = spec.geometry
        discrete_eigen = sum(
            (2 * np.sin(np.pi * h / (2 * length)) / h) ** 2
            for h, length in [
                (system.grid.spacing[0], g.length_um),
                (system.grid.spacing[2], g.height_um),
            ]
        )
        eigen = (np.pi / g.length_um) ** 2 + (np.pi / g.height_um) ** 2
        k2eps = (2 * np.pi / spec.wavelength_um) ** 2 * g.core_index**2
        metrics["analytic_discrete_relative_error"] = float(
            abs((eigen - k2eps) / (discrete_eigen - k2eps) - 1)
        )
    event("sampling", 0.7)
    physical = physical_bounds(spec)
    # Stay on physical boundary; ghost half-cell extrapolation at PEC is noted.
    display_axes = tuple(
        np.linspace(lo, hi, n) for (lo, hi), n in zip(physical, spec.mesh.sample_shape)
    )
    points = _points(display_axes)
    e, h = field.evaluate(points)
    shape = tuple(spec.mesh.sample_shape) + (3,)
    s = 0.5 * np.real(np.cross(e, np.conjugate(h)))
    # HDF5 contains only data, no pickle/object payloads.
    import h5py

    with h5py.File(out / "fields.h5", "w") as hf:
        hf.attrs["schema_version"] = 1
        hf.attrs["axis_order"] = "x,y,z,component"
        hf.attrs["coordinate_units"] = "um"
        hf.attrs["spec_hash"] = spec.spec_hash
        hf.attrs["sampling"] = "trilinear original staggered Yee grid; not a new solve"
        for name, values in zip("xyz", display_axes):
            hf.create_dataset(f"axes/{name}_um", data=values)
        for name, values in [("E", e), ("H", h)]:
            hf.create_dataset(f"{name}/real", data=values.real.reshape(shape), compression="gzip")
            hf.create_dataset(f"{name}/imag", data=values.imag.reshape(shape), compression="gzip")
        hf.create_dataset("poynting_w_m2", data=s.reshape(shape), compression="gzip")
        hf.create_dataset(
            "material_id", data=material_at(spec, points).reshape(shape[:-1]), compression="gzip"
        )
    np.save(out / "coefficients.npy", electric, allow_pickle=False)
    np.savez_compressed(
        out / "grid.npz", x=system.grid.axes[0], y=system.grid.axes[1], z=system.grid.axes[2]
    )
    _write_json(out / "spec.json", spec.model_dump(mode="json"))
    scene = build_scene(spec)
    if "pml" in scene:
        scene["pml"]["actual_thickness_um_xyz"] = metrics["pml_actual_thickness_um_xyz"]
    _write_json(out / "scene.json", scene)
    event("integrating", 0.9)
    fluxes = _flux_planes(field)
    metrics["total_outward_power_w"] = sum(p["outward_power_w"] for p in fluxes)
    if system.current_edges is not None:
        dv = float(np.prod(system.grid.spacing))
        work = (
            -0.5
            * np.real(np.vdot(system.current_edges[system.grid.free], electric[system.grid.free]))
            / Z0
            * dv
            * 1e-12
        )
        metrics["source_supplied_power_w"] = float(work)
        metrics["surface_source_power_relative_mismatch"] = (
            float(abs(metrics["total_outward_power_w"] - work) / abs(work)) if work else None
        )
    normalization = (
        "manufactured_exact_field_amplitude_V_per_m"
        if system.exact_edges is not None
        else "arbitrary_compact_impressed_current_not_port_normalized"
    )
    result = {
        "schema_version": 1,
        "engine_version": __version__,
        "spec_hash": spec.spec_hash,
        "native_layout_version": 1,
        "model": "3d_vector_maxwell_staggered_yee_fdfd",
        "time_convention": "exp(-i*omega*t)",
        "normalization": normalization,
        "geometry_kind": spec.geometry.kind,
        "wavelength_um": spec.wavelength_um,
        "metrics": metrics,
        "flux_planes": fluxes,
        "field_units": {"E": "V/m", "H": "A/m", "poynting": "W/m^2", "coordinates": "um"},
        "validation": {
            "linear_residual_pass": residual <= 1e-8,
            "analytic_reference_available": system.exact_edges is not None,
            "port_calibration": "not_implemented_stage_2",
            "independent_3d_crosscheck": "pending",
        },
        "limitations": [
            "Second-order staggered grid; material interfaces are sampled without subpixel averaging.",
            "Probe interpolates original E edges and H faces; interfaces may mix adjacent material samples.",
            "Open-domain flux quadrature is approximate and requires mesh/PML convergence.",
            "No transmission efficiency or S parameters until source/port calibration is independently validated.",
        ],
        "elapsed_seconds": time.perf_counter() - started,
    }
    artifacts = []
    for name in ["coefficients.npy", "fields.h5", "grid.npz", "scene.json", "spec.json"]:
        p = out / name
        artifacts.append(
            {
                "name": p.name,
                "bytes": p.stat().st_size,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
        )
    result["artifacts"] = artifacts
    _write_json(out / "result.json", result)
    event("completed", 1)
    return result


def probe(output_dir: str | Path, xyz: tuple[float, float, float]) -> dict:
    out = Path(output_dir)
    spec = ExperimentSpec.model_validate_json((out / "spec.json").read_text(encoding="utf-8"))
    grid = make_grid(spec)
    manifest = json.loads((out / "result.json").read_text(encoding="utf-8"))
    if manifest.get("native_layout_version") != 1 or manifest.get("spec_hash") != spec.spec_hash:
        raise ValueError("stored native layout/spec version mismatch; recomputation required")
    with np.load(out / "grid.npz", allow_pickle=False) as saved:
        if set(saved.files) != {"x", "y", "z"} or any(
            saved[c].shape != a.shape or not np.array_equal(saved[c], a)
            for c, a in zip("xyz", grid.axes)
        ):
            raise ValueError("stored grid disagrees with native layout; recomputation required")
    electric = np.load(out / "coefficients.npy", allow_pickle=False)
    if electric.shape != (grid.n_edges,) or not np.isfinite(electric).all():
        raise ValueError("invalid stored native field")
    field = NativeField(spec, grid, electric)
    point = np.asarray(xyz, dtype=float)
    if point.shape != (3,):
        raise ValueError("probe requires three coordinates")
    e, h = field.evaluate(point)
    flux = 0.5 * np.real(np.cross(e[0], np.conjugate(h[0])))
    return {
        "position_um": point.tolist(),
        "spec_hash": spec.spec_hash,
        "material_id": int(material_at(spec, point)),
        "E": {"real": e[0].real.tolist(), "imag": e[0].imag.tolist(), "unit": "V/m"},
        "H": {"real": h[0].real.tolist(), "imag": h[0].imag.tolist(), "unit": "A/m"},
        "poynting_w_m2": flux.tolist(),
        "sampling": "trilinear interpolation of original staggered E edges and H faces; interface stencils can cross materials",
    }
