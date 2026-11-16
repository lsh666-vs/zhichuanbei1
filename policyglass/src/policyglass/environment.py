"""Original torque-controlled spatial arm. MuJoCo is the source of physical motion."""

import copy
from types import SimpleNamespace
from typing import ClassVar

import gymnasium as gym
import numpy as np

from .config import EnvironmentConfig
from .physics_host import ENGINE_VERSION, host

LENGTHS = (0.32, 0.28)
BASE_HEIGHT = 0.18
OBSERVATION_LABELS = [
    "sin_yaw",
    "sin_shoulder",
    "sin_elbow",
    "cos_yaw",
    "cos_shoulder",
    "cos_elbow",
    "yaw_velocity_rad_s",
    "shoulder_velocity_rad_s",
    "elbow_velocity_rad_s",
    "tip_x_m",
    "tip_y_m",
    "tip_z_m",
    "target_x_m",
    "target_y_m",
    "target_z_m",
]


def model_xml(config):
    return f'''<mujoco model="policyglass_spatial_arm">
      <compiler angle="radian"/>
      <option timestep="{config.timestep}" gravity="0 0 {-config.gravity}" integrator="implicitfast"/>
      <default><joint damping="{config.damping}" armature="0.02" limited="true"/>
        <geom type="capsule" size="0.025" contype="0" conaffinity="0" rgba="0.22 0.54 0.72 1"/>
      </default>
      <worldbody>
        <body name="base" pos="0 0 {BASE_HEIGHT}">
          <joint name="yaw" axis="0 0 1" range="-2.8 2.8"/>
          <geom type="cylinder" size="0.04 0.04" mass="0.2"/>
          <body name="upper">
            <joint name="shoulder" axis="0 1 0" range="-1.75 1.4"/>
            <geom fromto="0 0 0 {LENGTHS[0]} 0 0" mass="0.8"/>
            <body name="forearm" pos="{LENGTHS[0]} 0 0">
              <joint name="elbow" axis="0 1 0" range="-2.3 2.3"/>
              <geom fromto="0 0 0 {LENGTHS[1]} 0 0" mass="0.5"/>
              <site name="tip" pos="{LENGTHS[1]} 0 0" size="0.018"/>
            </body>
          </body>
        </body>
      </worldbody>
      <actuator>
        <motor joint="yaw" ctrllimited="true" ctrlrange="{-config.torque_limit} {config.torque_limit}"/>
        <motor joint="shoulder" ctrllimited="true" ctrlrange="{-config.torque_limit} {config.torque_limit}"/>
        <motor joint="elbow" ctrllimited="true" ctrlrange="{-config.torque_limit} {config.torque_limit}"/>
      </actuator>
    </mujoco>'''


def forward_kinematics(q):
    """Independent analytic FK, not a call back into MuJoCo."""
    yaw, shoulder, elbow = q
    radial = LENGTHS[0] * np.cos(shoulder) + LENGTHS[1] * np.cos(shoulder + elbow)
    z = BASE_HEIGHT - LENGTHS[0] * np.sin(shoulder) - LENGTHS[1] * np.sin(shoulder + elbow)
    return np.array([np.cos(yaw) * radial, np.sin(yaw) * radial, z])


class SpatialArm(gym.Env):
    metadata: ClassVar[dict] = {"render_modes": []}

    def __init__(self, config=None, seed=17):
        self.config = config or EnvironmentConfig()
        self._validate_target(self.config.target)
        created = host().call("create", xml=model_xml(self.config))
        self.world_id = created["id"]
        self.model = SimpleNamespace(jnt_range=np.array(created["joint_limits"]).reshape(3, 2))
        self._sync(created["frame"])
        self.rng = np.random.default_rng(seed)
        limit = self.config.torque_limit
        self.action_space = gym.spaces.Box(-limit, limit, (3,), dtype=np.float64)
        self.observation_space = gym.spaces.Box(-np.inf, np.inf, (15,), dtype=np.float64)
        self.target = np.array(self.config.target, dtype=np.float64)
        self.steps = 0
        self.previous_action = np.zeros(3)
        self.force = np.zeros(6)
        self.force_steps = 0
        self.reset()

    def _sync(self, frame):
        self._frame = frame
        self.data = SimpleNamespace(
            qpos=np.array(frame["qpos_rad"]),
            qvel=np.array(frame["qvel_rad_s"]),
            ctrl=np.array(frame["torque_nm"]),
            time=frame["time_s"],
            site_xpos=np.array(frame["tip_m"]).reshape(1, 3),
        )

    @staticmethod
    def _validate_target(target):
        p = np.asarray(target, dtype=np.float64)
        radius = np.linalg.norm(p - [0, 0, BASE_HEIGHT])
        if not np.isfinite(p).all() or radius > sum(LENGTHS) + 1e-10 or radius < 0.05:
            raise ValueError(
                "Target outside geometric reach envelope [0.05, 0.60] m; joint limits may further restrict reach"
            )

    def observation(self):
        return np.concatenate(
            [
                np.sin(self.data.qpos),
                np.cos(self.data.qpos),
                self.data.qvel,
                self.data.site_xpos[0],
                self.target,
            ]
        ).copy()

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        self._sync(
            host().call("reset", id=self.world_id, qpos=self.rng.uniform(-0.15, 0.15, 3).tolist())
        )
        self.steps = 0
        self.previous_action = np.zeros(3)
        self.force = np.zeros(6)
        self.force_steps = 0
        return self.observation(), {"physics": self.frame()}

    def step(self, action):
        action = np.asarray(action, dtype=np.float64)
        if action.shape != (3,) or not np.isfinite(action).all():
            raise ValueError("Action must be three finite torque values")
        if np.any(np.abs(action) > self.config.torque_limit + 1e-9):
            raise ValueError("Action exceeds physical torque limit")
        force = self.force.tolist() if self.force_steps > 0 else None
        self._sync(
            host().call(
                "step",
                id=self.world_id,
                action=action.tolist(),
                substeps=self.config.substeps,
                force=force,
            )
        )
        self.force_steps = max(0, self.force_steps - 1)
        self.steps += 1
        distance = float(np.linalg.norm(self.data.site_xpos[0] - self.target))
        parts = {
            "distance": -(distance**2),
            "control": -0.002 * float((action**2).sum()),
            "action_change": -0.001 * float(((action - self.previous_action) ** 2).sum()),
        }
        self.previous_action = action.copy()
        terminated = False  # continuing reaching task; success is an evaluation metric
        truncated = self.steps >= self.config.horizon
        return (
            self.observation(),
            sum(parts.values()),
            terminated,
            truncated,
            {
                "reward_parts": parts,
                "distance_m": distance,
                "success": distance < 0.04,
                "physics": self.frame(),
            },
        )

    def frame(self):
        return {
            "schema": "policyglass.physics.v1",
            **copy.deepcopy(self._frame),
            "coordinate_system": "right-handed Z-up, SI",
            "engine": "canonical_mujoco_wasm",
            "engine_version": ENGINE_VERSION,
            "target_m": self.target.tolist(),
            "external_wrench_world": self.force.tolist() if self.force_steps > 0 else [0.0] * 6,
            "force_steps_remaining": self.force_steps,
        }

    def snapshot(self):
        state = host().call("snapshot", id=self.world_id)
        return {
            "integration": state["integration"],
            "engine_version": ENGINE_VERSION,
            "steps": self.steps,
            "previous_action": self.previous_action.tolist(),
            "target": self.target.tolist(),
            "rng": copy.deepcopy(self.rng.bit_generator.state),
            "force": self.force.tolist(),
            "force_steps": self.force_steps,
        }

    def restore(self, state):
        values = np.asarray(state["integration"], dtype=np.float64)
        if (
            state.get("engine_version") != ENGINE_VERSION
            or values.ndim != 1
            or not np.isfinite(values).all()
        ):
            raise ValueError("Invalid integration state")
        self._validate_target(state["target"])
        self._sync(host().call("restore", id=self.world_id, integration=values.tolist()))
        self.steps = int(state["steps"])
        self.previous_action = np.asarray(state["previous_action"], dtype=np.float64)
        self.target = np.asarray(state["target"], dtype=np.float64)
        self.rng.bit_generator.state = copy.deepcopy(state["rng"])
        self.force = np.asarray(state["force"], dtype=np.float64)
        self.force_steps = int(state["force_steps"])

    def set_joint_state(self, qpos, qvel=None):
        q = np.asarray(qpos, dtype=np.float64)
        v = np.zeros(3) if qvel is None else np.asarray(qvel, dtype=np.float64)
        if (
            q.shape != (3,)
            or v.shape != (3,)
            or not np.isfinite(q).all()
            or not np.isfinite(v).all()
        ):
            raise ValueError("Joint state requires three finite positions and velocities")
        if np.any(q < self.model.jnt_range[:, 0]) or np.any(q > self.model.jnt_range[:, 1]):
            raise ValueError("Joint positions outside limits")
        self._sync(host().call("set_joints", id=self.world_id, qpos=q.tolist(), qvel=v.tolist()))

    def apply_force(self, force_newtons, steps=1):
        force = np.asarray(force_newtons, dtype=np.float64)
        if force.shape != (3,) or not np.isfinite(force).all() or np.linalg.norm(force) > 30:
            raise ValueError("External world force must be finite and at most 30 N")
        if not isinstance(steps, int) or not 1 <= steps <= 128:
            raise ValueError("Force duration must be 1..128 control steps")
        self.force = np.concatenate([force, np.zeros(3)])
        self.force_steps = steps

    def set_target(self, target):
        self._validate_target(target)
        self.target = np.asarray(target, dtype=np.float64)

    def close(self):
        if getattr(self, "world_id", None) is not None:
            host().call("delete", id=self.world_id)
            self.world_id = None

    def __del__(self):
        try:
            self.close()
        except (RuntimeError, OSError, AttributeError, ImportError):
            pass

    def geometry(self):
        return {
            "schema": "policyglass.geometry.v1",
            "base_height_m": BASE_HEIGHT,
            "link_lengths_m": list(LENGTHS),
            "capsule_radius_m": 0.025,
            "base_cylinder_radius_m": 0.04,
            "base_cylinder_half_height_m": 0.04,
            "masses_kg": [0.2, 0.8, 0.5],
            "joint_axes_local": [[0, 0, 1], [0, 1, 0], [0, 1, 0]],
            "joint_limits_rad": self.model.jnt_range.tolist(),
            "observation_labels": OBSERVATION_LABELS,
            "timestep_s": self.config.timestep,
            "substeps": self.config.substeps,
            "gravity_m_s2": self.config.gravity,
            "damping_nm_s_rad": self.config.damping,
            "model_scope": "ideal rigid bodies; no self/ground contact; no real hardware safety claim",
            "target_scope": "geometric radial envelope checked; joint-limited reachability not guaranteed",
            "xml": model_xml(self.config),
        }
