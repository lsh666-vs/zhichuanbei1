# Stage 1 numerical model, checks and limits

Implementation: original vector three-dimensional Yee/FDFD Maxwell kernel using SciPy sparse complex factorization. NGSolve/OCC could not load under the host's application-control policy; no security policy was changed. This is a documented solver adaptation, not an extrusion of a two-dimensional field.

## Discretization and units

Time dependence is exp(-iωt). Coordinates are μm, relative permittivity is dimensionless, E is V/m and H is A/m. The full electric vector is sampled on oriented cubical edges; the discrete curl C maps edges to oriented faces. Tangential E edges on the exterior PEC termination are removed. The native linear system is Cᵀ μ'⁻¹ C E − k0² ε' E = i k0 Jnorm, where k0 is μm⁻¹. H = μ'⁻¹ C E / (i k0 Z0), Z0=376.730313668Ω. Surface integrals convert μm² to m² by 1e-12; current normalization is Jnorm = Z0·1e-6·J_SI. Impressed-current amplitude is arbitrary and is not mode/input-power normalized.

The open ridge core and residual slab continue through the x-directed PML, so the computational termination does not introduce an unintended waveguide end. Sidewall angle is measured from the substrate plane, top width is specified, and bottom width widens by twice etched depth divided by tan(angle). Geometry, material sampling and scene polygons use the same definitions. A compact Gaussian-windowed current has radius 3σ, with exact zero outside support and before the PML.

The PML uses outward coordinate stretches s_i=1+iσ_i, ε'_i=ε s_xs_ys_z/s_i² and μ'⁻¹_i=s_i²/(s_xs_ys_z). No second scalar damping/PML transformation is applied. Physical grid cells stay fixed under PML thickness changes. Padding rounds upward to whole cells; actual per-axis PML thickness is recorded in each result and scene. A roundoff-aware ceil avoids an extra cell from 0.6/0.2 rounding above 3. All physical observables exclude PML interiors; magnetic interpolation near the interface uses transformed μ, not free-space reconstruction in exterior samples.

## Independently derived manufactured reference

Uniform PEC cavity: E=(0, cos(πx/Lx)cos(πz/Lz),0) times the specified amplitude. It satisfies zero tangential E at all exterior faces and div(E)=0. The continuum forcing is (π²/Lx²+π²/Lz²−k0²n²)E. The manufactured source is guarded against its analytic zero-forcing resonance.

For this particular separable mode, the independent Yee eigenvalue is λ_h=(2sin(πh_x/(2Lx))/h_x)²+(2sin(πh_z/(2Lz))/h_z)². This predicts the finite-grid amplitude error without solving the matrix. Comparing computed E to that prediction checks operator signs, edge indexing, PEC elimination and source scaling. A separate analytic H comparison checks curl sign and impedance/length conversion.

2026-11-16 execution, 1.6μm cube, 4/8/12 cells per side:

| Cells/axis | Unknowns | Relative E error | Relative matrix residual |
|---|---:|---:|---:|
| 4 | 108 | 0.00664819050125 | 2.5189e-16 |
| 8 | 1176 | 0.00169626695733 | 5.2100e-15 |
| 12 | 4356 | 0.000756763416793 | 3.0000e-14 |

Measured continuum convergence order: 1.97799472728. Computed errors agree with independent discrete eigenvalue predictions. The residual alone is not used as an accuracy certificate.

## Analytic open modal reference

The second benchmark solves the full vector three-dimensional system in a homogeneous guide with PEC transverse y/z walls and PML only along propagation x. E_y=u(x)sin(π(z+Lz/2)/Lz), independent of y. These transverse PEC boundaries are intentional analytic conditions, not silica-clad SiN waveguide physics.

For the infinite discrete guide, transverse eigenvalue λ_z,h=(2sin(πh_z/(2Lz))/h_z)², 4sin²(θ/2)/h_x²=(k0n)²−λ_z,h. A unit discrete current sheet Jnorm=δ_i/h_x gives u_i=−k0h_x exp(iθ|i−i0|)/(2sinθ). This separately derived discrete Green function isolates PML reflection from ordinary bulk Yee dispersion. At odd Nz, comparison divides the measured transverse sample by its actual sin profile rather than assuming the center equals one. A least-squares forward/backward mode fit independently reports reflected amplitude. Consistent staggered E/H flux and source work check power accounting.

Physical guide length 2.4μm, transverse dimensions 0.6×0.8μm, n=1.44, λ=1.55μm, h≈0.1μm:

| PML thickness μm | Unknowns | E/reference relative error | Reflected amplitude ratio | Source/flux relative mismatch |
|---|---:|---:|---:|---:|
| 0.4 | 3662 | 0.00334911466145 | 0.00244525593415 | 1.1336e-15 |
| 0.8 | 4598 | 0.00259315835336 | 0.00189247174204 | 8.0901e-16 |
| 1.6 | 6470 | 0.00207338937998 | 0.00151489273959 | 4.8653e-16 |

The table is the root rerun after the final roundoff-aware grid correction, recorded in evidence/005-scientific-rerun.json. The earlier development receipt 004 is retained as historical evidence and must not replace this current table. The analytic-reference and reflection checks meet the declared 1% threshold for this benchmark. This does not validate every PML configuration or a calibrated optical port.

## Layered open model remains a quantitative validation gap

The true three-dimensional SiN ridge can be solved and its E/H fields saved and probed. The fixed-physical-grid coarse h=0.2μm ridge test still changes selected physical electric samples by about 33.90% then 12.20% for requested PML thicknesses 0.3/0.6/1.2μm. Its collocated physical-surface/source power mismatch remains approximately 9–10%. These are failed accuracy/convergence checks, retained in evidence/004-scientific-verification.json, not omitted from the report.

Stage 2 must improve/calibrate open dielectric transport, interface discretization and flux measurement, then independently cross-check before publishing optical efficiencies or claiming the flagship splitter targets. Raw current-driven fields are explicitly not S parameters. Material interfaces currently use point sampling without subpixel averaging; probe interpolation may mix adjacent material samples. Phase 1 includes no adjoint, optimizer or fabrication-robustness result.

## Native results and probes

- `assemble(spec)` returns `MaxwellSystem`: matrix, rhs, grid (axes, free edges, curl, edge/face points), transformed permittivity, inverse permeability and exact/current vectors. Stage 2 can differentiate the real discrete state rather than rendered textures.
- `solve(spec, output_dir, progress(stage,fraction), cancelled())` returns a JSON manifest, writes result/spec/scene, fields.h5, coefficients.npy and grid.npz. Cancellation is checked at safe boundaries, not inside a SuperLU factorization.
- fields.h5 contains x/y/z axes, E and H real/imag arrays, real time-averaged Poynting and material IDs. Display sample shape is separate from native discretization.
- Native E stays in coefficients.npy (no pickle). grid.npz stores original axes. `probe` validates layout/spec identity and saved axes before evaluating trilinear interpolation of original edge/face samples. Editing display HDF5 data does not affect probes. A future incompatible grid layout requires migration or recomputation, not silent reinterpretation.
- Scientific artifact allowlist excludes task input.json and mutable worker.log. The result manifest hashes only scientific files.

## Reproduction

From the LightForge directory, dot scripts/env.ps1, then use `.venv/Scripts/python.exe -m pytest tests/test_geometry.py tests/test_solver.py -q`. The final numerical/geometry set has 20 tests. Run `python -m lightforge.cli benchmarks --output <D: directory>` for full benchmark receipts. Root reran the full receipt after final corrections, at `.runtime/science-final-rerun/verification.json`, tracked as evidence/005-scientific-rerun.json. Elapsed times are machine/run observations, not product guarantees.
