import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { OrganizationState } from "../../world/state/types";
import type { SpatialPositionState } from "../localScene/types";
import type { MetropolitanSectorState, MetricBounds } from "../spatial/types";
import type { BuildingState } from "../urban/types";
import type {
  PhysicalVehicleAccess,
  PhysicalVehicleClass,
  PhysicalVehicleEntityState,
  PhysicalVehicleTravelEstimate,
  PhysicalVehiclesInput,
  PhysicalVehiclesState,
  PlayerVehicleControlState,
  VehicleCommand,
  VehicleParkingKind,
  VehicleParkingNodeState
} from "./types";

const MAX_MATERIALIZED_VEHICLES = 240;
const MAX_PARKING_NODES = 72;
const VISIBLE_DISTANCE_M = 260;
const NEARBY_DISTANCE_M = 36;
const ENTER_DISTANCE_M = 6;

interface VehicleModel {
  code: string;
  name: string;
  vehicleClass: PhysicalVehicleClass;
  seats: number;
  cargoCapacityKg: number;
  fuelCapacityL: number;
  consumptionLPer100Km: number;
}

const MODELS: Record<string, VehicleModel> = {
  compact: { code: "VNT-R4", name: "VANTA R-4", vehicleClass: "compact", seats: 4, cargoCapacityKg: 220, fuelCapacityL: 42, consumptionLPer100Km: 7.2 },
  sedan: { code: "HLX-C7", name: "HELIX C-7", vehicleClass: "sedan", seats: 5, cargoCapacityKg: 310, fuelCapacityL: 55, consumptionLPer100Km: 8.8 },
  van: { code: "KST-V2", name: "KESTREL V-2", vehicleClass: "van", seats: 3, cargoCapacityKg: 1_250, fuelCapacityL: 72, consumptionLPer100Km: 12.4 },
  taxi: { code: "LUX-T6", name: "LUXOR T-6", vehicleClass: "taxi", seats: 4, cargoCapacityKg: 240, fuelCapacityL: 58, consumptionLPer100Km: 9.6 },
  service: { code: "WRD-S3", name: "WARDEN S-3", vehicleClass: "service", seats: 5, cargoCapacityKg: 540, fuelCapacityL: 68, consumptionLPer100Km: 11.1 },
  medical: { code: "CMU-R9", name: "CMU RESPONSE R-9", vehicleClass: "medical", seats: 6, cargoCapacityKg: 780, fuelCapacityL: 76, consumptionLPer100Km: 13.6 },
  police: { code: "DSB-I5", name: "DSB INTERCEPTOR I-5", vehicleClass: "police", seats: 4, cargoCapacityKg: 260, fuelCapacityL: 64, consumptionLPer100Km: 12.8 },
  truck: { code: "IRN-H8", name: "IRONCLAD H-8", vehicleClass: "truck", seats: 2, cargoCapacityKg: 8_400, fuelCapacityL: 190, consumptionLPer100Km: 27.5 },
  bus: { code: "NL-B12", name: "NORTHLINE B-12", vehicleClass: "bus", seats: 86, cargoCapacityKg: 1_500, fuelCapacityL: 240, consumptionLPer100Km: 34 }
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function center(bounds: MetricBounds): { xM: number; yM: number } {
  return { xM: bounds.xM + bounds.widthM / 2, yM: bounds.yM + bounds.heightM / 2 };
}

function pointInBounds(bounds: MetricBounds, seed: string, margin = 4): { xM: number; yM: number } {
  const rng = new SeededRandom(seed);
  const width = Math.max(1, bounds.widthM - margin * 2);
  const height = Math.max(1, bounds.heightM - margin * 2);
  return {
    xM: round1(bounds.xM + margin + rng.next() * width),
    yM: round1(bounds.yM + margin + rng.next() * height)
  };
}

function distance(left: Pick<SpatialPositionState, "xM" | "yM">, right: { xM: number; yM: number }): number {
  return round1(Math.hypot(right.xM - left.xM, right.yM - left.yM));
}

function sectorById(input: PhysicalVehiclesInput, sectorId: string | undefined): MetropolitanSectorState | undefined {
  return input.metropolitan.sectors.find((sector) => sector.id === sectorId);
}

function buildingForLocation(input: PhysicalVehiclesInput, locationId: string | undefined): BuildingState | undefined {
  return locationId ? input.urban.buildings.find((building) => building.anchorLocationId === locationId) : undefined;
}

function locationPlacement(input: PhysicalVehiclesInput, locationId: string | undefined) {
  return locationId ? input.metropolitan.locations.find((placement) => placement.locationId === locationId) : undefined;
}

function curbPointForBuilding(building: BuildingState, seed: string): { xM: number; yM: number } {
  const rng = new SeededRandom(seed);
  const along = 0.12 + rng.next() * 0.76;
  return {
    xM: round1(building.bounds.xM + building.bounds.widthM * along),
    yM: round1(building.bounds.yM - 4 - rng.next() * 3)
  };
}

function clampPointToSector(input: PhysicalVehiclesInput, sectorId: string, point: { xM: number; yM: number }): { xM: number; yM: number } {
  const sector = sectorById(input, sectorId);
  if (!sector) return point;
  return {
    xM: round1(clamp(point.xM, sector.bounds.xM + 2, sector.bounds.xM + sector.bounds.widthM - 2)),
    yM: round1(clamp(point.yM, sector.bounds.yM + 2, sector.bounds.yM + sector.bounds.heightM - 2))
  };
}

function positionForLocation(input: PhysicalVehiclesInput, locationId: string, vehicleId: string) {
  const building = buildingForLocation(input, locationId);
  const placement = locationPlacement(input, locationId);
  if (building) {
    const point = clampPointToSector(input, building.sectorId, curbPointForBuilding(building, `${input.seed}:vehicle-destination:${vehicleId}:${locationId}`));
    return {
      sectorId: building.sectorId,
      xM: point.xM,
      yM: point.yM,
      locationId,
      buildingId: building.id,
      updatedAt: input.timestamp
    };
  }
  if (placement) {
    const point = pointInBounds(placement.bounds, `${input.seed}:vehicle-destination:${vehicleId}:${locationId}`, 8);
    return {
      sectorId: placement.sectorId,
      xM: point.xM,
      yM: point.yM,
      locationId,
      updatedAt: input.timestamp
    };
  }
  const sector = input.metropolitan.sectors[0];
  const point = sector ? center(sector.bounds) : { xM: 0, yM: 0 };
  return {
    sectorId: sector?.id ?? "sector-missing",
    xM: round1(point.xM),
    yM: round1(point.yM),
    locationId,
    updatedAt: input.timestamp
  };
}

function parkingKind(building: BuildingState | undefined): VehicleParkingKind {
  if (!building) return "curb";
  if (building.use === "residential" || building.use === "hotel") return "residential";
  if (building.use === "industrial" || building.use === "warehouse") return "freight";
  if (["medical", "civic", "transport", "utility", "corporate"].includes(building.use)) return "service";
  return "commercial";
}

function parkingNodes(input: PhysicalVehiclesInput): VehicleParkingNodeState[] {
  const nodes: VehicleParkingNodeState[] = [];
  for (const sectorId of input.metropolitan.streaming.activeSectorIds) {
    const sector = sectorById(input, sectorId);
    if (!sector) continue;
    const aggregate = input.mobility.parking.find((parking) => parking.sectorId === sector.id);
    const buildings = input.urban.buildings
      .filter((building) => building.sectorId === sector.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    const nodeCount = Math.min(10, Math.max(3, Math.round((aggregate?.spaces ?? 600) / 850)));
    for (let index = 0; index < nodeCount && nodes.length < MAX_PARKING_NODES; index += 1) {
      const building = buildings.length ? buildings[Math.floor(index * buildings.length / nodeCount)] : undefined;
      const point = building
        ? clampPointToSector(input, sector.id, curbPointForBuilding(building, `${input.seed}:parking-node:${sector.id}:${index}`))
        : pointInBounds(sector.bounds, `${input.seed}:parking-node:${sector.id}:${index}`, 18);
      const kind = parkingKind(building);
      const spaces = kind === "freight" ? 10 : kind === "service" ? 16 : kind === "residential" ? 28 : 22;
      nodes.push({
        id: createStableEntityId("vehicle-parking", `${input.seed}:${sector.id}:${index}:${building?.id ?? "curb"}`),
        sectorId: sector.id,
        buildingId: building?.id,
        addressCode: building?.addressCode,
        kind,
        xM: point.xM,
        yM: point.yM,
        spaces,
        occupiedVehicleIds: [],
        security: building?.security ?? Math.round(clamp(62 - sector.trafficLoad * 0.18 - sector.crowdLoad * 0.08, 18, 82)),
        pricePerHour: kind === "residential" ? 2 : kind === "freight" ? 7 : kind === "service" ? 4 : 5,
        lastUpdatedAt: input.timestamp
      });
    }
  }
  return nodes;
}

function plate(seed: string, id: string): string {
  const rng = new SeededRandom(`${seed}:vehicle-plate:${id}`);
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const a = letters[rng.integer(0, letters.length - 1)];
  const b = letters[rng.integer(0, letters.length - 1)];
  return `${a}${b}-${rng.integer(100, 999)}-${rng.integer(10, 99)}`;
}

function modelForSector(input: PhysicalVehiclesInput, sector: MetropolitanSectorState, slot: number): { model: VehicleModel; fleetMode: PhysicalVehicleEntityState["fleetMode"] } {
  const rng = new SeededRandom(`${input.seed}:vehicle-model:${sector.id}:${slot}`);
  if (sector.landUse === "transport") {
    const roll = slot % 7;
    if (roll === 0) return { model: MODELS.bus, fleetMode: "bus" };
    if (roll <= 2) return { model: MODELS.taxi, fleetMode: "taxi" };
    if (roll <= 4) return { model: MODELS.truck, fleetMode: "freight" };
    return { model: MODELS.van, fleetMode: "service" };
  }
  if (sector.landUse === "industrial" || sector.landUse === "utility") {
    if (slot % 4 === 0) return { model: MODELS.truck, fleetMode: "freight" };
    if (slot % 3 === 0) return { model: MODELS.service, fleetMode: "service" };
    return { model: MODELS.van, fleetMode: "service" };
  }
  if (sector.landUse === "civic") {
    if (slot % 6 === 0) return { model: MODELS.medical, fleetMode: "service" };
    if (slot % 5 === 0) return { model: MODELS.police, fleetMode: "service" };
    return { model: MODELS.service, fleetMode: "service" };
  }
  if (slot % 8 === 0) return { model: MODELS.taxi, fleetMode: "taxi" };
  return rng.chance(0.45) ? { model: MODELS.compact, fleetMode: "private-car" } : { model: MODELS.sedan, fleetMode: "private-car" };
}

function organizationForModel(input: PhysicalVehiclesInput, sector: MetropolitanSectorState, model: VehicleModel): OrganizationState | undefined {
  const districtOrganizations = input.organizations.filter((organization) => {
    const location = input.metropolitan.locations.find((placement) => organization.locationIds.includes(placement.locationId));
    return location?.districtId === sector.districtId;
  });
  const preferred = model.vehicleClass === "bus" || model.vehicleClass === "taxi"
    ? districtOrganizations.find((organization) => organization.type === "transport")
    : model.vehicleClass === "medical"
      ? districtOrganizations.find((organization) => organization.type === "medical")
      : model.vehicleClass === "police"
        ? districtOrganizations.find((organization) => organization.type === "police")
        : districtOrganizations.find((organization) => ["company", "corporation", "government", "transport"].includes(organization.type));
  return preferred ?? districtOrganizations[0];
}

function privateOwner(input: PhysicalVehiclesInput, sector: MetropolitanSectorState, slot: number): string | undefined {
  const candidates = input.population.residents.filter((resident) => resident.districtId === sector.districtId && resident.age >= 20 && resident.transportAccess >= 55);
  if (!candidates.length) return undefined;
  return candidates[slot % candidates.length]?.id;
}

function initialPlayerVehicle(input: PhysicalVehiclesInput, previous?: PhysicalVehicleEntityState): PhysicalVehicleEntityState {
  const id = createStableEntityId("physical-vehicle", `${input.seed}:player:${input.playerId}:starter`);
  const homeUnit = input.urban.units.find((unit) => unit.tenantEntityId === input.playerId || unit.residentIds.includes(input.playerId));
  const homeBuilding = homeUnit ? input.urban.buildings.find((building) => building.id === homeUnit.buildingId) : undefined;
  const fallback = locationPlacement(input, input.activeLocationId);
  const point = homeBuilding
    ? clampPointToSector(input, homeBuilding.sectorId, curbPointForBuilding(homeBuilding, `${input.seed}:player-vehicle-home`))
    : fallback
      ? pointInBounds(fallback.bounds, `${input.seed}:player-vehicle-home`, 8)
      : { xM: input.playerPosition.xM + 8, yM: input.playerPosition.yM + 4 };
  const sectorId = homeBuilding?.sectorId ?? fallback?.sectorId ?? input.playerPosition.sectorId;
  const rng = new SeededRandom(`${input.seed}:player-vehicle`);
  const base: PhysicalVehicleEntityState = {
    id,
    modelCode: MODELS.compact.code,
    modelName: MODELS.compact.name,
    vehicleClass: MODELS.compact.vehicleClass,
    plate: plate(input.seed, id),
    ownerEntityId: input.playerId,
    access: "owned",
    state: "parked",
    position: {
      sectorId,
      xM: point.xM,
      yM: point.yM,
      locationId: homeBuilding?.anchorLocationId ?? input.activeLocationId,
      buildingId: homeBuilding?.id,
      updatedAt: input.timestamp
    },
    seats: MODELS.compact.seats,
    cargoCapacityKg: MODELS.compact.cargoCapacityKg,
    condition: rng.integer(64, 78),
    fuelCapacityL: MODELS.compact.fuelCapacityL,
    fuelL: round1(rng.integer(24, 34)),
    consumptionLPer100Km: MODELS.compact.consumptionLPer100Km,
    odometerKm: rng.integer(86_000, 164_000),
    passengerEntityIds: [],
    locked: true,
    alarmed: true,
    persistent: true,
    distanceToPlayerM: 0,
    visible: false,
    nearby: false,
    playerCanEnter: false,
    playerCanDrive: true,
    lastMovedAt: input.timestamp,
    lastMaterializedAt: input.timestamp
  };
  if (!previous) return base;
  return {
    ...base,
    ...previous,
    position: { ...base.position, ...previous.position, updatedAt: input.timestamp },
    persistent: true,
    lastMaterializedAt: input.timestamp
  };
}

function generatedVehicle(
  input: PhysicalVehiclesInput,
  sector: MetropolitanSectorState,
  slot: number,
  nodes: VehicleParkingNodeState[],
  previous?: PhysicalVehicleEntityState
): PhysicalVehicleEntityState {
  const id = createStableEntityId("physical-vehicle", `${input.seed}:${sector.id}:${slot}`);
  const { model, fleetMode } = modelForSector(input, sector, slot);
  const rng = new SeededRandom(`${input.seed}:physical-vehicle:${sector.id}:${slot}`);
  const localNodes = nodes.filter((node) => node.sectorId === sector.id);
  const node = localNodes.length ? localNodes[slot % localNodes.length] : undefined;
  const hour = Math.floor(input.timestamp / (60 * 60_000));
  const moving = slot % 5 === 0 && model.vehicleClass !== "bus" ? true : slot % 7 === 0 && model.vehicleClass === "bus";
  const movingPoint = pointInBounds(sector.bounds, `${input.seed}:moving-vehicle:${sector.id}:${slot}:${hour}`, 12);
  const parkedPoint = node
    ? clampPointToSector(input, sector.id, {
        xM: round1(node.xM + ((slot % 4) - 1.5) * 3.2),
        yM: round1(node.yM + (Math.floor(slot / 4) % 3) * 3.6)
      })
    : pointInBounds(sector.bounds, `${input.seed}:parked-vehicle:${sector.id}:${slot}`, 16);
  const position = moving ? movingPoint : parkedPoint;
  const organization = fleetMode === "private-car" ? undefined : organizationForModel(input, sector, model);
  const ownerResidentId = fleetMode === "private-car" ? privateOwner(input, sector, slot) : undefined;
  const access: PhysicalVehicleAccess = model.vehicleClass === "taxi" || model.vehicleClass === "bus" ? "public" : "locked";
  const condition = previous?.condition ?? rng.integer(model.vehicleClass === "truck" || model.vehicleClass === "bus" ? 48 : 56, 94);
  const fuelL = previous?.fuelL ?? round1(model.fuelCapacityL * rng.integer(28, 92) / 100);
  return {
    id,
    modelCode: model.code,
    modelName: model.name,
    vehicleClass: model.vehicleClass,
    plate: previous?.plate ?? plate(input.seed, id),
    ownerEntityId: ownerResidentId ?? organization?.id,
    ownerResidentId,
    organizationId: organization?.id,
    fleetMode,
    access,
    state: condition < 18 ? "disabled" : moving ? "moving" : model.vehicleClass === "medical" || model.vehicleClass === "police" ? "service" : "parked",
    position: {
      sectorId: sector.id,
      xM: position.xM,
      yM: position.yM,
      buildingId: moving ? undefined : node?.buildingId,
      parkingNodeId: moving ? undefined : node?.id,
      updatedAt: input.timestamp
    },
    seats: model.seats,
    cargoCapacityKg: model.cargoCapacityKg,
    condition,
    fuelCapacityL: model.fuelCapacityL,
    fuelL,
    consumptionLPer100Km: model.consumptionLPer100Km,
    odometerKm: previous?.odometerKm ?? rng.integer(4_000, 280_000),
    driverEntityId: moving ? previous?.driverEntityId ?? organization?.id ?? ownerResidentId : undefined,
    passengerEntityIds: previous?.passengerEntityIds ?? [],
    locked: true,
    alarmed: model.vehicleClass !== "truck" ? condition >= 45 : condition >= 62,
    persistent: false,
    distanceToPlayerM: 0,
    visible: false,
    nearby: false,
    playerCanEnter: false,
    playerCanDrive: false,
    lastMovedAt: moving ? input.timestamp : previous?.lastMovedAt ?? input.timestamp,
    lastMaterializedAt: input.timestamp
  };
}

function targetVehicleCount(input: PhysicalVehiclesInput, sector: MetropolitanSectorState): number {
  const parking = input.mobility.parking.find((item) => item.sectorId === sector.id);
  const pressure = (parking?.pressurePercent ?? 45) / 100;
  const base = sector.id === input.playerPosition.sectorId ? 16 : 9;
  const landUseBonus = sector.landUse === "transport" ? 8 : sector.landUse === "industrial" || sector.landUse === "commercial" ? 4 : 1;
  return Math.min(28, Math.max(5, Math.round(base + landUseBonus + pressure * 6)));
}

function applyCommand(
  vehicles: PhysicalVehicleEntityState[],
  player: PlayerVehicleControlState,
  input: PhysicalVehiclesInput,
  command: VehicleCommand | undefined
): { vehicles: PhysicalVehicleEntityState[]; player: PlayerVehicleControlState } {
  if (!command) return { vehicles, player };
  const vehicle = vehicles.find((item) => item.id === command.vehicleId);
  if (!vehicle) return { vehicles, player };

  if (command.kind === "enter") {
    const driving = command.seat === "driver" && (vehicle.access === "owned" || vehicle.access === "authorized");
    const updated = vehicles.map((item) => item.id === vehicle.id ? {
      ...item,
      state: "occupied" as const,
      driverEntityId: driving ? input.playerId : item.driverEntityId,
      passengerEntityIds: driving ? item.passengerEntityIds.filter((id) => id !== input.playerId) : [...new Set([...item.passengerEntityIds, input.playerId])],
      locked: false,
      lastMovedAt: input.timestamp
    } : item);
    return {
      vehicles: updated,
      player: { ...player, currentVehicleId: vehicle.id, seat: driving ? "driver" : "passenger" }
    };
  }

  if (command.kind === "exit") {
    const updated = vehicles.map((item) => item.id === vehicle.id ? {
      ...item,
      state: item.condition < 18 ? "disabled" as const : "parked" as const,
      driverEntityId: item.driverEntityId === input.playerId ? undefined : item.driverEntityId,
      passengerEntityIds: item.passengerEntityIds.filter((id) => id !== input.playerId),
      locked: item.access === "owned",
      lastMovedAt: input.timestamp
    } : item);
    return { vehicles: updated, player: { ...player, currentVehicleId: undefined, seat: null } };
  }

  if (command.kind === "drive") {
    const position = positionForLocation(input, command.destinationLocationId, vehicle.id);
    const distanceKm = command.distanceM / 1_000;
    const conditionLoss = Math.max(0.1, distanceKm / 90 + (100 - vehicle.condition) / 1_600);
    const updated = vehicles.map((item) => item.id === vehicle.id ? {
      ...item,
      state: "occupied" as const,
      position,
      fuelL: round1(Math.max(0, item.fuelL - command.fuelUsedL)),
      condition: round1(Math.max(0, item.condition - conditionLoss)),
      odometerKm: round1(item.odometerKm + distanceKm),
      driverEntityId: input.playerId,
      locked: false,
      lastMovedAt: input.timestamp,
      lastMaterializedAt: input.timestamp
    } : item);
    return {
      vehicles: updated,
      player: {
        ...player,
        currentVehicleId: vehicle.id,
        seat: "driver",
        distanceDrivenKm: round1(player.distanceDrivenKm + distanceKm),
        fuelConsumedL: round1(player.fuelConsumedL + command.fuelUsedL),
        tripsCompleted: player.tripsCompleted + 1
      }
    };
  }

  const updated = vehicles.map((item) => item.id === vehicle.id ? {
    ...item,
    fuelL: round1(Math.min(item.fuelCapacityL, item.fuelL + command.fuelAddedL)),
    condition: round1(Math.min(100, item.condition + command.conditionRestored)),
    state: item.state === "disabled" && item.condition + command.conditionRestored >= 18 ? "parked" as const : item.state,
    lastMovedAt: input.timestamp
  } : item);
  return { vehicles: updated, player };
}

function playerControl(input: PhysicalVehiclesInput, previous?: PhysicalVehiclesState): PlayerVehicleControlState {
  const playerVehicleId = createStableEntityId("physical-vehicle", `${input.seed}:player:${input.playerId}:starter`);
  return {
    currentVehicleId: previous?.player.currentVehicleId,
    seat: previous?.player.seat ?? null,
    keyVehicleIds: [...new Set([playerVehicleId, ...(previous?.player.keyVehicleIds ?? [])])],
    ownedVehicleIds: [...new Set([playerVehicleId, ...(previous?.player.ownedVehicleIds ?? [])])],
    distanceDrivenKm: previous?.player.distanceDrivenKm ?? 0,
    fuelConsumedL: previous?.player.fuelConsumedL ?? 0,
    tripsCompleted: previous?.player.tripsCompleted ?? 0
  };
}

function decorateVehicles(input: PhysicalVehiclesInput, vehicles: PhysicalVehicleEntityState[], player: PlayerVehicleControlState): PhysicalVehicleEntityState[] {
  const playerInside = input.playerPosition.state === "inside";
  return vehicles.map((vehicle) => {
    const sameSector = vehicle.position.sectorId === input.playerPosition.sectorId;
    const current = player.currentVehicleId === vehicle.id;
    const vehicleDistance = current ? 0 : sameSector ? distance(input.playerPosition, vehicle.position) : Number.MAX_SAFE_INTEGER;
    const visible = current || (!playerInside && sameSector && vehicleDistance <= VISIBLE_DISTANCE_M);
    const nearby = current || (visible && vehicleDistance <= NEARBY_DISTANCE_M);
    const accessAllowed = vehicle.access === "owned" || vehicle.access === "authorized" || vehicle.access === "public";
    const canEnterState = vehicle.state === "parked" || vehicle.state === "service" || vehicle.state === "occupied";
    const playerCanUnlock = vehicle.access === "owned" || vehicle.access === "authorized";
    const playerCanEnter = !current && (playerCanUnlock || !vehicle.locked) && accessAllowed && canEnterState && vehicleDistance <= ENTER_DISTANCE_M;
    const playerCanDrive = (vehicle.access === "owned" || vehicle.access === "authorized") && vehicle.condition >= 18 && vehicle.fuelL > 0;
    return {
      ...vehicle,
      distanceToPlayerM: vehicleDistance,
      visible,
      nearby,
      playerCanEnter,
      playerCanDrive,
      lastMaterializedAt: input.timestamp
    };
  }).sort((left, right) => Number(right.id === player.currentVehicleId) - Number(left.id === player.currentVehicleId) || Number(right.visible) - Number(left.visible) || left.distanceToPlayerM - right.distanceToPlayerM || left.id.localeCompare(right.id));
}

function attachParkingOccupancy(nodes: VehicleParkingNodeState[], vehicles: PhysicalVehicleEntityState[]): VehicleParkingNodeState[] {
  return nodes.map((node) => ({
    ...node,
    occupiedVehicleIds: vehicles.filter((vehicle) => vehicle.position.parkingNodeId === node.id && vehicle.state !== "moving").map((vehicle) => vehicle.id).slice(0, node.spaces)
  }));
}

function buildState(input: PhysicalVehiclesInput, previous?: PhysicalVehiclesState): PhysicalVehiclesState {
  const previousById = new Map(previous?.vehicles.map((vehicle) => [vehicle.id, vehicle]) ?? []);
  let nodes = parkingNodes(input);
  const playerVehicleId = createStableEntityId("physical-vehicle", `${input.seed}:player:${input.playerId}:starter`);
  const vehicles: PhysicalVehicleEntityState[] = [initialPlayerVehicle(input, previousById.get(playerVehicleId))];
  for (const sectorId of input.metropolitan.streaming.activeSectorIds) {
    const sector = sectorById(input, sectorId);
    if (!sector) continue;
    const count = targetVehicleCount(input, sector);
    for (let slot = 0; slot < count && vehicles.length < MAX_MATERIALIZED_VEHICLES; slot += 1) {
      const id = createStableEntityId("physical-vehicle", `${input.seed}:${sector.id}:${slot}`);
      if (id === playerVehicleId) continue;
      vehicles.push(generatedVehicle(input, sector, slot, nodes, previousById.get(id)));
    }
  }

  for (const previousVehicle of previous?.vehicles ?? []) {
    if (!previousVehicle.persistent || vehicles.some((vehicle) => vehicle.id === previousVehicle.id)) continue;
    vehicles.push({ ...previousVehicle, lastMaterializedAt: input.timestamp });
  }

  let player = playerControl(input, previous);
  const commanded = applyCommand(vehicles, player, input, input.command);
  player = commanded.player;
  const decorated = decorateVehicles(input, commanded.vehicles, player).slice(0, MAX_MATERIALIZED_VEHICLES);
  nodes = attachParkingOccupancy(nodes, decorated);
  const focusSectorId = input.playerPosition.sectorId;
  return {
    version: 1,
    vehicles: decorated,
    parkingNodes: nodes,
    player,
    persistentVehicleIds: decorated.filter((vehicle) => vehicle.persistent).map((vehicle) => vehicle.id),
    totals: {
      materializedVehicles: decorated.length,
      focusSectorVehicles: decorated.filter((vehicle) => vehicle.position.sectorId === focusSectorId).length,
      parkedVehicles: decorated.filter((vehicle) => vehicle.state === "parked").length,
      movingVehicles: decorated.filter((vehicle) => vehicle.state === "moving").length,
      serviceVehicles: decorated.filter((vehicle) => vehicle.state === "service").length,
      disabledVehicles: decorated.filter((vehicle) => vehicle.state === "disabled").length,
      visibleVehicles: decorated.filter((vehicle) => vehicle.visible).length,
      nearbyVehicles: decorated.filter((vehicle) => vehicle.nearby).length,
      parkingNodes: nodes.length,
      occupiedParkingSpaces: nodes.reduce((sum, node) => sum + node.occupiedVehicleIds.length, 0)
    },
    lastProcessedHour: Math.floor(input.timestamp / (60 * 60_000)),
    lastUpdatedAt: input.timestamp
  };
}

export function createPhysicalVehiclesState(input: PhysicalVehiclesInput): PhysicalVehiclesState {
  return buildState(input);
}

export function advancePhysicalVehiclesState(state: PhysicalVehiclesState, input: PhysicalVehiclesInput): PhysicalVehiclesState {
  if (input.timestamp < state.lastUpdatedAt) return state;
  return buildState(input, state);
}

export function normalizePhysicalVehiclesState(value: unknown, input: PhysicalVehiclesInput): PhysicalVehiclesState {
  if (!value || typeof value !== "object") return createPhysicalVehiclesState(input);
  const raw = value as Partial<PhysicalVehiclesState>;
  if (raw.version !== 1 || !Array.isArray(raw.vehicles) || !raw.player) return createPhysicalVehiclesState(input);
  const previous: PhysicalVehiclesState = {
    version: 1,
    vehicles: raw.vehicles,
    parkingNodes: Array.isArray(raw.parkingNodes) ? raw.parkingNodes : [],
    player: raw.player,
    persistentVehicleIds: Array.isArray(raw.persistentVehicleIds) ? raw.persistentVehicleIds : [],
    totals: raw.totals ?? {
      materializedVehicles: raw.vehicles.length,
      focusSectorVehicles: 0,
      parkedVehicles: 0,
      movingVehicles: 0,
      serviceVehicles: 0,
      disabledVehicles: 0,
      visibleVehicles: 0,
      nearbyVehicles: 0,
      parkingNodes: 0,
      occupiedParkingSpaces: 0
    },
    lastProcessedHour: typeof raw.lastProcessedHour === "number" ? raw.lastProcessedHour : Math.floor(input.timestamp / (60 * 60_000)),
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
  return buildState(input, previous);
}

export function getPhysicalVehicle(state: PhysicalVehiclesState, vehicleId: string | null | undefined): PhysicalVehicleEntityState | null {
  if (!vehicleId) return null;
  return state.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
}

export function visiblePhysicalVehicles(state: PhysicalVehiclesState): PhysicalVehicleEntityState[] {
  return state.vehicles.filter((vehicle) => vehicle.visible);
}

export function playerVehiclePosition(vehicle: PhysicalVehicleEntityState, timestamp: number, state: "vehicle" | "outside" = "vehicle"): SpatialPositionState {
  return {
    sectorId: vehicle.position.sectorId,
    xM: vehicle.position.xM,
    yM: vehicle.position.yM,
    locationId: vehicle.position.locationId,
    vehicleId: state === "vehicle" ? vehicle.id : undefined,
    state,
    updatedAt: timestamp
  };
}


export function physicalVehiclePositionAtLocation(
  input: PhysicalVehiclesInput,
  vehicleId: string,
  locationId: string,
  state: "vehicle" | "outside" = "vehicle"
): SpatialPositionState {
  const position = positionForLocation(input, locationId, vehicleId);
  return {
    sectorId: position.sectorId,
    xM: position.xM,
    yM: position.yM,
    locationId,
    vehicleId: state === "vehicle" ? vehicleId : undefined,
    state,
    updatedAt: input.timestamp
  };
}

export function estimatePhysicalVehicleTravel(
  state: PhysicalVehiclesState,
  input: Pick<PhysicalVehiclesInput, "metropolitan" | "mobility">,
  vehicleId: string,
  originLocationId: string,
  destinationLocationId: string
): PhysicalVehicleTravelEstimate | null {
  const vehicle = getPhysicalVehicle(state, vehicleId);
  const origin = input.metropolitan.locations.find((placement) => placement.locationId === originLocationId);
  const destination = input.metropolitan.locations.find((placement) => placement.locationId === destinationLocationId);
  if (!vehicle || !origin || !destination) return null;
  const originPoint = center(origin.bounds);
  const destinationPoint = center(destination.bounds);
  const directDistance = Math.hypot(destinationPoint.xM - originPoint.xM, destinationPoint.yM - originPoint.yM);
  const distanceM = Math.max(350, Math.round(directDistance * 1.18));
  const relevantFlows = input.mobility.sectorFlows.filter((flow) => flow.sectorId === origin.sectorId || flow.sectorId === destination.sectorId);
  const congestionPercent = relevantFlows.length
    ? Math.round(relevantFlows.reduce((sum, flow) => sum + flow.congestionPercent, 0) / relevantFlows.length)
    : 25;
  const conditionFactor = clamp(vehicle.condition, 20, 100) / 100;
  const averageSpeedKph = round1(clamp(54 - congestionPercent * 0.36, 9, 54) * (0.72 + conditionFactor * 0.28));
  const durationMinutes = Math.max(3, Math.ceil(distanceM / 1_000 / averageSpeedKph * 60 + 3));
  const fuelUsedL = round1(Math.max(0.2, distanceM / 100_000 * vehicle.consumptionLPer100Km * (1 + congestionPercent / 260)));
  return {
    vehicleId,
    originLocationId,
    destinationLocationId,
    distanceM,
    durationMinutes,
    fuelUsedL,
    congestionPercent,
    averageSpeedKph
  };
}
