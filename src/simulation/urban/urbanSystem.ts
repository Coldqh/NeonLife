import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { DistrictState, LocationState, OrganizationState } from "../../world/state/types";
import type { HouseholdState, PopulationState } from "../population/types";
import type { LocationSpatialState, MetropolitanSectorState, MetropolitanState, MetricBounds, SectorLandUse, SpatialDetailLevel } from "../spatial/types";
import type {
  BuildingScale,
  BuildingState,
  BuildingUnitState,
  BuildingUse,
  DetailedResidentSampleLinkState,
  HouseholdAddressState,
  InteriorPersistentDeltaState,
  InteriorRoomKind,
  InteriorRoomState,
  InteriorState,
  MassDemographyCohortState,
  MassDemographySnapshotState,
  MassDemographyTotalsState,
  SectorBuildingCatalogState,
  UnitUse,
  UrbanFabricAdvanceResult,
  UrbanFabricInput,
  UrbanFabricState,
  UrbanFabricTotalsState,
  UrbanMemoryState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const MONTH_DAYS = 30;
const MONTH_MS = MONTH_DAYS * DAY_MS;
const MAX_BUILDING_CACHE = 720;
const MAX_UNIT_CACHE = 1_200;
const MAX_INTERIOR_CACHE = 24;
const MAX_HISTORY = 360;
const MEMORY_BUDGET_MB = 178;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function whole(value: number): number {
  return Math.max(0, Math.round(value));
}

function buildingUseForLand(landUse: SectorLandUse, rng: SeededRandom): BuildingUse {
  if (landUse === "residential") return rng.chance(0.84) ? "residential" : "mixed";
  if (landUse === "mixed") return rng.chance(0.62) ? "mixed" : rng.chance(0.52) ? "residential" : "retail";
  if (landUse === "commercial") return rng.chance(0.56) ? "office" : rng.chance(0.48) ? "retail" : "hotel";
  if (landUse === "industrial") return rng.chance(0.72) ? "industrial" : "warehouse";
  if (landUse === "corporate") return rng.chance(0.74) ? "office" : rng.chance(0.55) ? "hotel" : "mixed";
  if (landUse === "civic") return rng.chance(0.48) ? "civic" : rng.chance(0.5) ? "medical" : "education";
  if (landUse === "transport") return "transport";
  if (landUse === "utility") return "utility";
  return rng.chance(0.78) ? "vacant" : "industrial";
}

function buildingScaleFor(use: BuildingUse, sector: MetropolitanSectorState, rng: SeededRandom): BuildingScale {
  const density = sector.densityPerKm2;
  if (use === "utility" || use === "transport") return "infrastructure";
  if (use === "industrial") return rng.chance(0.72) ? "warehouse" : "campus";
  if (use === "medical" || use === "education" || use === "civic") return rng.chance(0.48) ? "campus" : "midrise";
  if (density > 24_000 && rng.chance(0.08)) return "megastructure";
  if (density > 18_000 && rng.chance(0.3)) return "megablock";
  if (density > 14_000 && rng.chance(0.5)) return "highrise";
  if (density > 7_000 && rng.chance(0.72)) return "midrise";
  if (density > 2_000) return rng.chance(0.62) ? "lowrise" : "midrise";
  return "house";
}

function floorRange(scale: BuildingScale): readonly [number, number] {
  if (scale === "house") return [1, 3];
  if (scale === "lowrise") return [3, 7];
  if (scale === "midrise") return [7, 16];
  if (scale === "highrise") return [18, 54];
  if (scale === "megablock") return [35, 92];
  if (scale === "megastructure") return [90, 220];
  if (scale === "warehouse") return [1, 4];
  if (scale === "campus") return [3, 14];
  return [1, 8];
}

function footprintForScale(scale: BuildingScale, blockSizeM: number, rng: SeededRandom): { widthM: number; heightM: number } {
  if (scale === "house") return { widthM: rng.integer(12, 28), heightM: rng.integer(14, 34) };
  if (scale === "lowrise") return { widthM: rng.integer(28, 62), heightM: rng.integer(24, 58) };
  if (scale === "midrise") return { widthM: rng.integer(38, 88), heightM: rng.integer(34, 82) };
  if (scale === "highrise") return { widthM: rng.integer(42, 96), heightM: rng.integer(42, 96) };
  if (scale === "megablock") return { widthM: rng.integer(160, 390), heightM: rng.integer(150, 360) };
  if (scale === "megastructure") return { widthM: rng.integer(320, 760), heightM: rng.integer(280, 680) };
  if (scale === "warehouse") return { widthM: rng.integer(80, 220), heightM: rng.integer(70, 210) };
  if (scale === "campus") return { widthM: rng.integer(120, 310), heightM: rng.integer(100, 280) };
  return { widthM: rng.integer(Math.floor(Math.max(40, blockSizeM / 2)), Math.floor(Math.max(60, blockSizeM))), heightM: rng.integer(Math.floor(Math.max(40, blockSizeM / 2)), Math.floor(Math.max(60, blockSizeM))) };
}

function unitMix(use: BuildingUse, scale: BuildingScale, floorAreaM2: number, rng: SeededRandom): { residentialUnits: number; commercialUnits: number; residentCapacity: number } {
  const residentialShare = use === "residential" ? 0.9 : use === "mixed" ? 0.52 : use === "hotel" ? 0.08 : 0;
  const residentialArea = floorAreaM2 * residentialShare;
  const averageUnitArea = scale === "house" ? 125 : scale === "megastructure" || scale === "megablock" ? 46 : scale === "highrise" ? 58 : 72;
  const residentialUnits = residentialShare > 0 ? Math.max(1, Math.floor(residentialArea / averageUnitArea)) : 0;
  const commercialArea = Math.max(0, floorAreaM2 - residentialArea);
  const commercialUnits = use === "vacant" ? 0 : Math.max(use === "residential" ? 0 : 1, Math.floor(commercialArea / (scale === "warehouse" ? 1_500 : 260)));
  const householdSize = 2.15 + rng.next() * 0.55;
  return { residentialUnits, commercialUnits, residentCapacity: whole(residentialUnits * householdSize) };
}

function ownerForSector(sector: MetropolitanSectorState, organizations: OrganizationState[], rng: SeededRandom): string {
  const relevant = organizations.filter((organization) => {
    if (sector.landUse === "corporate") return organization.type === "corporation" || organization.type === "company";
    if (sector.landUse === "industrial") return organization.type === "company" || organization.type === "transport";
    if (sector.landUse === "civic") return organization.type === "government" || organization.type === "medical" || organization.type === "police";
    if (sector.landUse === "transport") return organization.type === "transport" || organization.type === "government";
    return organization.type === "company" || organization.type === "independent" || organization.type === "government";
  });
  return relevant.length ? rng.pick(relevant).id : organizations[0]?.id ?? sector.districtId;
}

function catalogForSector(seed: string, timestamp: number, sector: MetropolitanSectorState): SectorBuildingCatalogState {
  const rng = new SeededRandom(`${seed}:building-catalog:${sector.id}`);
  const buildings = Math.max(0, sector.buildingEstimate);
  const residentialShare = sector.landUse === "residential" ? 0.82 : sector.landUse === "mixed" ? 0.55 : sector.landUse === "corporate" ? 0.24 : sector.landUse === "commercial" ? 0.12 : sector.landUse === "industrial" ? 0.06 : sector.landUse === "vacant" ? 0.015 : 0.08;
  const residentialBuildings = Math.min(buildings, whole(buildings * residentialShare));
  const industrialBuildings = sector.landUse === "industrial" ? whole(buildings * 0.74) : sector.landUse === "transport" || sector.landUse === "utility" ? whole(buildings * 0.46) : whole(buildings * 0.04);
  const civicBuildings = sector.landUse === "civic" ? whole(buildings * 0.7) : whole(buildings * 0.03);
  const commercialBuildings = Math.max(0, buildings - residentialBuildings - industrialBuildings - civicBuildings);
  const averageFloors = clamp(Math.round(sector.floorAreaEstimateM2 / Math.max(1, buildings) / 1_050), 1, 120);
  const averageUnitArea = sector.densityPerKm2 > 20_000 ? 44 : sector.densityPerKm2 > 10_000 ? 58 : 78;
  const residentialFloorArea = sector.floorAreaEstimateM2 * Math.max(0.02, residentialShare);
  const residentialUnits = whole(residentialFloorArea / averageUnitArea);
  const residentCapacity = whole(residentialUnits * (2.15 + rng.next() * 0.5));
  const representedHouseholds = Math.max(1, sector.representedHouseholds);
  const occupiedResidentialUnits = Math.min(residentialUnits, representedHouseholds);
  return {
    sectorId: sector.id,
    districtId: sector.districtId,
    seed: `${seed}:buildings:${sector.id}:v1`,
    landUse: sector.landUse,
    buildingCount: buildings,
    residentialBuildings,
    commercialBuildings,
    industrialBuildings,
    civicBuildings,
    residentialUnits,
    occupiedResidentialUnits,
    residentCapacity,
    floorAreaM2: sector.floorAreaEstimateM2,
    vacancyRate: residentialUnits ? clamp(Math.round((residentialUnits - occupiedResidentialUnits) / residentialUnits * 100), 0, 100) : 100,
    averageFloors,
    averageCondition: clamp(72 - Math.round(sector.trafficLoad * 0.12) + rng.integer(-12, 12)),
    materializedBuildingCount: 0,
    lastIndexedAt: timestamp
  };
}

function anchorUse(location: LocationState): BuildingUse {
  if (location.type === "housing") return "residential";
  if (location.type === "food" || location.type === "market") return "retail";
  if (location.type === "office") return "office";
  if (location.type === "workshop") return "industrial";
  if (location.type === "clinic") return "medical";
  if (location.type === "education") return "education";
  if (location.type === "government") return "civic";
  if (location.type === "transport") return "transport";
  return "mixed";
}

function anchorScale(placement: LocationSpatialState): BuildingScale {
  if (placement.footprintKind === "tower") return placement.floors >= 90 ? "megastructure" : "highrise";
  if (placement.footprintKind === "megablock") return "megablock";
  if (placement.footprintKind === "campus") return "campus";
  if (placement.footprintKind === "warehouse") return "warehouse";
  if (placement.footprintKind === "midrise") return "midrise";
  if (placement.footprintKind === "lowrise") return "lowrise";
  return "infrastructure";
}

function anchorBuilding(seed: string, timestamp: number, placement: LocationSpatialState, location: LocationState, organizations: OrganizationState[]): BuildingState {
  const rng = new SeededRandom(`${seed}:anchor-building:${location.id}`);
  const use = anchorUse(location);
  const scale = anchorScale(placement);
  const floorAreaM2 = whole(placement.bounds.widthM * placement.bounds.heightM * placement.floors * (scale === "campus" ? 0.62 : 0.78));
  const mix = unitMix(use, scale, floorAreaM2, rng);
  const owner = location.organizationId ?? organizations.find((organization) => organization.type === "government")?.id ?? placement.districtId;
  return {
    id: createStableEntityId("building", `anchor:${location.id}`),
    sectorId: placement.sectorId,
    districtId: placement.districtId,
    parcelCode: `${placement.addressCode}/ANCHOR`,
    addressCode: placement.addressCode,
    seed: `${seed}:anchor-building:${location.id}:v1`,
    bounds: placement.bounds,
    use,
    scale,
    floors: placement.floors,
    basementLevels: placement.basementLevels,
    floorAreaM2,
    residentialUnits: mix.residentialUnits,
    commercialUnits: mix.commercialUnits,
    residentCapacity: Math.max(mix.residentCapacity, use === "residential" ? placement.verticalPopulationCapacity : 0),
    representedResidents: 0,
    ownerEntityId: owner,
    controllerEntityId: location.organizationId ?? owner,
    anchorLocationId: location.id,
    condition: clamp(58 + location.security * 0.34 + rng.integer(-8, 8)),
    security: location.security,
    publicEntrances: placement.entranceCount,
    serviceEntrances: placement.serviceEntranceCount,
    elevatorCount: placement.floors >= 8 ? Math.max(1, Math.round(placement.floors / 14)) : 0,
    stairwellCount: Math.max(1, Math.round((placement.bounds.widthM * placement.bounds.heightM) / 18_000)),
    utilityService: 100,
    detailLevel: "warm",
    lastMaterializedAt: timestamp,
    permanent: true
  };
}

function buildingBounds(sector: MetropolitanSectorState, index: number, scale: BuildingScale, rng: SeededRandom, blockSizeM: number): MetricBounds {
  const blocksPerAxis = Math.max(1, Math.floor(sector.bounds.widthM / blockSizeM));
  const blockIndex = index % (blocksPerAxis * blocksPerAxis);
  const blockX = blockIndex % blocksPerAxis;
  const blockY = Math.floor(blockIndex / blocksPerAxis);
  const footprint = footprintForScale(scale, blockSizeM, rng);
  const maxWidth = Math.max(12, blockSizeM - 12);
  const maxHeight = Math.max(12, blockSizeM - 12);
  const widthM = Math.min(footprint.widthM, scale === "megablock" || scale === "megastructure" ? sector.bounds.widthM - 32 : maxWidth);
  const heightM = Math.min(footprint.heightM, scale === "megablock" || scale === "megastructure" ? sector.bounds.heightM - 32 : maxHeight);
  const baseX = sector.bounds.xM + blockX * blockSizeM;
  const baseY = sector.bounds.yM + blockY * blockSizeM;
  return {
    xM: Math.min(sector.bounds.xM + sector.bounds.widthM - widthM - 8, baseX + rng.integer(6, Math.max(6, blockSizeM - Math.min(widthM, blockSizeM) - 6))),
    yM: Math.min(sector.bounds.yM + sector.bounds.heightM - heightM - 8, baseY + rng.integer(6, Math.max(6, blockSizeM - Math.min(heightM, blockSizeM) - 6))),
    widthM,
    heightM
  };
}

function generatedBuilding(seed: string, timestamp: number, sector: MetropolitanSectorState, catalog: SectorBuildingCatalogState, index: number, organizations: OrganizationState[], blockSizeM: number): BuildingState {
  const rng = new SeededRandom(`${seed}:building:${sector.id}:${index}`);
  const use = buildingUseForLand(sector.landUse, rng);
  const scale = buildingScaleFor(use, sector, rng);
  const [minFloors, maxFloors] = floorRange(scale);
  const floors = rng.integer(minFloors, maxFloors);
  const bounds = buildingBounds(sector, index, scale, rng, blockSizeM);
  const floorAreaM2 = whole(bounds.widthM * bounds.heightM * floors * (scale === "warehouse" ? 0.88 : scale === "campus" ? 0.56 : 0.74));
  const mix = unitMix(use, scale, floorAreaM2, rng);
  const owner = ownerForSector(sector, organizations, rng);
  const representedResidents = catalog.residentialUnits > 0
    ? whole(sector.representedPopulation * (mix.residentialUnits / catalog.residentialUnits))
    : 0;
  const blockCode = `B${(index % 64 + 1).toString().padStart(2, "0")}`;
  const lotCode = `L${(Math.floor(index / 64) + 1).toString().padStart(2, "0")}`;
  return {
    id: createStableEntityId("building", `${seed}:${sector.id}:${index}`),
    sectorId: sector.id,
    districtId: sector.districtId,
    parcelCode: `${sector.code}/${blockCode}/${lotCode}`,
    addressCode: `${sector.code}-${blockCode}-${lotCode}`,
    seed: `${seed}:building:${sector.id}:${index}:v1`,
    bounds,
    use,
    scale,
    floors,
    basementLevels: scale === "megastructure" ? rng.integer(8, 24) : scale === "megablock" || scale === "highrise" ? rng.integer(2, 8) : rng.integer(0, 3),
    floorAreaM2,
    residentialUnits: mix.residentialUnits,
    commercialUnits: mix.commercialUnits,
    residentCapacity: mix.residentCapacity,
    representedResidents,
    ownerEntityId: owner,
    controllerEntityId: owner,
    condition: clamp(catalog.averageCondition + rng.integer(-18, 16)),
    security: clamp(25 + sector.densityPerKm2 / 900 + rng.integer(-16, 22)),
    publicEntrances: scale === "megastructure" ? rng.integer(10, 28) : scale === "megablock" ? rng.integer(5, 14) : Math.max(1, rng.integer(1, 4)),
    serviceEntrances: scale === "warehouse" || scale === "campus" || scale === "megastructure" ? rng.integer(2, 10) : rng.integer(0, 3),
    elevatorCount: floors >= 8 ? Math.max(1, whole(floors * Math.max(1, bounds.widthM * bounds.heightM / 7_500) / 18)) : 0,
    stairwellCount: Math.max(1, whole(bounds.widthM * bounds.heightM / 8_000)),
    utilityService: 100,
    detailLevel: "active",
    lastMaterializedAt: timestamp,
    permanent: false
  };
}

function materializeSectorBuildings(input: UrbanFabricInput, catalogs: SectorBuildingCatalogState[], existing: BuildingState[]): BuildingState[] {
  const activeIds = new Set(input.metropolitan.streaming.activeSectorIds);
  const warmIds = new Set(input.metropolitan.streaming.warmSectorIds);
  const anchors = existing.filter((building) => building.permanent).map((building) => {
    const detailLevel: SpatialDetailLevel = activeIds.has(building.sectorId) ? "active" : warmIds.has(building.sectorId) ? "warm" : "cold";
    return { ...building, detailLevel, lastMaterializedAt: detailLevel === "cold" ? building.lastMaterializedAt : input.timestamp };
  });
  const cachedById = new Map(existing.filter((building) => !building.permanent).map((building) => [building.id, building]));
  const generated: BuildingState[] = [];
  for (const sectorId of input.metropolitan.streaming.activeSectorIds) {
    const sector = input.metropolitan.sectors.find((item) => item.id === sectorId);
    const catalog = catalogs.find((item) => item.sectorId === sectorId);
    if (!sector || !catalog) continue;
    const anchorCount = anchors.filter((building) => building.sectorId === sectorId).length;
    const target = Math.max(0, Math.min(catalog.buildingCount - anchorCount, 96));
    for (let index = 0; index < target; index += 1) {
      const candidate = generatedBuilding(input.seed, input.timestamp, sector, catalog, index, input.organizations, input.metropolitan.config.blockSizeM);
      const previous = cachedById.get(candidate.id);
      generated.push(previous ? { ...candidate, ...previous, detailLevel: "active", lastMaterializedAt: input.timestamp } : candidate);
      if (anchors.length + generated.length >= MAX_BUILDING_CACHE) break;
    }
    if (anchors.length + generated.length >= MAX_BUILDING_CACHE) break;
  }
  const warmCached = existing
    .filter((building) => !building.permanent && warmIds.has(building.sectorId) && !generated.some((candidate) => candidate.id === building.id))
    .sort((left, right) => right.lastMaterializedAt - left.lastMaterializedAt)
    .slice(0, Math.max(0, MAX_BUILDING_CACHE - anchors.length - generated.length))
    .map((building) => ({ ...building, detailLevel: "warm" as const }));
  return [...anchors, ...generated, ...warmCached].slice(0, MAX_BUILDING_CACHE);
}

function unitUseForBuilding(building: BuildingState): UnitUse {
  if (building.use === "residential" || building.use === "mixed") return building.scale === "megablock" || building.scale === "megastructure" ? "apartment" : "apartment";
  if (building.use === "retail") return "shop";
  if (building.use === "office") return "office";
  if (building.use === "medical") return "clinic";
  if (building.use === "industrial") return "workshop";
  if (building.use === "hotel") return "hotel-room";
  if (building.use === "transport" || building.use === "utility") return "utility";
  return "service";
}

function buildUnit(seed: string, timestamp: number, building: BuildingState, unitOrdinal: number, household?: HouseholdState): BuildingUnitState {
  const rng = new SeededRandom(`${seed}:unit:${building.id}:${unitOrdinal}`);
  const floor = building.floors <= 1 ? 1 : 1 + (unitOrdinal % building.floors);
  const unitsPerFloor = Math.max(1, Math.ceil(Math.max(1, building.residentialUnits + building.commercialUnits) / building.floors));
  const door = unitOrdinal % unitsPerFloor + 1;
  const unitNumber = `${floor.toString().padStart(2, "0")}-${door.toString().padStart(2, "0")}`;
  const use = household ? (household.kind === "dormitory" ? "dorm-room" : "apartment") : unitUseForBuilding(building);
  const areaM2 = use === "apartment" ? rng.integer(32, building.scale === "megastructure" ? 92 : 125) : use === "dorm-room" ? rng.integer(18, 38) : use === "warehouse" ? rng.integer(600, 2_800) : rng.integer(40, 320);
  const roomCount = use === "apartment" ? clamp(Math.round(areaM2 / 24), 1, 6) : use === "dorm-room" ? 1 : clamp(Math.round(areaM2 / 55), 1, 12);
  const owner = building.ownerEntityId;
  return {
    id: createStableEntityId("building-unit", `${building.id}:${unitOrdinal}`),
    buildingId: building.id,
    sectorId: building.sectorId,
    floor,
    unitNumber,
    use,
    areaM2,
    roomCount,
    capacity: use === "apartment" || use === "dorm-room" ? Math.max(1, household?.memberIds.length ?? Math.round(areaM2 / 26)) : Math.max(2, Math.round(areaM2 / 18)),
    occupied: Boolean(household),
    householdId: household?.id,
    residentIds: household ? [...household.memberIds] : [],
    tenantEntityId: household?.id,
    ownerEntityId: owner,
    monthlyRent: use === "apartment" || use === "dorm-room" ? Math.round((areaM2 * (building.security + building.condition + 40)) / 38) : Math.round(areaM2 * 3.2),
    condition: clamp(building.condition + rng.integer(-10, 8)),
    security: clamp(building.security + rng.integer(-12, 10)),
    interiorSeed: `${seed}:interior:${building.id}:${unitOrdinal}:v1`,
    lastMaterializedAt: timestamp,
    permanent: Boolean(household)
  };
}

function buildingForHousehold(household: HouseholdState, buildings: BuildingState[], input: UrbanFabricInput): BuildingState | undefined {
  if (!household.homeLocationId) return undefined;
  const anchored = buildings.find((building) => building.anchorLocationId === household.homeLocationId);
  if (anchored) return anchored;
  const placement = input.metropolitan.locations.find((item) => item.locationId === household.homeLocationId);
  return placement ? buildings.find((building) => building.sectorId === placement.sectorId && building.residentialUnits > 0) : undefined;
}

function assignDetailedHouseholds(input: UrbanFabricInput, buildings: BuildingState[], previous: HouseholdAddressState[], previousUnits: BuildingUnitState[]): { addresses: HouseholdAddressState[]; units: BuildingUnitState[] } {
  const addressByHousehold = new Map(previous.map((item) => [item.householdId, item]));
  const unitById = new Map(previousUnits.map((item) => [item.id, item]));
  const ordinalByBuilding = new Map<string, number>();
  const addresses: HouseholdAddressState[] = [];
  const units: BuildingUnitState[] = [];
  for (const household of input.population.households) {
    if (!household.homeLocationId || household.kind === "unhoused") continue;
    const building = buildingForHousehold(household, buildings, input);
    if (!building) continue;
    const previousAddress = addressByHousehold.get(household.id);
    let ordinal = ordinalByBuilding.get(building.id) ?? 0;
    if (previousAddress?.buildingId === building.id) {
      const priorUnit = unitById.get(previousAddress.unitId);
      if (priorUnit) {
        units.push({ ...priorUnit, residentIds: [...household.memberIds], occupied: true, householdId: household.id, tenantEntityId: household.id, lastMaterializedAt: input.timestamp, permanent: true });
        addresses.push({ ...previousAddress, residentIds: [...household.memberIds] });
        ordinalByBuilding.set(building.id, Math.max(ordinal, Number(priorUnit.unitNumber.replace("-", "")) || ordinal) + 1);
        continue;
      }
    }
    const unit = buildUnit(input.seed, input.timestamp, building, ordinal, household);
    ordinal += 1;
    ordinalByBuilding.set(building.id, ordinal);
    units.push(unit);
    addresses.push({
      householdId: household.id,
      buildingId: building.id,
      unitId: unit.id,
      sectorId: building.sectorId,
      addressCode: `${building.addressCode}/${unit.unitNumber}`,
      residentIds: [...household.memberIds],
      assignedAt: input.timestamp
    });
  }
  return { addresses, units };
}

function roomKindsForUnit(unit: BuildingUnitState): InteriorRoomKind[] {
  if (unit.use === "apartment" || unit.use === "dorm-room") {
    const result: InteriorRoomKind[] = ["entry", "bathroom"];
    if (unit.roomCount >= 2) result.push("living");
    if (unit.roomCount >= 3) result.push("kitchen");
    for (let index = result.length; index < unit.roomCount + 1; index += 1) result.push("bedroom");
    return result.slice(0, Math.max(2, unit.roomCount + 1));
  }
  if (unit.use === "shop") return ["entry", "retail-floor", "storage", "service-room"];
  if (unit.use === "clinic") return ["entry", "corridor", "clinic-room", "clinic-room", "storage"];
  if (unit.use === "office") return ["entry", "corridor", "office", "office", "service-room"];
  if (unit.use === "workshop" || unit.use === "warehouse") return ["entry", "workroom", "storage", "service-room"];
  return ["entry", "corridor", "service-room"];
}

function materializeInterior(seed: string, timestamp: number, building: BuildingState, unit?: BuildingUnitState): InteriorState {
  const interiorSeed = unit?.interiorSeed ?? `${seed}:interior:building:${building.id}:v1`;
  const rng = new SeededRandom(interiorSeed);
  const targetArea = unit?.areaM2 ?? Math.min(900, Math.max(80, building.bounds.widthM * building.bounds.heightM * 0.65));
  const width = Math.max(6, Math.round(Math.sqrt(targetArea * 1.35)));
  const height = Math.max(6, Math.round(targetArea / width));
  const kinds = unit ? roomKindsForUnit(unit) : ["entry", "corridor", building.use === "retail" ? "retail-floor" : building.use === "medical" ? "clinic-room" : building.use === "industrial" ? "workroom" : "office", "storage"] as InteriorRoomKind[];
  const rooms: InteriorRoomState[] = kinds.map((kind, index) => {
    const columns = Math.ceil(Math.sqrt(kinds.length));
    const cellWidth = Math.max(3, Math.floor(width / columns));
    const cellHeight = Math.max(3, Math.floor(height / Math.ceil(kinds.length / columns)));
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const roomId = createStableEntityId("interior-room", `${interiorSeed}:${index}:${kind}`);
    return {
      id: roomId,
      kind,
      bounds: { xM: x, yM: y, widthM: cellWidth, heightM: cellHeight },
      doorIds: [createStableEntityId("door", `${roomId}:main`)],
      furnishingProfile: `${unit?.use ?? building.use}:${kind}:${rng.integer(1, 8)}`,
      itemEstimate: kind === "storage" ? rng.integer(8, 30) : kind === "bedroom" ? rng.integer(6, 16) : kind === "retail-floor" ? rng.integer(24, 80) : rng.integer(3, 20)
    };
  });
  const id = createStableEntityId("interior", unit?.id ?? building.id);
  return {
    id,
    buildingId: building.id,
    unitId: unit?.id,
    sectorId: building.sectorId,
    seed: interiorSeed,
    rooms,
    entranceDoorIds: [createStableEntityId("door", `${id}:entrance`)],
    floor: unit?.floor ?? 1,
    estimatedMemoryKb: Math.round(90 + rooms.length * 18 + rooms.reduce((sum, room) => sum + room.itemEstimate, 0) * 1.2),
    lastTouchedAt: timestamp,
    materializedAt: timestamp
  };
}

function updateInteriorCache(input: UrbanFabricInput, buildings: BuildingState[], units: BuildingUnitState[], existing: InteriorState[]): InteriorState[] {
  const activeSectors = new Set(input.metropolitan.streaming.activeSectorIds);
  const retained = existing
    .filter((interior) => activeSectors.has(interior.sectorId))
    .map((interior) => ({ ...interior, lastTouchedAt: input.timestamp }));
  const targetPlacement = input.metropolitan.locations.find((placement) => placement.locationId === (input.targetLocationId ?? input.activeLocationId));
  const targetBuilding = buildings.find((building) => building.anchorLocationId === (input.targetLocationId ?? input.activeLocationId))
    ?? (targetPlacement ? buildings.find((building) => building.sectorId === targetPlacement.sectorId) : undefined);
  if (targetBuilding) {
    const targetUnit = units.find((unit) => unit.buildingId === targetBuilding.id);
    const id = createStableEntityId("interior", targetUnit?.id ?? targetBuilding.id);
    if (!retained.some((interior) => interior.id === id)) retained.push(materializeInterior(input.seed, input.timestamp, targetBuilding, targetUnit));
  }
  for (const unit of units) {
    if (!activeSectors.has(unit.sectorId) || retained.length >= MAX_INTERIOR_CACHE) continue;
    if (retained.some((interior) => interior.unitId === unit.id)) continue;
    const building = buildings.find((item) => item.id === unit.buildingId);
    if (building) retained.push(materializeInterior(input.seed, input.timestamp, building, unit));
  }
  return retained.sort((left, right) => right.lastTouchedAt - left.lastTouchedAt).slice(0, MAX_INTERIOR_CACHE);
}

function ageShares(district: DistrictState): { children: number; young: number; adults: number; elderly: number } {
  const children = clamp(0.19 + (50 - district.costOfLiving) / 850 - district.pollution / 4_000, 0.13, 0.25);
  const elderly = clamp(0.105 + district.infrastructure / 2_800 - district.pollution / 4_500, 0.07, 0.17);
  const young = clamp(0.235 + district.employmentRate / 2_500 - district.costOfLiving / 5_000, 0.19, 0.29);
  return { children, young, adults: Math.max(0.3, 1 - children - young - elderly), elderly };
}

function cohortForSector(timestamp: number, sector: MetropolitanSectorState, district: DistrictState): MassDemographyCohortState {
  const shares = ageShares(district);
  const population = sector.representedPopulation;
  const children = whole(population * shares.children);
  const youngAdults = whole(population * shares.young);
  const elderly = whole(population * shares.elderly);
  const adults = Math.max(0, population - children - youngAdults - elderly);
  const laborForce = youngAdults + adults;
  const employed = whole(laborForce * district.employmentRate / 100);
  const unemployed = Math.max(0, laborForce - employed);
  return {
    sectorId: sector.id,
    districtId: sector.districtId,
    population,
    households: Math.max(1, whole(population / 2.36)),
    children,
    youngAdults,
    adults,
    elderly,
    students: whole(children * 0.68 + youngAdults * 0.13),
    employed,
    unemployed,
    births: 0,
    deaths: 0,
    immigrants: 0,
    emigrants: 0,
    internalArrivals: 0,
    internalDepartures: 0,
    graduates: 0,
    householdFormations: 0,
    lastProcessedMonth: Math.floor(timestamp / MONTH_MS)
  };
}

function demographyTotals(cohorts: MassDemographyCohortState[]): MassDemographyTotalsState {
  return {
    population: cohorts.reduce((sum, item) => sum + item.population, 0),
    households: cohorts.reduce((sum, item) => sum + item.households, 0),
    births: cohorts.reduce((sum, item) => sum + item.births, 0),
    deaths: cohorts.reduce((sum, item) => sum + item.deaths, 0),
    immigrants: cohorts.reduce((sum, item) => sum + item.immigrants, 0),
    emigrants: cohorts.reduce((sum, item) => sum + item.emigrants, 0),
    internalMoves: cohorts.reduce((sum, item) => sum + item.internalArrivals, 0),
    graduates: cohorts.reduce((sum, item) => sum + item.graduates, 0),
    householdFormations: cohorts.reduce((sum, item) => sum + item.householdFormations, 0)
  };
}

function monthlyDemography(seed: string, monthIndex: number, cohort: MassDemographyCohortState, sector: MetropolitanSectorState, district: DistrictState, transportService: number): MassDemographyCohortState {
  const rng = new SeededRandom(`${seed}:mass-demography:${monthIndex}:${cohort.sectorId}`);
  const population = Math.max(1, cohort.population);
  const annualBirthRate = clamp(11.8 - district.costOfLiving * 0.035 - district.pollution * 0.018 + Math.max(0, 60 - sector.densityPerKm2 / 500) * 0.02, 6.2, 15.5);
  const annualDeathRate = clamp(6.8 + district.pollution * 0.045 + Math.max(0, 55 - district.infrastructure) * 0.055 + cohort.elderly / population * 21, 5.8, 18.5);
  const laborPressure = district.employmentRate - 66;
  const housingPressure = Math.max(0, sector.representedHouseholds - Math.max(1, sector.buildingEstimate * 14));
  const annualImmigrationRate = clamp(8.5 + laborPressure * 0.24 + transportService * 0.035 - district.costOfLiving * 0.025, 1.2, 24);
  const annualEmigrationRate = clamp(6.2 + Math.max(0, 58 - district.employmentRate) * 0.34 + district.costOfLiving * 0.035 + housingPressure / Math.max(1, population) * 120, 2.5, 25);
  const births = whole(population * annualBirthRate / 1_000 / 12 + rng.next());
  const deaths = whole(population * annualDeathRate / 1_000 / 12 + rng.next());
  const immigrants = whole(population * annualImmigrationRate / 1_000 / 12 + rng.next());
  const emigrants = whole(population * annualEmigrationRate / 1_000 / 12 + rng.next());
  const graduates = whole((cohort.students * 0.085) / 12 + rng.next());
  const householdFormations = whole((cohort.youngAdults * 0.032) / 12 + immigrants / 2.2 + rng.next());
  const nextPopulation = Math.max(1, population + births - deaths + immigrants - emigrants);
  const childDelta = births - whole(deaths * (cohort.children / population)) - whole(emigrants * (cohort.children / population)) + whole(immigrants * 0.16);
  const youngDelta = whole(cohort.children / 18 / 12) - whole(cohort.youngAdults / 17 / 12) - whole(deaths * (cohort.youngAdults / population)) + whole((immigrants - emigrants) * 0.31);
  const elderlyDelta = whole(cohort.adults / 30 / 12) - whole(deaths * (cohort.elderly / population)) + whole((immigrants - emigrants) * 0.06);
  const children = Math.max(0, cohort.children + childDelta);
  const youngAdults = Math.max(0, cohort.youngAdults + youngDelta);
  const elderly = Math.max(0, cohort.elderly + elderlyDelta);
  const adults = Math.max(0, nextPopulation - children - youngAdults - elderly);
  const laborForce = youngAdults + adults;
  const employed = whole(laborForce * district.employmentRate / 100);
  return {
    ...cohort,
    population: nextPopulation,
    households: Math.max(1, cohort.households + householdFormations - whole(deaths / 2.4) - whole(emigrants / 2.4)),
    children,
    youngAdults,
    adults,
    elderly,
    students: Math.max(0, whole(children * 0.68 + youngAdults * 0.13)),
    employed,
    unemployed: Math.max(0, laborForce - employed),
    births: cohort.births + births,
    deaths: cohort.deaths + deaths,
    immigrants: cohort.immigrants + immigrants,
    emigrants: cohort.emigrants + emigrants,
    graduates: cohort.graduates + graduates,
    householdFormations: cohort.householdFormations + householdFormations,
    lastProcessedMonth: monthIndex
  };
}

function attractiveness(cohort: MassDemographyCohortState, sector: MetropolitanSectorState, district: DistrictState, catalog: SectorBuildingCatalogState): number {
  return district.employmentRate * 0.3 + district.infrastructure * 0.24 + (100 - district.pollution) * 0.12 + (100 - catalog.vacancyRate) * 0.05 + catalog.vacancyRate * 0.22 - sector.trafficLoad * 0.07 - district.costOfLiving * 0.1;
}

function applyInternalMoves(seed: string, monthIndex: number, cohorts: MassDemographyCohortState[], sectors: MetropolitanSectorState[], districts: DistrictState[], catalogs: SectorBuildingCatalogState[]): MassDemographyCohortState[] {
  const next = cohorts.map((item) => ({ ...item }));
  const ranked = next.map((cohort) => {
    const sector = sectors.find((item) => item.id === cohort.sectorId)!;
    const district = districts.find((item) => item.id === cohort.districtId)!;
    const catalog = catalogs.find((item) => item.sectorId === cohort.sectorId)!;
    return { cohort, sector, score: attractiveness(cohort, sector, district, catalog) };
  }).filter((item) => item.sector && Number.isFinite(item.score)).sort((left, right) => left.score - right.score);
  const count = Math.min(300, Math.floor(ranked.length / 4));
  for (let index = 0; index < count; index += 1) {
    const source = ranked[index];
    const target = ranked[ranked.length - 1 - index];
    if (!source || !target || source.cohort.sectorId === target.cohort.sectorId) continue;
    const rng = new SeededRandom(`${seed}:internal-move:${monthIndex}:${source.cohort.sectorId}:${target.cohort.sectorId}`);
    const moving = Math.min(source.cohort.population - 1, whole(source.cohort.population * (0.0012 + rng.next() * 0.0018)));
    if (moving <= 0) continue;
    const sourceIndex = next.findIndex((item) => item.sectorId === source.cohort.sectorId);
    const targetIndex = next.findIndex((item) => item.sectorId === target.cohort.sectorId);
    if (sourceIndex < 0 || targetIndex < 0) continue;
    next[sourceIndex] = { ...next[sourceIndex], population: next[sourceIndex].population - moving, internalDepartures: next[sourceIndex].internalDepartures + moving };
    next[targetIndex] = { ...next[targetIndex], population: next[targetIndex].population + moving, internalArrivals: next[targetIndex].internalArrivals + moving };
  }
  return next;
}

function snapshot(seed: string, monthIndex: number, cohorts: MassDemographyCohortState[], previousTotals?: MassDemographyTotalsState): MassDemographySnapshotState {
  const currentTotals = demographyTotals(cohorts);
  return {
    id: createStableEntityId("mass-demography-snapshot", `${seed}:${monthIndex}`),
    monthIndex,
    population: currentTotals.population,
    births: currentTotals.births - (previousTotals?.births ?? currentTotals.births),
    deaths: currentTotals.deaths - (previousTotals?.deaths ?? currentTotals.deaths),
    immigrants: currentTotals.immigrants - (previousTotals?.immigrants ?? currentTotals.immigrants),
    emigrants: currentTotals.emigrants - (previousTotals?.emigrants ?? currentTotals.emigrants),
    internalMoves: currentTotals.internalMoves - (previousTotals?.internalMoves ?? currentTotals.internalMoves),
    students: cohorts.reduce((sum, item) => sum + item.students, 0),
    employed: cohorts.reduce((sum, item) => sum + item.employed, 0),
    unemployed: cohorts.reduce((sum, item) => sum + item.unemployed, 0)
  };
}

function sampleLinks(timestamp: number, population: PopulationState, metropolitan: MetropolitanState): DetailedResidentSampleLinkState[] {
  const residentCountBySector = new Map<string, number>();
  const sectorByResident = new Map<string, string>();
  for (const resident of population.residents) {
    const placement = metropolitan.locations.find((item) => item.locationId === resident.homeLocationId);
    const sectorId = placement?.sectorId ?? metropolitan.sectors.find((item) => item.districtId === resident.districtId)?.id;
    if (!sectorId) continue;
    sectorByResident.set(resident.id, sectorId);
    residentCountBySector.set(sectorId, (residentCountBySector.get(sectorId) ?? 0) + 1);
  }
  return population.residents.flatMap((resident) => {
    const sectorId = sectorByResident.get(resident.id);
    const sector = sectorId ? metropolitan.sectors.find((item) => item.id === sectorId) : undefined;
    if (!sectorId || !sector) return [];
    const sampleCount = residentCountBySector.get(sectorId) ?? 1;
    return [{
      residentId: resident.id,
      sectorId,
      districtId: resident.districtId,
      representedWeight: Math.max(1, Math.round(sector.representedPopulation / sampleCount)),
      materialized: metropolitan.streaming.activeSectorIds.includes(sectorId),
      updatedAt: timestamp
    }];
  });
}

function memoryState(previous: UrbanMemoryState | undefined, buildings: BuildingState[], units: BuildingUnitState[], interiors: InteriorState[], timestamp: number): UrbanMemoryState {
  const estimatedMemoryMb = Math.round((buildings.length * 18 + units.length * 6.5 + interiors.reduce((sum, item) => sum + item.estimatedMemoryKb, 0) + 1_800) / 1024 * 100) / 100;
  return {
    buildingCacheLimit: MAX_BUILDING_CACHE,
    unitCacheLimit: MAX_UNIT_CACHE,
    interiorCacheLimit: MAX_INTERIOR_CACHE,
    cachedBuildings: buildings.length,
    cachedUnits: units.length,
    cachedInteriors: interiors.length,
    buildingsEvicted: (previous?.buildingsEvicted ?? 0) + Math.max(0, (previous?.cachedBuildings ?? 0) - buildings.length),
    unitsEvicted: (previous?.unitsEvicted ?? 0) + Math.max(0, (previous?.cachedUnits ?? 0) - units.length),
    interiorsEvicted: (previous?.interiorsEvicted ?? 0) + Math.max(0, (previous?.cachedInteriors ?? 0) - interiors.length),
    estimatedMemoryMb,
    peakEstimatedMemoryMb: Math.max(previous?.peakEstimatedMemoryMb ?? 0, estimatedMemoryMb),
    lastCompactedAt: timestamp
  };
}

function urbanTotals(catalogs: SectorBuildingCatalogState[], buildings: BuildingState[], units: BuildingUnitState[], addresses: HouseholdAddressState[], interiors: InteriorState[]): UrbanFabricTotalsState {
  return {
    indexedBuildings: catalogs.reduce((sum, item) => sum + item.buildingCount, 0),
    indexedResidentialUnits: catalogs.reduce((sum, item) => sum + item.residentialUnits, 0),
    indexedResidentCapacity: catalogs.reduce((sum, item) => sum + item.residentCapacity, 0),
    materializedBuildings: buildings.length,
    materializedUnits: units.length,
    detailedHouseholdAddresses: addresses.length,
    materializedInteriors: interiors.length
  };
}

function updatedCatalogs(timestamp: number, catalogs: SectorBuildingCatalogState[], cohorts: MassDemographyCohortState[], buildings: BuildingState[]): SectorBuildingCatalogState[] {
  return catalogs.map((catalog) => {
    const cohort = cohorts.find((item) => item.sectorId === catalog.sectorId);
    const occupiedResidentialUnits = Math.min(catalog.residentialUnits, cohort?.households ?? catalog.occupiedResidentialUnits);
    return {
      ...catalog,
      occupiedResidentialUnits,
      vacancyRate: catalog.residentialUnits ? clamp(Math.round((catalog.residentialUnits - occupiedResidentialUnits) / catalog.residentialUnits * 100)) : 100,
      materializedBuildingCount: buildings.filter((item) => item.sectorId === catalog.sectorId).length,
      lastIndexedAt: timestamp
    };
  });
}

export function createUrbanFabricState(input: UrbanFabricInput): UrbanFabricState {
  const catalogs = input.metropolitan.sectors.map((sector) => catalogForSector(input.seed, input.timestamp, sector));
  const anchors = input.metropolitan.locations.flatMap((placement) => {
    const location = input.locations.find((item) => item.id === placement.locationId);
    return location ? [anchorBuilding(input.seed, input.timestamp, placement, location, input.organizations)] : [];
  });
  const buildings = materializeSectorBuildings(input, catalogs, anchors);
  const assigned = assignDetailedHouseholds(input, buildings, [], []);
  const units = assigned.units.slice(0, MAX_UNIT_CACHE);
  const interiors = updateInteriorCache(input, buildings, units, []);
  const cohorts = input.metropolitan.sectors.map((sector) => {
    const district = input.districts.find((item) => item.id === sector.districtId) ?? input.districts[0];
    return cohortForSector(input.timestamp, sector, district);
  });
  const totals = demographyTotals(cohorts);
  const memory = memoryState(undefined, buildings, units, interiors, input.timestamp);
  const state: UrbanFabricState = {
    version: 1,
    catalogs: updatedCatalogs(input.timestamp, catalogs, cohorts, buildings),
    buildings,
    units,
    householdAddresses: assigned.addresses,
    interiors,
    interiorDeltas: [],
    demography: {
      version: 1,
      cohorts,
      history: [snapshot(input.seed, Math.floor(input.timestamp / MONTH_MS), cohorts)],
      totals,
      lastProcessedMonth: Math.floor(input.timestamp / MONTH_MS)
    },
    sampleLinks: sampleLinks(input.timestamp, input.population, input.metropolitan),
    memory,
    totals: urbanTotals(catalogs, buildings, units, assigned.addresses, interiors),
    lastUpdatedAt: input.timestamp
  };
  return state;
}

function advanceDemography(state: UrbanFabricState, input: UrbanFabricInput): UrbanFabricState["demography"] {
  const targetMonth = Math.floor(input.timestamp / MONTH_MS);
  let month = state.demography.lastProcessedMonth;
  let cohorts = state.demography.cohorts.map((item) => ({ ...item }));
  let history = [...state.demography.history];
  while (month < targetMonth) {
    month += 1;
    const previousTotals = demographyTotals(cohorts);
    cohorts = cohorts.map((cohort) => {
      const sector = input.metropolitan.sectors.find((item) => item.id === cohort.sectorId);
      const district = input.districts.find((item) => item.id === cohort.districtId);
      return sector && district ? monthlyDemography(input.seed, month, cohort, sector, district, input.transportServiceLevel) : cohort;
    });
    cohorts = applyInternalMoves(input.seed, month, cohorts, input.metropolitan.sectors, input.districts, state.catalogs);
    history.push(snapshot(input.seed, month, cohorts, previousTotals));
    history = history.slice(-MAX_HISTORY);
  }
  return { version: 1, cohorts, history, totals: demographyTotals(cohorts), lastProcessedMonth: month };
}

export function advanceUrbanFabricState(state: UrbanFabricState, input: UrbanFabricInput): UrbanFabricAdvanceResult {
  if (input.timestamp <= state.lastUpdatedAt) {
    return {
      state,
      representedPopulationByDistrict: populationByDistrict(state.demography.cohorts),
      representedPopulationBySector: Object.fromEntries(state.demography.cohorts.map((item) => [item.sectorId, item.population]))
    };
  }
  const demography = advanceDemography(state, input);
  let catalogs = state.catalogs.length === input.metropolitan.sectors.length
    ? state.catalogs.map((catalog) => ({ ...catalog }))
    : input.metropolitan.sectors.map((sector) => catalogForSector(input.seed, input.timestamp, sector));
  const buildings = materializeSectorBuildings(input, catalogs, state.buildings);
  const assigned = assignDetailedHouseholds(input, buildings, state.householdAddresses, state.units);
  const permanentUnitIds = new Set(assigned.units.map((unit) => unit.id));
  const activeSectors = new Set(input.metropolitan.streaming.activeSectorIds);
  const cachedUnits = state.units
    .filter((unit) => !permanentUnitIds.has(unit.id) && activeSectors.has(unit.sectorId))
    .sort((left, right) => right.lastMaterializedAt - left.lastMaterializedAt);
  const units = [...assigned.units, ...cachedUnits].slice(0, MAX_UNIT_CACHE);
  const interiors = updateInteriorCache(input, buildings, units, state.interiors);
  catalogs = updatedCatalogs(input.timestamp, catalogs, demography.cohorts, buildings);
  const previousBuildingIds = new Set(buildings.map((item) => item.id));
  const previousUnitIds = new Set(units.map((item) => item.id));
  const previousInteriorIds = new Set(interiors.map((item) => item.id));
  const evictedBuildings = state.buildings.filter((item) => !previousBuildingIds.has(item.id)).length;
  const evictedUnits = state.units.filter((item) => !previousUnitIds.has(item.id)).length;
  const evictedInteriors = state.interiors.filter((item) => !previousInteriorIds.has(item.id)).length;
  const baseMemory = memoryState(state.memory, buildings, units, interiors, input.timestamp);
  const memory = {
    ...baseMemory,
    buildingsEvicted: state.memory.buildingsEvicted + evictedBuildings,
    unitsEvicted: state.memory.unitsEvicted + evictedUnits,
    interiorsEvicted: state.memory.interiorsEvicted + evictedInteriors
  };
  const next: UrbanFabricState = {
    ...state,
    catalogs,
    buildings,
    units,
    householdAddresses: assigned.addresses,
    interiors,
    demography,
    sampleLinks: sampleLinks(input.timestamp, input.population, input.metropolitan),
    memory,
    totals: urbanTotals(catalogs, buildings, units, assigned.addresses, interiors),
    lastUpdatedAt: input.timestamp
  };
  return {
    state: next,
    representedPopulationByDistrict: populationByDistrict(demography.cohorts),
    representedPopulationBySector: Object.fromEntries(demography.cohorts.map((item) => [item.sectorId, item.population]))
  };
}

function populationByDistrict(cohorts: MassDemographyCohortState[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const cohort of cohorts) result[cohort.districtId] = (result[cohort.districtId] ?? 0) + cohort.population;
  return result;
}

export function normalizeUrbanFabricState(value: unknown, input: UrbanFabricInput): UrbanFabricState {
  if (!value || typeof value !== "object") return createUrbanFabricState(input);
  const raw = value as Partial<UrbanFabricState>;
  if (raw.version !== 1 || !Array.isArray(raw.catalogs) || !Array.isArray(raw.buildings) || !raw.demography || !raw.memory) {
    return createUrbanFabricState(input);
  }
  const fresh = createUrbanFabricState(input);
  const normalized: UrbanFabricState = {
    ...fresh,
    ...raw,
    version: 1,
    catalogs: raw.catalogs.length === input.metropolitan.sectors.length ? raw.catalogs : fresh.catalogs,
    buildings: Array.isArray(raw.buildings) ? raw.buildings : fresh.buildings,
    units: Array.isArray(raw.units) ? raw.units : fresh.units,
    householdAddresses: Array.isArray(raw.householdAddresses) ? raw.householdAddresses : fresh.householdAddresses,
    interiors: Array.isArray(raw.interiors) ? raw.interiors : [],
    interiorDeltas: Array.isArray(raw.interiorDeltas) ? raw.interiorDeltas as InteriorPersistentDeltaState[] : [],
    demography: {
      ...fresh.demography,
      ...raw.demography,
      version: 1,
      cohorts: Array.isArray(raw.demography.cohorts) && raw.demography.cohorts.length === input.metropolitan.sectors.length ? raw.demography.cohorts : fresh.demography.cohorts,
      history: Array.isArray(raw.demography.history) ? raw.demography.history.slice(-MAX_HISTORY) : fresh.demography.history,
      totals: raw.demography.totals ?? fresh.demography.totals
    },
    sampleLinks: Array.isArray(raw.sampleLinks) ? raw.sampleLinks : fresh.sampleLinks,
    memory: { ...fresh.memory, ...raw.memory },
    totals: raw.totals ?? fresh.totals,
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
  return advanceUrbanFabricState(normalized, input).state;
}

export function buildingForLocation(state: UrbanFabricState, locationId: string): BuildingState | null {
  return state.buildings.find((building) => building.anchorLocationId === locationId) ?? null;
}

export function addressForHousehold(state: UrbanFabricState, householdId: string): HouseholdAddressState | null {
  return state.householdAddresses.find((address) => address.householdId === householdId) ?? null;
}

export function urbanMemoryHealthy(state: UrbanFabricState): boolean {
  return state.memory.cachedBuildings <= state.memory.buildingCacheLimit
    && state.memory.cachedUnits <= state.memory.unitCacheLimit
    && state.memory.cachedInteriors <= state.memory.interiorCacheLimit
    && state.memory.estimatedMemoryMb <= MEMORY_BUDGET_MB;
}

export function synchronizeMetropolitanFromUrban(metropolitan: MetropolitanState, urban: UrbanFabricState): MetropolitanState {
  const cohortBySector = new Map(urban.demography.cohorts.map((cohort) => [cohort.sectorId, cohort]));
  const sectors = metropolitan.sectors.map((sector) => {
    const cohort = cohortBySector.get(sector.id);
    if (!cohort) return sector;
    return {
      ...sector,
      representedPopulation: cohort.population,
      representedHouseholds: cohort.households,
      densityPerKm2: Math.round(cohort.population / Math.max(0.01, sector.bounds.widthM * sector.bounds.heightM / 1_000_000))
    };
  });
  const districts = metropolitan.districts.map((district) => {
    const local = sectors.filter((sector) => sector.districtId === district.districtId);
    const population = local.reduce((sum, sector) => sum + sector.representedPopulation, 0);
    const areaKm2 = Math.max(1, local.reduce((sum, sector) => sum + sector.bounds.widthM * sector.bounds.heightM / 1_000_000, 0));
    return { ...district, representedPopulation: population, densityPerKm2: Math.round(population / areaKm2) };
  });
  return {
    ...metropolitan,
    sectors,
    districts,
    totals: {
      ...metropolitan.totals,
      representedPopulation: sectors.reduce((sum, sector) => sum + sector.representedPopulation, 0)
    }
  };
}
