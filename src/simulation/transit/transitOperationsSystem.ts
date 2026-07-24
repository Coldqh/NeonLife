import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { PersonState } from "../../people/network/types";
import type { BackgroundResident } from "../population/types";
import type { MetricPoint, MetropolitanSectorState } from "../spatial/types";
import type {
  PlayerTransitJourneyState,
  TransitCabinState,
  TransitCommand,
  TransitJourneyEstimate,
  TransitJourneySegmentState,
  TransitMode,
  TransitOperationsInput,
  TransitOperationsState,
  TransitPassengerState,
  TransitPhoneActivity,
  TransitPriorityNeed,
  TransitRouteOperationState,
  TransitSeatState,
  TransitStopState,
  TransitVehicleOperationState
} from "./types";

const MINUTE_MS = 60_000;
const MAX_ROUTE_VEHICLES = 64;
const MAX_CABIN_PASSENGERS = 24;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pointDistance(left: MetricPoint, right: MetricPoint): number {
  return Math.hypot(right.xM - left.xM, right.yM - left.yM);
}

function sectorCenter(sector: MetropolitanSectorState): MetricPoint {
  return {
    xM: sector.bounds.xM + sector.bounds.widthM / 2,
    yM: sector.bounds.yM + sector.bounds.heightM / 2
  };
}

function sectorForPoint(input: TransitOperationsInput, point: MetricPoint): MetropolitanSectorState {
  return input.metropolitan.sectors.find((sector) => (
    point.xM >= sector.bounds.xM
    && point.xM < sector.bounds.xM + sector.bounds.widthM
    && point.yM >= sector.bounds.yM
    && point.yM < sector.bounds.yM + sector.bounds.heightM
  )) ?? input.metropolitan.sectors[0];
}

function locationPoint(input: TransitOperationsInput, locationId: string): MetricPoint | null {
  const placement = input.metropolitan.locations.find((item) => item.locationId === locationId);
  if (!placement) return null;
  return {
    xM: placement.bounds.xM + placement.bounds.widthM / 2,
    yM: placement.bounds.yM + placement.bounds.heightM / 2
  };
}

function routeStatus(reliability: number, crowding: number, delay: number): TransitRouteOperationState["status"] {
  if (reliability < 25) return "suspended";
  if (crowding >= 92) return "crowded";
  if (delay >= 7 || reliability < 62) return "delayed";
  return "operational";
}

function busStopForSector(
  input: TransitOperationsInput,
  stopMap: Map<string, TransitStopState>,
  sector: MetropolitanSectorState,
  label?: string
): TransitStopState {
  const id = createStableEntityId("transit-stop", `${input.seed}:bus:${sector.id}`);
  const existing = stopMap.get(id);
  if (existing) return existing;
  const district = input.districts.find((item) => item.id === sector.districtId);
  const point = sectorCenter(sector);
  const stop: TransitStopState = {
    id,
    code: `B-${sector.code}`,
    name: label ?? `${district?.code ?? "CITY"} ${sector.code}`,
    mode: "bus",
    sectorId: sector.id,
    districtId: sector.districtId,
    xM: round1(point.xM),
    yM: round1(point.yM),
    routeIds: [],
    shelter: sector.landUse !== "vacant",
    accessible: sector.landUse !== "industrial" || sector.detailLevel === "active",
    dailyBoardings: Math.max(60, Math.round(sector.representedPopulation * 0.08))
  };
  stopMap.set(id, stop);
  return stop;
}

function metroStopsAndRoutes(input: TransitOperationsInput, stopMap: Map<string, TransitStopState>): TransitRouteOperationState[] {
  return input.metropolitan.transitLines.flatMap((line, lineIndex) => {
    if (line.mode === "freight") return [];
    const stations = line.stationIds
      .map((stationId) => input.metropolitan.transitStations.find((station) => station.id === stationId))
      .filter((station): station is NonNullable<typeof station> => Boolean(station));
    if (stations.length < 2) return [];
    const routeId = createStableEntityId("transit-operation-route", `${input.seed}:rail:${line.id}`);
    const routeMobility = input.mobility.routes.find((route) => route.name === line.name || route.pathSectorIds.includes(stations[0].sectorId));
    const reliability = clamp(routeMobility?.serviceReliability ?? 78);
    const hour = new Date(input.timestamp).getUTCHours();
    const peak = hour >= 6 && hour <= 10 || hour >= 16 && hour <= 20;
    const baselineCrowding = (peak ? 72 : 38) + lineIndex * 4;
    const crowding = clamp(Math.max(routeMobility?.loadPercent ?? 0, input.mobility.sectorFlows.find((flow) => flow.sectorId === stations[0].sectorId)?.transitCrowdingPercent ?? 0, baselineCrowding));
    const delay = Math.max(0, Math.round((100 - reliability) / 12 + crowding / 35));
    const stopIds = stations.map((station, stationIndex) => {
      const stop: TransitStopState = {
        id: station.id,
        code: `M-${lineIndex + 1}${String(stationIndex + 1).padStart(2, "0")}`,
        name: station.name,
        mode: "metro",
        sectorId: station.sectorId,
        districtId: station.districtId,
        xM: station.xM,
        yM: station.yM,
        routeIds: [routeId],
        shelter: true,
        accessible: reliability >= 35,
        dailyBoardings: station.dailyCapacity
      };
      stopMap.set(stop.id, stop);
      return stop.id;
    });
    const headwayMinutes = reliability >= 80 ? 5 : reliability >= 60 ? 7 : 10;
    const scheduledVehicles = Math.max(4, Math.ceil(line.lengthM / 4_500));
    const activeVehicles = Math.max(1, Math.round(scheduledVehicles * reliability / 100));
    return [{
      id: routeId,
      sourceRouteId: line.id,
      code: `MET-${lineIndex + 1}`,
      name: line.name,
      mode: "metro",
      stopIds,
      headwayMinutes,
      serviceStartHour: 5,
      serviceEndHour: 1,
      fare: 7,
      capacityPerVehicle: 920,
      scheduledVehicles,
      activeVehicles,
      reliability,
      averageDelayMinutes: delay,
      crowdingPercent: crowding,
      status: routeStatus(reliability, crowding, delay)
    }];
  });
}

function districtHub(input: TransitOperationsInput, districtId: string): MetropolitanSectorState | undefined {
  const district = input.metropolitan.districts.find((item) => item.districtId === districtId);
  if (!district) return undefined;
  return input.metropolitan.sectors
    .filter((sector) => sector.districtId === districtId)
    .sort((left, right) => pointDistance(sectorCenter(left), district.center) - pointDistance(sectorCenter(right), district.center))[0];
}

function busRoutes(input: TransitOperationsInput, stopMap: Map<string, TransitStopState>): TransitRouteOperationState[] {
  const routes: TransitRouteOperationState[] = [];

  for (const [districtIndex, district] of input.districts.entries()) {
    const hubSector = districtHub(input, district.id);
    if (!hubSector) continue;
    const routeId = createStableEntityId("transit-operation-route", `${input.seed}:bus-local:${district.id}`);
    const placements = input.metropolitan.locations
      .filter((placement) => placement.districtId === district.id)
      .map((placement) => input.metropolitan.sectors.find((sector) => sector.id === placement.sectorId))
      .filter((sector): sector is MetropolitanSectorState => Boolean(sector));
    const sectors = [hubSector, ...placements]
      .filter((sector, index, array) => array.findIndex((item) => item.id === sector.id) === index)
      .sort((left, right) => Math.atan2(sectorCenter(left).yM - sectorCenter(hubSector).yM, sectorCenter(left).xM - sectorCenter(hubSector).xM)
        - Math.atan2(sectorCenter(right).yM - sectorCenter(hubSector).yM, sectorCenter(right).xM - sectorCenter(hubSector).xM))
      .slice(0, 16);
    while (sectors.length < 4) {
      const fallback = input.metropolitan.sectors.find((sector) => sector.districtId === district.id && !sectors.some((item) => item.id === sector.id));
      if (!fallback) break;
      sectors.push(fallback);
    }
    const stopIds = sectors.map((sector, index) => busStopForSector(input, stopMap, sector, index === 0 ? `${district.name} HUB` : undefined).id);
    if (stopIds.length < 2) continue;
    const districtFlow = input.mobility.sectorFlows.filter((flow) => flow.districtId === district.id);
    const measuredCrowding = districtFlow.length ? Math.round(districtFlow.reduce((sum, flow) => sum + flow.transitCrowdingPercent, 0) / districtFlow.length) : 0;
    const hour = new Date(input.timestamp).getUTCHours();
    const peak = hour >= 6 && hour <= 10 || hour >= 16 && hour <= 20;
    const crowding = Math.max(measuredCrowding, (peak ? 66 : 35) + districtIndex * 3);
    const reliability = clamp(72 + district.infrastructure * 0.18 - input.districts[districtIndex].pollution * 0.05);
    const delay = Math.max(0, Math.round((100 - reliability) / 11 + crowding / 32));
    const headwayMinutes = reliability >= 78 ? 8 : reliability >= 58 ? 12 : 18;
    const scheduledVehicles = Math.max(3, Math.ceil(stopIds.length * 1.4));
    routes.push({
      id: routeId,
      code: `BUS-${district.code}-L`,
      name: `${district.name} LOCAL`,
      mode: "bus",
      stopIds,
      headwayMinutes,
      serviceStartHour: 5,
      serviceEndHour: 2,
      fare: 4,
      capacityPerVehicle: 86,
      scheduledVehicles,
      activeVehicles: Math.max(1, Math.round(scheduledVehicles * reliability / 100)),
      reliability,
      averageDelayMinutes: delay,
      crowdingPercent: clamp(crowding),
      status: routeStatus(reliability, crowding, delay)
    });
  }

  const connectorMobilityRoutes = input.mobility.routes.filter((route) => route.primaryMode === "bus" && route.districtIds.length >= 2);
  for (const [routeIndex, mobilityRoute] of connectorMobilityRoutes.entries()) {
    const routeId = createStableEntityId("transit-operation-route", `${input.seed}:bus-connector:${mobilityRoute.id}`);
    const sampledSectorIds = mobilityRoute.pathSectorIds.filter((_, index, array) => index === 0 || index === array.length - 1 || index % 3 === 0);
    const stopIds = sampledSectorIds.flatMap((sectorId, index) => {
      const sector = input.metropolitan.sectors.find((item) => item.id === sectorId);
      return sector ? [busStopForSector(input, stopMap, sector, index === 0 || index === sampledSectorIds.length - 1 ? mobilityRoute.name : undefined).id] : [];
    });
    if (stopIds.length < 2) continue;
    const reliability = clamp(mobilityRoute.serviceReliability);
    const hour = new Date(input.timestamp).getUTCHours();
    const peak = hour >= 6 && hour <= 10 || hour >= 16 && hour <= 20;
    const crowding = clamp(Math.max(mobilityRoute.loadPercent, (peak ? 72 : 42) + routeIndex % 3 * 4));
    const delay = Math.max(0, Math.round((mobilityRoute.currentDurationMinutes - mobilityRoute.baseDurationMinutes) + (100 - reliability) / 16));
    const headwayMinutes = reliability >= 78 ? 10 : reliability >= 55 ? 15 : 22;
    const scheduledVehicles = Math.max(2, Math.ceil(mobilityRoute.distanceM / 7_500));
    routes.push({
      id: routeId,
      sourceRouteId: mobilityRoute.id,
      code: mobilityRoute.code || `BUS-X${routeIndex + 1}`,
      name: mobilityRoute.name,
      mode: "bus",
      stopIds,
      headwayMinutes,
      serviceStartHour: 5,
      serviceEndHour: 2,
      fare: mobilityRoute.districtIds.length > 1 ? 8 : 4,
      capacityPerVehicle: 86,
      scheduledVehicles,
      activeVehicles: Math.max(1, Math.round(scheduledVehicles * reliability / 100)),
      reliability,
      averageDelayMinutes: delay,
      crowdingPercent: crowding,
      status: routeStatus(reliability, crowding, delay)
    });
  }

  return routes;
}

function attachRouteIds(stops: TransitStopState[], routes: TransitRouteOperationState[]): TransitStopState[] {
  return stops.map((stop) => ({
    ...stop,
    routeIds: routes.filter((route) => route.stopIds.includes(stop.id)).map((route) => route.id)
  }));
}

const CREW_FIRST = ["Mara", "Vik", "Soren", "Nika", "Jun", "Rin", "Tomas", "Lea", "Kiro", "Mina"] as const;
const CREW_LAST = ["Voss", "Kade", "Orlov", "Vale", "Sato", "Kern", "Meyer", "Rao", "Klein", "Ahn"] as const;

function crewFor(input: TransitOperationsInput, route: TransitRouteOperationState, slot: number): TransitVehicleOperationState["crew"] {
  const residents = input.population.residents.filter((resident) => resident.lifeStage === "working-age");
  const resident = residents.length ? residents[(slot + route.code.length) % residents.length] : undefined;
  const rng = new SeededRandom(`${input.seed}:transit-crew:${route.id}:${slot}`);
  return {
    driverId: createStableEntityId("transit-driver", `${input.seed}:${route.id}:${slot}`),
    residentId: resident?.id,
    name: resident?.name ?? `${rng.pick(CREW_FIRST)} ${rng.pick(CREW_LAST)}`,
    roleLabel: route.mode === "metro" ? "TRAIN OPERATOR" : "BUS DRIVER",
    shiftEndsAt: input.timestamp + rng.integer(2, 7) * 60 * MINUTE_MS
  };
}

function operationVehicles(input: TransitOperationsInput, routes: TransitRouteOperationState[]): TransitVehicleOperationState[] {
  const minuteIndex = Math.floor(input.timestamp / MINUTE_MS);
  const physicalBuses = input.physicalVehicles.vehicles.filter((vehicle) => vehicle.vehicleClass === "bus");
  const result: TransitVehicleOperationState[] = [];
  for (const route of routes) {
    const activeCount = Math.min(route.activeVehicles, Math.max(1, Math.min(8, route.stopIds.length * 2)));
    for (let slot = 0; slot < activeCount && result.length < MAX_ROUTE_VEHICLES; slot += 1) {
      const cycleLength = Math.max(2, route.stopIds.length * 2 - 2);
      const cycleStep = Math.floor((minuteIndex + slot * route.headwayMinutes) / Math.max(2, route.mode === "metro" ? 2 : 4)) % cycleLength;
      const direction: 1 | -1 = cycleStep < route.stopIds.length ? 1 : -1;
      const currentStopIndex = direction === 1 ? Math.min(route.stopIds.length - 1, cycleStep) : Math.max(0, cycleLength - cycleStep);
      const delay = route.status === "delayed" || route.status === "crowded" ? route.averageDelayMinutes : 0;
      const occupancy = Math.round(route.capacityPerVehicle * clamp(route.crowdingPercent + slot % 3 * 3, 8, 115) / 100);
      const physicalBusIndex = result.filter((item) => item.mode === "bus" && item.physicalVehicleId).length;
      const physical = route.mode === "bus" ? physicalBuses[physicalBusIndex] : undefined;
      result.push({
        id: createStableEntityId("transit-vehicle-operation", `${input.seed}:${route.id}:${slot}`),
        physicalVehicleId: physical?.id,
        routeId: route.id,
        mode: route.mode,
        fleetNumber: `${route.mode === "metro" ? "M" : "B"}-${String(slot + 1).padStart(3, "0")}`,
        capacity: route.capacityPerVehicle,
        seatCount: route.mode === "metro" ? 180 : 34,
        currentStopIndex,
        direction,
        nextStopAt: input.timestamp + (route.headwayMinutes + delay) * MINUTE_MS,
        occupancy,
        condition: physical?.condition ?? clamp(route.reliability + 8 - slot % 5),
        delayMinutes: delay,
        status: route.status === "suspended" ? "out-of-service" : delay >= 7 ? "delayed" : "in-service",
        crew: crewFor(input, route, slot)
      });
    }
  }
  return result;
}

function nearestStops(stops: TransitStopState[], point: MetricPoint, mode?: TransitMode, limit = 5): TransitStopState[] {
  return stops
    .filter((stop) => !mode || stop.mode === mode)
    .map((stop) => ({ stop, distanceM: pointDistance(point, stop) }))
    .filter(({ stop, distanceM }) => distanceM <= (stop.mode === "metro" ? 4_500 : 2_800))
    .sort((left, right) => left.distanceM - right.distanceM)
    .slice(0, limit)
    .map(({ stop }) => stop);
}

function orderedSlice(route: TransitRouteOperationState, originStopId: string, destinationStopId: string): string[] | null {
  const originIndex = route.stopIds.indexOf(originStopId);
  const destinationIndex = route.stopIds.indexOf(destinationStopId);
  if (originIndex < 0 || destinationIndex < 0 || originIndex === destinationIndex) return null;
  if (originIndex < destinationIndex) return route.stopIds.slice(originIndex, destinationIndex + 1);
  return route.stopIds.slice(destinationIndex, originIndex + 1).reverse();
}

function segmentFor(route: TransitRouteOperationState, originStopId: string, destinationStopId: string): TransitJourneySegmentState | null {
  const stopIds = orderedSlice(route, originStopId, destinationStopId);
  if (!stopIds) return null;
  const legs = Math.max(1, stopIds.length - 1);
  const minutesPerLeg = route.mode === "metro" ? 3 : 5;
  return {
    id: createStableEntityId("transit-journey-segment", `${route.id}:${originStopId}:${destinationStopId}`),
    routeId: route.id,
    mode: route.mode,
    originStopId,
    destinationStopId,
    stopIds,
    durationMinutes: legs * minutesPerLeg + route.averageDelayMinutes,
    fare: route.fare,
    transferMinutesAfter: 0
  };
}

function directSegments(routes: TransitRouteOperationState[], origin: TransitStopState, destination: TransitStopState): TransitJourneySegmentState[][] {
  return routes.flatMap((route) => {
    if (route.status === "suspended" || !route.stopIds.includes(origin.id) || !route.stopIds.includes(destination.id)) return [];
    const segment = segmentFor(route, origin.id, destination.id);
    return segment ? [[segment]] : [];
  });
}

function transferSegments(routes: TransitRouteOperationState[], origin: TransitStopState, destination: TransitStopState): TransitJourneySegmentState[][] {
  const originRoutes = routes.filter((route) => route.status !== "suspended" && route.stopIds.includes(origin.id));
  const destinationRoutes = routes.filter((route) => route.status !== "suspended" && route.stopIds.includes(destination.id));
  const options: TransitJourneySegmentState[][] = [];
  for (const first of originRoutes) {
    for (const second of destinationRoutes) {
      if (first.id === second.id) continue;
      const transferStopId = first.stopIds.find((stopId) => second.stopIds.includes(stopId));
      if (!transferStopId || transferStopId === origin.id || transferStopId === destination.id) continue;
      const firstSegment = segmentFor(first, origin.id, transferStopId);
      const secondSegment = segmentFor(second, transferStopId, destination.id);
      if (!firstSegment || !secondSegment) continue;
      firstSegment.transferMinutesAfter = 6;
      options.push([firstSegment, secondSegment]);
    }
  }
  return options;
}


function twoTransferSegments(routes: TransitRouteOperationState[], origin: TransitStopState, destination: TransitStopState): TransitJourneySegmentState[][] {
  const originRoutes = routes.filter((route) => route.status !== "suspended" && route.stopIds.includes(origin.id));
  const destinationRoutes = routes.filter((route) => route.status !== "suspended" && route.stopIds.includes(destination.id));
  const options: TransitJourneySegmentState[][] = [];
  for (const first of originRoutes) {
    for (const middle of routes) {
      if (middle.status === "suspended" || middle.id === first.id) continue;
      const firstTransfer = first.stopIds.find((stopId) => middle.stopIds.includes(stopId) && stopId !== origin.id);
      if (!firstTransfer) continue;
      for (const last of destinationRoutes) {
        if (last.id === middle.id || last.id === first.id) continue;
        const secondTransfer = middle.stopIds.find((stopId) => last.stopIds.includes(stopId) && stopId !== firstTransfer && stopId !== destination.id);
        if (!secondTransfer) continue;
        const firstSegment = segmentFor(first, origin.id, firstTransfer);
        const middleSegment = segmentFor(middle, firstTransfer, secondTransfer);
        const lastSegment = segmentFor(last, secondTransfer, destination.id);
        if (!firstSegment || !middleSegment || !lastSegment) continue;
        firstSegment.transferMinutesAfter = 6;
        middleSegment.transferMinutesAfter = 6;
        options.push([firstSegment, middleSegment, lastSegment]);
      }
    }
  }
  return options;
}

function waitMinutes(timestamp: number, route: TransitRouteOperationState): number {
  const minute = Math.floor(timestamp / MINUTE_MS);
  const until = route.headwayMinutes - (minute % route.headwayMinutes);
  return Math.max(1, until + route.averageDelayMinutes);
}

export function estimateTransitJourney(
  state: TransitOperationsState,
  input: TransitOperationsInput,
  originLocationId: string,
  destinationLocationId: string,
  preferredMode?: TransitMode
): TransitJourneyEstimate | null {
  const originPoint = locationPoint(input, originLocationId);
  const destinationPoint = locationPoint(input, destinationLocationId);
  if (!originPoint || !destinationPoint) return null;
  const originStops = nearestStops(state.stops, originPoint, preferredMode);
  const destinationStops = nearestStops(state.stops, destinationPoint, preferredMode);
  let best: TransitJourneyEstimate | null = null;

  for (const origin of originStops) {
    for (const destination of destinationStops) {
      const routeOptions = [
        ...directSegments(state.routes, origin, destination),
        ...transferSegments(state.routes, origin, destination),
        ...twoTransferSegments(state.routes, origin, destination)
      ];
      for (const segments of routeOptions) {
        const firstRoute = state.routes.find((route) => route.id === segments[0].routeId);
        if (!firstRoute) continue;
        const walkingMinutes = Math.max(2, Math.ceil(pointDistance(originPoint, origin) / 80) + Math.ceil(pointDistance(destinationPoint, destination) / 80));
        const waiting = waitMinutes(input.timestamp, firstRoute);
        const rideMinutes = segments.reduce((sum, segment) => sum + segment.durationMinutes, 0);
        const transferMinutes = segments.reduce((sum, segment) => sum + segment.transferMinutesAfter, 0);
        const totalMinutes = walkingMinutes + waiting + rideMinutes + transferMinutes;
        const totalFare = segments.reduce((sum, segment) => sum + segment.fare, 0);
        const estimate: TransitJourneyEstimate = {
          destinationLocationId,
          segments,
          originStopId: origin.id,
          destinationStopId: destination.id,
          walkingMinutes,
          waitingMinutes: waiting,
          rideMinutes,
          transferMinutes,
          totalMinutes,
          totalFare,
          expectedArrivalAt: input.timestamp + totalMinutes * MINUTE_MS
        };
        if (!best || estimate.totalMinutes < best.totalMinutes || (estimate.totalMinutes === best.totalMinutes && estimate.totalFare < best.totalFare)) best = estimate;
      }
    }
  }
  return best;
}

function passengerPriority(resident: BackgroundResident | undefined, age: number, rng: SeededRandom): TransitPriorityNeed {
  if (resident?.health === "disabled") return "disabled";
  if (resident?.health === "ill" && rng.chance(0.55)) return "injured";
  if (age >= 67) return "elderly";
  if (rng.chance(0.045)) return "carrying-child";
  return "none";
}

function knownPerson(input: TransitOperationsInput, resident: BackgroundResident | undefined): PersonState | undefined {
  return resident?.activePersonId ? input.people.people.find((person) => person.id === resident.activePersonId) : undefined;
}

const PASSENGER_FIRST = ["Mara", "Vik", "Soren", "Ilya", "Nika", "Jun", "Rin", "Dara", "Tomas", "Lea", "Kiro", "Mina", "Oleg", "Tess", "Arin", "Yana"] as const;
const PASSENGER_LAST = ["Voss", "Kade", "Orlov", "Vale", "Sato", "Kern", "Rusk", "Meyer", "Dane", "Kovac", "Ives", "Rao", "Klein", "Moroz", "Ahn", "Costa"] as const;
const PASSENGER_ROLES = ["SHIFT WORKER", "STUDENT", "COURIER", "CLERK", "MEDIC", "TECHNICIAN", "VENDOR", "SECURITY", "UNEMPLOYED", "DRIVER"] as const;
const PASSENGER_FACTS = [
  "жалуется на задержки этой линии",
  "едет после ночной смены",
  "ищет дешёвое жильё",
  "проверяет вакансии в дороге",
  "везёт лекарства родственнику",
  "боится пропустить пересадку",
  "знает короткий путь от следующей остановки",
  "слышал о проверках билетов"
] as const;

function createCabin(input: TransitOperationsInput, route: TransitRouteOperationState, vehicle: TransitVehicleOperationState, journey: PlayerTransitJourneyState): TransitCabinState {
  const rng = new SeededRandom(`${input.seed}:transit-cabin:${journey.id}:${journey.activeSegmentIndex}:${vehicle.id}`);
  const seatCount = route.mode === "metro" ? 20 : 14;
  const seats: TransitSeatState[] = Array.from({ length: seatCount }, (_, index) => ({
    id: createStableEntityId("transit-seat", `${vehicle.id}:${journey.activeSegmentIndex}:${index}`),
    index,
    kind: index < (route.mode === "metro" ? 4 : 3) ? "priority" : "standard",
    occupiedBy: null
  }));
  const representedPassengers = Math.max(4, Math.min(vehicle.capacity, vehicle.occupancy));
  const sampleCount = Math.min(MAX_CABIN_PASSENGERS, Math.max(6, Math.round(seatCount * clamp(route.crowdingPercent, 35, 120) / 80)));
  const residents = input.population.residents.filter((resident) => resident.lifeStage !== "child");
  const passengers: TransitPassengerState[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const resident = residents.length ? residents[(index * 17 + vehicle.fleetNumber.length) % residents.length] : undefined;
    const person = knownPerson(input, resident);
    const age = person?.age ?? resident?.age ?? rng.integer(17, 78);
    const id = createStableEntityId("transit-passenger", `${journey.id}:${journey.activeSegmentIndex}:${index}`);
    const priorityNeed = passengerPriority(resident, age, rng);
    const passenger: TransitPassengerState = {
      id,
      residentId: resident?.id,
      activePersonId: person?.id,
      name: person?.name ?? resident?.name ?? `${rng.pick(PASSENGER_FIRST)} ${rng.pick(PASSENGER_LAST)}`,
      age,
      roleLabel: person?.roleLabel ?? rng.pick(PASSENGER_ROLES),
      priorityNeed,
      standing: false,
      mood: rng.pick(["calm", "tired", "irritated", "nervous", "friendly"] as const),
      attitudeToPlayer: 0,
      interactionCount: 0,
      knownFact: rng.pick(PASSENGER_FACTS)
    };
    passengers.push(passenger);
  }

  const occupiedTarget = route.crowdingPercent >= 95 ? seatCount : Math.min(seatCount - 1, Math.max(4, Math.round(seatCount * route.crowdingPercent / 100)));
  for (let index = 0; index < passengers.length; index += 1) {
    const passenger = passengers[index];
    const seat = seats[index < occupiedTarget ? index : -1];
    if (seat) {
      seat.occupiedBy = passenger.id;
      passenger.seatId = seat.id;
      passenger.standing = false;
    } else {
      passenger.standing = true;
    }
  }

  if (!passengers.some((passenger) => passenger.standing && passenger.priorityNeed !== "none")) {
    const standing = passengers.find((passenger) => passenger.standing) ?? passengers[passengers.length - 1];
    if (standing) standing.priorityNeed = standing.age >= 60 ? "elderly" : "injured";
  }

  return {
    vehicleId: vehicle.id,
    seats,
    passengers,
    totalPassengerCount: representedPassengers,
    crowdingPercent: route.crowdingPercent,
    playerStanding: true
  };
}

function stopPosition(stops: TransitStopState[], input: TransitOperationsInput, stopId: string, state: "outside" | "in-transit", routeId?: string, vehicleId?: string) {
  const stop = stops.find((item) => item.id === stopId);
  const sector = stop ? input.metropolitan.sectors.find((item) => item.id === stop.sectorId) : undefined;
  return {
    sectorId: stop?.sectorId ?? sectorForPoint(input, input.playerPosition).id,
    xM: stop?.xM ?? input.playerPosition.xM,
    yM: stop?.yM ?? input.playerPosition.yM,
    transitRouteId: routeId,
    vehicleId,
    state,
    updatedAt: input.timestamp
  } as const;
}

function destinationPosition(input: TransitOperationsInput, destinationLocationId: string) {
  const placement = input.metropolitan.locations.find((item) => item.locationId === destinationLocationId);
  const point = placement ? {
    xM: placement.bounds.xM + placement.bounds.widthM / 2,
    yM: placement.bounds.yM + placement.bounds.heightM / 2
  } : input.playerPosition;
  return {
    sectorId: placement?.sectorId ?? input.playerPosition.sectorId,
    xM: round1(point.xM),
    yM: round1(point.yM),
    locationId: destinationLocationId,
    state: "outside" as const,
    updatedAt: input.timestamp
  };
}

function activeSegment(journey: PlayerTransitJourneyState): TransitJourneySegmentState {
  return journey.segments[journey.activeSegmentIndex];
}

function updateJourneyStop(journey: PlayerTransitJourneyState): PlayerTransitJourneyState {
  const segment = activeSegment(journey);
  const currentStopId = segment.stopIds[journey.currentStopOffset] ?? segment.destinationStopId;
  const nextStopId = segment.stopIds[journey.currentStopOffset + 1];
  return { ...journey, currentStopId, nextStopId };
}

function advanceJourney(
  stops: TransitStopState[],
  input: TransitOperationsInput,
  player: TransitOperationsState["player"],
  cabin: TransitCabinState | undefined
): { player: TransitOperationsState["player"]; cabin?: TransitCabinState } {
  const journey = player.journey;
  if (!journey || journey.phase !== "onboard") return { player, cabin };
  const segment = activeSegment(journey);
  const nextOffset = Math.min(segment.stopIds.length - 1, journey.currentStopOffset + 1);
  const reachedSegmentEnd = nextOffset >= segment.stopIds.length - 1;

  if (reachedSegmentEnd && journey.activeSegmentIndex < journey.segments.length - 1) {
    const nextSegmentIndex = journey.activeSegmentIndex + 1;
    const nextSegment = journey.segments[nextSegmentIndex];
    const nextJourney = updateJourneyStop({
      ...journey,
      phase: "waiting",
      activeSegmentIndex: nextSegmentIndex,
      currentStopOffset: 0,
      currentStopId: nextSegment.originStopId,
      nextStopId: nextSegment.stopIds[1],
      vehicleId: undefined,
      seatId: undefined
    });
    return {
      player: {
        ...player,
        journey: nextJourney,
        position: stopPosition(stops, input, nextSegment.originStopId, "outside"),
        completedTransfers: player.completedTransfers + 1
      },
      cabin: undefined
    };
  }

  const nextJourney = updateJourneyStop({
    ...journey,
    phase: reachedSegmentEnd ? "arrived" : "onboard",
    currentStopOffset: nextOffset
  });
  return {
    player: {
      ...player,
      journey: nextJourney,
      position: stopPosition(stops, input, nextJourney.currentStopId, "in-transit", segment.routeId, journey.vehicleId)
    },
    cabin
  };
}

function interactionText(passenger: TransitPassengerState): string {
  if (passenger.mood === "friendly") return `${passenger.name} отвечает охотно и ${passenger.knownFact}.`;
  if (passenger.mood === "irritated") return `${passenger.name} отвечает коротко. ${passenger.knownFact}.`;
  if (passenger.mood === "nervous") return `${passenger.name} постоянно смотрит на двери и ${passenger.knownFact}.`;
  if (passenger.mood === "tired") return `${passenger.name} говорит тихо: ${passenger.knownFact}.`;
  return `${passenger.name} поддерживает разговор и ${passenger.knownFact}.`;
}

function applyCommand(
  input: TransitOperationsInput,
  base: TransitOperationsState,
  command: TransitCommand | undefined
): TransitOperationsState {
  if (!command) return { ...base, player: { ...base.player, position: base.player.journey ? base.player.position : input.playerPosition } };
  let player = base.player;
  let cabin = base.cabin;

  if (command.kind === "begin") {
    const first = command.segments[0];
    if (!first) return base;
    const journey: PlayerTransitJourneyState = updateJourneyStop({
      id: createStableEntityId("transit-journey", `${input.seed}:${input.playerId}:${input.timestamp}:${command.destinationLocationId}`),
      phase: "waiting",
      destinationLocationId: command.destinationLocationId,
      segments: command.segments,
      activeSegmentIndex: 0,
      currentStopOffset: 0,
      currentStopId: first.originStopId,
      nextStopId: first.stopIds[1],
      startedAt: input.timestamp,
      expectedArrivalAt: command.expectedArrivalAt,
      farePaid: 0,
      interactions: 0,
      yieldedSeats: 0,
      phoneMinutes: 0,
      skipped: false
    });
    return {
      ...base,
      player: { ...player, journey, position: stopPosition(base.stops, input, first.originStopId, "outside") },
      cabin: undefined
    };
  }

  const journey = player.journey;
  if (!journey) return base;

  if (command.kind === "board") {
    if (journey.phase !== "waiting") return base;
    const segment = activeSegment(journey);
    const route = base.routes.find((item) => item.id === segment.routeId);
    const vehicle = base.vehicles.find((item) => item.id === command.vehicleId && item.routeId === segment.routeId)
      ?? base.vehicles.find((item) => item.routeId === segment.routeId && item.status !== "out-of-service");
    if (!route || !vehicle) return base;
    const nextJourney = { ...journey, phase: "onboard" as const, vehicleId: vehicle.id, farePaid: journey.farePaid + segment.fare };
    cabin = createCabin(input, route, vehicle, nextJourney);
    player = {
      ...player,
      journey: nextJourney,
      position: stopPosition(base.stops, input, nextJourney.currentStopId, "in-transit", segment.routeId, vehicle.id),
      faresPaid: player.faresPaid + segment.fare
    };
    return { ...base, player, cabin };
  }

  if (command.kind === "take-seat") {
    if (journey.phase !== "onboard" || !cabin || journey.seatId) return base;
    const seat = cabin.seats.find((item) => item.id === command.seatId && item.occupiedBy === null);
    if (!seat) return base;
    cabin = {
      ...cabin,
      seats: cabin.seats.map((item) => item.id === seat.id ? { ...item, occupiedBy: "player" as const } : item),
      playerStanding: false
    };
    player = { ...player, journey: { ...journey, seatId: seat.id }, seatsTaken: player.seatsTaken + 1 };
    return { ...base, player, cabin };
  }

  if (command.kind === "stand") {
    if (journey.phase !== "onboard" || !cabin || !journey.seatId) return base;
    cabin = {
      ...cabin,
      seats: cabin.seats.map((item) => item.id === journey.seatId && item.occupiedBy === "player" ? { ...item, occupiedBy: null } : item),
      playerStanding: true
    };
    player = { ...player, journey: { ...journey, seatId: undefined } };
    return { ...base, player, cabin };
  }

  if (command.kind === "yield-seat") {
    if (journey.phase !== "onboard" || !cabin || !journey.seatId) return base;
    const passenger = cabin.passengers.find((item) => item.id === command.passengerId && item.standing && item.priorityNeed !== "none");
    if (!passenger) return base;
    cabin = {
      ...cabin,
      seats: cabin.seats.map((item) => item.id === journey.seatId ? { ...item, occupiedBy: passenger.id } : item),
      passengers: cabin.passengers.map((item) => item.id === passenger.id ? { ...item, standing: false, seatId: journey.seatId, attitudeToPlayer: item.attitudeToPlayer + 12 } : item),
      playerStanding: true,
      lastInteraction: `${passenger.name} занимает место и благодарит тебя.`
    };
    player = {
      ...player,
      journey: { ...journey, seatId: undefined, yieldedSeats: journey.yieldedSeats + 1 },
      seatsYielded: player.seatsYielded + 1
    };
    return { ...base, player, cabin };
  }

  if (command.kind === "alight") {
    if (journey.phase !== "arrived") return base;
    return {
      ...base,
      player: {
        ...player,
        journey: undefined,
        position: destinationPosition(input, journey.destinationLocationId),
        completedTrips: player.completedTrips + 1
      },
      cabin: undefined
    };
  }

  if (command.kind === "skip") {
    return {
      ...base,
      player: {
        ...player,
        journey: undefined,
        position: destinationPosition(input, journey.destinationLocationId),
        completedTrips: player.completedTrips + 1
      },
      cabin: undefined
    };
  }

  if (journey.phase !== "onboard") return base;

  if (command.kind === "interact-advance" && cabin) {
    const passenger = cabin.passengers.find((item) => item.id === command.passengerId);
    if (passenger) {
      const attitudeDelta = passenger.mood === "friendly" ? 5 : passenger.mood === "irritated" ? -2 : 2;
      const text = interactionText(passenger);
      cabin = {
        ...cabin,
        passengers: cabin.passengers.map((item) => item.id === passenger.id ? {
          ...item,
          attitudeToPlayer: item.attitudeToPlayer + attitudeDelta,
          interactionCount: item.interactionCount + 1
        } : item),
        lastInteraction: text
      };
      player = {
        ...player,
        journey: { ...journey, interactions: journey.interactions + 1 },
        passengerInteractions: player.passengerInteractions + 1
      };
    }
  }

  if (command.kind === "phone-advance" && cabin) {
    const knowledgeDelta = command.activity === "study" ? Math.max(1, Math.floor(command.productiveMinutes / 5)) : command.activity === "city-feed" ? 1 : 0;
    cabin = { ...cabin, lastPhoneActivity: command.activity };
    player = {
      ...player,
      journey: { ...journey, phoneMinutes: journey.phoneMinutes + command.productiveMinutes },
      productivePhoneMinutes: player.productivePhoneMinutes + command.productiveMinutes,
      knowledgePoints: player.knowledgePoints + knowledgeDelta
    };
  }

  const advanced = advanceJourney(base.stops, input, player, cabin);
  return { ...base, player: advanced.player, cabin: advanced.cabin };
}

function buildNetwork(input: TransitOperationsInput): { stops: TransitStopState[]; routes: TransitRouteOperationState[]; vehicles: TransitVehicleOperationState[] } {
  const stopMap = new Map<string, TransitStopState>();
  const routes = [...metroStopsAndRoutes(input, stopMap), ...busRoutes(input, stopMap)];
  const stops = attachRouteIds([...stopMap.values()], routes);
  const vehicles = operationVehicles(input, routes);
  return { stops, routes, vehicles };
}

function basePlayer(input: TransitOperationsInput, previous?: TransitOperationsState): TransitOperationsState["player"] {
  return {
    journey: previous?.player.journey,
    position: previous?.player.position ?? input.playerPosition,
    completedTrips: previous?.player.completedTrips ?? 0,
    completedTransfers: previous?.player.completedTransfers ?? 0,
    faresPaid: previous?.player.faresPaid ?? 0,
    seatsTaken: previous?.player.seatsTaken ?? 0,
    seatsYielded: previous?.player.seatsYielded ?? 0,
    passengerInteractions: previous?.player.passengerInteractions ?? 0,
    productivePhoneMinutes: previous?.player.productivePhoneMinutes ?? 0,
    knowledgePoints: previous?.player.knowledgePoints ?? 0
  };
}

function buildState(input: TransitOperationsInput, previous?: TransitOperationsState): TransitOperationsState {
  const network = buildNetwork(input);
  const representedPassengers = network.vehicles.reduce((sum, vehicle) => sum + vehicle.occupancy, 0);
  const base: TransitOperationsState = {
    version: 1,
    stops: network.stops,
    routes: network.routes,
    vehicles: network.vehicles,
    player: basePlayer(input, previous),
    cabin: previous?.cabin,
    totals: {
      stops: network.stops.length,
      routes: network.routes.length,
      activeVehicles: network.vehicles.filter((vehicle) => vehicle.status !== "out-of-service").length,
      delayedRoutes: network.routes.filter((route) => route.status === "delayed").length,
      crowdedRoutes: network.routes.filter((route) => route.status === "crowded").length,
      passengerCapacity: network.vehicles.reduce((sum, vehicle) => sum + vehicle.capacity, 0),
      representedPassengers
    },
    lastProcessedMinute: Math.floor(input.timestamp / MINUTE_MS),
    lastUpdatedAt: input.timestamp
  };
  return applyCommand(input, base, input.command);
}

export function createTransitOperationsState(input: TransitOperationsInput): TransitOperationsState {
  return buildState(input);
}

export function advanceTransitOperationsState(state: TransitOperationsState, input: TransitOperationsInput): TransitOperationsState {
  if (input.timestamp < state.lastUpdatedAt) return state;
  return buildState(input, state);
}

export function normalizeTransitOperationsState(value: unknown, input: TransitOperationsInput): TransitOperationsState {
  if (!value || typeof value !== "object") return createTransitOperationsState(input);
  const raw = value as Partial<TransitOperationsState>;
  if (raw.version !== 1 || !raw.player || !Array.isArray(raw.stops) || !Array.isArray(raw.routes) || !Array.isArray(raw.vehicles)) {
    return createTransitOperationsState(input);
  }
  return buildState(input, raw as TransitOperationsState);
}

export function getTransitRoute(state: TransitOperationsState, routeId: string | null | undefined): TransitRouteOperationState | null {
  if (!routeId) return null;
  return state.routes.find((route) => route.id === routeId) ?? null;
}

export function getTransitVehicle(state: TransitOperationsState, vehicleId: string | null | undefined): TransitVehicleOperationState | null {
  if (!vehicleId) return null;
  return state.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
}

export function getTransitStop(state: TransitOperationsState, stopId: string | null | undefined): TransitStopState | null {
  if (!stopId) return null;
  return state.stops.find((stop) => stop.id === stopId) ?? null;
}

export function getTransitLegMinutes(state: TransitOperationsState): number {
  const journey = state.player.journey;
  if (!journey || journey.phase !== "onboard") return 0;
  const segment = activeSegment(journey);
  return Math.max(2, Math.ceil(segment.durationMinutes / Math.max(1, segment.stopIds.length - 1)));
}

export function getTransitRemainingMinutes(state: TransitOperationsState): number {
  const journey = state.player.journey;
  if (!journey) return 0;
  if (journey.phase === "arrived") return 1;
  let total = 0;
  for (let index = journey.activeSegmentIndex; index < journey.segments.length; index += 1) {
    const segment = journey.segments[index];
    const legs = Math.max(1, segment.stopIds.length - 1);
    const completed = index === journey.activeSegmentIndex ? journey.currentStopOffset : 0;
    total += Math.ceil(segment.durationMinutes * Math.max(0, legs - completed) / legs);
    total += segment.transferMinutesAfter;
  }
  return Math.max(1, total);
}

export function getTransitAdvancePosition(state: TransitOperationsState, input: TransitOperationsInput) {
  const journey = state.player.journey;
  if (!journey || journey.phase !== "onboard") return input.playerPosition;
  const segment = activeSegment(journey);
  const nextOffset = Math.min(segment.stopIds.length - 1, journey.currentStopOffset + 1);
  const stopId = segment.stopIds[nextOffset] ?? segment.destinationStopId;
  return stopPosition(state.stops, input, stopId, "in-transit", segment.routeId, journey.vehicleId);
}

export function getTransitDestinationPosition(state: TransitOperationsState, input: TransitOperationsInput) {
  const journey = state.player.journey;
  return journey ? destinationPosition(input, journey.destinationLocationId) : input.playerPosition;
}

export function getTransitCurrentFare(state: TransitOperationsState): number {
  const journey = state.player.journey;
  if (!journey || journey.phase !== "waiting") return 0;
  return activeSegment(journey).fare;
}

export function getTransitBoardingVehicle(state: TransitOperationsState): TransitVehicleOperationState | null {
  const journey = state.player.journey;
  if (!journey || journey.phase !== "waiting") return null;
  const segment = activeSegment(journey);
  return state.vehicles
    .filter((vehicle) => vehicle.routeId === segment.routeId && vehicle.status !== "out-of-service")
    .sort((left, right) => left.nextStopAt - right.nextStopAt)[0] ?? null;
}

export function phoneActivityLabel(activity: TransitPhoneActivity): string {
  if (activity === "messages") return "разобрал сообщения";
  if (activity === "job-board") return "проверил заказы и вакансии";
  if (activity === "study") return "занимался по учебным материалам";
  return "изучил городскую ленту и маршрут";
}
