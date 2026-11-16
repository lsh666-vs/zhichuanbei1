import numpy as np
import pytest
from scipy.sparse.linalg import splu

from lightforge.models import ExperimentSpec
from lightforge.power import native_box_power
from lightforge.solver import assemble


@pytest.mark.parametrize("loss", [0, 0.1])
@pytest.mark.scientific
def test_discrete_power_balance_in_open_dielectric_with_radiation_and_loss(loss):
    spec = ExperimentSpec.model_validate(
        {
            "geometry": {
                "kind": "layered_waveguide",
                "length_um": 2.4,
                "width_um": 1.2,
                "height_um": 1.2,
                "core_width_um": 0.5,
                "core_thickness_um": 0.3,
                "etch_depth_um": 0.3,
                "pml_thickness_um": 0.2,
                "material_loss": loss,
            },
            "mesh": {"maxh_um": 0.2},
            "excitation": {"kind": "localized_current", "width_um": 0.12},
        }
    )
    system = assemble(spec)
    electric = np.zeros(system.grid.n_edges, dtype=complex)
    electric[system.grid.free] = splu(system.matrix).solve(system.rhs)
    bounds = np.array([[-1.0, 1.0], [-0.4, 0.4], [-0.4, 0.4]])
    result = native_box_power(system, electric, bounds)
    assert result["source_power_w"] > 0
    assert result["relative_balance_error"] < 1e-10
    assert (result["absorbed_power_w"] > 0) == (loss > 0)
    # Three-dimensional radiation participates: x-only flux is not total power.
    assert sum(p["outward_power_w"] for p in result["planes"] if p["axis"] != "x") > 0
    with pytest.raises(ValueError, match="nodes"):
        native_box_power(system, electric, bounds + 0.01)
    with pytest.raises(ValueError, match="strictly inside"):
        native_box_power(system, electric, np.array([[-1.2, 1.2], [-0.6, 0.6], [-0.6, 0.6]]))
