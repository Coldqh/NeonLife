import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { PersonState } from "../../people/network/types";
import type { CommuterPlanState } from "../mobility/types";
import type { BackgroundResident, EmploymentRecord } from "../population/types";
import type { LocationSpatialState, MetropolitanSectorState, MetricBounds } from "../spatial/types";
import type { BuildingState, BuildingUnitState, HouseholdAddressState } from "../urban/types";
import type {
  LocalActorActivity,
  LocalActorState,
  LocalBuildingPresenceState,
  LocalSceneInput,
  LocalSceneState,
  SpatialPositionState
} from "./types";

const VISIBLE_DISTANCE_M = 240;
const NEARBY_DISTANCE_M = 72;
const INTERACTION_DISTANCE_M = 4;
const MAX_LOCAL_BUILDINGS = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(left: Pick<SpatialPositionState, "xM" | "yM">, right: Pick<SpatialPositionState, "xM" | "yM">): number {
  return Math.round(Math.hypot(right.xM - left.xM, right.yM - left.yM) * 10) / 10;
}

function center(bounds: MetricBounds): { xM: number; yM: number } {
  return { xM: bounds.xM + bounds.widthM / 2, yM: bounds.yM + bounds.heightM / 2 };
}

function placementForLocation(input: LocalSceneInput, locationId: string | null | undefined): LocationSpatialState | undefined {
  if (!locationId) return undefined;
  return input.metropolitan.locations.find((item) => item.locationId === locationId);
}

function sectorById(input: LocalSceneInput, sectorId: string | undefined): MetropolitanSectorState | undefined {
  return input.metropolitan.sectors.find((item) => item.id === sectorId);
}

function buildingForLocation(input: LocalSceneInput, locationId: string | null | undefined): BuildingState | undefined {
  if (!locationId) return undefined;
  return input.urban.buildings.find((building) => building.anchorLocationId === locationId);
}

function addressForResident(input: LocalSceneInput, resident: BackgroundResident): HouseholdAddressState | undefined {
  return input.urban.householdAddresses.find((address) => address.householdId === resident.householdId);
}

function unitForAddress(input: LocalSceneInput, address: HouseholdAddressState | undefined): BuildingUnitState | undefined {
  return address ? input.urban.units.find((unit) => unit.id === address.unitId) : undefined;
}

function stablePoint(bounds: MetricBounds, seed: string, margin = 2): { xM: number; yM: number } {
  const rng = new SeededRandom(seed);
  const usableWidth = Math.max(1, bounds.widthM - margin * 2);
  const usableHeight = Math.max(1, bounds.heightM - margin * 2);
  return {
    xM: Math.round((bounds.xM + margin + rng.next() * usableWidth) * 10) / 10,
    yM: Math.round((bounds.yM + margin + rng.next() * usableHeight) * 10) / 10
  };
}

function pointInSector(sector: MetropolitanSectorState, seed: string): { xM: number; yM: number } {
  return stablePoint(sector.bounds, seed, 8);
}

function positionAtLocation(
  input: LocalSceneInput,
  resident: BackgroundResident | null,
  locationId: string,
  activity: LocalActorActivity,
  scope: string
): SpatialPositionState | null {
  const placement = placementForLocation(input, locationId);
  if (!placement) return null;
  const isHome = activity === "home" || activity === "rest";
  const address = resident && isHome ? addressForResident(input, resident) : undefined;
  const unit = unitForAddress(input, address);
  const building = address
    ? input.urban.buildings.find((item) => item.id === address.buildingId)
    : buildingForLocation(input, locationId);
  const bounds = building?.bounds ?? placement.bounds;
  const point = stablePoint(bounds, `${input.seed}:local-position:${scope}:${activity}:${locationId}`);
  return {
    sectorId: building?.sectorId ?? placement.sectorId,
    xM: point.xM,
    yM: point.yM,
    locationId,
    buildingId: building?.id,
    unitId: unit?.id,
    floor: unit?.floor ?? (building ? 1 : undefined),
    state: building ? "inside" : "outside",
    updatedAt: input.timestamp
  };
}

function shiftWindow(employment: EmploymentRecord, residentId: string): { start: number; end: number } {
  if (employment.shift === "night") return { start: 18 * 60, end: 6 * 60 };
  if (employment.shift === "rotating") {
    const parity = Number.parseInt(residentId.slice(-2), 16) % 2;
    return parity === 0 ? { start: 6 * 60, end: 15 * 60 } : { start: 14 * 60, end: 23 * 60 };
  }
  return { start: 8 * 60, end: 17 * 60 };
}

function minuteInWindow(minute: number, start: number, end: number): boolean {
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

function minuteDistanceForward(from: number, to: number): number {
  return (to - from + 24 * 60) % (24 * 60);
}

function commuteProgress(minute: number, departureMinute: number, durationMinutes: number): number | null {
  const elapsed = minuteDistanceForward(departureMinute, minute);
  if (elapsed > Math.max(8, durationMinutes)) return null;
  return clamp(elapsed / Math.max(1, durationMinutes), 0, 1);
}

function transitPosition(
  input: LocalSceneInput,
  resident: BackgroundResident,
  plan: CommuterPlanState,
  returning: boolean,
  progress: number
): SpatialPositionState | null {
  const fromSectorId = returning ? plan.destinationSectorId : plan.originSectorId;
  const toSectorId = returning ? plan.originSectorId : plan.destinationSectorId;
  const route = input.mobility.routes.find((item) => item.primaryMode === plan.mode && item.pathSectorIds.includes(fromSectorId) && item.pathSectorIds.includes(toSectorId));
  const path = route?.pathSectorIds.length ? route.pathSectorIds : [fromSectorId, toSectorId];
  const normalizedPath = returning ? [...path].reverse() : path;
  const pathIndex = Math.min(normalizedPath.length - 1, Math.floor(progress * normalizedPath.length));
  const sector = sectorById(input, normalizedPath[pathIndex]);
  if (!sector) return null;
  const point = pointInSector(sector, `${input.seed}:commute:${resident.id}:${Math.floor(input.timestamp / 60_000)}`);
  return {
    sectorId: sector.id,
    xM: point.xM,
    yM: point.yM,
    transitRouteId: route?.id,
    state: "in-transit",
    updatedAt: input.timestamp
  };
}

function knownPersonFor(input: LocalSceneInput, resident: BackgroundResident): PersonState | undefined {
  return resident.activePersonId ? input.people.people.find((person) => person.id === resident.activePersonId) : undefined;
}

function activityForKnownPerson(person: PersonState, timestamp: number): LocalActorActivity {
  const hour = new Date(timestamp).getUTCHours();
  const block = person.schedule.find((item) => hour >= item.startHour && hour < item.endHour);
  if (!block) return "idle";
  if (block.activity === "commute") return "commute";
  if (block.activity === "errand") return "errand";
  if (block.activity === "rest") return "rest";
  if (block.activity === "home") return "home";
  return "work";
}

function activityLabel(activity: LocalActorActivity, locationName?: string): string {
  const suffix = locationName ? ` · ${locationName}` : "";
  if (activity === "work") return `На смене${suffix}`;
  if (activity === "commute") return "В пути";
  if (activity === "errand") return `По делам${suffix}`;
  if (activity === "rest") return `Отдыхает${suffix}`;
  if (activity === "home") return `Дома${suffix}`;
  if (activity === "school") return `На занятиях${suffix}`;
  if (activity === "medical") return `Получает помощь${suffix}`;
  return `На улице${suffix}`;
}

interface ActorPlacement {
  activity: LocalActorActivity;
  position: SpatialPositionState;
  destinationLocationId?: string;
}

function genericActorPlacement(input: LocalSceneInput, resident: BackgroundResident): ActorPlacement | null {
  const minute = new Date(input.timestamp).getUTCHours() * 60 + new Date(input.timestamp).getUTCMinutes();
  const employment = input.population.employments.find((item) => item.id === resident.employmentId && item.status !== "unemployed");
  const plan = input.mobility.commuterPlans.find((item) => item.residentId === resident.id);

  if (employment && plan && employment.status !== "absent") {
    const work = shiftWindow(employment, resident.id);
    const outboundDeparture = (work.start - Math.max(8, plan.expectedDurationMinutes) + 24 * 60) % (24 * 60);
    const returnDeparture = work.end;
    const outboundProgress = commuteProgress(minute, outboundDeparture, plan.expectedDurationMinutes);
    if (outboundProgress !== null) {
      const position = transitPosition(input, resident, plan, false, outboundProgress);
      if (position) return { activity: "commute", position, destinationLocationId: employment.locationId };
    }
    const returnProgress = commuteProgress(minute, returnDeparture, plan.expectedDurationMinutes);
    if (returnProgress !== null) {
      const position = transitPosition(input, resident, plan, true, returnProgress);
      if (position) return { activity: "commute", position, destinationLocationId: resident.homeLocationId ?? undefined };
    }
    if (minuteInWindow(minute, work.start, work.end)) {
      const position = positionAtLocation(input, resident, employment.locationId, "work", resident.id);
      if (position) return { activity: "work", position };
    }
  }

  const dayIndex = Math.floor(input.timestamp / (24 * 60 * 60_000));
  const errandRng = new SeededRandom(`${input.seed}:local-errand:${resident.id}:${dayIndex}`);
  const errandStart = 17 * 60 + errandRng.integer(0, 150);
  const errandLocation = input.locations.find((location) => location.districtId === resident.districtId && (location.type === "market" || location.type === "food"));
  if (errandLocation && errandRng.chance(0.24) && minute >= errandStart && minute < errandStart + 50) {
    const position = positionAtLocation(input, resident, errandLocation.id, "errand", `${resident.id}:${dayIndex}`);
    if (position) return { activity: "errand", position };
  }

  if (resident.homeLocationId) {
    const activity: LocalActorActivity = minute >= 23 * 60 || minute < 6 * 60 ? "rest" : "home";
    const position = positionAtLocation(input, resident, resident.homeLocationId, activity, resident.id);
    if (position) return { activity, position };
  }

  const fallbackSector = input.metropolitan.sectors.find((sector) => sector.districtId === resident.districtId);
  if (!fallbackSector) return null;
  const point = pointInSector(fallbackSector, `${input.seed}:unhoused:${resident.id}:${dayIndex}`);
  return {
    activity: "idle",
    position: {
      sectorId: fallbackSector.id,
      xM: point.xM,
      yM: point.yM,
      state: "outside",
      updatedAt: input.timestamp
    }
  };
}

function actorPlacement(input: LocalSceneInput, resident: BackgroundResident): ActorPlacement | null {
  const known = knownPersonFor(input, resident);
  if (!known) return genericActorPlacement(input, resident);
  const activity = activityForKnownPerson(known, input.timestamp);
  if (activity === "commute") {
    const plan = input.mobility.commuterPlans.find((item) => item.residentId === resident.id);
    if (plan) {
      const minute = new Date(input.timestamp).getUTCHours() * 60 + new Date(input.timestamp).getUTCMinutes();
      const returning = minute >= plan.returnHour * 60;
      const departure = (returning ? plan.returnHour : plan.departureHour) * 60;
      const progress = commuteProgress(minute, departure, plan.expectedDurationMinutes) ?? 0.5;
      const position = transitPosition(input, resident, plan, returning, progress);
      if (position) return { activity, position, destinationLocationId: returning ? resident.homeLocationId ?? undefined : plan.destinationLocationId };
    }
  }
  const position = positionAtLocation(input, resident, known.currentLocationId, activity, resident.id);
  return position ? { activity, position } : genericActorPlacement(input, resident);
}

function roleLabel(input: LocalSceneInput, resident: BackgroundResident): string {
  const known = knownPersonFor(input, resident);
  if (known) return known.roleLabel;
  const employment = input.population.employments.find((item) => item.id === resident.employmentId);
  if (employment?.title) return employment.title;
  if (resident.lifeStage === "child") return "CHILD";
  if (resident.retired || resident.lifeStage === "elderly") return "RETIRED";
  if (resident.educationLevel && resident.educationProgressDays) return "STUDENT";
  return "UNEMPLOYED";
}

function buildPlayerPosition(input: LocalSceneInput): SpatialPositionState {
  if (!input.targetLocationId && input.playerPosition) {
    const sector = sectorById(input, input.playerPosition.sectorId);
    if (sector && input.metropolitan.streaming.activeSectorIds.includes(sector.id)) {
      return { ...input.playerPosition, updatedAt: input.timestamp };
    }
  }
  const locationId = input.targetLocationId ?? input.activeLocationId;
  const placement = placementForLocation(input, locationId) ?? input.metropolitan.locations[0];
  const fallbackSector = placement ? sectorById(input, placement.sectorId) : input.metropolitan.sectors[0];
  if (!placement || !fallbackSector) {
    return { sectorId: "sector-missing", xM: 0, yM: 0, locationId, state: "outside", updatedAt: input.timestamp };
  }
  const building = buildingForLocation(input, locationId);
  const point = building ? center(building.bounds) : center(placement.bounds);
  return {
    sectorId: building?.sectorId ?? placement.sectorId,
    xM: Math.round(point.xM * 10) / 10,
    yM: Math.round(point.yM * 10) / 10,
    locationId,
    buildingId: building?.id,
    floor: building ? 1 : undefined,
    state: building ? "inside" : "outside",
    updatedAt: input.timestamp
  };
}

const LOCAL_FIRST_NAMES = ["Mara", "Vik", "Soren", "Ilya", "Nika", "Jun", "Rin", "Dara", "Tomas", "Lea", "Kiro", "Mina", "Oleg", "Tess", "Arin", "Yana"] as const;
const LOCAL_LAST_NAMES = ["Voss", "Kade", "Orlov", "Vale", "Sato", "Kern", "Rusk", "Meyer", "Dane", "Kovac", "Ives", "Rao", "Klein", "Moroz", "Ahn", "Costa"] as const;

function syntheticRole(sector: MetropolitanSectorState, rng: SeededRandom): string {
  const roles: Record<MetropolitanSectorState["landUse"], readonly string[]> = {
    residential: ["RESIDENT", "CARE WORKER", "DELIVERY RUNNER", "MAINTENANCE"],
    mixed: ["SHOP WORKER", "COURIER", "CLERK", "RESIDENT"],
    commercial: ["VENDOR", "SECURITY", "SERVICE WORKER", "OFFICE CLERK"],
    industrial: ["LOADER", "TECHNICIAN", "SHIFT WORKER", "DRIVER"],
    corporate: ["ANALYST", "SECURITY", "ADMINISTRATOR", "TECHNICIAN"],
    civic: ["CLERK", "MEDIC", "PUBLIC WORKER", "SECURITY"],
    transport: ["COMMUTER", "DRIVER", "TRANSIT WORKER", "COURIER"],
    utility: ["TECHNICIAN", "MAINTENANCE", "SECURITY", "OPERATOR"],
    vacant: ["UNHOUSED", "SCAVENGER", "RUNNER", "LOOKOUT"]
  };
  return rng.pick(roles[sector.landUse]);
}

function syntheticActivity(sector: MetropolitanSectorState, rng: SeededRandom, timestamp: number): LocalActorActivity {
  const hour = new Date(timestamp).getUTCHours();
  if (sector.landUse === "transport" && rng.chance(0.55)) return "commute";
  if (hour >= 23 || hour < 6) return rng.chance(0.82) ? "rest" : "work";
  if (hour >= 7 && hour < 18) {
    if (["industrial", "corporate", "commercial", "civic", "utility"].includes(sector.landUse)) return rng.chance(0.76) ? "work" : "errand";
    return rng.chance(0.42) ? "work" : rng.chance(0.5) ? "errand" : "home";
  }
  return rng.chance(0.34) ? "errand" : rng.chance(0.32) ? "commute" : "home";
}

function clampPointToSector(sector: MetropolitanSectorState, point: { xM: number; yM: number }): { xM: number; yM: number } {
  return {
    xM: Math.round(clamp(point.xM, sector.bounds.xM + 1, sector.bounds.xM + sector.bounds.widthM - 1) * 10) / 10,
    yM: Math.round(clamp(point.yM, sector.bounds.yM + 1, sector.bounds.yM + sector.bounds.heightM - 1) * 10) / 10
  };
}

function syntheticPosition(
  input: LocalSceneInput,
  sector: MetropolitanSectorState,
  slot: number,
  activity: LocalActorActivity,
  playerPosition: SpatialPositionState
): SpatialPositionState {
  const rng = new SeededRandom(`${input.seed}:sector-actor-position:${sector.id}:${slot}:${Math.floor(input.timestamp / (60 * 60_000))}`);
  const isFocus = sector.id === playerPosition.sectorId;
  const sectorBuildings = input.urban.buildings.filter((building) => building.sectorId === sector.id);
  const playerBuilding = playerPosition.buildingId ? sectorBuildings.find((building) => building.id === playerPosition.buildingId) : undefined;
  const nearPlayer = isFocus && slot < 8;
  let building = nearPlayer && playerBuilding ? playerBuilding : sectorBuildings.length && rng.chance(activity === "commute" ? 0.15 : 0.72) ? rng.pick(sectorBuildings) : undefined;

  if (nearPlayer) {
    const radius = slot === 0 ? 2.5 : 18 + slot * 11;
    const angle = rng.next() * Math.PI * 2;
    const point = clampPointToSector(sector, {
      xM: playerPosition.xM + Math.cos(angle) * radius,
      yM: playerPosition.yM + Math.sin(angle) * radius
    });
    return {
      sectorId: sector.id,
      xM: point.xM,
      yM: point.yM,
      locationId: building?.anchorLocationId ?? playerPosition.locationId,
      buildingId: playerPosition.state === "inside" ? playerPosition.buildingId : undefined,
      unitId: playerPosition.state === "inside" ? playerPosition.unitId : undefined,
      roomId: playerPosition.state === "inside" ? playerPosition.roomId : undefined,
      floor: playerPosition.state === "inside" ? playerPosition.floor : undefined,
      state: playerPosition.state === "inside" ? "inside" : activity === "commute" ? "in-transit" : "outside",
      updatedAt: input.timestamp
    };
  }

  if (building) {
    const point = stablePoint(building.bounds, `${input.seed}:sector-actor-building:${sector.id}:${slot}`, 2);
    return {
      sectorId: sector.id,
      xM: point.xM,
      yM: point.yM,
      locationId: building.anchorLocationId,
      buildingId: building.id,
      floor: 1,
      state: activity === "commute" ? "in-transit" : "inside",
      updatedAt: input.timestamp
    };
  }

  const point = pointInSector(sector, `${input.seed}:sector-actor-street:${sector.id}:${slot}:${Math.floor(input.timestamp / (60 * 60_000))}`);
  return {
    sectorId: sector.id,
    xM: point.xM,
    yM: point.yM,
    state: activity === "commute" ? "in-transit" : "outside",
    updatedAt: input.timestamp
  };
}

function createSyntheticActor(
  input: LocalSceneInput,
  sector: MetropolitanSectorState,
  slot: number,
  targetCount: number,
  playerPosition: SpatialPositionState
): LocalActorState {
  const residentId = createStableEntityId("sector-resident", `${input.seed}:${sector.id}:${slot}`);
  const rng = new SeededRandom(`${input.seed}:sector-actor:${sector.id}:${slot}`);
  const activity = syntheticActivity(sector, rng, input.timestamp);
  const position = syntheticPosition(input, sector, slot, activity, playerPosition);
  const actorDistance = distance(playerPosition, position);
  const sameBuilding = playerPosition.buildingId && position.buildingId === playerPosition.buildingId;
  const sameUnit = !playerPosition.unitId || position.unitId === playerPosition.unitId;
  const sameFloor = playerPosition.floor === undefined || (position.floor ?? 1) === playerPosition.floor;
  const spatiallyVisible = playerPosition.state === "inside" ? Boolean(sameBuilding && sameUnit && sameFloor) : position.state !== "inside";
  const visible = position.sectorId === playerPosition.sectorId && spatiallyVisible && actorDistance <= VISIBLE_DISTANCE_M;
  const nearby = visible && actorDistance <= NEARBY_DISTANCE_M;
  const location = position.locationId ? input.locations.find((item) => item.id === position.locationId) : undefined;
  const healthRoll = rng.integer(1, 100);
  const health: BackgroundResident["health"] = healthRoll <= 4 ? "disabled" : healthRoll <= 13 ? "ill" : healthRoll <= 31 ? "strained" : "healthy";
  return {
    id: createStableEntityId("local-actor", residentId),
    residentId,
    source: "sector-sample",
    name: `${rng.pick(LOCAL_FIRST_NAMES)} ${rng.pick(LOCAL_LAST_NAMES)}`,
    age: rng.integer(16, 78),
    roleLabel: syntheticRole(sector, rng),
    health,
    activity,
    activityLabel: activityLabel(activity, location?.name),
    position,
    homeLocationId: null,
    knownToPlayer: false,
    distanceToPlayerM: actorDistance,
    visible,
    nearby,
    interactable: nearby && actorDistance <= INTERACTION_DISTANCE_M && position.state !== "in-transit",
    representedWeight: Math.max(1, Math.round(sector.representedPopulation / Math.max(1, targetCount))),
    lastMaterializedAt: input.timestamp
  };
}

function materializeActors(input: LocalSceneInput, playerPosition: SpatialPositionState): LocalActorState[] {
  const activeSectorIds = new Set(input.metropolitan.streaming.activeSectorIds);
  const representedWeight = new Map(input.urban.sampleLinks.map((link) => [link.residentId, link.representedWeight]));
  const actors: LocalActorState[] = [];
  for (const resident of input.population.residents) {
    const placement = actorPlacement(input, resident);
    if (!placement || !activeSectorIds.has(placement.position.sectorId)) continue;
    const known = knownPersonFor(input, resident);
    const actorDistance = distance(playerPosition, placement.position);
    const sameBuilding = playerPosition.buildingId && placement.position.buildingId === playerPosition.buildingId;
    const sameUnit = !playerPosition.unitId || placement.position.unitId === playerPosition.unitId;
    const sameFloor = playerPosition.floor === undefined || (placement.position.floor ?? 1) === playerPosition.floor;
    const spatiallyVisible = playerPosition.state === "inside" ? Boolean(sameBuilding && sameUnit && sameFloor) : placement.position.state !== "inside";
    const visible = placement.position.sectorId === playerPosition.sectorId && spatiallyVisible && actorDistance <= VISIBLE_DISTANCE_M;
    const nearby = visible && actorDistance <= NEARBY_DISTANCE_M;
    const location = placement.position.locationId ? input.locations.find((item) => item.id === placement.position.locationId) : undefined;
    actors.push({
      id: createStableEntityId("local-actor", resident.id),
      residentId: resident.id,
      source: "detailed",
      activePersonId: resident.activePersonId,
      name: resident.name,
      age: resident.age,
      roleLabel: roleLabel(input, resident),
      health: resident.health,
      activity: placement.activity,
      activityLabel: activityLabel(placement.activity, location?.name),
      position: placement.position,
      homeLocationId: resident.homeLocationId,
      destinationLocationId: placement.destinationLocationId,
      knownToPlayer: Boolean(known),
      distanceToPlayerM: actorDistance,
      visible,
      nearby,
      interactable: nearby && actorDistance <= INTERACTION_DISTANCE_M && placement.position.state !== "in-transit",
      representedWeight: representedWeight.get(resident.id) ?? 1,
      lastMaterializedAt: input.timestamp
    });
  }

  const sectorOrder = input.metropolitan.streaming.activeSectorIds
    .map((sectorId) => sectorById(input, sectorId))
    .filter((sector): sector is MetropolitanSectorState => Boolean(sector))
    .sort((left, right) => Number(right.id === playerPosition.sectorId) - Number(left.id === playerPosition.sectorId));
  for (const sector of sectorOrder) {
    const targetCount = sector.materializedResidentCount;
    const existingCount = actors.filter((actor) => actor.position.sectorId === sector.id).length;
    let syntheticAdded = 0;
    for (let slot = 0; existingCount + syntheticAdded < targetCount && actors.length < input.metropolitan.config.maxMaterializedResidents; slot += 1) {
      actors.push(createSyntheticActor(input, sector, slot, targetCount, playerPosition));
      syntheticAdded += 1;
    }
  }

  return actors
    .sort((left, right) => Number(right.knownToPlayer) - Number(left.knownToPlayer) || Number(right.position.sectorId === playerPosition.sectorId) - Number(left.position.sectorId === playerPosition.sectorId) || left.distanceToPlayerM - right.distanceToPlayerM || left.id.localeCompare(right.id))
    .slice(0, input.metropolitan.config.maxMaterializedResidents);
}

function materializeBuildings(input: LocalSceneInput, playerPosition: SpatialPositionState, actors: LocalActorState[]): LocalBuildingPresenceState[] {
  return input.urban.buildings
    .filter((building) => building.sectorId === playerPosition.sectorId)
    .map((building) => {
      const sector = sectorById(input, building.sectorId);
      const buildingCenter = center(building.bounds);
      const entrancePoint = sector
        ? {
            xM: clamp(buildingCenter.xM, sector.bounds.xM + 1, sector.bounds.xM + sector.bounds.widthM - 1),
            yM: clamp(building.bounds.yM - 2, sector.bounds.yM + 1, sector.bounds.yM + sector.bounds.heightM - 1)
          }
        : buildingCenter;
      const targetPoint = playerPosition.buildingId === building.id ? buildingCenter : entrancePoint;
      return {
        buildingId: building.id,
        addressCode: building.addressCode,
        use: building.use,
        distanceToPlayerM: Math.round(Math.hypot(targetPoint.xM - playerPosition.xM, targetPoint.yM - playerPosition.yM) * 10) / 10,
        publicEntrances: building.publicEntrances,
        serviceEntrances: building.serviceEntrances,
        security: building.security,
        occupiedActorCount: actors.filter((actor) => actor.position.buildingId === building.id).length,
        playerInside: playerPosition.buildingId === building.id
      };
    })
    .sort((left, right) => Number(right.playerInside) - Number(left.playerInside) || left.distanceToPlayerM - right.distanceToPlayerM)
    .slice(0, MAX_LOCAL_BUILDINGS);
}

function buildState(input: LocalSceneInput): LocalSceneState {
  const playerPosition = buildPlayerPosition(input);
  const actors = materializeActors(input, playerPosition);
  const buildings = materializeBuildings(input, playerPosition, actors);
  const focusSector = sectorById(input, playerPosition.sectorId);
  const focusSectorActors = actors.filter((actor) => actor.position.sectorId === playerPosition.sectorId);
  const visibleActorIds = actors.filter((actor) => actor.visible).map((actor) => actor.id);
  const nearbyActorIds = actors.filter((actor) => actor.nearby).map((actor) => actor.id);
  return {
    version: 1,
    focusSectorId: playerPosition.sectorId,
    playerPosition,
    actors,
    buildings,
    nearbyActorIds,
    visibleActorIds,
    totals: {
      materializedActors: actors.length,
      focusSectorActors: focusSectorActors.length,
      visibleActors: visibleActorIds.length,
      nearbyActors: nearbyActorIds.length,
      knownActors: actors.filter((actor) => actor.knownToPlayer).length,
      interiorActors: actors.filter((actor) => actor.position.state === "inside").length,
      commutingActors: actors.filter((actor) => actor.position.state === "in-transit").length,
      materializedBuildings: buildings.length,
      ambientPopulationEstimate: Math.max(0, (focusSector?.materializedResidentCount ?? 0) - focusSectorActors.length)
    },
    lastUpdatedAt: input.timestamp
  };
}

export function createLocalSceneState(input: LocalSceneInput): LocalSceneState {
  return buildState(input);
}

export function advanceLocalSceneState(state: LocalSceneState, input: LocalSceneInput): LocalSceneState {
  return buildState({
    ...input,
    playerPosition: input.playerPosition ?? (input.targetLocationId ? undefined : state.playerPosition)
  });
}

export function normalizeLocalSceneState(value: unknown, input: LocalSceneInput): LocalSceneState {
  if (!value || typeof value !== "object") return buildState(input);
  const raw = value as Partial<LocalSceneState>;
  if (raw.version !== 1 || !Array.isArray(raw.actors) || !raw.playerPosition) return buildState(input);
  return buildState({ ...input, playerPosition: raw.playerPosition });
}

export function getVisibleLocalActors(state: LocalSceneState): LocalActorState[] {
  const ids = new Set(state.visibleActorIds);
  return state.actors.filter((actor) => ids.has(actor.id));
}

export function getNearbyLocalActors(state: LocalSceneState): LocalActorState[] {
  const ids = new Set(state.nearbyActorIds);
  return state.actors.filter((actor) => ids.has(actor.id));
}
