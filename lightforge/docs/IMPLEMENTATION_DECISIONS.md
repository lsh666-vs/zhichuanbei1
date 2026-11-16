# Implementation decisions (append-only factual progression)

## 2026-11-16 — Windows native kernel adaptation

The approved plan chose NGSolve H(curl) FEM. The installed native OCC dependency is blocked by Windows application control (4551). Do not alter OS security for this project. Implement a full-vector 3D staggered Yee/FDFD Maxwell kernel using SciPy complex sparse systems instead. Preserve physical/gradient/robustness validation, material geometry, 3D coordinates and quantitative truthfulness. Keep ngsolve in an optional `fem` extra, not a required runtime dependency.

Second-order finite differences replace the planned FEM order setting; schema permits only order=2. Discretization accuracy must be assessed by convergence and independent checks. Native probes evaluate the original staggered-grid field with declared interpolation; do not call these exact FEM point evaluations. The later independent Meep route remains planned and must report actual evidence before claiming verified.
