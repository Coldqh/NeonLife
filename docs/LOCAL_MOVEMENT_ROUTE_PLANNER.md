# Local Movement Architecture

## Canonical route graph

The planner materializes street topology only for the rectangular corridor between the player and destination, with a one-sector margin. Intersections sharing the same metric coordinate are merged. This connects matching sector gates without creating a second road system.

Walking ignores vehicle one-way restrictions because pedestrians use sidewalks in either direction.

## Persistent route state

A route stores:

- target identity and current coordinates;
- ordered metric points;
- ordered street names;
- current leg and progress inside that leg;
- total, travelled and remaining distance;
- topology version and timestamps.

The state is optional inside `GameSession`, so old saves remain valid.

## Dynamic destinations

Vehicles and people are resolved again before every movement step. If they moved more than 12 metres, the route is rebuilt from the player's current position. Street topology version changes also trigger replanning.

## World time

Walking calls `progressLife`. The player position changes before the local scene, vehicles, transit, population and other systems are advanced. Arrival at a named location updates the active location only when the target is actually reached.

## UI

The same target and route system is used by:

- the local map;
- Nearby people;
- Nearby buildings;
- Nearby vehicles;
- the full-screen walking scene;
- the approach to the first bus or metro stop.

Instant approach buttons are removed from Nearby.


## Transit handoff

Starting a bus or metro route plans a real street route to the origin stop. During that walk, the local movement scene has priority. Arrival completes the transit walking phase and hands control to the stop waiting screen. Cancelling the street walk also cancels the linked transit journey.
