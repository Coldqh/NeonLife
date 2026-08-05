# Neon Life 0.50.1 — Legacy Work Cleanup

This hotfix removes the orphaned `VenueWorkPanel.tsx` that can survive when the 0.50 archive is copied over an existing checkout instead of being applied with its deletion manifest.

It also adds a build regression that rejects:

- the old venue work panel;
- `session.jobs`;
- imports from removed work and courier systems;
- the removed legacy player-work test runner.

`playerLoop` remains the only source of truth for player work, training, equipment, street fights and boxing.
