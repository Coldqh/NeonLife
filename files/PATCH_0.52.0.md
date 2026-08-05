# Neon Life 0.52.0 — One City Daily Life

## Core direction

Neon Life now treats the existing city as the whole game space. Player actions remain simple, but employment, training, shopping, boxing and violence require a real physical context.

## Employment

- vacancies belong to a concrete venue;
- hiring happens inside that venue;
- the contract stores one employer, workplace and manager;
- a one-click shift can only start at the workplace;
- managers remember hiring, shifts and resignations;
- the Work screen is only a contract record and route to the workplace.

## Profile

- characteristics and equipment remain in Profile;
- important employment, boxing and street-combat events enter a permanent biography;
- biography entries keep exact game time, place and involved person when available.

## Cleanup

The patch writes files directly into the project root and removes the accidentally committed `files/` patch payload plus old work/courier remnants.
