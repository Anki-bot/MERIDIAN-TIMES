# Implementation Plan: Full 3D Watch

## Tasks

- [ ] 1. Create Full 3D spec and fallback-only seed
  - [ ] 1.1 Create `data/full-3d-release.json` `fallback-only` and `lib/full-3d/types.ts` with `Full3DAssetPackage` `Full3DMigrationGate` `SupportCode` `RuntimeFailureCode`.
  - [ ] 1.2 Create `scripts/verify-full-3d-assets.mjs` that checks `source/assets/full-3d/` `public/assets/full-3d/` `data/full-3d-release.json` and exits `0` for `fallback-only`.

- [ ] 2. Implement Full3D canvas from measured wheel
  - [ ] 2.1 Create `components/canvas/Full3DWatchCanvas.tsx` from `WatchMovementCanvas.tsx:1` with `upper-right-wheel` `Gear` `MeshPhysicalMaterial` `pivot 1925,355` `period 2000` `sampleMotion` parity and `useAnimationClock` `Active_Elapsed_Time`.
  - [ ] 2.2 Add `components/ui/WatchImageBackdrop.tsx` `Full3DWatchCanvas` sibling after `LayeredWatchEnhancement`, keeping `WatchImageBackdrop` `picture` `z-2` `Full3D z-3` `Layered z-3` fallback order.

- [ ] 3. Verify and publish
  - [ ] 3.1 Run `npm run verify:full-3d`, `npm run typecheck`, `npm run lint`, `npm run build` with `fallback-only` `ready` `0` `public` requests.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["3.1"] }
  ]
}
```
