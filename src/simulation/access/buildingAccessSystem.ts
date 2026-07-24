import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BuildingState, BuildingUnitState, InteriorState } from "../urban/types";
import type {
  AccessDecision,
  AccessDoorState,
  AccessLockType,
  BuildingAccessInput,
  BuildingAccessState,
  BuildingEntryAccessState,
  BuildingFloorAccessState,
  BuildingRoomAccessState,
  BuildingUnitAccessState,
  PlayerBuildingAccessState
} from "./types";

const MAX_VISITED = 128;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function isOpenHour(input: BuildingAccessInput, building: BuildingState): boolean {
  if (!building.anchorLocationId) return true;
  const location = input.locations.find((item) => item.id === building.anchorLocationId);
  if (!location || !location.open) return false;
  const hour = new Date(input.timestamp).getUTCHours();
  const openHour = location.openHour ?? 0;
  const closeHour = location.closeHour ?? 24;
  if (openHour === closeHour) return true;
  return openHour < closeHour ? hour >= openHour && hour < closeHour : hour >= openHour || hour < closeHour;
}

function isPublicUse(building: BuildingState): boolean {
  return ["mixed", "retail", "medical", "education", "civic", "transport", "hotel", "entertainment"].includes(building.use);
}

function isPlayerHomeBuilding(input: BuildingAccessInput, building: BuildingState): boolean {
  return building.anchorLocationId === input.playerHomeLocationId;
}

function occupationAllows(input: BuildingAccessInput, building: BuildingState): boolean {
  const occupation = input.player.occupation.toUpperCase();
  if (occupation.includes("COURIER") && ["warehouse", "industrial", "transport", "mixed"].includes(building.use)) return true;
  if (occupation.includes("MED") && building.use === "medical") return true;
  if (occupation.includes("SECURITY") && ["office", "corporate", "civic"].includes(building.use)) return true;
  return false;
}

interface DecisionResult {
  decision: AccessDecision;
  reason: string;
  authorized: boolean;
  locked: boolean;
  lockType: AccessLockType;
  alarmed: boolean;
}

function publicEntryDecision(input: BuildingAccessInput, building: BuildingState): DecisionResult {
  if (building.publicEntrances <= 0) return { decision: "unavailable", reason: "Нет публичного входа", authorized: false, locked: true, lockType: "none", alarmed: false };
  if (isPlayerHomeBuilding(input, building)) return { decision: "authorized", reason: "Доступ жильца", authorized: true, locked: false, lockType: "electronic", alarmed: building.security >= 55 };
  if (building.use === "vacant") return { decision: "open", reason: "Объект не контролируется", authorized: false, locked: false, lockType: "mechanical", alarmed: false };
  if (isPublicUse(building)) {
    if (!isOpenHour(input, building)) return { decision: "closed", reason: "Объект закрыт по времени", authorized: false, locked: true, lockType: building.security >= 70 ? "corporate" : "electronic", alarmed: building.security >= 50 };
    return { decision: "open", reason: "Публичный вход открыт", authorized: false, locked: false, lockType: building.security >= 70 ? "corporate" : "electronic", alarmed: building.security >= 65 };
  }
  if (occupationAllows(input, building)) return { decision: "authorized", reason: "Рабочий доступ", authorized: true, locked: false, lockType: "electronic", alarmed: building.security >= 60 };
  if (building.use === "residential" && building.security <= 34) return { decision: "open", reason: "Подъезд не заперт", authorized: false, locked: false, lockType: "mechanical", alarmed: false };
  return {
    decision: "locked",
    reason: building.use === "residential" ? "Нужен ключ жильца" : "Требуется пропуск",
    authorized: false,
    locked: true,
    lockType: building.security >= 72 ? "corporate" : building.security >= 42 ? "electronic" : "mechanical",
    alarmed: building.security >= 56
  };
}

function serviceEntryDecision(input: BuildingAccessInput, building: BuildingState): DecisionResult {
  if (building.serviceEntrances <= 0) return { decision: "unavailable", reason: "Служебного входа нет", authorized: false, locked: true, lockType: "none", alarmed: false };
  if (occupationAllows(input, building)) return { decision: "authorized", reason: "Служебный доступ", authorized: true, locked: false, lockType: "electronic", alarmed: building.security >= 64 };
  if (building.use === "vacant" || building.security <= 18) return { decision: "open", reason: "Служебная дверь не заперта", authorized: false, locked: false, lockType: "mechanical", alarmed: false };
  return {
    decision: "locked",
    reason: "Служебный доступ закрыт",
    authorized: false,
    locked: true,
    lockType: building.security >= 68 ? "corporate" : "electronic",
    alarmed: building.security >= 45
  };
}

function entranceDoor(input: BuildingAccessInput, building: BuildingState, kind: "public-entrance" | "service-entrance", previous?: AccessDoorState): AccessDoorState | null {
  const result = kind === "public-entrance" ? publicEntryDecision(input, building) : serviceEntryDecision(input, building);
  if (result.decision === "unavailable") return null;
  const id = createStableEntityId("access-door", `${building.id}:${kind}`);
  return {
    id,
    buildingId: building.id,
    floor: 1,
    kind,
    label: kind === "public-entrance" ? "Главный вход" : "Служебный вход",
    lockType: result.lockType,
    decision: result.decision,
    reason: result.reason,
    locked: result.locked,
    open: previous?.open === true && !result.locked,
    alarmed: result.alarmed,
    security: building.security,
    playerAuthorized: result.authorized,
    lastChangedAt: previous?.lastChangedAt ?? input.timestamp
  };
}

function buildingEntry(input: BuildingAccessInput, building: BuildingState, priorDoors: Map<string, AccessDoorState>): BuildingEntryAccessState {
  const local = input.localScene.buildings.find((item) => item.buildingId === building.id);
  const publicDoor = entranceDoor(input, building, "public-entrance", priorDoors.get(createStableEntityId("access-door", `${building.id}:public-entrance`)));
  const serviceDoor = entranceDoor(input, building, "service-entrance", priorDoors.get(createStableEntityId("access-door", `${building.id}:service-entrance`)));
  return {
    buildingId: building.id,
    addressCode: building.addressCode,
    use: building.use,
    distanceToPlayerM: local?.distanceToPlayerM ?? Number.MAX_SAFE_INTEGER,
    publicDoorId: publicDoor?.id,
    serviceDoorId: serviceDoor?.id,
    publicDecision: publicDoor?.decision ?? "unavailable",
    serviceDecision: serviceDoor?.decision ?? "unavailable",
    publicReason: publicDoor?.reason ?? "Нет публичного входа",
    serviceReason: serviceDoor?.reason ?? "Нет служебного входа",
    playerInside: input.localScene.playerPosition.buildingId === building.id
  };
}

function playerAccess(input: BuildingAccessInput, previous?: BuildingAccessState): PlayerBuildingAccessState {
  const position = input.localScene.playerPosition;
  if (!position.buildingId || position.state !== "inside") return { level: "street" };
  const sameBuilding = previous?.player.buildingId === position.buildingId;
  const enteredAt = sameBuilding ? previous?.player.enteredAt : input.timestamp;
  if (position.roomId) {
    return {
      level: "room",
      buildingId: position.buildingId,
      unitId: position.unitId,
      roomId: position.roomId,
      interiorId: position.unitId ? createStableEntityId("interior", position.unitId) : createStableEntityId("interior", position.buildingId),
      floor: position.floor ?? 1,
      entranceDoorId: previous?.player.entranceDoorId,
      enteredAt
    };
  }
  if (position.unitId) {
    return {
      level: "unit",
      buildingId: position.buildingId,
      unitId: position.unitId,
      interiorId: createStableEntityId("interior", position.unitId),
      floor: position.floor ?? 1,
      entranceDoorId: previous?.player.entranceDoorId,
      enteredAt
    };
  }
  return {
    level: "building",
    buildingId: position.buildingId,
    interiorId: createStableEntityId("interior", position.buildingId),
    floor: position.floor ?? 1,
    entranceDoorId: previous?.player.entranceDoorId,
    enteredAt
  };
}

function unitDecision(input: BuildingAccessInput, building: BuildingState, unit: BuildingUnitState): DecisionResult {
  if (unit.tenantEntityId === input.player.id || unit.residentIds.includes(input.player.id)) {
    return { decision: "authorized", reason: "Твоя жилая ячейка", authorized: true, locked: false, lockType: "electronic", alarmed: unit.security >= 60 };
  }
  if (isPlayerHomeBuilding(input, building) && unit.unitNumber.endsWith("P1")) {
    return { decision: "authorized", reason: "Твоя жилая ячейка", authorized: true, locked: false, lockType: "electronic", alarmed: unit.security >= 60 };
  }
  if (["shop", "clinic", "office", "hotel-room", "service"].includes(unit.use) && isOpenHour(input, building)) {
    return { decision: "open", reason: "Помещение принимает посетителей", authorized: false, locked: false, lockType: "electronic", alarmed: unit.security >= 70 };
  }
  if (!unit.occupied && building.use === "vacant" && unit.security <= 25) {
    return { decision: "open", reason: "Пустующее помещение не заперто", authorized: false, locked: false, lockType: "mechanical", alarmed: false };
  }
  return {
    decision: "locked",
    reason: unit.occupied ? "Частное помещение" : "Помещение заперто",
    authorized: false,
    locked: true,
    lockType: unit.security >= 72 ? "corporate" : unit.security >= 42 ? "electronic" : "mechanical",
    alarmed: unit.security >= 58
  };
}

function unitAccess(input: BuildingAccessInput, building: BuildingState, unit: BuildingUnitState, previous?: AccessDoorState): { unit: BuildingUnitAccessState; door: AccessDoorState } {
  const result = unitDecision(input, building, unit);
  const doorId = createStableEntityId("access-door", `${unit.id}:entrance`);
  const interior = input.urban.interiors.find((item) => item.unitId === unit.id);
  return {
    unit: {
      unitId: unit.id,
      floor: unit.floor,
      unitNumber: unit.unitNumber,
      use: unit.use,
      occupied: unit.occupied,
      residentCount: unit.residentIds.length,
      security: unit.security,
      doorId,
      decision: result.decision,
      reason: result.reason,
      playerAuthorized: result.authorized,
      interiorId: interior?.id
    },
    door: {
      id: doorId,
      buildingId: building.id,
      unitId: unit.id,
      floor: unit.floor,
      kind: "unit",
      label: `Помещение ${unit.unitNumber}`,
      lockType: result.lockType,
      decision: result.decision,
      reason: result.reason,
      locked: result.locked,
      open: previous?.open === true && !result.locked,
      alarmed: result.alarmed,
      security: unit.security,
      playerAuthorized: result.authorized,
      lastChangedAt: previous?.lastChangedAt ?? input.timestamp
    }
  };
}

function roomAccess(input: BuildingAccessInput, building: BuildingState, interior: InteriorState, previousDoors: Map<string, AccessDoorState>): { rooms: BuildingRoomAccessState[]; doors: AccessDoorState[] } {
  const playerRoomId = input.localScene.playerPosition.roomId;
  const occupiedByRoom = new Map<string, number>();
  for (const actor of input.localScene.actors) {
    if (actor.position.roomId) occupiedByRoom.set(actor.position.roomId, (occupiedByRoom.get(actor.position.roomId) ?? 0) + 1);
  }
  const rooms: BuildingRoomAccessState[] = [];
  const doors: AccessDoorState[] = [];
  for (const room of interior.rooms) {
    const doorId = room.doorIds[0] ?? createStableEntityId("access-door", `${room.id}:main`);
    const previous = previousDoors.get(doorId);
    const decision: AccessDecision = "open";
    rooms.push({
      roomId: room.id,
      interiorId: interior.id,
      unitId: interior.unitId,
      floor: interior.floor,
      kind: room.kind,
      doorId,
      decision,
      playerInside: playerRoomId === room.id,
      occupiedActorCount: occupiedByRoom.get(room.id) ?? 0
    });
    doors.push({
      id: doorId,
      buildingId: building.id,
      unitId: interior.unitId,
      roomId: room.id,
      floor: interior.floor,
      kind: "room",
      label: room.kind.replace(/-/g, " ").toUpperCase(),
      lockType: "none",
      decision,
      reason: "Внутренняя дверь",
      locked: false,
      open: previous?.open ?? false,
      alarmed: false,
      security: 0,
      playerAuthorized: true,
      lastChangedAt: previous?.lastChangedAt ?? input.timestamp
    });
  }
  return { rooms, doors };
}

function floorStates(input: BuildingAccessInput, building: BuildingState, units: BuildingUnitAccessState[], rooms: BuildingRoomAccessState[]): BuildingFloorAccessState[] {
  const actorCount = new Map<number, number>();
  for (const actor of input.localScene.actors) {
    if (actor.position.buildingId !== building.id) continue;
    const floor = actor.position.floor ?? 1;
    actorCount.set(floor, (actorCount.get(floor) ?? 0) + 1);
  }
  const floors: BuildingFloorAccessState[] = [];
  const bottom = building.basementLevels > 0 ? -building.basementLevels : 1;
  for (let floor = bottom; floor <= building.floors; floor += 1) {
    if (floor === 0) continue;
    floors.push({
      floor,
      label: floor < 0 ? `B${Math.abs(floor)}` : floor === 1 ? "GROUND" : `F${floor}`,
      unitIds: units.filter((unit) => unit.floor === floor).map((unit) => unit.unitId),
      roomIds: rooms.filter((room) => room.floor === floor).map((room) => room.roomId),
      stairsAvailable: building.stairwellCount > 0,
      elevatorAvailable: building.elevatorCount > 0 && building.utilityService >= 25,
      accessible: floor === 1 || building.stairwellCount > 0 || (building.elevatorCount > 0 && building.utilityService >= 25),
      occupiedActorCount: actorCount.get(floor) ?? 0
    });
  }
  return floors;
}

function uniqueRecent(values: string[], value: string | undefined): string[] {
  if (!value) return values.slice(-MAX_VISITED);
  return [...values.filter((item) => item !== value), value].slice(-MAX_VISITED);
}

function buildState(input: BuildingAccessInput, previous?: BuildingAccessState): BuildingAccessState {
  const previousDoors = new Map((previous?.doors ?? []).map((door) => [door.id, door]));
  const localBuildings = input.localScene.buildings
    .map((item) => input.urban.buildings.find((building) => building.id === item.buildingId))
    .filter((building): building is BuildingState => Boolean(building));
  const buildingEntries = localBuildings.map((building) => buildingEntry(input, building, previousDoors));
  const entranceDoors = localBuildings.flatMap((building) => [
    entranceDoor(input, building, "public-entrance", previousDoors.get(createStableEntityId("access-door", `${building.id}:public-entrance`))),
    entranceDoor(input, building, "service-entrance", previousDoors.get(createStableEntityId("access-door", `${building.id}:service-entrance`)))
  ]).filter((door): door is AccessDoorState => Boolean(door));

  const player = playerAccess(input, previous);
  const activeBuilding = player.buildingId ? input.urban.buildings.find((item) => item.id === player.buildingId) : undefined;
  const activeUnits = activeBuilding ? input.urban.units.filter((unit) => unit.buildingId === activeBuilding.id) : [];
  const unitResults = activeBuilding ? activeUnits.map((unit) => unitAccess(input, activeBuilding, unit, previousDoors.get(createStableEntityId("access-door", `${unit.id}:entrance`)))) : [];
  const units = unitResults.map((item) => item.unit).sort((left, right) => left.floor - right.floor || left.unitNumber.localeCompare(right.unitNumber));
  const unitDoors = unitResults.map((item) => item.door);
  const activeInterior = activeBuilding
    ? input.urban.interiors.find((interior) => interior.id === player.interiorId)
      ?? input.urban.interiors.find((interior) => interior.buildingId === activeBuilding.id && interior.unitId === player.unitId)
      ?? input.urban.interiors.find((interior) => interior.buildingId === activeBuilding.id && !interior.unitId)
    : undefined;
  const roomResult = activeBuilding && activeInterior ? roomAccess(input, activeBuilding, activeInterior, previousDoors) : { rooms: [], doors: [] };
  const floors = activeBuilding ? floorStates(input, activeBuilding, units, roomResult.rooms) : [];
  const doors = [...entranceDoors, ...unitDoors, ...roomResult.doors];
  const newlyVisitedBuilding = player.buildingId && previous?.player.buildingId !== player.buildingId ? player.buildingId : undefined;
  const newlyVisitedUnit = player.unitId && previous?.player.unitId !== player.unitId ? player.unitId : undefined;
  const visitedBuildingIds = uniqueRecent(previous?.visitedBuildingIds ?? [], newlyVisitedBuilding);
  const visitedUnitIds = uniqueRecent(previous?.visitedUnitIds ?? [], newlyVisitedUnit);
  const openCount = doors.filter((door) => door.open).length;
  const deniedAttempts = previous?.totals.deniedAttempts ?? 0;
  return {
    version: 1,
    player,
    buildingEntries,
    doors,
    floors,
    units,
    rooms: roomResult.rooms,
    visitedBuildingIds,
    visitedUnitIds,
    totals: {
      localBuildings: buildingEntries.length,
      openEntrances: buildingEntries.filter((entry) => entry.publicDecision === "open" || entry.serviceDecision === "open").length,
      authorizedEntrances: buildingEntries.filter((entry) => entry.publicDecision === "authorized" || entry.serviceDecision === "authorized").length,
      lockedEntrances: buildingEntries.filter((entry) => entry.publicDecision === "locked" && entry.serviceDecision === "locked").length,
      activeFloors: floors.length,
      activeUnits: units.length,
      activeRooms: roomResult.rooms.length,
      doorsOpened: Math.max(previous?.totals.doorsOpened ?? 0, openCount),
      deniedAttempts
    },
    lastUpdatedAt: input.timestamp
  };
}

export function createBuildingAccessState(input: BuildingAccessInput): BuildingAccessState {
  return buildState(input);
}

export function advanceBuildingAccessState(state: BuildingAccessState, input: BuildingAccessInput): BuildingAccessState {
  return buildState(input, state);
}

export function normalizeBuildingAccessState(value: unknown, input: BuildingAccessInput): BuildingAccessState {
  if (!value || typeof value !== "object") return buildState(input);
  const raw = value as Partial<BuildingAccessState>;
  if (raw.version !== 1 || !raw.player || !Array.isArray(raw.doors)) return buildState(input);
  return buildState(input, raw as BuildingAccessState);
}

export function setAccessDoorOpen(state: BuildingAccessState, doorId: string, open: boolean, timestamp: number): BuildingAccessState {
  const door = state.doors.find((item) => item.id === doorId);
  if (!door || door.locked && open) return state;
  const wasOpen = door.open;
  return {
    ...state,
    doors: state.doors.map((item) => item.id === doorId ? { ...item, open, lastChangedAt: timestamp } : item),
    totals: { ...state.totals, doorsOpened: state.totals.doorsOpened + (!wasOpen && open ? 1 : 0) },
    lastUpdatedAt: timestamp
  };
}

export function recordAccessDenied(state: BuildingAccessState, timestamp: number): BuildingAccessState {
  return {
    ...state,
    totals: { ...state.totals, deniedAttempts: state.totals.deniedAttempts + 1 },
    lastUpdatedAt: timestamp
  };
}

export function findAccessDoor(state: BuildingAccessState, doorId: string | undefined): AccessDoorState | undefined {
  return doorId ? state.doors.find((door) => door.id === doorId) : undefined;
}
