"""One analytic three-dimensional geometry for meshing, materials and display.

Coordinates are micrometres. Sidewall angle is measured from the horizontal
substrate plane; 90 degrees denotes vertical walls. The ridge top width is
core_width_um, and its base widens by etch_depth / tan(angle) on each side.
"""

from __future__ import annotations

import math

import numpy as np

from .models import ExperimentSpec


def physical_bounds(spec: ExperimentSpec) -> np.ndarray:
    g = spec.geometry
    half = np.array([g.length_um, g.width_um, g.height_um]) / 2
    return np.column_stack((-half, half))


def material_at(spec: ExperimentSpec, points: np.ndarray) -> np.ndarray:
    """0: cladding, 1: core; core continues through x-directed PML."""
    points = np.asarray(points, dtype=float)
    if points.shape[-1] != 3:
        raise ValueError("points require a final coordinate axis of length three")
    g = spec.geometry
    if g.kind == "manufactured_cavity":
        return np.ones(points.shape[:-1], dtype=np.uint8)
    y, z = points[..., 1], points[..., 2]
    bottom, top = -g.core_thickness_um / 2, g.core_thickness_um / 2
    ridge_bottom = top - g.etch_depth_um
    slab = (z >= bottom) & (z < ridge_bottom)
    half_width = g.core_width_um / 2 + (top - z) / math.tan(
        math.radians(g.sidewall_angle_deg)
    )
    ridge = (z >= ridge_bottom) & (z <= top) & (np.abs(y) <= half_width)
    return (slab | ridge).astype(np.uint8)


def epsilon_at(spec: ExperimentSpec, points: np.ndarray) -> np.ndarray:
    g = spec.geometry
    ids = material_at(spec, points)
    # Positive imaginary permittivity is passive with exp(-i omega t).
    return np.where(ids == 1, g.core_index**2 + 1j * g.material_loss,
                    g.cladding_index**2).astype(complex)


def build_scene(spec: ExperimentSpec) -> dict:
    """Parametric scene; renderer must use these same vertices and conventions."""
    g = spec.geometry
    bounds = physical_bounds(spec)
    common = {
        "schema_version": 1,
        "units": "um",
        "coordinate_system": "right_handed_x_y_planar_z_thickness",
        "spec_hash": spec.spec_hash,
        "physical_bounds_um": bounds.tolist(),
        "geometry_kind": g.kind,
        "materials": [
            {"id": 0, "name": "cladding", "relative_permittivity": g.cladding_index**2},
            {"id": 1, "name": "core", "relative_permittivity": g.core_index**2,
             "imaginary_permittivity": g.material_loss},
        ],
        "design_region_bounds_um": [
            [-g.design_length_um / 2, g.design_length_um / 2],
            [-g.width_um / 2, g.width_um / 2],
            [-g.core_thickness_um / 2, g.core_thickness_um / 2],
        ],
        "observation_only_operations": ["camera", "clipping", "visibility", "exploded_view"],
    }
    if g.kind == "manufactured_cavity":
        common["solids"] = [{"kind": "box", "material_id": 1,
                              "bounds_um": bounds.tolist(), "boundary": "PEC"}]
        return common
    top = g.core_thickness_um / 2
    ridge_bottom = top - g.etch_depth_um
    base_halfwidth = g.core_width_um / 2 + g.etch_depth_um / math.tan(
        math.radians(g.sidewall_angle_deg)
    )
    # A prism along x represented by an ordered y/z cross-section.
    solids = [{"kind": "box", "material_id": 0, "bounds_um": bounds.tolist()}]
    if g.etch_depth_um > 0:
        solids.append({"kind": "prism_x", "material_id": 1,
                       "x_range_um": bounds[0].tolist(),
                       "yz_polygon_um": [[-base_halfwidth, ridge_bottom],
                                         [base_halfwidth, ridge_bottom],
                                         [g.core_width_um / 2, top],
                                         [-g.core_width_um / 2, top]]})
    if g.etch_depth_um < g.core_thickness_um:
        solids.append({"kind": "box", "material_id": 1,
                       "bounds_um": [bounds[0].tolist(), bounds[1].tolist(),
                                     [-g.core_thickness_um / 2, ridge_bottom]]})
    common.update({"solids": solids,
                   "pml": {"exterior_thickness_um": g.pml_thickness_um,
                           "excluded_from_physical_observables": True},
                   "port_candidates": [
                       {"id": "left", "normal": [-1, 0, 0],
                        "center_um": [bounds[0, 0], 0, 0]},
                       {"id": "right", "normal": [1, 0, 0],
                        "center_um": [bounds[0, 1], 0, 0]}],
                   "port_status": "geometry_only_not_mode_normalized"})
    return common


def build_geometry(spec: ExperimentSpec) -> dict:
    """Backend-independent analytic scene consumed by the structured grid."""
    return build_scene(spec)
