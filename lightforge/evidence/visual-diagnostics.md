# Scientific visual diagnostics — actual-data artifact

Date: 2026-11-16. The diagnostic renderer was added as a Stage 1 scientific inspection artifact, separate from the final Stage 3 interactive product. It reads only explicitly selected solver artifacts and the existing verification receipt. It does not read `.env`, credentials or private keys.

## Implementation

`scripts/render_diagnostics.py` validates the canonical specification hash against `result.json`, `scene.json` and HDF5 metadata, and checks the manifest SHA256/byte counts of the selected spec, scene and field file. It validates axis ordering, finite values, sample dimensions and physical units before rendering.

The self-contained HTML embeds Plotly 6.5.0 and actual data. It contains four plots: a rotatable 3D isosurface with Re(Ey)/|Ey| selection, two 3D surfaces with sliders selecting actual z-sample slices, and the existing cavity error/residual convergence records. Coordinates are μm and E is V/m. The source model, normalization, hash, sampling limitations, validation coverage and open-PML status remain visible.

The script does not solve new fields or manufacture missing convergence values. Missing run artifacts or missing/invalid convergence data raise a clear error and no output page is created. Display fields are interpolated original-grid samples from HDF5, not exact continuum data or a source of optical-efficiency claims.

## Actual commands and outputs

Executed with the local `.venv/Scripts/python.exe` after loading `scripts/env.ps1`:

```powershell
& '.\.venv\Scripts\python.exe' -m ruff check scripts/render_diagnostics.py
& '.\.venv\Scripts\python.exe' scripts/render_diagnostics.py --run .runtime/science-final/cavity-12 --verification .runtime/science-final/verification.json --output .runtime/diagnostics
& '.\.venv\Scripts\python.exe' scripts/render_diagnostics.py --run .runtime/science-final/pml-1.2 --verification .runtime/science-final/verification.json --output .runtime/diagnostics/open-waveguide
```

Ruff passed. A Python HTML parser found four expected plot containers and zero external script sources in the cavity page; all template tokens were replaced. A missing-source negative check returned nonzero with an explicit missing-artifact error and produced no page.

| Artifact | Observed output |
| --- | --- |
| Cavity HTML | `.runtime/diagnostics/field-diagnostics.html`, 5,046,472 bytes |
| Cavity HTML SHA256 | `3d8edec82725057f72839e162601dad65187425ba8f3a23cb0f531e12094aeb3` |
| Layered current-driven HTML | `.runtime/diagnostics/open-waveguide/field-diagnostics.html`, 5,133,270 bytes |
| Layered HTML SHA256 | `0539ff1879d7a7fdcbcb1f86c93de4c9637488cd93cc4adebe96b78af41a011e` |
| Verification receipt | `.runtime/science-final/verification.json` |
| Verification SHA256 | `d20e9d56002db70954cb81761051c680627968ded91bbfd1790637ddb50e4dcf` |

Both outputs have an adjacent `diagnostics-manifest.json` listing absolute input paths and SHA256 for `spec.json`, `result.json`, `scene.json` and `fields.h5`, output hash and size, generation timestamp and Plotly version. The cavity input contains 9×9×9 display samples; the layered input contains 13×9×9. The convergence plot uses three actual entries from the same verification receipt.

These receipts bind to the files above. If final solver data or verification is regenerated, rerun the renderer and record new hashes rather than reusing these as evidence for different results.

## Verification limits

## Root final-data regeneration and browser verification

Root subsequently regenerated both diagnostic pages from `.runtime/science-final-rerun` (not the earlier science-final receipt). Current cavity HTML is 5,046,564 bytes, SHA256 `34c4024c17a8cef782a41d38e635477297bc8bf27cb254942376c69aa3c5fd4f`; current layered HTML is 5,133,362 bytes, SHA256 `28f4b0effa455735c3d7c92850ab53dc81606e9aa30847dfbd7ffc74fffff9e8`. Final verification input SHA256 is `e81eed784ec2942126b29d0890e5d36d9a1d19e64df3ae0be3900e7a4da9ffee`. Adjacent manifests bind the final source data. Earlier hashes above remain historical development observations.

A real Chromium headless session loaded the self-contained cavity HTML, rendered four Plotly figures including three WebGL canvases, found two slice sliders, zero external scripts, zero page errors and no desktop horizontal overflow at1440px. Root inspected the full-page screenshot and corrected overlapping field-selector controls and the cavity/open-ridge warning scope, then regenerated and rechecked. Screenshot: `.runtime/diagnostics/browser-desktop.png`; machine receipt: `.runtime/diagnostics/browser-check.json`.

The browser check verifies this diagnostic artifact. It does not certify the later React workbench, mobile layout, or all interactive controls.

After the user's explicit interaction requirement, root operated the actual field-selector button and z-slice rail in Chromium: Re(Ey) became the visible isosurface; the first slice slider changed from middle index4 to index8 and its visible data trace became `z=0.8 μm`. No page errors occurred. The check first failed because the test attempted to click an offscreen slider; the test now scrolls it into view before clicking. Reproduce after loading the parent repo `scripts/env.ps1` for its D: browser runtime: `node lightforge/scripts/verify_diagnostics.cjs`. This check uses the parent's locked Playwright installation and is not required for scientific CLI runtime. Tracked receipt: `evidence/diagnostics-browser-check.json`; screenshot: `evidence/screenshots/cavity-diagnostics.png`.

### Original renderer verification boundary

The artifact was generated and statically checked, not visually inspected in a browser by this renderer. Browser WebGL rendering and pixel appearance are therefore unverified here. The source receipt's scientific limitations remain visible in the page; cavity convergence and a small linear residual do not establish calibrated optical transmission, manufacturing performance or the final splitter's success.

HTML outputs are ignored local runtime artifacts. The renderer and this factual evidence record are tracked for reproduction. Quantitative figures use actual numerical data, while image-generated artwork is managed separately as illustrative project assets.
