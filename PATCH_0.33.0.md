# NEON LIFE v0.33.0 — Local Movement & Route Planner

This patch turns the generated street network into a player movement system.

## Core loop

1. Select a point, street, building, stop, vehicle, person, or named location.
2. Build a route over actual street intersections and connected sector gates.
3. Start walking.
4. Advance one minute, five minutes, continuously, or skip the remaining section.
5. Arrive at the target coordinates and continue interacting with the world.

Public-transport routes use the same street walker for the approach to their first stop. The transit overlay opens only after the player reaches the stop.

## Save compatibility

`GameSession.localMovement` is optional. Existing schema-29 saves load without migration. Once a route starts, its geometry and progress are saved with the normal world payload.

## Limits

The local planner is intentionally capped at eight sector steps. Longer journeys still use metropolitan travel and public transport. NPC and vehicle movement over the same graph are scheduled for later patches.
