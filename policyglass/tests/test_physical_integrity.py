import numpy as np
import pytest

from policyglass.config import EnvironmentConfig
from policyglass.environment import (
    SpatialArm,
    forward_kinematics,
    inverse_kinematics,
    static_gravity_torque,
)
from policyglass.science import physics_report


@pytest.mark.scientific
def test_physics_time_refinement_and_dissipation():
    result = physics_report()
    assert result["analytic_fk_max_abs_m"] < 1e-12
    assert result["damped_energy_end_j"] < result["damped_energy_start_j"]
    errors = [item["error_vs_finest_rad"] for item in result["timestep_refinement"]]
    assert errors[0] > errors[1] > errors[2] > errors[3]


@pytest.mark.scientific
def test_inverse_kinematics_checks_actual_joint_limited_reachability():
    rng = np.random.default_rng(14)
    for _ in range(40):
        q = rng.uniform([-2.5, -1.5, -2.0], [2.5, 1.2, 2.0])
        target = forward_kinematics(q)
        solutions = inverse_kinematics(target)
        assert solutions
        for solution in solutions:
            np.testing.assert_allclose(forward_kinematics(solution), target, atol=1e-12)
    assert inverse_kinematics([10, 0, 0]) == []
    with pytest.raises(ValueError):
        SpatialArm(EnvironmentConfig(target=[0, 0, 0.18]))


def test_external_force_is_real_and_saved_with_duration(small_config):
    a = SpatialArm(small_config.environment, 4)
    b = SpatialArm(small_config.environment, 4)
    a.apply_force([1, 0, 0], steps=2)
    state = a.snapshot()
    first = a.step([0, 0, 0])[0]
    baseline = b.step([0, 0, 0])[0]
    assert np.linalg.norm(first - baseline) > 1e-6
    b.restore(state)
    np.testing.assert_allclose(b.step([0, 0, 0])[0], first, atol=1e-14)


@pytest.mark.scientific
def test_analytic_gravity_torque_matches_actual_engine_and_default_target_is_holdable():
    env = SpatialArm()
    for q in ([0.1, -0.7, 0.8], [0.4, 0, 0], [-0.7, -1.0, 1.2]):
        env.set_joint_state(q, [0, 0, 0])
        np.testing.assert_allclose(
            env.frame()["bias_torque_nm"], static_gravity_torque(q), atol=1e-12
        )
    assert env.geometry()["target_statically_holdable"]
