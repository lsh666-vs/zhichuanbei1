import json

import h5py
import numpy as np
import pytest
from scipy.sparse.linalg import splu

from lightforge.models import ExperimentSpec
from lightforge.solver import Z0, NativeField, _pml_diagonal, assemble, make_grid, probe, solve


def cavity(maxh=0.35, **mesh):
    return ExperimentSpec.model_validate({"mesh": {"maxh_um": maxh, **mesh}})


def open_spec(maxh=0.35, **geometry):
    return ExperimentSpec.model_validate(
        {
            "geometry": {"kind": "layered_waveguide", **geometry},
            "mesh": {"maxh_um": maxh},
            "excitation": {"kind": "localized_current"},
        }
    )


def native_solution(spec):
    system = assemble(spec)
    values = splu(system.matrix).solve(system.rhs)
    electric = np.zeros(system.grid.n_edges, dtype=complex)
    electric[system.grid.free] = values
    return system, electric


def test_staggered_curl_of_discrete_gradient_is_zero():
    grid = make_grid(cavity())
    x, y, z = np.meshgrid(*grid.axes, indexing="ij")
    phi = np.sin(0.3 * x + 0.7 * y) * np.cos(z)
    edges = np.concatenate([(np.diff(phi, axis=c) / grid.spacing[c]).ravel() for c in range(3)])
    assert np.linalg.norm(grid.curl @ edges) < 1e-12


def test_pec_elimination_exactly_removes_tangential_boundary_edges():
    grid = make_grid(cavity())
    nx, ny, nz = [len(a) - 1 for a in grid.axes]
    assert (
        len(grid.free)
        == nx * (ny - 1) * (nz - 1) + (nx - 1) * ny * (nz - 1) + (nx - 1) * (ny - 1) * nz
    )
    assert len(np.unique(grid.free)) == len(grid.free)


@pytest.mark.scientific
def test_continuum_manufactured_solution_matches_independent_discrete_prediction(tmp_path):
    result = solve(cavity(), tmp_path)
    m = result["metrics"]
    assert m["relative_residual"] < 1e-10
    assert m["relative_electric_l2_error"] == pytest.approx(
        m["analytic_discrete_relative_error"], rel=1e-9
    )
    assert m["relative_electric_l2_error"] < 0.003
    assert result["normalization"].startswith("manufactured")
    assert m["total_outward_power_w"] == 0


@pytest.mark.scientific
def test_continuum_error_decreases_at_second_order():
    errors = []
    spacings = []
    for maxh in [0.4, 0.2, 1.6 / 12]:
        spec = ExperimentSpec.model_validate(
            {
                "geometry": {"length_um": 1.6, "width_um": 1.6, "height_um": 1.6},
                "mesh": {"maxh_um": maxh},
            }
        )
        system, electric = native_solution(spec)
        errors.append(
            np.linalg.norm(electric - system.exact_edges) / np.linalg.norm(system.exact_edges)
        )
        spacings.append(max(system.grid.spacing))
    order = np.log(errors[0] / errors[-1]) / np.log(spacings[0] / spacings[-1])
    assert 1.85 < order < 2.15
    assert errors[2] < errors[1] < errors[0]


@pytest.mark.scientific
def test_magnetic_units_and_sign_match_analytic_maxwell_field():
    spec = cavity(0.2)
    system, electric = native_solution(spec)
    p = np.array([[0.3, 0.1, 0.2]])
    e, h = NativeField(spec, system.grid, electric).evaluate(p)
    g = spec.geometry
    k0 = 2 * np.pi / spec.wavelength_um
    dx = (
        -np.pi
        / g.length_um
        * np.sin(np.pi * p[0, 0] / g.length_um)
        * np.cos(np.pi * p[0, 2] / g.height_um)
    )
    dz = (
        -np.pi
        / g.height_um
        * np.cos(np.pi * p[0, 0] / g.length_um)
        * np.sin(np.pi * p[0, 2] / g.height_um)
    )
    expected = np.array([-dz, 0, dx]) / (1j * k0 * Z0)
    assert np.linalg.norm(h[0] - expected) / np.linalg.norm(expected) < 0.06
    assert h[0, 0].imag < 0 < h[0, 2].imag
    assert np.linalg.norm(e[0].imag) < 1e-12


def test_pml_is_identity_inside_and_has_correct_tensor_stretch():
    s = open_spec()
    pts = np.array([[0, 0, 0], [1.7, 0, 0]])
    epsx = _pml_diagonal(s, pts, 0)
    epsy = _pml_diagonal(s, pts, 1)
    mux_inv = _pml_diagonal(s, pts, 0, inverse=True)
    assert epsx[0] == epsy[0] == mux_inv[0] == 1
    assert epsy[1].imag > 0
    assert epsx[1] * epsy[1] == pytest.approx(1)
    assert mux_inv[1] == pytest.approx(epsy[1])


def test_magnetic_reconstruction_includes_pml_permeability():
    system, electric = native_solution(open_spec())
    field = NativeField(system.spec, system.grid, electric)
    expected = (
        system.mu_inverse_faces
        * (system.grid.curl @ electric)
        / (1j * (2 * np.pi / system.spec.wavelength_um) * Z0)
    )
    assert np.allclose(field.magnetic, expected, rtol=1e-13, atol=1e-15)
    untransformed = (system.grid.curl @ electric) / (
        1j * (2 * np.pi / system.spec.wavelength_um) * Z0
    )
    assert np.linalg.norm(field.magnetic - untransformed) > 1e-8


@pytest.mark.scientific
def test_open_three_dimensional_current_solve_is_finite_and_passive():
    system, electric = native_solution(open_spec())
    u = electric[system.grid.free]
    assert np.linalg.norm(system.matrix @ u - system.rhs) / np.linalg.norm(system.rhs) < 1e-10
    supplied = -0.5 * np.real(np.vdot(system.current_edges[system.grid.free], u)) / Z0
    assert supplied > 0
    assert np.count_nonzero(np.abs(electric) > 1e-12) > 100
    field = NativeField(system.spec, system.grid, electric)
    e, h = field.evaluate(np.array([[0.4, 0, 0], [0.4, 0, 0.4]]))
    assert np.isfinite(e).all() and np.isfinite(h).all()
    assert not np.allclose(e[0], e[1])
    # Source is exactly absent from the PML, not just a small Gaussian tail.
    outside = np.any(np.abs(system.grid.edge_points) > np.array([1.5, 1, 0.8]), axis=1)
    assert np.all(system.current_edges[outside] == 0)


@pytest.mark.scientific
def test_probes_use_original_grid_and_reload_unchanged(tmp_path):
    solve(cavity(), tmp_path)
    initial = probe(tmp_path, (0.2, 0.1, -0.2))
    with h5py.File(tmp_path / "fields.h5", "r+") as f:
        assert f["E/real"].shape == (25, 17, 13, 3)
        assert f.attrs["spec_hash"] == initial["spec_hash"]
        f["E/real"][:] = 999  # frontend samples cannot affect native probes
    reloaded = probe(tmp_path, (0.2, 0.1, -0.2))
    assert reloaded == initial
    assert abs(initial["E"]["real"][1]) < 1
    assert initial["E"]["unit"] == "V/m"
    assert initial["H"]["unit"] == "A/m"
    with pytest.raises(ValueError, match="inside physical"):
        probe(tmp_path, (100, 0, 0))
    with pytest.raises(ValueError):
        probe(tmp_path, (float("nan"), 0, 0))


def test_actual_unknown_budget_checked_before_matrix_assembly():
    with pytest.raises(ValueError, match="unknown count"):
        make_grid(cavity(0.1, max_dofs=1000))


def test_cancel_at_safe_boundary_prevents_solve(tmp_path):
    with pytest.raises(InterruptedError):
        solve(cavity(), tmp_path, cancelled=lambda: True)
    assert not (tmp_path / "result.json").exists()


def test_public_manifest_has_only_real_artifacts_and_no_fake_transmission(tmp_path):
    (tmp_path / "worker.log").write_text("mutable task log", encoding="utf-8")
    (tmp_path / "input.json").write_text("not a scientific output", encoding="utf-8")
    r = solve(cavity(), tmp_path)
    assert (
        json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))["spec_hash"]
        == cavity().spec_hash
    )
    assert {a["name"] for a in r["artifacts"]} == {
        "coefficients.npy",
        "grid.npz",
        "fields.h5",
        "spec.json",
        "scene.json",
    }
    assert "transmission" not in r["metrics"]
    assert r["validation"]["port_calibration"] == "not_implemented_stage_2"


def test_saved_grid_mismatch_is_rejected_instead_of_misinterpreting_fields(tmp_path):
    solve(cavity(), tmp_path)
    with np.load(tmp_path / "grid.npz", allow_pickle=False) as data:
        axes = {c: data[c].copy() for c in "xyz"}
    axes["x"] += 0.01
    np.savez(tmp_path / "grid.npz", **axes)
    with pytest.raises(ValueError, match="stored grid"):
        probe(tmp_path, (0, 0, 0))


def test_physical_grid_stays_identical_under_pml_doubling():
    def interior_axes(s):
        return [
            a[(a >= -L / 2 - 1e-10) & (a <= L / 2 + 1e-10)]
            for a, L in zip(make_grid(s).axes, (3, 2, 1.6))
        ]

    a, b = (
        interior_axes(open_spec(pml_thickness_um=0.3)),
        interior_axes(open_spec(pml_thickness_um=0.6)),
    )
    for left, right in zip(a, b):
        assert np.allclose(left, right, atol=1e-14, rtol=0)


@pytest.mark.scientific
def test_open_3d_modal_reference_and_pml_reflection_convergence():
    from lightforge.benchmarks import open_modal_benchmark

    results = [open_modal_benchmark(d) for d in [0.4, 0.8, 1.6]]
    errors = [r["relative_electric_reference_error"] for r in results]
    assert errors[2] < errors[1] < errors[0]
    assert errors[2] < 0.01
    assert results[-1]["reflected_amplitude_ratio"] < 0.01
    assert all(r["source_flux_relative_mismatch"] < 1e-10 for r in results)
