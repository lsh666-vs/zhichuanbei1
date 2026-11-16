# LightForge architecture

Version: 2026-11-16. This document distinguishes the Stage 1 foundation from the complete product plan. Passing a foundation benchmark does not establish that the final photonic splitter, adjoint optimizer, or user interface is complete. See [development plan](DEVELOPMENT_PLAN.md), [contracts](CONTRACTS.md), and the latest handoff for observed completion.

## Responsibilities and dependency direction

The application has one physical experiment specification. It drives both the computational model and the scene description. The frontend does not invent a second geometry, and a display transform is never silently written back as a physical parameter.

```text
Validated experiment specification + canonical hash
                  |
          geometry/material model
             /             \
  scene representation    staggered Yee grid + source
             |                      |
      Three.js renderer       Maxwell forward solve
             |                      |
 observation/bookmarks    immutable numerical artifacts
             \                    /
             linked probes and analysis
```

The numerical modules depend on the schema and geometry layer, not on HTTP or React. The API delegates long calculations to a separate process and stores metadata and events. The same experiment can be run from the command line. The user interface consumes versioned results; it does not supply executable numerical code.

Implementation decision: Windows application control rejected an OpenCascade DLL required by the planned NGSolve/Netgen geometry path. The project does not change that machine security policy. Stage 1 therefore implements an original three-dimensional vector FDFD operator on a staggered Yee grid, using SciPy sparse linear algebra. NGSolve remains an optional dependency and a possible future independent route, not a runtime requirement or an implemented numerical capability. The physical scope and validation requirements remain unchanged.

| Component | Stage 1 responsibility | Subsequent work |
| --- | --- | --- |
| Typed configuration | Validate finite numbers, dimensions, units, model types and resource limits | Versioned optimization and fabrication specifications |
| Geometry | Actual three-dimensional volumes, material regions, bounds and scene metadata | Final manufacturing rules, arbitrary design masks and export refinements |
| Numerical kernel | Three-dimensional vector FDFD Maxwell problem, native E/H grid values, numerical baselines | Verified adjoint, optical port calibration, design/robust optimization |
| Result artifacts | Native grid/edge degrees of freedom, display samples, manifest and provenance | Optimization trajectories and fabrication ensembles |
| Experiment service | Immutable run snapshots, persistence, events, cancellation and safe artifact access | Optimization checkpoints and additional lifecycle controls |
| Presentation | Data and scene contract, original visual assets | Complete React/Three.js workbench, teaching and AI integration |

Actual module names and fields are governed by code and [CONTRACTS.md](CONTRACTS.md). Scientific coverage is governed by result evidence, not by the table above.

## Physical and numerical conventions

- Coordinates form a right-handed Cartesian frame. The device lies in the x/y plane and thickness is z. Geometry is expressed in micrometres unless a field explicitly says SI.
- Harmonic time dependence is exp(-iωt). Complex fields retain both real and imaginary parts.
- Material parameters are relative permittivity/permeability with an explicit loss convention. A change in sign convention requires coordinated source, field and flux changes.
- Source amplitude and field units must be declared by the model. A manufactured right-hand side or an arbitrary dipole does not establish unit incident waveguide power.
- Computed fields, geometry previews, two-dimensional approximations and stored replays have distinct result metadata. Two-dimensional samples cannot be extruded into a purported three-dimensional field.
- PML regions are computational regions, excluded from physical probes and observations unless explicitly being inspected for numerical diagnostics.

The primary solver assembles the full vector curl-curl equation on staggered component locations. Component placement, the discrete curl, material assignment and boundary treatment must be documented and tested together. A scalar Helmholtz solve or a two-dimensional result repeated through thickness would not satisfy this contract. The optional finite-element route uses a different discretization and must pass its own verification before its results are admitted.

## Identity, versions and results

An experiment may be edited by creating a new stored configuration/version. A run always keeps the exact submitted configuration and canonical hash, even when the user changes an editable experiment later. Results reference the run and its specification, not whichever form is currently on screen.

Every numerical result should carry the model identifier, configuration hash, engine and dependency versions, grid settings, source/normalization, sampling convention, physical units and validation coverage. A cache entry additionally depends on the material model and solver settings. View-only properties such as orbit angle, visibility, clipping position and exploded-view separation are not physical cache inputs.

Native staggered-grid coordinates and field degrees of freedom are the scientific authority. Display arrays are derived data and may use reduced sampling for browser responsiveness. A probe interpolates from the native numerical grid using a documented method; it is not an exact analytic continuum value. Reported metrics and probes must not be calculated from a screenshot or a lossy GPU texture. Exports retain the information needed to recompute the physical result.

The Stage 1 numerical writer defines `spec.json`, `scene.json`, `result.json`, native electric edge values in `coefficients.npy`, native grid nodes in `grid.npz`, and structured display samples in `fields.h5`. Arrays are loaded with object pickle disabled. HDF5 stores `axes/x_um`, `axes/y_um`, `axes/z_um`; complex E/H use separate `real` and `imag` datasets shaped (nx, ny, nz, 3). It also stores `poynting_w_m2` and `material_id`. The result manifest is authoritative for artifact names/checksums and numerical metadata; check its version rather than assuming every future result has an identical set.

Field units are E in V/m, H in A/m and Poynting flux density in W/m². For coordinates in μm, H is reconstructed with the corresponding μm wave-number conversion and free-space impedance. The native probe reconstructs edge/face field values and interpolates them; a stencil can cross a material interface, so the query must retain that limitation. An impressed-current demonstration carries the explicit normalization `arbitrary_compact_impressed_current_not_port_normalized`.

For complex field comparisons, identical excitation, source normalization and a common phase reference are required. A relative phase shift can produce a visually large difference between physically equivalent harmonic fields. Differences between different discretizations also require an explicit common sampling domain and interpolation policy.

## Task and storage boundary

SQLite stores experiment/run metadata and monotonic event records. Large numerical arrays and native grid data live in per-run directories. Numerical computations execute outside the API process so a solve does not block status requests. Jobs must have bounded resource consumption and explicit terminal states.

Planned run states are queued, running, completed, failed and cancelled. Events are persisted before delivery through SSE; reconnection uses event identifiers. Startup must identify jobs whose previous worker no longer exists. Cancellation must not report success while a worker still writes a result as completed. Partial artifacts remain visibly incomplete and cannot be mistaken for a completed manifest.

Pausing and resuming an optimizer is a later-stage capability. If internal optimizer state cannot be serialized exactly, continuation must be described as restarting from the saved structure rather than reproducing the same trajectory.

Paths are resolved beneath the selected data directory. Artifact endpoints serve manifest-listed basenames; user input cannot select an arbitrary filesystem file. Imports enforce archive size, path, count and array-shape limits. Native numerical reload formats are for locally generated, validated artifacts; untrusted object pickles must never be accepted.

## Three-dimensional interaction contract

The scene representation carries actual geometry bounds, materials and physical coordinates. It must support selecting a material or parameter and locating a probe in the original physical frame. Scene deformation for explanation, visual exaggeration and exploded layers are separately tracked, labelled and reversible.

When the geometry specification changes, the UI displays the new geometry preview and marks previous fields as belonging to the old run. The user can keep an old result for comparison, but the old field is never relabelled as a result for the new structure. A compute request creates a new immutable run. Geometry is rasterized onto the computational grid using an explicit convention; grid refinement is required to assess geometric discretization error.

Linked views share selection, physical location, run identifier and—when requested—camera, clipping plane and colour scale. They do not share mutable numerical state. Read-only camera operations cannot enqueue calculations. Physical parameter edits can enqueue a validated calculation only through the normal task API.

## Stage 2 numerical extension

The forward solver must expose the assembled discrete operator, source, state and parameter/material mapping through an internal Python interface. Stage 2 differentiates this actual discrete problem. Lossy/open systems must not be assumed Hermitian, and the adjoint must use the documented complex convention.

The design mapping is a sequence of explicit operations: independent parameters, filter/projection or geometric mapping, material distribution, field solution and objective. Each operation needs a derivative or a clearly disclosed numerical treatment. Derivatives of incident modes or normalization matter whenever a design parameter affects them.

Manufacturing uncertainty changes the physical geometry or material. It is represented in the experiment/configuration, not as a shader displacement attached only to the rendering mesh. Sample identity, seed and distribution persist with the evaluated result.

## Stage 3 product extension

React/TypeScript handles application state and interactions. Three.js with React Three Fiber provides the 3D workbench, WebGL2 volume data and clipping. ECharts and KaTeX provide spectra, convergence, statistics and equations. The API remains the authority for run status and numerical provenance.

AI may propose a typed configuration or explain observed results. Programmatic checks remain authoritative for units, model scope, resource limits and physical conflicts. AI-generated code, shell, SQL and Python are not executed. Core experiments run without an API key; an AI outage cannot terminate a numerical task.

## Deployment and filesystem

Development, runtime data, caches, logs and test profiles default to D:. The current user permits plugin installation on C:, but no such installation is required by this architecture. Existing image-generation permission applies to newly generated files before copying selected assets into the repository.

The complete product targets a self-contained Windows runtime and a browser interface bound to localhost by default. The package must include a small genuine 3D computation for the ten-minute reproduction path. Full high-accuracy optimization and independent verification have separately reported runtimes. Meep-based independent verification runs in a Linux environment and is not a prerequisite for ordinary Windows interaction.
