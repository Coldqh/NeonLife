import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BackgroundResident, EmploymentRecord } from "../population/types";
import type { MetropolitanSectorState, MetropolitanState, MetricPoint } from "../spatial/types";
import type {
  CommuterPlanState,
  FreightMovementState,
  MetropolitanMobilityInput,
  MetropolitanMobilityState,
  MobilityFleetState,
  MobilityMode,
  MobilityParkingState,
  MobilityRouteState,
  MobilityRouteStatus,
  MobilitySectorFlowState,
  MobilitySnapshotState,
  MobilityTotalsState,
  MobilityTravelEstimate
} from "./types";

const HOUR_MS = 60 * 60_000;
const MAX_HISTORY = 24 * 31;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function whole(value: number): number {
  return Math.max(0, Math.round(value));
}

function pointForSector(sector: MetropolitanSectorState): MetricPoint {
  return {
    xM: sector.bounds.xM + sector.bounds.widthM / 2,
    yM: sector.bounds.yM + sector.bounds.heightM / 2
  };
}

function pointForLocation(metropolitan: MetropolitanState, locationId: string): MetricPoint | null {
  const placement = metropolitan.locations.find((item) => item.locationId === locationId);
  if (!placement) return null;
  return {
    xM: placement.bounds.xM + placement.bounds.widthM / 2,
    yM: placement.bounds.yM + placement.bounds.heightM / 2
  };
}

function distanceBetweenLocations(metropolitan: MetropolitanState, originLocationId: string, destinationLocationId: string): number {
  const origin = pointForLocation(metropolitan, originLocationId);
  const destination = pointForLocation(metropolitan, destinationLocationId);
  if (!origin || !destination) return metropolitan.config.sectorSizeM;
  return Math.max(250, Math.round(Math.hypot(destination.xM - origin.xM, destination.yM - origin.yM)));
}

function sectorForLocation(metropolitan: MetropolitanState, locationId: string): MetropolitanSectorState | undefined {
  const placement = metropolitan.locations.find((item) => item.locationId === locationId);
  return metropolitan.sectors.find((sector) => sector.id === placement?.sectorId);
}

function sectorPath(metropolitan: MetropolitanState, originSectorId: string, destinationSectorId: string): string[] {
  const origin = metropolitan.sectors.find((item) => item.id === originSectorId);
  const destination = metropolitan.sectors.find((item) => item.id === destinationSectorId);
  if (!origin || !destination) return origin ? [origin.id] : destination ? [destination.id] : [];
  const byCoordinate = new Map(metropolitan.sectors.map((sector) => [`${sector.xIndex}:${sector.yIndex}`, sector.id]));
  const deltaX = destination.xIndex - origin.xIndex;
  const deltaY = destination.yIndex - origin.yIndex;
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY), 1);
  const result: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const xIndex = Math.round(origin.xIndex + deltaX * step / steps);
    const yIndex = Math.round(origin.yIndex + deltaY * step / steps);
    const sectorId = byCoordinate.get(`${xIndex}:${yIndex}`);
    if (sectorId && result[result.length - 1] !== sectorId) result.push(sectorId);
  }
  return result.length ? result : [origin.id, destination.id].filter((id, index, array) => array.indexOf(id) === index);
}

function routeDistance(metropolitan: MetropolitanState, pathSectorIds: string[]): number {
  if (pathSectorIds.length <= 1) return metropolitan.config.sectorSizeM;
  let distanceM = 0;
  for (let index = 1; index < pathSectorIds.length; index += 1) {
    const previous = metropolitan.sectors.find((sector) => sector.id === pathSectorIds[index - 1]);
    const current = metropolitan.sectors.find((sector) => sector.id === pathSectorIds[index]);
    if (!previous || !current) continue;
    const left = pointForSector(previous);
    const right = pointForSector(current);
    distanceM += Math.hypot(right.xM - left.xM, right.yM - left.yM);
  }
  return Math.max(metropolitan.config.sectorSizeM, Math.round(distanceM));
}

function routeStatus(loadPercent: number, reliability: number): MobilityRouteStatus {
  if (reliability < 25 || loadPercent >= 175) return "blocked";
  if (loadPercent >= 110) return "congested";
  if (loadPercent >= 72) return "busy";
  return "clear";
}

function modeSpeed(mode: MobilityMode): number {
  if (mode === "walk") return 5;
  if (mode === "metro") return 46;
  if (mode === "bus") return 29;
  if (mode === "freight") return 34;
  if (mode === "service") return 38;
  if (mode === "taxi") return 40;
  return 43;
}

function durationFor(mode: MobilityMode, distanceM: number, congestionPercent: number, crowdingPercent = 0): number {
  const congestionFactor = mode === "metro" || mode === "walk" ? 1 : 1 + congestionPercent / 115;
  const crowdingDelay = mode === "metro" || mode === "bus" ? crowdingPercent / 18 : 0;
  const accessMinutes = mode === "metro" ? 9 : mode === "bus" ? 5 : mode === "walk" ? 0 : 3;
  return Math.max(2, Math.round(distanceM / 1000 / modeSpeed(mode) * 60 * congestionFactor + crowdingDelay + accessMinutes));
}

function closestSectorToPoint(metropolitan: MetropolitanState, point: MetricPoint): MetropolitanSectorState {
  return metropolitan.sectors.reduce((best, sector) => {
    const center = pointForSector(sector);
    const bestCenter = pointForSector(best);
    return Math.hypot(center.xM - point.xM, center.yM - point.yM) < Math.hypot(bestCenter.xM - point.xM, bestCenter.yM - point.yM) ? sector : best;
  }, metropolitan.sectors[0]);
}

function transitRoutes(input: MetropolitanMobilityInput): MobilityRouteState[] {
  return input.metropolitan.transitLines.flatMap((line, lineIndex) => {
    const stations = line.stationIds
      .map((id) => input.metropolitan.transitStations.find((station) => station.id === id))
      .filter((station): station is NonNullable<typeof station> => Boolean(station));
    const first = stations[0];
    const last = stations[stations.length - 1];
    if (!first || !last) return [];
    const origin = input.metropolitan.sectors.find((sector) => sector.id === first.sectorId);
    const destination = input.metropolitan.sectors.find((sector) => sector.id === last.sectorId);
    if (!origin || !destination) return [];
    const pathSectorIds = stations.map((station) => station.sectorId).filter((id, index, array) => array.indexOf(id) === index);
    const primaryMode: MobilityMode = line.mode === "freight" ? "freight" : "metro";
    const capacityPerHour = Math.max(1, Math.round(line.dailyCapacity / (primaryMode === "freight" ? 16 : 18)));
    const reliability = clamp(input.transportServiceLevel * 0.82 + input.dataServiceLevel * 0.18 - (lineIndex % 3) * 2);
    return [{
      id: createStableEntityId("mobility-route", `${input.seed}:transit:${line.id}`),
      code: `TR-${(lineIndex + 1).toString().padStart(2, "0")}`,
      name: line.name,
      kind: line.mode === "freight" ? "freight" : "mass-transit",
      primaryMode,
      originSectorId: origin.id,
      destinationSectorId: destination.id,
      districtIds: [...new Set(stations.map((station) => station.districtId))],
      pathSectorIds,
      distanceM: line.lengthM,
      baseDurationMinutes: durationFor(primaryMode, line.lengthM, 0),
      currentDurationMinutes: durationFor(primaryMode, line.lengthM, 0),
      capacityPerHour,
      demandPerHour: 0,
      loadPercent: 0,
      congestionPercent: 0,
      serviceReliability: reliability,
      status: reliability < 25 ? "blocked" : "clear",
      lastUpdatedAt: input.timestamp
    }];
  });
}

function districtRoutes(input: MetropolitanMobilityInput): MobilityRouteState[] {
  const anchors = input.metropolitan.districts.map((district) => {
    const sector = closestSectorToPoint(input.metropolitan, district.center);
    return { district, sector };
  });
  const routes: MobilityRouteState[] = [];
  for (let leftIndex = 0; leftIndex < anchors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < anchors.length; rightIndex += 1) {
      const left = anchors[leftIndex];
      const right = anchors[rightIndex];
      const pathSectorIds = sectorPath(input.metropolitan, left.sector.id, right.sector.id);
      const distanceM = routeDistance(input.metropolitan, pathSectorIds);
      const reliability = clamp(input.transportServiceLevel * 0.78 + input.dataServiceLevel * 0.12 + 8);
      routes.push({
        id: createStableEntityId("mobility-route", `${input.seed}:bus:${left.district.districtId}:${right.district.districtId}`),
        code: `BUS-${leftIndex + 1}${rightIndex + 1}`,
        name: `${input.districts.find((item) => item.id === left.district.districtId)?.code ?? "A"} ↔ ${input.districts.find((item) => item.id === right.district.districtId)?.code ?? "B"}`,
        kind: "commuter",
        primaryMode: "bus",
        originSectorId: left.sector.id,
        destinationSectorId: right.sector.id,
        districtIds: [left.district.districtId, right.district.districtId],
        pathSectorIds,
        distanceM,
        baseDurationMinutes: durationFor("bus", distanceM, 0),
        currentDurationMinutes: durationFor("bus", distanceM, 0),
        capacityPerHour: Math.max(2_400, Math.round((left.district.representedPopulation + right.district.representedPopulation) / 250)),
        demandPerHour: 0,
        loadPercent: 0,
        congestionPercent: 0,
        serviceReliability: reliability,
        status: reliability < 25 ? "blocked" : "clear",
        lastUpdatedAt: input.timestamp
      });
    }
  }
  return routes;
}

function serviceRoutes(input: MetropolitanMobilityInput): MobilityRouteState[] {
  const routes: MobilityRouteState[] = [];
  for (const organization of input.organizations) {
    if (!["government", "police", "medical", "transport", "company", "corporation"].includes(organization.type)) continue;
    const placements = organization.locationIds
      .map((locationId) => input.metropolitan.locations.find((placement) => placement.locationId === locationId))
      .filter((placement): placement is NonNullable<typeof placement> => Boolean(placement));
    if (!placements.length) continue;
    const origin = input.metropolitan.sectors.find((sector) => sector.id === placements[0].sectorId);
    const districtSpatial = input.metropolitan.districts.find((district) => district.districtId === origin?.districtId);
    if (!origin || !districtSpatial) continue;
    const destination = closestSectorToPoint(input.metropolitan, districtSpatial.center);
    const pathSectorIds = sectorPath(input.metropolitan, origin.id, destination.id);
    const distanceM = routeDistance(input.metropolitan, pathSectorIds);
    const capacityPerHour = Math.max(8, Math.round(organization.employeeCount / 18));
    const reliability = clamp(input.transportServiceLevel * 0.58 + input.dataServiceLevel * 0.18 + organization.reputation * 0.24);
    routes.push({
      id: createStableEntityId("mobility-route", `${input.seed}:service:${organization.id}`),
      code: `SRV-${organization.code.slice(0, 5)}`,
      name: `${organization.name} SERVICE GRID`,
      kind: "service",
      primaryMode: "service",
      originSectorId: origin.id,
      destinationSectorId: destination.id,
      districtIds: [origin.districtId],
      pathSectorIds,
      distanceM,
      baseDurationMinutes: durationFor("service", distanceM, 0),
      currentDurationMinutes: durationFor("service", distanceM, 0),
      capacityPerHour,
      demandPerHour: 0,
      loadPercent: 0,
      congestionPercent: 0,
      serviceReliability: reliability,
      status: reliability < 25 ? "blocked" : "clear",
      lastUpdatedAt: input.timestamp
    });
  }
  return routes.slice(0, 24);
}

function destinationForShipment(input: MetropolitanMobilityInput, shipment: MetropolitanMobilityInput["production"]["shipments"][number]): string | null {
  if (shipment.targetKind === "facility") {
    return input.production.facilities.find((facility) => facility.id === shipment.targetFacilityId)?.locationId ?? null;
  }
  return input.economy.businesses.find((business) => business.id === shipment.targetBusinessId)?.locationId ?? null;
}

function freightMovements(input: MetropolitanMobilityInput, previous: FreightMovementState[] = []): FreightMovementState[] {
  const previousByShipment = new Map(previous.map((item) => [item.shipmentId, item]));
  return input.production.shipments.flatMap((shipment) => {
    const sourceLocationId = input.production.facilities.find((facility) => facility.id === shipment.sourceFacilityId)?.locationId;
    const destinationLocationId = destinationForShipment(input, shipment);
    if (!sourceLocationId || !destinationLocationId) return [];
    const origin = sectorForLocation(input.metropolitan, sourceLocationId);
    const destination = sectorForLocation(input.metropolitan, destinationLocationId);
    if (!origin || !destination) return [];
    const pathSectorIds = sectorPath(input.metropolitan, origin.id, destination.id);
    const previousMovement = previousByShipment.get(shipment.id);
    return [{
      id: previousMovement?.id ?? createStableEntityId("freight-movement", `${input.seed}:${shipment.id}`),
      shipmentId: shipment.id,
      sourceLocationId,
      destinationLocationId,
      originSectorId: origin.id,
      destinationSectorId: destination.id,
      routeId: createStableEntityId("mobility-route", `${input.seed}:freight:${origin.id}:${destination.id}`),
      pathSectorIds,
      status: shipment.status,
      legality: shipment.legality,
      departedAt: shipment.departedAt,
      estimatedArrivalAt: shipment.estimatedArrivalAt,
      units: shipment.units,
      vehicleCount: Math.max(1, Math.ceil(shipment.transportCapacityUsed / 8)),
      delayHours: shipment.delayHours,
      lastUpdatedAt: input.timestamp
    }];
  }).slice(-480);
}

function freightRoutes(input: MetropolitanMobilityInput, movements: FreightMovementState[]): MobilityRouteState[] {
  const grouped = new Map<string, FreightMovementState[]>();
  for (const movement of movements) {
    const group = grouped.get(movement.routeId) ?? [];
    group.push(movement);
    grouped.set(movement.routeId, group);
  }
  return [...grouped.entries()].map<MobilityRouteState>(([routeId, group], index) => {
    const first = group[0];
    const distanceM = routeDistance(input.metropolitan, first.pathSectorIds);
    const active = group.filter((movement) => movement.status === "in-transit" || movement.status === "queued");
    const demand = active.reduce((sum, movement) => sum + movement.vehicleCount, 0);
    const capacity = Math.max(12, first.pathSectorIds.length * 8);
    const loadPercent = whole(demand / capacity * 100);
    const reliability = clamp(input.transportServiceLevel * 0.72 + input.dataServiceLevel * 0.08 + 12 - group.reduce((sum, item) => sum + item.delayHours, 0) / Math.max(1, group.length));
    return {
      id: routeId,
      code: `FRT-${(index + 1).toString().padStart(3, "0")}`,
      name: `FREIGHT ${first.originSectorId.slice(-4).toUpperCase()} → ${first.destinationSectorId.slice(-4).toUpperCase()}`,
      kind: "freight",
      primaryMode: "freight",
      originSectorId: first.originSectorId,
      destinationSectorId: first.destinationSectorId,
      districtIds: [...new Set(first.pathSectorIds.map((sectorId) => input.metropolitan.sectors.find((sector) => sector.id === sectorId)?.districtId).filter((id): id is string => Boolean(id)))],
      pathSectorIds: first.pathSectorIds,
      distanceM,
      baseDurationMinutes: durationFor("freight", distanceM, 0),
      currentDurationMinutes: durationFor("freight", distanceM, loadPercent),
      capacityPerHour: capacity,
      demandPerHour: demand,
      loadPercent,
      congestionPercent: clamp(loadPercent * 0.58),
      serviceReliability: reliability,
      status: routeStatus(loadPercent, reliability),
      lastUpdatedAt: input.timestamp
    };
  }).slice(0, 80);
}

function commuterMode(seed: string, resident: BackgroundResident, distanceM: number, transitAvailable: boolean): CommuterPlanState["mode"] {
  if (distanceM <= 1_600) return "walk";
  const rng = new SeededRandom(`${seed}:commuter-mode:${resident.id}:${resident.homeLocationId}:${resident.employmentId}`);
  if (resident.transportAccess >= 72 && rng.chance(0.42)) return "private-car";
  if (transitAvailable && distanceM >= 2_500 && resident.transportAccess >= 42) return "metro";
  return "bus";
}

function shiftHours(employment: EmploymentRecord, residentId: string): { departureHour: number; returnHour: number } {
  if (employment.shift === "night") return { departureHour: 19, returnHour: 6 };
  if (employment.shift === "rotating") {
    const parity = parseInt(residentId.slice(-2), 16) % 2;
    return parity === 0 ? { departureHour: 6, returnHour: 15 } : { departureHour: 14, returnHour: 23 };
  }
  return { departureHour: 7, returnHour: 17 };
}

function commuterPlans(input: MetropolitanMobilityInput, previous: CommuterPlanState[] = []): CommuterPlanState[] {
  const previousByResident = new Map(previous.map((plan) => [plan.residentId, plan]));
  const employmentByResident = new Map(input.population.employments.filter((employment) => employment.status !== "unemployed").map((employment) => [employment.residentId, employment]));
  return input.population.residents.flatMap((resident) => {
    const employment = employmentByResident.get(resident.id);
    if (!employment || !resident.homeLocationId) return [];
    const origin = sectorForLocation(input.metropolitan, resident.homeLocationId);
    const destination = sectorForLocation(input.metropolitan, employment.locationId);
    if (!origin || !destination) return [];
    const distanceM = distanceBetweenLocations(input.metropolitan, resident.homeLocationId, employment.locationId);
    const transitAvailable = input.metropolitan.transitStations.some((station) => station.districtId === origin.districtId)
      && input.metropolitan.transitStations.some((station) => station.districtId === destination.districtId);
    const mode = commuterMode(input.seed, resident, distanceM, transitAvailable);
    const hours = shiftHours(employment, resident.id);
    const previousPlan = previousByResident.get(resident.id);
    const sameRoute = previousPlan?.originLocationId === resident.homeLocationId && previousPlan.destinationLocationId === employment.locationId;
    return [{
      residentId: resident.id,
      householdId: resident.householdId,
      originLocationId: resident.homeLocationId,
      destinationLocationId: employment.locationId,
      originSectorId: origin.id,
      destinationSectorId: destination.id,
      mode,
      shift: employment.shift,
      departureHour: hours.departureHour,
      returnHour: hours.returnHour,
      distanceM,
      expectedDurationMinutes: durationFor(mode, distanceM, 35, 45),
      lastTripAt: sameRoute ? previousPlan?.lastTripAt : undefined,
      tripsCompleted: sameRoute ? previousPlan?.tripsCompleted ?? 0 : 0
    }];
  });
}

function fleetStates(input: MetropolitanMobilityInput): MobilityFleetState[] {
  const fleets: MobilityFleetState[] = [];
  for (const district of input.metropolitan.districts) {
    const population = district.representedPopulation;
    const condition = clamp(input.transportServiceLevel * 0.75 + input.dataServiceLevel * 0.08 + 12);
    const privateVehicles = whole(population * (0.12 + district.verticality / 1_500));
    const modes: Array<{ mode: MobilityFleetState["mode"]; vehicles: number; capacity: number; reliability: number }> = [
      { mode: "private-car", vehicles: privateVehicles, capacity: 4, reliability: condition },
      { mode: "taxi", vehicles: Math.max(80, whole(population / 1_450)), capacity: 4, reliability: clamp(condition - 4) },
      { mode: "bus", vehicles: Math.max(35, whole(population / 25_000)), capacity: 86, reliability: clamp(input.transportServiceLevel * 0.88 + 8) },
      { mode: "metro", vehicles: Math.max(18, whole(population / 95_000)), capacity: 920, reliability: clamp(input.transportServiceLevel * 0.92 + input.dataServiceLevel * 0.08) }
    ];
    for (const item of modes) {
      const hour = new Date(input.timestamp).getUTCHours();
      const peak = hour >= 6 && hour <= 10 || hour >= 16 && hour <= 20;
      const activeShare = item.mode === "private-car" ? (peak ? 0.34 : 0.18) : item.mode === "metro" || item.mode === "bus" ? (peak ? 0.82 : 0.48) : peak ? 0.72 : 0.55;
      fleets.push({
        id: createStableEntityId("mobility-fleet", `${input.seed}:${district.districtId}:${item.mode}`),
        districtId: district.districtId,
        mode: item.mode,
        vehicles: item.vehicles,
        activeVehicles: Math.min(item.vehicles, whole(item.vehicles * activeShare * item.reliability / 100)),
        capacityPerVehicle: item.capacity,
        availabilityPercent: clamp(item.reliability - (peak ? 6 : 0)),
        averageCondition: condition,
        serviceReliability: item.reliability,
        lastUpdatedAt: input.timestamp
      });
    }
  }
  for (const organization of input.organizations) {
    if (!["government", "police", "medical", "transport", "company", "corporation"].includes(organization.type)) continue;
    const location = input.locations.find((item) => organization.locationIds.includes(item.id));
    if (!location) continue;
    const vehicles = Math.max(2, whole(organization.employeeCount / (organization.type === "transport" ? 18 : 42)));
    fleets.push({
      id: createStableEntityId("mobility-fleet", `${input.seed}:${organization.id}:service`),
      districtId: location.districtId,
      ownerEntityId: organization.id,
      mode: organization.type === "transport" ? "freight" : "service",
      vehicles,
      activeVehicles: Math.max(1, whole(vehicles * 0.58)),
      capacityPerVehicle: organization.type === "transport" ? 18 : 6,
      availabilityPercent: clamp(input.transportServiceLevel * 0.6 + organization.reputation * 0.35),
      averageCondition: clamp(55 + organization.reputation * 0.35),
      serviceReliability: clamp(input.transportServiceLevel * 0.55 + input.dataServiceLevel * 0.15 + organization.reputation * 0.3),
      lastUpdatedAt: input.timestamp
    });
  }
  return fleets;
}

function parkingBase(input: MetropolitanMobilityInput, sector: MetropolitanSectorState): { spaces: number; commercialSpaces: number; serviceSpaces: number; freightBays: number } {
  const catalog = input.urban.catalogs.find((item) => item.sectorId === sector.id);
  const residential = catalog?.residentialUnits ?? sector.representedHouseholds;
  const commercialBuildings = catalog?.commercialBuildings ?? whole(sector.buildingEstimate * 0.2);
  const industrialBuildings = catalog?.industrialBuildings ?? whole(sector.buildingEstimate * 0.12);
  const spaces = Math.max(20, whole(residential * 0.18 + commercialBuildings * 22 + industrialBuildings * 14 + sector.roadLengthM / 16));
  return {
    spaces,
    commercialSpaces: whole(commercialBuildings * 18),
    serviceSpaces: Math.max(4, whole((commercialBuildings + industrialBuildings) * 2.4)),
    freightBays: Math.max(2, whole(industrialBuildings * 1.8))
  };
}

function baseActivity(sector: MetropolitanSectorState, hour: number): { residentRate: number; workerRate: number; serviceRate: number; freightRate: number; parkingRatio: number } {
  const morning = hour >= 6 && hour <= 10;
  const evening = hour >= 16 && hour <= 20;
  const workday = hour >= 10 && hour < 16;
  const night = hour >= 22 || hour < 5;
  const residential = sector.landUse === "residential" || sector.landUse === "mixed";
  const work = sector.landUse === "corporate" || sector.landUse === "commercial" || sector.landUse === "industrial" || sector.landUse === "civic";
  const industrial = sector.landUse === "industrial" || sector.landUse === "transport" || sector.landUse === "utility";
  return {
    residentRate: residential ? morning || evening ? 0.042 : night ? 0.006 : 0.018 : workday ? 0.014 : 0.008,
    workerRate: work ? morning || evening ? 0.068 : workday ? 0.025 : 0.007 : 0.006,
    serviceRate: workday ? 0.006 : night ? 0.0015 : 0.0035,
    freightRate: industrial ? night ? 0.014 : morning ? 0.008 : 0.005 : night ? 0.002 : 0.001,
    parkingRatio: residential ? night ? 0.9 : morning ? 0.62 : workday ? 0.55 : 0.76 : work ? workday ? 0.82 : morning || evening ? 0.68 : 0.24 : 0.45
  };
}

interface MutableFlow {
  residentTrips: number;
  workerTrips: number;
  serviceTrips: number;
  freightTrips: number;
  throughTrips: number;
}

function routeDemandIntoFlows(routes: MobilityRouteState[], flows: Map<string, MutableFlow>): void {
  for (const route of routes) {
    if (route.demandPerHour <= 0 || route.pathSectorIds.length === 0) continue;
    const through = route.demandPerHour / route.pathSectorIds.length;
    for (const sectorId of route.pathSectorIds) {
      const flow = flows.get(sectorId);
      if (!flow) continue;
      flow.throughTrips += through;
      if (route.kind === "service") flow.serviceTrips += through * 0.35;
      if (route.kind === "freight") flow.freightTrips += through * 0.45;
    }
  }
}

function commuterDemandIntoFlows(input: MetropolitanMobilityInput, plans: CommuterPlanState[], flows: Map<string, MutableFlow>): void {
  const hour = new Date(input.timestamp).getUTCHours();
  const sampleWeight = new Map(input.urban.sampleLinks.map((link) => [link.residentId, Math.max(1, link.representedWeight)]));
  for (const plan of plans) {
    const departure = Math.min(Math.abs(hour - plan.departureHour), 24 - Math.abs(hour - plan.departureHour));
    const returning = Math.min(Math.abs(hour - plan.returnHour), 24 - Math.abs(hour - plan.returnHour));
    if (departure > 1 && returning > 1) continue;
    const weight = Math.min(7_500, sampleWeight.get(plan.residentId) ?? 1);
    const path = sectorPath(input.metropolitan, departure <= 1 ? plan.originSectorId : plan.destinationSectorId, departure <= 1 ? plan.destinationSectorId : plan.originSectorId);
    const perSector = weight / Math.max(1, path.length);
    for (const sectorId of path) {
      const flow = flows.get(sectorId);
      if (flow) flow.workerTrips += perSector;
    }
  }
}

function createParkingAndFlows(
  input: MetropolitanMobilityInput,
  routes: MobilityRouteState[],
  plans: CommuterPlanState[]
): { parking: MobilityParkingState[]; flows: MobilitySectorFlowState[] } {
  const hour = new Date(input.timestamp).getUTCHours();
  const hourIndex = Math.floor(input.timestamp / HOUR_MS);
  const mutable = new Map<string, MutableFlow>();
  for (const sector of input.metropolitan.sectors) {
    const cohort = input.urban.demography.cohorts.find((item) => item.sectorId === sector.id);
    const activity = baseActivity(sector, hour);
    const population = cohort?.population ?? sector.representedPopulation;
    const employed = cohort?.employed ?? whole(population * 0.58);
    mutable.set(sector.id, {
      residentTrips: population * activity.residentRate,
      workerTrips: employed * activity.workerRate,
      serviceTrips: Math.max(1, sector.buildingEstimate * activity.serviceRate * 10),
      freightTrips: Math.max(0, sector.buildingEstimate * activity.freightRate * 4),
      throughTrips: 0
    });
  }
  routeDemandIntoFlows(routes, mutable);
  commuterDemandIntoFlows(input, plans, mutable);

  const parking: MobilityParkingState[] = [];
  const flows: MobilitySectorFlowState[] = [];
  for (const sector of input.metropolitan.sectors) {
    const flow = mutable.get(sector.id) ?? { residentTrips: 0, workerTrips: 0, serviceTrips: 0, freightTrips: 0, throughTrips: 0 };
    const activity = baseActivity(sector, hour);
    const transitAccess = input.metropolitan.transitStations.some((station) => station.sectorId === sector.id)
      ? 0.58
      : sector.landUse === "transport" ? 0.48 : 0.3;
    const transitShare = clamp(transitAccess * input.transportServiceLevel, 10, 68) / 100;
    const walkShare = sector.landUse === "mixed" || sector.landUse === "commercial" ? 0.18 : 0.11;
    const passengerTrips = flow.residentTrips + flow.workerTrips;
    const transitDemand = passengerTrips * transitShare;
    const walkingDemand = passengerTrips * walkShare;
    const roadPassenger = Math.max(0, passengerTrips - transitDemand - walkingDemand);
    const roadDemand = roadPassenger + flow.serviceTrips + flow.freightTrips + flow.throughTrips;
    const roadCapacity = Math.max(180, sector.roadLengthM * (sector.landUse === "transport" ? 1.1 : sector.landUse === "industrial" ? 0.82 : 0.68));
    const deterministicNoise = new SeededRandom(`${input.seed}:mobility-flow:${sector.id}:${hourIndex}`).integer(-4, 5);
    const congestionPercent = clamp(Math.round(roadDemand / roadCapacity * 100 + (100 - input.transportServiceLevel) * 0.32 + deterministicNoise));
    const stationCapacity = input.metropolitan.transitStations.filter((station) => station.sectorId === sector.id).reduce((sum, station) => sum + station.dailyCapacity / 18, 0);
    const localTransitCapacity = Math.max(320, stationCapacity + sector.representedPopulation * 0.006);
    const transitCrowdingPercent = clamp(Math.round(transitDemand / localTransitCapacity * 100 + (100 - input.transportServiceLevel) * 0.18));
    const averageSpeedKph = Math.round(clamp(47 - congestionPercent * 0.38, 7, 47) * 10) / 10;
    const base = parkingBase(input, sector);
    const incomingVehicles = roadPassenger * 0.38 + flow.serviceTrips * 0.5 + flow.freightTrips * 0.4;
    const desiredOccupied = base.spaces * activity.parkingRatio + incomingVehicles * 0.18;
    const occupiedSpaces = Math.min(base.spaces, whole(desiredOccupied));
    const overflow = Math.max(0, desiredOccupied - base.spaces);
    const illegalParkingVehicles = whole(overflow * 0.42);
    const pressurePercent = clamp(Math.round((occupiedSpaces + illegalParkingVehicles) / Math.max(1, base.spaces) * 100));
    parking.push({
      id: createStableEntityId("mobility-parking", `${input.seed}:${sector.id}`),
      sectorId: sector.id,
      districtId: sector.districtId,
      ...base,
      occupiedSpaces,
      pricePerHour: Math.max(0, Math.round((input.districts.find((district) => district.id === sector.districtId)?.costOfLiving ?? 50) / 18 + pressurePercent / 25)),
      turnoverPerDay: whole(base.spaces * (sector.landUse === "commercial" ? 3.4 : sector.landUse === "mixed" ? 2.1 : 1.15)),
      illegalParkingVehicles,
      pressurePercent,
      status: pressurePercent >= 96 ? "full" : pressurePercent >= 78 ? "strained" : "available",
      lastUpdatedAt: input.timestamp
    });
    flows.push({
      sectorId: sector.id,
      districtId: sector.districtId,
      hourIndex,
      residentTripsPerHour: whole(flow.residentTrips),
      workerTripsPerHour: whole(flow.workerTrips),
      serviceTripsPerHour: whole(flow.serviceTrips),
      freightTripsPerHour: whole(flow.freightTrips),
      throughTripsPerHour: whole(flow.throughTrips),
      roadDemandPerHour: whole(roadDemand),
      transitDemandPerHour: whole(transitDemand),
      walkingDemandPerHour: whole(walkingDemand),
      congestionPercent,
      transitCrowdingPercent,
      averageSpeedKph,
      parkingOccupancyPercent: pressurePercent,
      illegalParkingVehicles
    });
  }
  return { parking, flows };
}

function updateRoutes(input: MetropolitanMobilityInput, routes: MobilityRouteState[], flows: MobilitySectorFlowState[]): MobilityRouteState[] {
  const flowBySector = new Map(flows.map((flow) => [flow.sectorId, flow]));
  return routes.map((route) => {
    const pathFlows = route.pathSectorIds.map((id) => flowBySector.get(id)).filter((flow): flow is MobilitySectorFlowState => Boolean(flow));
    const congestionPercent = pathFlows.length ? whole(pathFlows.reduce((sum, flow) => sum + flow.congestionPercent, 0) / pathFlows.length) : 0;
    const transitCrowding = pathFlows.length ? whole(pathFlows.reduce((sum, flow) => sum + flow.transitCrowdingPercent, 0) / pathFlows.length) : 0;
    const demandPerHour = route.kind === "freight" && route.demandPerHour > 0
      ? route.demandPerHour
      : route.primaryMode === "metro" || route.primaryMode === "bus"
        ? whole(pathFlows.reduce((sum, flow) => sum + flow.transitDemandPerHour, 0) / Math.max(1, pathFlows.length))
        : route.primaryMode === "service"
          ? whole(pathFlows.reduce((sum, flow) => sum + flow.serviceTripsPerHour, 0) / Math.max(1, pathFlows.length))
          : whole(pathFlows.reduce((sum, flow) => sum + flow.roadDemandPerHour, 0) / Math.max(1, pathFlows.length));
    const loadPercent = whole(demandPerHour / Math.max(1, route.capacityPerHour) * 100);
    const serviceReliability = clamp(route.serviceReliability - congestionPercent * (route.primaryMode === "metro" ? 0.05 : 0.18) - transitCrowding * 0.04);
    return {
      ...route,
      demandPerHour,
      loadPercent,
      congestionPercent,
      currentDurationMinutes: durationFor(route.primaryMode, route.distanceM, congestionPercent, transitCrowding),
      serviceReliability,
      status: routeStatus(loadPercent, serviceReliability),
      lastUpdatedAt: input.timestamp
    };
  });
}

function snapshot(input: MetropolitanMobilityInput, flows: MobilitySectorFlowState[], routes: MobilityRouteState[]): MobilitySnapshotState {
  const totalTripsPerHour = flows.reduce((sum, flow) => sum + flow.residentTripsPerHour + flow.workerTripsPerHour + flow.serviceTripsPerHour + flow.freightTripsPerHour, 0);
  const roadTripsPerHour = flows.reduce((sum, flow) => sum + flow.roadDemandPerHour, 0);
  const transitTripsPerHour = flows.reduce((sum, flow) => sum + flow.transitDemandPerHour, 0);
  const walkingTripsPerHour = flows.reduce((sum, flow) => sum + flow.walkingDemandPerHour, 0);
  const serviceTripsPerHour = flows.reduce((sum, flow) => sum + flow.serviceTripsPerHour, 0);
  const freightTripsPerHour = flows.reduce((sum, flow) => sum + flow.freightTripsPerHour, 0);
  const sectorCount = Math.max(1, flows.length);
  return {
    id: createStableEntityId("mobility-snapshot", `${input.seed}:${Math.floor(input.timestamp / HOUR_MS)}`),
    hourIndex: Math.floor(input.timestamp / HOUR_MS),
    totalTripsPerHour,
    roadTripsPerHour,
    transitTripsPerHour,
    walkingTripsPerHour,
    serviceTripsPerHour,
    freightTripsPerHour,
    averageCongestionPercent: whole(flows.reduce((sum, flow) => sum + flow.congestionPercent, 0) / sectorCount),
    peakCongestionPercent: flows.reduce((peak, flow) => Math.max(peak, flow.congestionPercent), 0),
    averageTransitCrowdingPercent: whole(flows.reduce((sum, flow) => sum + flow.transitCrowdingPercent, 0) / sectorCount),
    averageSpeedKph: Math.round(flows.reduce((sum, flow) => sum + flow.averageSpeedKph, 0) / sectorCount * 10) / 10,
    parkingOccupancyPercent: whole(flows.reduce((sum, flow) => sum + flow.parkingOccupancyPercent, 0) / sectorCount),
    delayedRoutes: routes.filter((route) => route.status === "congested" || route.status === "blocked").length
  };
}

function emptyTotals(): MobilityTotalsState {
  return {
    passengerTrips: 0,
    transitBoardings: 0,
    serviceTrips: 0,
    freightTrips: 0,
    delayedTrips: 0,
    vehicleKm: 0,
    parkingViolations: 0,
    gridlockHours: 0
  };
}

function countHourOccurrences(startExclusive: number, endInclusive: number, targetHour: number): number {
  if (endInclusive <= startExclusive) return 0;
  const firstCandidate = startExclusive + 1;
  const offset = (targetHour - ((firstCandidate % 24) + 24) % 24 + 24) % 24;
  const first = firstCandidate + offset;
  if (first > endInclusive) return 0;
  return Math.floor((endInclusive - first) / 24) + 1;
}

function advanceCommuterTripCounts(plans: CommuterPlanState[], previousHour: number, targetHour: number, timestamp: number): CommuterPlanState[] {
  if (targetHour <= previousHour) return plans;
  return plans.map((plan) => {
    const departures = countHourOccurrences(previousHour, targetHour, plan.departureHour);
    const returns = countHourOccurrences(previousHour, targetHour, plan.returnHour);
    const trips = departures + returns;
    return trips > 0 ? { ...plan, tripsCompleted: plan.tripsCompleted + trips, lastTripAt: timestamp } : plan;
  });
}

function updateTotals(
  previous: MobilityTotalsState,
  snapshotState: MobilitySnapshotState,
  flows: MobilitySectorFlowState[],
  elapsedHours: number
): MobilityTotalsState {
  if (elapsedHours <= 0) return previous;
  const passengerPerHour = Math.max(0, snapshotState.totalTripsPerHour - snapshotState.serviceTripsPerHour - snapshotState.freightTripsPerHour);
  const illegalParking = flows.reduce((sum, flow) => sum + flow.illegalParkingVehicles, 0);
  return {
    passengerTrips: previous.passengerTrips + whole(passengerPerHour * elapsedHours),
    transitBoardings: previous.transitBoardings + whole(snapshotState.transitTripsPerHour * elapsedHours),
    serviceTrips: previous.serviceTrips + whole(snapshotState.serviceTripsPerHour * elapsedHours),
    freightTrips: previous.freightTrips + whole(snapshotState.freightTripsPerHour * elapsedHours),
    delayedTrips: previous.delayedTrips + whole(snapshotState.delayedRoutes * elapsedHours),
    vehicleKm: previous.vehicleKm + whole(snapshotState.roadTripsPerHour * 6.8 * elapsedHours),
    parkingViolations: previous.parkingViolations + whole(illegalParking * elapsedHours * 0.08),
    gridlockHours: previous.gridlockHours + (snapshotState.peakCongestionPercent >= 96 ? elapsedHours : 0)
  };
}

function buildCurrentState(input: MetropolitanMobilityInput, previous?: MetropolitanMobilityState): MetropolitanMobilityState {
  const targetHour = Math.floor(input.timestamp / HOUR_MS);
  const previousHour = previous?.lastProcessedHour ?? targetHour;
  let plans = commuterPlans(input, previous?.commuterPlans);
  plans = advanceCommuterTripCounts(plans, previousHour, targetHour, input.timestamp);
  const movements = freightMovements(input, previous?.freightMovements);
  const baseRoutes = [
    ...transitRoutes(input),
    ...districtRoutes(input),
    ...serviceRoutes(input),
    ...freightRoutes(input, movements)
  ];
  const firstPass = createParkingAndFlows(input, baseRoutes, plans);
  const routes = updateRoutes(input, baseRoutes, firstPass.flows);
  const secondPass = createParkingAndFlows(input, routes, plans);
  const finalRoutes = updateRoutes(input, routes, secondPass.flows);
  const currentSnapshot = snapshot(input, secondPass.flows, finalRoutes);
  const elapsedHours = Math.max(0, targetHour - previousHour);
  const history = previous && targetHour === previousHour
    ? [...previous.history.slice(0, -1), currentSnapshot].slice(-MAX_HISTORY)
    : [...(previous?.history ?? []), currentSnapshot].slice(-MAX_HISTORY);
  return {
    version: 1,
    routes: finalRoutes,
    sectorFlows: secondPass.flows,
    parking: secondPass.parking,
    fleets: fleetStates(input),
    commuterPlans: plans,
    freightMovements: movements,
    history,
    totals: updateTotals(previous?.totals ?? emptyTotals(), currentSnapshot, secondPass.flows, elapsedHours),
    lastProcessedHour: targetHour,
    lastUpdatedAt: input.timestamp
  };
}

export function createMetropolitanMobilityState(input: MetropolitanMobilityInput): MetropolitanMobilityState {
  return buildCurrentState(input);
}

export function advanceMetropolitanMobilityState(state: MetropolitanMobilityState, input: MetropolitanMobilityInput): MetropolitanMobilityState {
  if (input.timestamp < state.lastUpdatedAt) return state;
  return buildCurrentState(input, state);
}

export function normalizeMetropolitanMobilityState(value: unknown, input: MetropolitanMobilityInput): MetropolitanMobilityState {
  if (!value || typeof value !== "object") return createMetropolitanMobilityState(input);
  const raw = value as Partial<MetropolitanMobilityState>;
  if (raw.version !== 1 || !Array.isArray(raw.routes) || !Array.isArray(raw.sectorFlows) || !Array.isArray(raw.parking)) {
    return createMetropolitanMobilityState(input);
  }
  const fresh = createMetropolitanMobilityState(input);
  const normalized: MetropolitanMobilityState = {
    ...fresh,
    ...raw,
    version: 1,
    routes: Array.isArray(raw.routes) ? raw.routes : fresh.routes,
    sectorFlows: Array.isArray(raw.sectorFlows) ? raw.sectorFlows : fresh.sectorFlows,
    parking: Array.isArray(raw.parking) ? raw.parking : fresh.parking,
    fleets: Array.isArray(raw.fleets) ? raw.fleets : fresh.fleets,
    commuterPlans: Array.isArray(raw.commuterPlans) ? raw.commuterPlans : fresh.commuterPlans,
    freightMovements: Array.isArray(raw.freightMovements) ? raw.freightMovements : fresh.freightMovements,
    history: Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY) : fresh.history,
    totals: raw.totals ?? fresh.totals,
    lastProcessedHour: typeof raw.lastProcessedHour === "number" ? raw.lastProcessedHour : fresh.lastProcessedHour,
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
  return buildCurrentState(input, normalized);
}

export function synchronizeMetropolitanFromMobility(metropolitan: MetropolitanState, mobility: MetropolitanMobilityState): MetropolitanState {
  const flowBySector = new Map(mobility.sectorFlows.map((flow) => [flow.sectorId, flow]));
  const sectors = metropolitan.sectors.map((sector) => {
    const flow = flowBySector.get(sector.id);
    if (!flow) return sector;
    return {
      ...sector,
      trafficLoad: flow.congestionPercent,
      crowdLoad: clamp(Math.round(sector.crowdLoad * 0.35 + flow.transitCrowdingPercent * 0.65))
    };
  });
  const districts = metropolitan.districts.map((district) => {
    const local = mobility.sectorFlows.filter((flow) => flow.districtId === district.districtId);
    if (!local.length) return district;
    const congestion = local.reduce((sum, flow) => sum + flow.congestionPercent, 0) / local.length;
    const crowding = local.reduce((sum, flow) => sum + flow.transitCrowdingPercent, 0) / local.length;
    return {
      ...district,
      transitScore: clamp(Math.round(district.transitScore * 0.72 + (100 - crowding) * 0.18 + (100 - congestion) * 0.1))
    };
  });
  return { ...metropolitan, sectors, districts, lastUpdatedAt: Math.max(metropolitan.lastUpdatedAt, mobility.lastUpdatedAt) };
}

function averagePathFlow(state: MetropolitanMobilityState, pathSectorIds: string[]): { congestion: number; crowding: number } {
  const flows = pathSectorIds.map((id) => state.sectorFlows.find((flow) => flow.sectorId === id)).filter((flow): flow is MobilitySectorFlowState => Boolean(flow));
  if (!flows.length) return { congestion: 0, crowding: 0 };
  return {
    congestion: whole(flows.reduce((sum, flow) => sum + flow.congestionPercent, 0) / flows.length),
    crowding: whole(flows.reduce((sum, flow) => sum + flow.transitCrowdingPercent, 0) / flows.length)
  };
}

function nearbyTransitStation(metropolitan: MetropolitanState, locationId: string): boolean {
  const point = pointForLocation(metropolitan, locationId);
  if (!point) return false;
  return metropolitan.transitStations.some((station) => Math.hypot(station.xM - point.xM, station.yM - point.yM) <= 3_200);
}

export function estimateMobilityTravel(
  state: MetropolitanMobilityState,
  metropolitan: MetropolitanState,
  originLocationId: string,
  destinationLocationId: string
): MobilityTravelEstimate | null {
  const origin = sectorForLocation(metropolitan, originLocationId);
  const destination = sectorForLocation(metropolitan, destinationLocationId);
  if (!origin || !destination) return null;
  const distanceM = distanceBetweenLocations(metropolitan, originLocationId, destinationLocationId);
  const pathSectorIds = sectorPath(metropolitan, origin.id, destination.id);
  const pathFlow = averagePathFlow(state, pathSectorIds);
  const metroAvailable = nearbyTransitStation(metropolitan, originLocationId) && nearbyTransitStation(metropolitan, destinationLocationId);
  const averageReliability = state.routes.filter((route) => route.primaryMode === "bus" || route.primaryMode === "metro").reduce((sum, route, _, routes) => sum + route.serviceReliability / Math.max(1, routes.length), 0);
  const mode: MobilityTravelEstimate["mode"] = distanceM <= 1_800
    ? "walk"
    : metroAvailable && distanceM >= 2_500 && averageReliability >= 38
      ? "metro"
      : averageReliability >= 28
        ? "bus"
        : "taxi";
  const matchingRoute = state.routes.find((route) => route.primaryMode === mode && route.districtIds.includes(origin.districtId) && route.districtIds.includes(destination.districtId))
    ?? state.routes.find((route) => route.primaryMode === mode && route.districtIds.includes(destination.districtId));
  const durationMinutes = durationFor(mode, distanceM, pathFlow.congestion, pathFlow.crowding);
  const sameDistrict = origin.districtId === destination.districtId;
  const cost = mode === "walk" ? 0 : mode === "metro" ? (sameDistrict ? 5 : 11) : mode === "bus" ? (sameDistrict ? 4 : 12) : Math.max(18, Math.round(distanceM / 1_000 * 2.4));
  return {
    originLocationId,
    destinationLocationId,
    mode,
    routeCode: matchingRoute?.code ?? mode.toUpperCase(),
    distanceM,
    durationMinutes,
    cost,
    congestionPercent: pathFlow.congestion,
    transitCrowdingPercent: pathFlow.crowding
  };
}
