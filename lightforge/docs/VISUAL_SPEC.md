# LightForge visual and interaction specification

Purpose: make a complex physical design inspectable and understandable. This is the implementation brief for the Stage 3 product, not a claim that its interface already exists. Stage 1 supplies original image assets and a physical scene/data contract. The art is illustrative; computed fields and quantitative graphics come from numerical results.

## Visual direction

The workbench takes cues from precision optical instruments and contemporary scientific editorial design: graphite canvas, clearly separated material surfaces, restrained spectral colours and legible measurement overlays. Documentation and reports use a light reading surface. The same units, typography and semantic colours persist across both.

| Role | Starting palette | Rule |
| --- | --- | --- |
| Workbench background | #0B1016 / #121A23 | Preserve depth without hiding thin edges |
| Primary text / secondary text | #E8EDF2 / #A8B6C6 | Verify contrast in implemented components |
| Action / selection | #54D8C7 | Reserved for interaction, not fabricated intensity |
| Warning / failed constraint | #F4AF67 / #F27982 | Never depend on hue alone; include marker and text |
| Structural materials | Neutral glass, ceramic and SiN tints | Material legend distinct from field legend |
| Phase / magnitude / signed gradient | Purpose-specific scientific scales | Each scale states quantity, range, units and normalization |

Numbers use tabular alignment. Every plot includes axis names and units. Infrared wavelengths use labelled false colours. A comparison defaults to a shared colour scale. User-selected normalization is explicit and reversible. No bloom, transparency or cinematic depth effect may obscure measurement overlays.

## Image-generation brief

Generate an original wide editorial image for the experiment homepage/cover. Depict an exquisite silicon-nitride photonic structure on a layered optical substrate, microscopic-scale material detail, a clean graphite environment and restrained teal/amber light accents. Use asymmetric composition with a quiet region for live HTML copy. Avoid baked-in interface text, logos, equations and numerical claims. The image represents the project subject, not an actual computed electromagnetic field or fabricated specimen.

A companion visual may show a precisely separated layer cross-section to establish the visual language for the interactive model. Layer relations should be plausible, but no quantitative geometry should be inferred from the illustration. Record the actual prompt, generated file, original output location, copied repository path, checksum and chosen-use note in an asset manifest. Record the tool/model only as exposed by the actual tool result; do not infer a model identity from the user's requested label.

Use generated raster assets for cover, empty states or explanatory art. Buttons, formulae, axes, labels, editable geometry, field volumes, spectra, gradients and fabrication defects must remain functional code/data elements. Do not ship a raster mockup as an interactive workbench.

## Workbench composition

The main spatial viewport occupies the centre. A compact left rail selects tasks; the adjacent panel contains current physical configuration. A right inspector follows the selected object/probe. The bottom region holds spectrum, convergence or fabrication plots and a real iteration timeline. Panels collapse to increase working space; the viewport never loses the current run/model label.

The persistent run strip shows model type, experiment version, wavelength/source, status and data provenance. A geometry preview awaiting recomputation is visually marked. A completed previous result may remain in a comparison panel but must not be relabelled to match a newly edited structure.

## Interaction semantics

| Task | Required 3D interaction | Numerical meaning | Verification |
| --- | --- | --- | --- |
| Layer inspection | Orbit, hide, clip and explode layers | Inspection only | Specification hash unchanged |
| Physical edit | Constrained handle, cross-section edit, exact input | New geometry/configuration version | Computational geometry and scene dimensions agree |
| Port inspection | Select actual port plane, choose mode/component | Real computed mode and normalization | Port identity/direction visible |
| Field investigation | Volume transfer function, arbitrary clipping, isosurface, vector/flux view | Same saved 3D numerical solution | Probe reads original solution |
| Adjoint explanation | Linked forward/adjoint/sensitivity views, perturb region | Actual derivative and new solve | Predicted vs measured change shown |
| Optimization | Time scrub, added/removed material, constraint locator | Actual iteration checkpoints | No interpolated invented iterations |
| Fabrication | Etch/thickness/sidewall controls and aligned sample inspection | New physical scenario | Stale-field guard; sample identity shown |
| Comparison | Shared camera, clipping, probe and scale | Aligned experiments with documented references | Source/phase/units compatibility checked |

Observation and edit modes are explicit. Dragging a physical handle disables orbit control until release; pressing Escape restores the starting value. A complete drag produces one undoable transaction, not hundreds of independent history entries. Every handle also has a keyboard/numeric alternative. Reset view, focus selected, principal views and recover-hidden-items controls are always available.

The layer-explosion separation is a display transform. Thickness exaggeration, when used to make a thin layer readable, has an obvious scale label and is excluded from physical measurements. Geometry probes use inverse display-to-physical transforms; measurements never use exploded distances.

## Field representation

Three.js `Data3DTexture` supports a raw volume divided into width/height/depth. A custom shader can implement magnitude/phase mapping and ray-marched volume rendering; this rendering capability does not certify the field data. [Official texture documentation](https://threejs.org/docs/pages/Data3DTexture.html)

Use component-aware data selection and a labelled transfer function. Keep opacity control separate from numerical normalization. Clipping planes and isosurfaces operate in the shared physical frame. Limit ray samples and texture allocation according to hardware; preserve the original result for precise probes and exports.

A phase animation reconstructs Re(E exp(-iωt)) from saved complex values. It does not animate an arbitrary travelling wave over a static image. Energy-flow lines derive from the computed time-averaged Poynting vector and are labelled as energy flow, not individual photon trajectories. Interface discontinuities must not be smoothed indiscriminately across material boundaries.

An interpolated display position is not a new physics solve. Field interpolation between solved wavelengths is either disabled for quantitative readout or clearly marked as display interpolation, with actual sample wavelengths selectable. Intermediate slider positions must not appear as measured spectra.

## Readability and accessibility

Use progressive disclosure: guided mode introduces one task at a time; professional mode exposes the full configuration. Both operate on identical numerical results. Contextual explanations reference a selected feature, field or constraint; long theory remains available without covering the viewport.

All actions have visible labels or accessible names, keyboard focus and non-hover alternatives. Use shapes/text for selection and errors, not only colour. Reduced-motion mode disables continuous camera/phase motion. Error messages locate invalid parameters and retain valid user work. Empty, queued, computing, stale, cancelled, failed and complete states have distinct copy and actions.

Desktop is the complete working environment. Narrow displays provide readable results, charts and suitable touch inspection; do not claim unrestricted professional editing until separately tested. Viewport keyboard shortcuts must not intercept text-field editing.

## Performance and visual acceptance

Targets for the specified desktop scene are at least 30 fps during common inspection and roughly 100 ms feedback for ordinary edits. These are targets pending hardware measurement. Physical solves have separately measured runtimes. Loading geometry immediately must not falsely imply a new field was computed.

Test camera/selection/clipping after panel resizing, multiple viewports and device-pixel-ratio changes. Test transparent surfaces, hidden objects and back faces for correct picking. Verify colour legends, bounds, probe coordinates, synchronized views, units and stale-result behaviour. Frame-rate adaptation may reduce display sampling but cannot silently alter scientific metrics.
