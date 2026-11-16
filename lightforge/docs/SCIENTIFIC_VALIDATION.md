# Scientific validation protocol and claim boundaries

Status at document creation: protocol, not an execution report. Actual results belong in machine-readable benchmark outputs and the stage handoff, with exact commands and configuration hashes. A planned check is not a passed check.

## What each check establishes

| Check | Establishes | Does not establish |
| --- | --- | --- |
| Linear-system residual | The assembled discrete equation was solved sufficiently accurately | Correct physical model, adequate mesh, correct normalization or boundaries |
| Analytic/manufactured solution | Agreement of a selected PDE, geometry, source and boundary formulation with a known solution | General open-waveguide/device performance |
| Mesh/order convergence | Stability of chosen observables under the documented discretization changes | Correctness of a shared modelling assumption |
| Boundary/PML convergence | Chosen physical observations are insensitive to documented boundary changes | Manufacturing validity or target-port transmission |
| Power balance | Source, absorption and outward power agree under the chosen normalization and domain | Correct distribution among optical modes |
| Independent solver comparison | Agreement of distinct implementations under aligned physical conditions | Experimental fabrication performance |
| Adjoint finite difference/Taylor check | Derivative consistency for the tested parameter mapping and objective | Global optimality or all untested parameters |
| Fabrication ensemble | Performance in the stated uncertainty model and finite sample | Real foundry yield or unmodelled process errors |

## Stage 1 forward baseline

The baseline suite should include a nontrivial three-dimensional vector field with an independently known solution. A PEC-cavity manufactured solution is suitable when its tangential electric field satisfies the actual boundary condition. Its analytic source must be derived for the same wavelength, relative permittivity and time convention as the solver. Avoid an unforced cavity exactly at an eigenfrequency, where uniqueness is lost.

The selected Stage 1 reference is a centred rectangular domain with E = (0, sin(π(x+Lx/2)/Lx) sin(π(z+Lz/2)/Lz), 0). It is divergence-free; its tangential field vanishes on all PEC faces. In a uniform medium, curl curl E = [(π/Lx)² + (π/Lz)²] E, so the manufactured right-hand side follows directly from the actual Maxwell operator. This is a chosen verification problem with known forcing, not a claim that a passive unforced cavity generates the field by itself.

Measure relative L2 field error and, where meaningful, curl error. Report actual grid spacing, staggered component placement, degrees of freedom, source details and error values for each refinement. At least two discretizations should demonstrate a real accuracy change; a test that compares a field to its own serialized copy establishes persistence, not PDE accuracy. Native-grid interpolation and reduced display sampling are separate error sources.

The implementation also needs native-grid reload and probe tests. They should check complex components at interior physical positions, bounds rejection, material membership, handling of interface ambiguity and exclusion of PML points. A probe uses documented interpolation from staggered grid values, not an exact continuum reconstruction. Points on a material discontinuity must have a documented one-sided or ambiguous interpretation.

A layered-device demonstration with a localized source may produce useful real 3D fields. Until guided-mode injection and reference normalization are validated, the result must be labelled as a driven-field demonstration. It must not report a splitter efficiency or S-parameter derived from an arbitrary source amplitude.

The selected layered geometry is a straight trapezoidal SiN ridge with an optional residual slab determined by etch depth, embedded in silica cladding. A localized Gaussian impressed current drives the field. Layer thickness, etch depth and sidewall angle change the actual geometry. A Gaussian current is not automatically the fundamental guided mode, and arbitrary impressed-current normalization is retained in result metadata until calibrated port excitation is implemented.

## Maxwell open-boundary validation

The planned NGSolve/Netgen route encountered a Windows application-control rejection of an OpenCascade DLL. Stage 1 instead uses an original full-vector staggered-Yee FDFD implementation with SciPy sparse matrices; the machine policy is not changed. This is a numerical implementation change, not permission to weaken physical verification. NGSolve remains optional. Its documentation also states that the general PML facility is tested on H1 spaces and cautions about nonconstant coefficients under complex mappings, so any future finite-element route requires its own vector-Maxwell verification. [Official PML documentation](https://docu.ngsolve.org/latest/how_to/pml.html)

The Maxwell absorber must apply the intended transformed permittivity/permeability tensors consistently. Its verification matrix includes physical-domain size, absorber thickness, stretch strength, mesh resolution near the transition and edge/corner combinations. An apparent reduction of total field magnitude alone is insufficient. Record reflected amplitudes or interior-observable changes in a test with a known reference.

At an unchanged physical structure, compare at least the source-side response, output-side response and a set of interior probes. Physical monitors remain outside the absorber. A zero field obtained by excessive damping in the physical region is a failure rather than a successful boundary condition.

## Optical port and power validation

Before evaluating the flagship splitter, validate the fundamental guided mode and any additional supported modes of each port cross-section. Preserve mode orientation, phase, propagation direction, normalization and wavelength. Track modes consistently through parameter sweeps; sorting solely by index may exchange two near-degenerate modes.

Use a straight-waveguide/reference experiment to establish incident power and reference phase. Check forward/backward mode coefficients against signed Poynting flux. A change of port geometry/material requires a new modal solve and normalization. The Meep tutorial provides a primary example of cross-checking modal coefficients and Poynting flux, including the need for a normalization run. [Mode-decomposition tutorial](https://meep.readthedocs.io/en/latest/Python_Tutorials/Mode_Decomposition/)

For exp(-iωt), the time-averaged energy flux is 1/2 Re(E × H*). Keep the outward normal and area units explicit. A closed physical surface measures outward power; radiation and absorption must appear in the power budget. A display of |E|² is not a port power integral, and a bright output point is not a guided-mode efficiency.

## Adjoint validation — Stage 2

Differentiate the same assembled operator and material mapping used in the forward solve. Document the real-objective complex variation, adjoint operator and sign convention. Loss, absorbing boundaries and complex materials generally prevent assumptions that the system is Hermitian.

For a fixed interior parameter point and direction d, sweep multiple perturbation sizes h and compare the central difference [J(θ+hd)-J(θ-hd)]/(2h) with the adjoint directional derivative. Include absolute error for near-zero derivatives, where relative error is ill-conditioned. A Taylor remainder should show the expected order over a non-roundoff-limited range. Do not claim a derivative fails or passes from one convenient h alone.

Test the complete chain: design variable → filter → projection/geometric map → material/mesh → field → objective. Freeze the discretization where required for a differentiable check. If shape changes trigger remeshing or topology changes, disclose that discontinuity and use a compatible fixed-domain or shape-calculus treatment. Source and reference-normalization derivatives must be included when affected by design parameters.

Representative checks cover material density, a geometry parameter, wavelength-specific objective aggregation and a manufacturing scenario. Repeat on a lossy/open model after a closed analytic benchmark. Do not display a 2D or column-summed gradient as a general 3D design freedom.

## Constraints and fabrication — Stage 2

Record the design-space dimensions, fixed masks, source configuration, random seeds, solver tolerances and compute budget before comparisons. Compare nominal and robust optimization using aligned evaluation conditions, preserving unsuccessful runs and all tested seeds.

The final binary geometry must be checked independently of the optimizer's smooth penalty. Measure minimum material width, void spacing, small connected regions and process-relevant cross-sections. Include sidewall angle, etch depth and layer thickness where part of the chosen process model. Any geometric repair is a new structure and requires a new electromagnetic evaluation.

Robust optimization may include erosion/dilation and selected process variations. Final evaluation uses separately held-out variations with documented ranges, probability laws, correlations and sample counts. Uniform etch bias does not cover every random roughness mechanism. Perturbations on one physical wafer may be correlated; an independence assumption must be stated, not silently inferred.

For a finite sample, report successes/total and an appropriate uncertainty interval. The label is simulation pass rate under the stated model. No manufacturing certification or physical yield claim follows without real process and measurement evidence.

## Cross-solver and three-dimensional acceptance

The primary Yee-FDFD and independent Meep models must agree on geometry, material dispersion/loss, source, port definition, phase reference, physical boundaries and observables before comparing numbers. Independently converge both solvers. Align sampling only after preserving the original numerical solutions. If an optional NGSolve implementation is later admitted, it receives the same independent checks. Explain discrepancy rather than selecting a visually convenient normalization.

Two-dimensional/effective-index and full-three-dimensional calculations are different physical models. Their difference is model error, not necessarily a solver bug. State thickness and vertical confinement assumptions, and include out-of-plane radiation in the full-3D analysis.

The full-product goals below are acceptance targets, not observed results:

| Quantity | Target |
| --- | --- |
| Representative normalized discrete residual | ≤ 1e-8 |
| Complete passive benchmark power-budget error | ≤ 1%, including radiation and absorption |
| Converged transmission change under additional mesh/boundary refinement | ≤ 1 percentage point |
| Smooth representative adjoint directional relative error | ≤ 1e-3, plus step sweep/Taylor evidence |
| Independently converged 3D solver transmission difference | ≤ 2 percentage points, exceptions analysed |
| Flagship nominal target-port power / isolation | ≥ 85% / ≥ 15 dB under frozen design budget |
| Flagship stated fabrication-range target-port power / isolation | ≥ 75% / ≥ 12 dB under the same frozen budget |

The final report must list which goals passed, failed or were not run. Failed full-product acceptance cannot be converted to success by changing colour scales, removing samples, loosening the design budget after evaluation, or calling a foundation benchmark the flagship.

## Required execution receipt

Each scientific receipt records date, exact command, configuration and hash, repository commit, dependency versions, physical model, hardware, discretization, solver tolerances, runtime/memory observations, raw artifact hashes and numerical outputs. Distinguish measurements from estimates. If an experiment was interrupted, preserve that state rather than reporting its planned output.
