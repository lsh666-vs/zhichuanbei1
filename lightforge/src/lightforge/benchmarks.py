"""Reproducible scientific checks, separate from UI and optical design claims."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import splu

from .models import ExperimentSpec
from .solver import Z0, NativeField, _pml_diagonal, _points, _split, assemble, make_grid, solve


def open_modal_benchmark(thickness: float = 0.8, spacing: float = 0.1) -> dict:
    """3D PEC cross-section / open-x homogeneous modal line benchmark.

    The TE mode E_y=u(x) sin(pi(z+Lz/2)/Lz) is independent of y. We solve
    the full vector 3D system, while an independently derived infinite-grid
    Green function provides its reference, isolating PML reflection from
    ordinary Yee dispersion. Transverse PEC boundaries are intentional.
    """
    length, width, height, index, wavelength = 2.4, 0.6, 0.8, 1.44, 1.55
    settings = {
        "width_um": width,
        "height_um": height,
        "core_width_um": 0.3,
        "core_thickness_um": 0.2,
        "etch_depth_um": 0.2,
    }
    padded = ExperimentSpec.model_validate(
        {
            "geometry": {"length_um": length + 2 * thickness, **settings},
            "mesh": {"maxh_um": spacing},
        }
    )
    pml_spec = ExperimentSpec.model_validate(
        {
            "geometry": {
                "kind": "layered_waveguide",
                "length_um": length,
                "pml_thickness_um": thickness,
                **settings,
            },
            "mesh": {"maxh_um": spacing},
            "excitation": {"kind": "localized_current", "width_um": 0.05},
        }
    )
    grid = make_grid(padded)
    eps_parts, mu_parts = [], []
    for c in range(3):
        edge, face = _points(grid.edge_axes[c]), _points(grid.face_axes[c])
        edge[:, 1:] = 0
        face[:, 1:] = 0
        eps_parts.append(index**2 * _pml_diagonal(pml_spec, edge, c))
        mu_parts.append(_pml_diagonal(pml_spec, face, c, inverse=True))
    eps, muinv = np.concatenate(eps_parts), np.concatenate(mu_parts)
    k0 = 2 * np.pi / wavelength
    curl = grid.curl[:, grid.free]
    matrix = (curl.T @ sp.diags(muinv) @ curl - k0 * k0 * sp.diags(eps[grid.free])).tocsc()
    current_components = [np.zeros(shape) for shape in grid.edge_shapes]
    source_index = int(np.argmin(abs(grid.axes[0])))
    hz = grid.spacing[2]
    hx = grid.spacing[0]
    current_components[1][source_index, :, :] = (
        np.sin(np.pi * (grid.axes[2] / height + 0.5))[None, :] / hx
    )
    current = np.concatenate([a.ravel() for a in current_components])
    rhs = 1j * k0 * current[grid.free]
    electric = np.zeros(grid.n_edges, dtype=complex)
    electric[grid.free] = splu(matrix).solve(rhs)
    ey = _split(electric, grid.edge_shapes)[1]
    transverse_eigenvalue = (2 * np.sin(np.pi * hz / (2 * height)) / hz) ** 2
    beta2 = (k0 * index) ** 2 - transverse_eigenvalue
    theta = 2 * np.arcsin(hx * np.sqrt(beta2) / 2)
    amplitude = -k0 * hx / (2 * np.sin(theta))
    xnodes = grid.axes[0] - grid.axes[0][source_index]
    reference = amplitude * np.exp(1j * theta * np.abs(xnodes) / hx)
    mid_z = (len(grid.axes[2]) - 1) // 2
    profile_at_sample = np.sin(np.pi * (grid.axes[2][mid_z] / height + 0.5))
    measured = ey[:, ey.shape[1] // 2, mid_z] / profile_at_sample
    physical = np.abs(xnodes) < length / 2 - 0.05
    relative_error = float(
        np.linalg.norm(measured[physical] - reference[physical])
        / np.linalg.norm(reference[physical])
    )
    positive = (xnodes > 0.1) & (xnodes < length / 2 - 0.05)
    basis = np.column_stack(
        [np.exp(1j * theta * xnodes[positive] / hx), np.exp(-1j * theta * xnodes[positive] / hx)]
    )
    outgoing, incoming = np.linalg.lstsq(basis, measured[positive], rcond=None)[0]
    reflected_amplitude = float(abs(incoming / outgoing))
    supplied = float(
        -0.5
        * np.real(np.vdot(current[grid.free], electric[grid.free]))
        / Z0
        * np.prod(grid.spacing)
        * 1e-12
    )
    magnetic = muinv * (grid.curl @ electric) / (1j * k0 * Z0)
    hz_field = _split(magnetic, grid.face_shapes)[2]
    fluxes = []
    for sign in [-1, 1]:
        xf = (grid.axes[0][1:] + grid.axes[0][:-1]) / 2
        i = int(np.argmin(abs(xf - sign * 0.8)))
        flux = sign * 0.5 * np.real(np.sum((ey[i] + ey[i + 1]) / 2 * np.conjugate(hz_field[i])))
        fluxes.append(float(flux * grid.spacing[1] * grid.spacing[2] * 1e-12))
    return {
        "benchmark": "full_3d_yee_TE_mode_open_x_with_PEC_yz",
        "reference": "independently derived discrete infinite-guide Green function",
        "pml_thickness_um": thickness,
        "actual_spacing_um": grid.spacing.tolist(),
        "unknowns": len(grid.free),
        "relative_residual": float(
            np.linalg.norm(matrix @ electric[grid.free] - rhs) / np.linalg.norm(rhs)
        ),
        "relative_electric_reference_error": relative_error,
        "reflected_amplitude_ratio": reflected_amplitude,
        "source_power_w": supplied,
        "outward_plane_powers_w": fluxes,
        "source_flux_relative_mismatch": abs(sum(fluxes) - supplied) / abs(supplied),
    }


def validate_benchmarks(output_dir: str | Path) -> dict:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    cavity = []
    for n in [4, 8, 12]:
        spec = ExperimentSpec.model_validate(
            {
                "name": f"Manufactured PEC cube {n} cells per side",
                "geometry": {"length_um": 1.6, "width_um": 1.6, "height_um": 1.6},
                "mesh": {"maxh_um": 1.6 / n, "sample_shape": [9, 9, 9]},
            }
        )
        result = solve(spec, output / f"cavity-{n}")
        cavity.append(
            {
                "cells_per_axis": n,
                "spec_hash": spec.spec_hash,
                **result["metrics"],
                "elapsed_seconds": result["elapsed_seconds"],
            }
        )
    convergence_order = math.log(
        cavity[0]["relative_electric_l2_error"] / cavity[-1]["relative_electric_l2_error"]
    ) / math.log(3)
    open_models = []
    points = np.array([[0.6, 0, 0], [0.6, 0, 0.25], [0, 0.35, 0.2]])
    for thickness in [0.3, 0.6, 1.2]:
        spec = ExperimentSpec.model_validate(
            {
                "name": f"Open ridge PML thickness {thickness} um",
                "geometry": {
                    "kind": "layered_waveguide",
                    "length_um": 2.4,
                    "width_um": 1.2,
                    "height_um": 1.2,
                    "core_width_um": 0.5,
                    "core_thickness_um": 0.3,
                    "etch_depth_um": 0.3,
                    "pml_thickness_um": thickness,
                },
                "excitation": {"kind": "localized_current", "width_um": 0.12},
                "mesh": {"maxh_um": 0.2, "sample_shape": [13, 9, 9]},
            }
        )
        result = solve(spec, output / f"pml-{thickness}")
        system = assemble(spec)
        electric = np.load(output / f"pml-{thickness}" / "coefficients.npy", allow_pickle=False)
        e, _ = NativeField(spec, system.grid, electric).evaluate(points)
        open_models.append(
            {
                "pml_thickness_um": thickness,
                "spec_hash": spec.spec_hash,
                **result["metrics"],
                "elapsed_seconds": result["elapsed_seconds"],
                "probe_e_real": e.real.tolist(),
                "probe_e_imag": e.imag.tolist(),
            }
        )
    a, b, c = [np.array(m["probe_e_real"]) + 1j * np.array(m["probe_e_imag"]) for m in open_models]
    relative_changes = [
        float(np.linalg.norm(b - a) / np.linalg.norm(b)),
        float(np.linalg.norm(c - b) / np.linalg.norm(c)),
    ]
    modal = [open_modal_benchmark(d) for d in [0.4, 0.8, 1.6]]
    report = {
        "schema_version": 1,
        "purpose": "first-stage numerical verification, not a validated optical splitter",
        "manufactured_cavity": cavity,
        "measured_convergence_order": convergence_order,
        "manufactured_pass": bool(
            1.85 < convergence_order < 2.15
            and all(
                m["relative_residual"] < 1e-8
                and abs(m["relative_electric_l2_error"] - m["analytic_discrete_relative_error"])
                < 1e-9
                for m in cavity
            )
        ),
        "open_pml": open_models,
        "physical_probe_coordinates_um": points.tolist(),
        "pml_doubling_probe_relative_changes": relative_changes,
        "pml_converged_to_one_percent": bool(relative_changes[-1] < 0.01),
        "open_modal_reference": modal,
        "open_modal_reference_pass": bool(
            modal[-1]["relative_electric_reference_error"] < 0.01
            and modal[-1]["reflected_amplitude_ratio"] < 0.01
            and modal[-1]["source_flux_relative_mismatch"] < 1e-8
        ),
        "limitations": [
            "Layered-device PML comparison holds physical grid fixed; thick 3D cladding PML and material-interface convergence still require independent validation.",
            "Independent solver and calibrated waveguide transport are not part of these manufactured-source checks.",
            "A small algebraic residual does not certify field accuracy or optical efficiency.",
        ],
    }
    (output / "verification.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8"
    )
    return report
