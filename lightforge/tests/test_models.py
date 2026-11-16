import pytest
from pydantic import ValidationError
from lightforge.models import ExperimentSpec


def test_canonical_hash_roundtrip():
    spec = ExperimentSpec()
    assert ExperimentSpec.model_validate_json(spec.canonical_json()).spec_hash == spec.spec_hash
    assert ExperimentSpec(name="new version").spec_hash != spec.spec_hash


@pytest.mark.parametrize("change", [
    {"wavelength_um": float("nan")}, {"extra": 1},
    {"geometry": {"etch_depth_um": 1.0}},
    {"geometry": {"core_width_um": 2.0}},
    {"mesh": {"sample_shape": [129,129,129]}},
    {"excitation": {"center_um": [100,0,0]}},
    {"excitation": {"kind": "localized_current"}},
    {"geometry": {"material_loss": .1}},
    {"geometry": {"core_width_um": 1e-12}},
    {"wavelength_um": 5.647058823529412},
])
def test_reject_invalid_physical_inputs(change):
    with pytest.raises(ValidationError):
        ExperimentSpec.model_validate(change)


def test_no_unbounded_parameter_mutation():
    spec = ExperimentSpec()
    with pytest.raises(ValidationError):
        spec.wavelength_um = 0
