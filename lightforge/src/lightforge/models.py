"""Versioned physical inputs. Public lengths are micrometres, never display pixels."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)


class GeometrySpec(StrictModel):
    kind: Literal["manufactured_cavity", "layered_waveguide"] = "manufactured_cavity"
    length_um: Annotated[float, Field(ge=0.5, le=12)] = 3.0
    width_um: Annotated[float, Field(ge=0.5, le=8)] = 2.0
    height_um: Annotated[float, Field(ge=0.5, le=6)] = 1.6
    core_width_um: Annotated[float, Field(ge=0.06, le=4)] = 0.7
    core_thickness_um: Annotated[float, Field(ge=0.06, le=2)] = 0.4
    etch_depth_um: Annotated[float, Field(ge=0, le=2)] = 0.4
    sidewall_angle_deg: Annotated[float, Field(ge=60, le=90)] = 90.0
    core_index: Annotated[float, Field(ge=1, le=4)] = 2.0
    cladding_index: Annotated[float, Field(ge=1, le=4)] = 1.44
    design_length_um: Annotated[float, Field(gt=0, le=10)] = 1.0
    pml_thickness_um: Annotated[float, Field(ge=0.1, le=2)] = 0.3
    material_loss: Annotated[float, Field(ge=0, le=0.2)] = 0.0

    @model_validator(mode="after")
    def physical_fit(self):
        if self.core_thickness_um >= self.height_um:
            raise ValueError("core thickness must fit inside physical domain height")
        if self.etch_depth_um > self.core_thickness_um:
            raise ValueError("etch depth cannot exceed core thickness")
        bottom_width = self.core_width_um + 2 * self.etch_depth_um / math.tan(
            math.radians(self.sidewall_angle_deg)
        )
        if bottom_width >= self.width_um:
            raise ValueError("sloped sidewall must fit inside physical domain width")
        if self.design_length_um >= self.length_um:
            raise ValueError("design region must fit inside domain length")
        if self.kind == "layered_waveguide" and self.core_index <= self.cladding_index:
            raise ValueError("guided core index must exceed cladding index")
        return self


class MeshSpec(StrictModel):
    maxh_um: Annotated[float, Field(ge=0.06, le=0.8)] = 0.35
    order: Literal[2] = 2
    sample_shape: tuple[Annotated[int, Field(ge=3, le=129)], ...] = (25, 17, 13)
    max_dofs: Annotated[int, Field(ge=1000, le=500000)] = 250000

    @model_validator(mode="after")
    def bounded_samples(self):
        if len(self.sample_shape) != 3 or math.prod(self.sample_shape) > 500000:
            raise ValueError("sample_shape requires 3 axes with at most 500000 samples")
        return self


class ExcitationSpec(StrictModel):
    kind: Literal["manufactured", "localized_current"] = "manufactured"
    amplitude: Annotated[float, Field(gt=0, le=10)] = 1.0
    component: Literal["x", "y", "z"] = "y"
    center_um: tuple[float, float, float] | None = None
    width_um: Annotated[float, Field(ge=0.05, le=1)] = 0.15


class ExperimentSpec(StrictModel):
    schema_version: Literal[1] = 1
    name: Annotated[str, Field(min_length=1, max_length=120)] = "PEC cavity verification"
    wavelength_um: Annotated[float, Field(ge=0.6, le=8)] = 1.55
    geometry: GeometrySpec = Field(default_factory=GeometrySpec)
    mesh: MeshSpec = Field(default_factory=MeshSpec)
    excitation: ExcitationSpec = Field(default_factory=ExcitationSpec)

    @model_validator(mode="after")
    def compatible_model(self):
        cavity = self.geometry.kind == "manufactured_cavity"
        if cavity != (self.excitation.kind == "manufactured"):
            raise ValueError("manufactured source requires cavity; layered model requires current")
        if cavity and (self.excitation.component != "y" or self.geometry.material_loss != 0):
            raise ValueError("analytic cavity benchmark requires y polarization and zero loss")
        g = self.geometry
        if cavity:
            resonant_wavelength = 2*g.core_index / math.sqrt(1/g.length_um**2 + 1/g.height_um**2)
            if abs(self.wavelength_um/resonant_wavelength - 1) < 0.03:
                raise ValueError("manufactured analytic source is near its cavity resonance")
        if self.excitation.center_um is not None:
            for val, length in zip(self.excitation.center_um, (g.length_um,g.width_um,g.height_um)):
                if not math.isfinite(val) or abs(val) >= length / 2:
                    raise ValueError("source center must lie strictly inside physical domain")
        padded = tuple(v + (0 if cavity else 2*g.pml_thickness_um) for v in
                       (g.length_um,g.width_um,g.height_um))
        if math.prod(padded) / self.mesh.maxh_um**3 > 120000:
            raise ValueError("estimated mesh budget exceeded; use a smaller domain or larger maxh")
        return self

    def canonical_json(self) -> str:
        return json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"),
                          ensure_ascii=False, allow_nan=False)

    @property
    def spec_hash(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()
