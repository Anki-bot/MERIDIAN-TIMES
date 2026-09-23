# Requirements Document: Full 3D Watch

## Introduction

The Full 3D Watch feature is the gated successor to the completed `interactive-layered-watch-2-5d` 2.5D enhancement. It replaces the flat layered composition with a true WebGL/Three.js rendered watch model derived from measured geometry, materials, and lighting, while preserving the exact predecessor `Static_Fallback_Surface`, `WatchImageBackdrop`, and all `EliteWatchesExperience` behavior as the atomic fallback. The 2.5D package remains independently valid after Full-3D activation.

## Glossary

- **ELITE_WATCHES_Application**: Next.js application rooted at `/Users/ankitkumar/Desktop/CODE/activity`.
- **Full_3D_System**: The successor feature including local 3D asset preparation, integrity validation, WebGL runtime, deterministic motion, and fallback.
- **Predecessor_2_5D_Baseline**: The approved 2.5D state with `optional-depth` `1.3.0` `ready`.
- **Canonical_Master**: Immutable PNG `source/assets/elite-watch-master.png` `7480bd...8c66b` as appearance provenance.
- **Full_3D_Asset_Package**: Versioned set of geometry (glTF/GLB), materials (PBR), textures, rigging, camera, lighting, measurements, uncertainties, licenses, provenance, and approvals.
- **Full_3D_Migration_Gate**: Finite verifier that requires separate spec, fidelity parity `SSIM≥0.995`, behavior parity, browser compatibility `Chrome/Edge≥120 Firefox≥121 Safari≥17.2`, performance `≤100ms`, provenance, and atomic fallback.
- **Static_Fallback_Surface**: Predecessor responsive `<picture>` `WatchImageBackdrop`.
- **Layered_2_5D_Background**: The 2.5D `reconstructed-background` + `upper-right-wheel-layer` composition.

## Requirements

### Requirement 1: Preserve 2.5D as Authoritative Fallback
- The Full_3D_System shall keep `data/watch-layer-release.json` `1.3.0` `optional-depth` and `public/assets/watch-2-5d/` as independently valid after Full-3D activation.
- While Full_3D `Enhanced_Error_State` or `Unsupported` is active, the application shall render `Static_Fallback_Surface` via `WatchImageBackdrop`.

### Requirement 2: Full 3D Asset Provenance
- The Full_3D_Asset_Package shall reference `Canonical_Master` `7480bd...8c66b` for appearance, plus every additional photograph, measurement, drawing, model source, license, and authored assumption for geometry/materials.
- Geometry not established by measured evidence shall be labeled `authored reconstruction`.

### Requirement 3: Deterministic Motion Parity
- Full 3D motion shall reuse `Animation_Clock` `Active_Elapsed_Time` and `Motion_Profile` semantics (`continuous-rotation 2000ms` `upper-right-wheel-layer`) to preserve deterministic `sampleMotion` parity with 2.5D.

### Requirement 4: Migration Gate
- Full_3D_Migration_Gate shall require separate `requirements.md` `design.md` `tasks.md` approval, `Visual_Fidelity_Gate` `SSIM≥0.995` at `Reference_Viewports`, `UI_Behavior_Baseline` parity (13 graph controls, search, dialog, header), `browser` `Supported_Browser_Matrix`, `performance` `120 frames ≥114 ≤25ms max ≤100ms`, and atomic `Static_Fallback_Surface` fallback.
