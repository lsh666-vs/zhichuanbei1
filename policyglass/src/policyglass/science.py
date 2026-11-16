"""Machine-readable actual numerical and physical checks, with independent formulas."""

import json
import platform
import time

import numpy as np
import torch

from .agents import Learner
from .checkpoint import decode, encode
from .config import EnvironmentConfig, ExperimentConfig
from .environment import SpatialArm, forward_kinematics
from .physics_host import ENGINE_VERSION


def audit_trace(trace):
    errors = {
        "sample_gradient_sum_max_abs": 0.0,
        "adam_update_max_abs": 0.0,
        "parameter_addition_max_abs": 0.0,
        "normalization_chain_max_abs": 0.0,
    }
    optimizers = {e["label"]: e for e in trace["events"] if e["kind"] == "optimizer"}
    for event in trace["events"]:
        if event["kind"] == "sample_gradients":
            for name, samples in event["contributions"].items():
                raw = np.asarray(optimizers[event["label"]]["parameters"][name]["raw_gradient"])
                errors["sample_gradient_sum_max_abs"] = max(
                    errors["sample_gradient_sum_max_abs"],
                    float(np.max(np.abs(np.sum(samples, axis=0) - raw))),
                )
        elif event["kind"] == "optimizer":
            for record in event["parameters"].values():
                g = np.asarray(record["raw_gradient"]) * event["clip_factor"]
                m = event["beta1"] * np.asarray(record["moment_before"]) + (1 - event["beta1"]) * g
                v = (
                    event["beta2"] * np.asarray(record["variance_before"])
                    + (1 - event["beta2"]) * g * g
                )
                expected = (
                    -event["lr"]
                    * (m / (1 - event["beta1"] ** event["step"]))
                    / (np.sqrt(v / (1 - event["beta2"] ** event["step"])) + event["epsilon"])
                )
                errors["adam_update_max_abs"] = max(
                    errors["adam_update_max_abs"], float(np.max(np.abs(expected - record["delta"])))
                )
                errors["parameter_addition_max_abs"] = max(
                    errors["parameter_addition_max_abs"],
                    float(
                        np.max(np.abs(np.asarray(record["before"]) + expected - record["after"]))
                    ),
                )
        elif event["kind"] == "observation_transform" and event["raw_gradient"] is not None:
            expected = np.asarray(event["normalized_gradient"]) / np.asarray(event["scale"])
            errors["normalization_chain_max_abs"] = max(
                errors["normalization_chain_max_abs"],
                float(np.max(np.abs(expected - event["raw_gradient"]))),
            )
    if max(errors.values()) > 1e-10:
        raise AssertionError(f"Independent trace reconstruction failed: {errors}")
    return errors


def physics_report():
    env = SpatialArm(EnvironmentConfig(gravity=0, damping=0.2))
    rng = np.random.default_rng(1207)
    fk_error = 0.0
    for _ in range(50):
        env.set_joint_state(rng.uniform([-1, -1, -1], [1, 1, 1]))
        fk_error = max(
            fk_error,
            float(np.max(np.abs(env.data.site_xpos[0] - forward_kinematics(env.data.qpos)))),
        )
    env.set_joint_state([0.2, -0.3, 0.5], [0.3, 0.2, -0.1])
    energy_start = sum(env.frame()["energy_j"])
    for _ in range(30):
        env.step([0, 0, 0])
    energy_end = sum(env.frame()["energy_j"])
    env.close()
    refined = []
    for dt, substeps in ((0.01, 2), (0.005, 4), (0.0025, 8), (0.00125, 16)):
        env = SpatialArm(EnvironmentConfig(gravity=0, damping=0.15, timestep=dt, substeps=substeps))
        env.set_joint_state([0.2, -0.3, 0.5], [0.3, 0.2, -0.1])
        for _ in range(25):
            env.step([0.05, -0.03, 0.02])
        refined.append(
            {"dt_s": dt, "duration_s": env.data.time, "qpos_rad": env.data.qpos.tolist()}
        )
        env.close()
    fine = np.asarray(refined[-1]["qpos_rad"])
    for item in refined:
        item["error_vs_finest_rad"] = float(np.linalg.norm(np.asarray(item["qpos_rad"]) - fine))
    errors = [item["error_vs_finest_rad"] for item in refined[:-1]]
    if fk_error > 1e-12 or not energy_end < energy_start or not errors[0] > errors[1] > errors[2]:
        raise AssertionError("Physical FK, damping or timestep refinement failed")
    return {
        "analytic_fk_max_abs_m": fk_error,
        "damped_energy_start_j": energy_start,
        "damped_energy_end_j": energy_end,
        "timestep_refinement": refined,
        "scope": "ideal rigid body FK, dissipative behavior and smooth short-trajectory refinement; not real-robot validation",
    }


def report():
    result = {
        "schema": "policyglass.science-report.v1",
        "python": platform.python_version(),
        "platform": platform.platform(),
        "torch": torch.__version__,
        "numpy": np.__version__,
        "physics_engine": f"canonical_mujoco_wasm_{ENGINE_VERSION}",
        "reference": "CPU float64, fixed physical-unit observation scaling, one torch thread",
        "algorithms": {},
        "physics": physics_report(),
    }
    for algorithm in ("ppo", "sac"):
        learner = Learner(ExperimentConfig(algorithm=algorithm))
        started = time.perf_counter()
        outputs = learner.iteration(record=True)
        elapsed = time.perf_counter() - started
        trace = next(trace for _, trace in outputs if trace is not None)
        checks = audit_trace(trace)
        resumed_state, _ = decode(encode(learner.state()))
        resumed = Learner.from_state(resumed_state)
        original_next = learner.iteration()
        resumed_next = resumed.iteration()
        if [s for s, _ in original_next] != [s for s, _ in resumed_next]:
            raise AssertionError(
                "Following real collection/update differs after checkpoint roundtrip"
            )
        max_error = max(
            float((a - b).abs().max().detach())
            for name in learner.models
            for a, b in zip(learner.models[name].parameters(), resumed.models[name].parameters())
        )
        result["algorithms"][algorithm] = {
            "trace_update": trace["update"],
            "event_count": len(trace["events"]),
            "trace_json_bytes": len(json.dumps(trace)),
            "first_actual_iteration_seconds": elapsed,
            "independent_trace_checks": checks,
            "resume_max_parameter_abs": max_error,
            "source": "actual locally collected spatial-arm data",
            "trained_policy_success_claimed": False,
        }
        learner.env.close()
        resumed.env.close()
    return result
