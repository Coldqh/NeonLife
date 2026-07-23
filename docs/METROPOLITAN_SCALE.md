# Metropolitan Scale Foundation

`GameSession.metropolitan` gives NEON LIFE a physical city footprint without loading an entire metropolis at full detail.

## Metric city

The initial city occupies `42 × 36 km` (`1,512 km²`). Coordinates are stored in meters.

Hierarchy:

```text
city
→ 1 km² streaming sector
→ 125 m procedural block
→ land parcel
→ building
→ floor
→ unit / room
```

Only sectors are stored globally in v0.22. Blocks, parcels and interiors are deterministic descendants of a sector seed and will be materialized by later building patches.

## Represented population

The metropolitan macro layer represents several million residents. The existing detailed resident set remains a durable sample with households, jobs, health, relationships and history.

A sector stores aggregate:

- represented population and household count;
- land use;
- estimated buildings and floor area;
- local road length;
- crowd and traffic load;
- current detail level.

This makes the city produce metropolitan demand, density and travel pressure without creating millions of full NPC objects.

## Streaming levels

```text
ACTIVE
→ exact local simulation budget

WARM
→ important buildings and aggregate movement

COLD
→ compact sector statistics and persistent deltas only
```

Default budgets:

- no more than 9 active sectors;
- no more than 40 warm sectors;
- no more than 480 materialized NPCs;
- no more than 24 materialized interiors;
- 256 MB estimated city-detail budget.

When focus moves, distant sectors are evicted. Detailed residents and interiors are dematerialized. Persistent changes survive as deltas and are rebuilt from deterministic seeds.

## Persistent addresses

Every existing location receives:

- metric bounds;
- sector ID;
- stable address code;
- building footprint type;
- floors and basement levels;
- entrance counts;
- vertical capacity;
- persistent interior seed.

The address and seed remain stable after unloading.

## Roads and transit

The foundation creates:

- an arterial road graph with intersections and interchanges;
- expressway and arterial links with length, lanes, capacity and speed;
- three mass-transit lines;
- persistent stations tied to physical sectors.

Local street grids will be derived from each sector seed in the future 2D map layer.

## Memory compaction

Every seven simulated days the spatial system can compact old detail:

- active geometry is released outside the streaming window;
- materialized residents return to aggregate schedules;
- interiors collapse to seed plus permanent deltas;
- old event and surveillance budgets are reduced;
- a compact archive summary is kept.

Permanent ownership, damage, deaths, crimes, evidence and player-caused changes are not discarded.
