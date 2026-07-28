import type { GameSession, LocationState } from "../../world/state/types";
import type { BuildingState, BuildingUnitState } from "../../simulation/urban/types";

export function getPlayerExactLocationId(session: GameSession): string | null {
  const position = session.localScene.playerPosition;
  if (position.locationId && session.world.locations.some((location) => location.id === position.locationId)) {
    return position.locationId;
  }
  if (position.buildingId) {
    return session.urban.buildings.find((building) => building.id === position.buildingId)?.anchorLocationId ?? null;
  }
  if (position.vehicleId) {
    return session.vehicles.vehicles.find((vehicle) => vehicle.id === position.vehicleId)?.position.locationId ?? null;
  }
  return null;
}

export function getPlayerHomeBuilding(session: GameSession): BuildingState | undefined {
  return session.urban.buildings.find((building) => building.anchorLocationId === session.life.housing.locationId);
}

export function getPlayerHomeUnit(session: GameSession): BuildingUnitState | undefined {
  const homeBuilding = getPlayerHomeBuilding(session);
  if (!homeBuilding) return undefined;
  return session.urban.units.find((unit) => unit.buildingId === homeBuilding.id && unit.tenantEntityId === session.player.id);
}

export function isPlayerInsideLocation(session: GameSession, locationId: string): boolean {
  const position = session.localScene.playerPosition;
  if (position.state !== "inside") return false;
  if (position.locationId === locationId) return true;
  return Boolean(position.buildingId && session.urban.buildings.some((building) => building.id === position.buildingId && building.anchorLocationId === locationId));
}

export function isPlayerInsideHome(session: GameSession): boolean {
  const position = session.localScene.playerPosition;
  const homeUnit = getPlayerHomeUnit(session);
  return position.state === "inside" && Boolean(homeUnit && position.unitId === homeUnit.id);
}

export function currentPhysicalLocation(session: GameSession): LocationState | undefined {
  const locationId = getPlayerExactLocationId(session);
  return locationId ? session.world.locations.find((location) => location.id === locationId) : undefined;
}

export function isCourierDispatchLocation(location: LocationState | undefined): boolean {
  return Boolean(location && location.type === "transport" && (location.code.startsWith("MSH/") || location.name.includes("MESHLINE")));
}
