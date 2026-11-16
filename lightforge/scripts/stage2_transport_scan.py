"""Actual failed/successful open-ridge transport checks, never optical efficiency."""

import json
import time
from pathlib import Path

import numpy as np
from scipy.sparse.linalg import splu

from lightforge.models import ExperimentSpec
from lightforge.power import native_box_power
from lightforge.solver import NativeField, assemble


def main():
    out = Path(".runtime/stage2-transport")
    out.mkdir(parents=True, exist_ok=True)
    records = []
    for size, spacing, thickness in [
        (1.2, 0.2, 0.6),
        (1.2, 0.2, 1.2),
        (2.4, 0.2, 0.6),
        (2.4, 0.2, 1.2),
    ]:
        start = time.perf_counter()
        spec = ExperimentSpec.model_validate(
            {
                "name": "stage2 transport investigation",
                "geometry": {
                    "kind": "layered_waveguide",
                    "length_um": 2.4,
                    "width_um": size,
                    "height_um": size,
                    "core_width_um": 0.5,
                    "core_thickness_um": 0.3,
                    "etch_depth_um": 0.3,
                    "pml_thickness_um": thickness,
                },
                "mesh": {"maxh_um": spacing},
                "excitation": {"kind": "localized_current", "width_um": 0.12},
            }
        )
        system = assemble(spec)
        print("factor", size, spacing, thickness, len(system.grid.free), flush=True)
        e = np.zeros(system.grid.n_edges, dtype=complex)
        e[system.grid.free] = splu(system.matrix).solve(system.rhs)
        power = native_box_power(system, e, np.array([[-1.0, 1.0], [-0.4, 0.4], [-0.4, 0.4]]))
        probe, _ = NativeField(spec, system.grid, e).evaluate(
            np.array([[0.6, 0, 0], [0.6, 0, 0.25], [0, 0.35, 0.2]])
        )
        record = {
            "spec": spec.model_dump(mode="json"),
            "spec_hash": spec.spec_hash,
            "unknowns": len(system.grid.free),
            "power": power,
            "probe_real": probe.real.tolist(),
            "probe_imag": probe.imag.tolist(),
            "elapsed_s": time.perf_counter() - start,
        }
        records.append(record)
        (out / "scan.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
        print(json.dumps({k: v for k, v in record.items() if k not in ["spec"]}), flush=True)


if __name__ == "__main__":
    main()
