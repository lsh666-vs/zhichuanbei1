# Stage contracts — v1

All values use μm and dimensionless relative ε/μ unless a field explicitly says SI. Time convention exp(-iωt), Cartesian right-handed x/y/z, z is thickness. Results must declare model, normalization and validation coverage.

## Stage 1 interfaces

`lightforge.models.ExperimentSpec` is the canonical validated configuration. It contains a unique name, wavelength_um, geometry (box / layered device), mesh settings, excitation and monitor definitions. Serialized JSON uses `schema_version: 1`; reject unknown fields/nonfinite values/excess resource budgets. Spec hash is canonical JSON SHA256, excludes mutable metadata only if documented. Final typed schema is generated to docs/schemas/experiment.schema.json.

`lightforge.geometry.build_geometry(spec)` returns Netgen geometry and descriptive scene metadata. Scene uses meters only when explicitly requested; canonical geometry is μm. Surface meshes and layer descriptions are actual model geometry, not independent approximations. Scalar/vector functions can be sampled at physical coordinates.

`lightforge.solver.solve(spec, output_dir, progress=None)` returns a serializable result manifest and writes raw artifacts. Root retains API/store ownership; numerical agent defines result dataclasses with explicit units and updates this contract. Actual `E(x,y,z)` and derived `H` sampled on structured display grid; raw finite element coefficients/mesh kept separately. Scalar complex arrays store real/imag explicitly. PML points excluded from physical observables; material IDs accompany samples.

Benchmarks: analytic PEC cavity eigenfield/manufactured source and plane/slab or straight-waveguide transport. Residual must not be sole evidence. Declare normalization: a manufactured/dipole source is not an input-port-normalized optical device, no fictional S-parameters. Flux is physically integrated and signed with explicit normal; transmission requires validated input reference.

Stage 2 must receive assembled A, source b, state vector and parameter/material mapping through an internal numerical interface, without computing gradients from lossy frontend textures. Complex derivative convention is documented; no assumptions of Hermitian A in lossy/open systems. Stage 2 may expand schema with versioned migration, keeping existing specimens valid.

## Persistence/API

`POST /api/experiments` validates and stores a spec; GET list/detail. `POST /api/experiments/{id}/runs` creates immutable run tied to spec/hash. `GET /api/runs/{id}` status + artifact manifest; `POST /api/runs/{id}/cancel` cooperative boundary cancellation. `GET /api/runs/{id}/events` SSE states; monotonically numbered persisted events, recoverable by Last-Event-ID. Run states: queued/running/completed/failed/cancelled; startup detects interrupted jobs. Phase 2 may add optimization checkpoints and pausing; never claim support before implementation.

`GET /api/runs/{id}/artifacts/{name}` only manifest-listed basename artifacts from run directory, no arbitrary paths. `GET /api/runs/{id}/probe?x=...&y=...&z=...` evaluates original field when available; no extrapolation outside physical domain. `GET /api/runs/{id}/export` immutable result bundle without credentials/executable pickle objects. Import rejects unsafe paths/oversized payloads. API binds localhost by default; fixed same-origin deployment in stage 3.

## Stage boundaries

Stage 1 will explicitly document which scientific benchmarks pass and which are pending. Stage 2 owns adjoint, actual optical port calibration, design optimization and fabrication scenarios; do not ship a manufactured field benchmark as a validated splitter. Stage 3 owns visual/interactive product. Each handoff lists tested commands, commits, artifact formats, limits and READY status.

See docs/DEVELOPMENT_PLAN.md for complete (all stages) acceptance targets. Quality does not mean all three stages are claimed implemented in stage 1.
