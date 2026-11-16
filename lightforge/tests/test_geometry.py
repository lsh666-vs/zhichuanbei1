import numpy as np
import pytest

from lightforge.geometry import build_scene, epsilon_at, material_at
from lightforge.models import ExperimentSpec


def layered(**changes):
    return ExperimentSpec.model_validate({"geometry": {"kind": "layered_waveguide", **changes},
                                          "excitation": {"kind": "localized_current"}})


def test_material_matches_vertical_and_sloping_ridge():
    s = layered(sidewall_angle_deg=60)
    # Top half-width .35, bottom half-width .581.
    assert material_at(s, np.array([[0, .5, -.19], [0, .5, .19]])).tolist() == [1, 0]
    scene = build_scene(s)
    polygon = scene["solids"][1]["yz_polygon_um"]
    assert polygon[1][0] == pytest.approx(.35 + .4/np.tan(np.pi/3))


def test_partial_etch_residual_slab_and_core_continue_through_x_pml():
    s = layered(etch_depth_um=.2)
    points = np.array([[0, .8, -.1], [0, .8, .1], [1.7, 0, .1]])
    assert material_at(s, points).tolist() == [1, 0, 1]
    assert len(build_scene(s)["solids"]) == 3


def test_zero_etch_is_uniform_slab_without_degenerate_ridge():
    s = layered(etch_depth_um=0)
    assert [v["kind"] for v in build_scene(s)["solids"]] == ["box", "box"]
    assert material_at(s, np.array([0, .8, 0])) == 1


def test_positive_imaginary_permittivity_and_honest_scene_ports():
    s = layered(material_loss=.02)
    assert epsilon_at(s, np.array([[0, 0, 0], [0, .9, .5]])).tolist() == [4+.02j, 1.44**2+0j]
    assert build_scene(s)["port_status"] == "geometry_only_not_mode_normalized"


def test_cavity_scene_uniform_material_and_pec():
    s = ExperimentSpec()
    assert np.all(material_at(s, np.array([[0, .9, .7], [0, 0, 0]])) == 1)
    assert build_scene(s)["solids"][0]["boundary"] == "PEC"

