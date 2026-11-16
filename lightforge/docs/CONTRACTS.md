# LightForge data and numerical contracts — v1

This contract describes Stage 1 source interfaces and the serial extension boundary, not a passing-test receipt. API/CLI execution status belongs in `handoffs/STAGE_1.md`; complete-product requirements remain in `DEVELOPMENT_PLAN.md`.

## Physical conventions

- Public lengths are μm. Geometry uses a right-handed x/y/z frame centred at the origin; z is thickness.
- Fields use exp(-iωt), E in V/m, H in A/m, and time-averaged Poynting density in W/m². Relative ε/μ are dimensionless; positive imaginary ε is passive under this convention.
- `manufactured_cavity` uses a known analytic forcing and PEC exterior, with normalization `manufactured_exact_field_amplitude_V_per_m`.
- `layered_waveguide` uses a compact impressed current in a silica-clad SiN ridge/slab and exterior anisotropic PML, with normalization `arbitrary_compact_impressed_current_not_port_normalized`. Source amplitude does not establish optical efficiency or S-parameters.
- Preview geometry, sampled display data and computed 3D results retain distinct identities. A 2D field is never extruded into a 3D computed result.

## Validated specification

`models.ExperimentSpec` is the canonical immutable Pydantic configuration. Unknown fields and nonfinite values are rejected. JSON uses `schema_version: 1`.

| Field group | Current content |
| --- | --- |
| Experiment | `name`, `wavelength_um`, `schema_version` |
| `geometry` | Model kind; centred domain dimensions; core width/thickness; etch depth; sidewall angle; core/cladding indices; loss; design length; PML thickness |
| `mesh` | `maxh_um`, second-order difference setting `order: 2`, sample shape, actual unknown budget |
| `excitation` | Manufactured/current kind, amplitude, component, optional physical centre, compact-current width |

The `mesh` group now denotes a staggered finite-difference grid, not finite-element polynomial order. `maxh_um` is a requested maximum spacing; actual spacings follow domain/cell counts and are recorded. `order` is fixed at 2. Cross-field validation checks geometry fit, etch consistency, source/model pairing, source position and preliminary resources. Grid creation also checks actual unknown count and source support/resolution. A valid spec is not proof of design feasibility or scientific accuracy.

`canonical_json()` serializes the entire validated spec with sorted keys, compact separators, Unicode and no NaN values. `spec_hash` is SHA256 of those UTF-8 bytes. The hash currently includes `name`; changing that requires an explicit migration. Generated JSON Schema is written to `docs/schemas/experiment.schema.json` by the owner.

## Geometry

`geometry.physical_bounds(spec)` returns a 3×2 array of lower/upper physical bounds. Exterior PML is additional computational space.

`material_at(spec, points)` returns material IDs (0 cladding, 1 core) for coordinates in the final axis. `epsilon_at(spec, points)` returns complex relative ε. Analytic straight-waveguide geometry continues through x-directed PML rather than terminating at the physical boundary.

`build_scene(spec)` returns serializable physical bounds, materials, parametric solids, design region, PML metadata and port candidates. A prism uses an x-range and ordered y/z polygon. The renderer uses these same dimensions. Port candidates locate geometry and are not calibrated optical modes. `build_geometry(spec)` is a scene-description compatibility alias, not a Netgen builder.

Camera, clipping, visibility and exploded-view operations are observation-only and keep the physical hash unchanged. Thickness/depth/sidewall edits produce a new spec/version and require a new numerical run.

## Numerical interface

The primary implementation is original full-vector 3D Yee-FDFD using SciPy sparse matrices. Windows application control blocked a required OpenCascade DLL in the planned NGSolve/Netgen route. NGSolve remains optional, not an implemented production solver; physical acceptance requirements remain unchanged.

`solver.make_grid(spec)` returns `YeeGrid`: native node axes, component-specific edge/face coordinates and shapes, free electric degrees of freedom and the oriented edge-to-face discrete curl. Tangential E edges on the computational PEC exterior are eliminated.

`solver.assemble(spec)` returns `MaxwellSystem`: `spec`, `grid`, actual sparse `matrix`, `rhs`, `epsilon_edges`, `mu_inverse_faces`, and either `exact_edges` or `current_edges`. Stage 2 uses this operator for a verified discrete adjoint. It must not differentiate display textures or assume a lossy/PML system is Hermitian.

`solver.solve(spec, output_dir, progress=None, cancelled=None)` writes artifacts and returns the result manifest. Progress receives `(stage, fraction)` at real boundaries; optional cancellation is checked at those boundaries. The job service can also terminate its worker. Progress does not claim continuous completion estimates inside sparse factorization.

`NativeField` reconstructs H from the discrete curl of native E using the corresponding μm wave number and free-space impedance. `evaluate(points)` interpolates native staggered component samples and validates finite physical-domain positions. Interface stencils can mix adjacent materials. At a physical boundary a staggered component may require half-cell extrapolation, which is a numerical limitation rather than exact reconstruction.

`solver.probe(output_dir, (x,y,z))` reloads spec/native electric coefficients, rebuilds the grid and returns complex E/H, Poynting density, material ID, coordinate and hash. It samples the native-grid interpolant, never a GPU texture, and rejects points outside the physical box/PML.

## Artifacts

| File | Meaning |
| --- | --- |
| `spec.json` | Exact validated physical spec |
| `scene.json` | Same-spec geometry and scene metadata |
| `result.json` | Model/engine/spec identity, normalization, units, metrics, limitations, coverage, artifact sizes/hashes |
| `coefficients.npy` | Full original complex E edge vector, object pickle disabled |
| `grid.npz` | Native node axes `x`, `y`, `z` |
| `fields.h5` | Structured display samples with sampling metadata |

HDF5 datasets: `axes/x_um`, `axes/y_um`, `axes/z_um`; `E/real`, `E/imag`, `H/real`, `H/imag`, each shaped `(nx,ny,nz,3)`; `poynting_w_m2` with the vector shape; `material_id` shaped `(nx,ny,nz)`. Order is x/y/z/component. Display sampling performs interpolation, not another solve.

Six physical-box faces record signed outward flux, normal and midpoint quadrature. They are approximate flux integrals, not mode-resolved power. Source-work/surface-flux mismatch is a convergence diagnostic, not proof of a valid device. The cavity records edge-field error versus analytic reference and an analytic discrete-error prediction.

Consumers validate schema/model, hash, dimensions and finite values. Checksums establish identity, not accuracy. Arbitrary object deserialization is prohibited. Display downsampling cannot silently change scientific metrics.

## Persistence and jobs

`Store` uses SQLite transactions for immutable specs, runs and monotonic events. States are queued/running/completed/failed/cancelled. Terminal states cannot be overwritten by late worker progress. Stage 1 serializes numerical jobs and bounds the queue.

Startup marks abandoned running jobs as interrupted failures while preserving inputs. Queued jobs may continue. Cancellation, worker termination and timeout preserve truthful terminal states. Parameter limits and queue bounds are not an operating-system memory sandbox; only claim hard memory enforcement after implementing and testing it.

## HTTP and CLI contract

The owner implements the following surface; actual source and handoff determine which routes have been run:

- `POST /api/experiments`, `GET /api/experiments`, `GET /api/experiments/{id}`: validate/create/list/read specs.
- `POST /api/experiments/{id}/runs`: create an immutable queued run.
- `GET /api/runs/{id}`, `POST /api/runs/{id}/cancel`: state, manifest and cancellation.
- `GET /api/runs/{id}/events`: persisted SSE and reconnection via event IDs/`Last-Event-ID`.
- `GET /api/runs/{id}/artifacts/{name}`: manifest-listed approved basenames below that run directory.
- `GET /api/runs/{id}/probe?x=...&y=...&z=...`: native-grid probe of completed result.
- `GET /api/runs/{id}/export`: bounded archive of approved data, no credentials/executable payloads.

Any import validates paths, sizes, file count and numeric schemas. No arbitrary path selection. API binds localhost by default; same-origin product/optional AI integration comes in Stage 3.

CLI: `python -m lightforge.cli schema`; `solve <spec.json> --output <directory>`; `validate --output <directory>`; `serve --port 4321`. Record executed receipts, paths and versions; keep return codes suitable for scripting.

## Serial extension

Stage 1 lists actual baseline coverage and shortcomings. Stage 2 owns guided-mode injection/reference calibration, verified adjoint and design derivatives, constrained optimization, final manufacturing-rule checks, fabrication scenarios, robustness and independent validation. Schema changes require explicit compatible migration. A manufactured cavity is not a validated splitter.

Stage 3 builds the complete 3D teaching/product interface and release. Four scientific capabilities remain mandatory. Each handoff records exact commits, commands, actual pass/fail/not-run checks, artifacts, limits and READY state. READY means ready for the next stage, not final acceptance.
