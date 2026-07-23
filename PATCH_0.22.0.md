# NEON LIFE v0.22.0 — Metropolitan Scale Foundation

## Goal

Establish a real-size physical metropolis before buildings, apartments, visual movement or player gameplay are developed.

## Added

- a `42 × 36 km` metric city footprint;
- 1,512 persistent one-square-kilometer sectors;
- several-million represented population distributed by district and land use;
- estimated citywide building count, floor area and local road length;
- deterministic sector seeds for future blocks, parcels and interiors;
- stable physical placement and addresses for every existing location;
- footprints for towers, megablocks, campuses, warehouses, midrises and lowrises;
- arterial and expressway road graph;
- metro, elevated and freight transit lines;
- active, warm and cold simulation detail levels;
- bounded materialized NPC and interior caches;
- sector eviction and weekly detail compaction;
- archive summaries for released detail;
- `CITY → НАСЕЛЕНИЕ → МАСШТАБ` diagnostics;
- save migration from schema 19 to 20.

## Not added

- visual city rendering;
- player movement;
- enterable building interiors;
- combat;
- new player actions.

Those layers will use this physical foundation later.
