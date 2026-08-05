# Neon Life 0.51.0 — World-Bound Player Systems

## Player-facing structure

- Work contains only employment.
- Profile contains characteristics and equipment.
- Equipment is purchased from physical shops.
- Strength and endurance are trained in gyms.
- Boxing training and career fights happen in boxing gyms.
- Shooting is trained at shooting ranges.
- Street fights begin through actual nearby NPCs.

## World generation

The city now generates `gym`, `boxing-gym`, `shooting-range`, and `weapon-shop` venues with addresses, operating states, prices, inventory, and map/search integration.

## Verification

- TypeScript typecheck: PASS
- UI verification suites: PASS
- Player world-binding domain test: PASS
- Domain suites: 29/29 PASS
