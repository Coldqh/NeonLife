# Neon Life 0.50.2 — Verified Legacy Removal

This hotfix removes every file from the deleted player-work implementation instead of relying on ZIP overlay semantics.

Deleted:

- `src/app/map/VenueWorkPanel.tsx`;
- `src/gameplay/jobs/work/types.ts`;
- `src/gameplay/jobs/work/workSystem.ts`;
- `src/gameplay/jobs/courier/courierSystem.ts`;
- obsolete player-work test runner, test source and tsconfig.

`playerLoop` remains the only player-facing source of truth. The apply script aborts if any deleted file survives or TypeScript still fails.
