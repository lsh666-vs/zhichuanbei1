# Native power correction — 2026-11-16

Stage 2 received the explicit READY message at baseline 9426d2f. The unchanged
baseline reproduced 38 passing tests (6.65 s), Ruff passed, and GitHub main
matched that baseline before ownership was changed in d341476.

`power.native_box_power(system, electric, bounds_um)` measures the original
staggered E/H fields. On node-aligned surfaces, use tangential E and the average
of the two neighboring tangential H faces. Integrate with endpoint half weights
along the transverse node coordinate and full weights along the edge midpoint
coordinate. Source work and dielectric absorption use the same dual volumes.
This is the summation-by-parts power identity of the discrete curl operator.
It does not use the interpolated display field and does not establish continuum
accuracy, guided-mode normalization, S parameters, or device efficiency.

Actual checks: `python -m pytest tests/test_power.py -q`: **2 passed, 1.21 s**.
They solve open, truly 3D SiN/silica geometries with both zero loss and imaginary
core permittivity 0.1. Radiation on all axes participates. Source, absorption
and outward flux balance to <1e-10; invalid/PML/non-node boxes are rejected.

`scripts/stage2_transport_scan.py` reproduces the first-stage coarse h=0.2 um
ridge, varying transverse domain size (1.2/2.4 um) and PML (0.6/1.2 um).
Raw output is `008-stage2-transport-scan.json`; each entry binds exact spec/hash,
unknown count, coordinates and computed values. Native power relative errors
are 2.23e-16, 1.01e-14, 8.84e-16 and 1.69e-14. The earlier 9–10% mismatch from
interpolated surface integration remains in historical receipts. It is explained
by a measurement error, not silently removed.

PML field sensitivity remains unresolved: widening the cladding does not remove
the coarse-grid changes. This module fixes discrete power measurement only.
Stage 2 therefore continues to mode injection, mesh/PML convergence and separate
independent transport validation before publishing flagship metrics.

Primary reference consulted: [Meep PML documentation](https://meep.readthedocs.io/en/latest/Perfectly_Matched_Layer/)
describes finite-grid PML reflection, repeated thickness doubling, and the need
to keep transverse evanescent tails away from PML. This motivates separate
tests; the numbers above are our actual computations, not Meep output.
