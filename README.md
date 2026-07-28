# NEON LIFE v0.33.0 patch

Apply this archive over a repository that already contains v0.32.1.

```powershell
cd C:\NeonLife
powershell -ExecutionPolicy Bypass -File "C:\path\to\NeonLife_v0.33.0_local_movement_route_planner\APPLY_PATCH.ps1" -ProjectRoot C:\NeonLife
npm install
npm run build
npm run test:movement
npm run test:movement:domain
npm run test:ui
npm run test:map
npm run test:streets
```

The archive contains only changed and new files.
