import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { DistrictState, LocationState } from "../../world/state/types";
import type {
  DistrictSpatialState,
  LocationFootprintKind,
  LocationSpatialState,
  MetricBounds,
  MetropolitanAdvanceInput,
  MetropolitanAdvanceResult,
  MetropolitanConfig,
  MetropolitanSectorState,
  MetropolitanState,
  MetropolitanTotals,
  RoadLinkState,
  RoadNodeState,
  SectorLandUse,
  SpatialArchiveSummary,
  SpatialDetailLevel,
  SpatialStreamingState,
  TransitLineState,
  TransitStationState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const CITY_WIDTH_M = 42_000;
const CITY_HEIGHT_M = 36_000;
const SECTOR_SIZE_M = 1_000;
const BLOCK_SIZE_M = 125;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function config(): MetropolitanConfig {
  return {
    widthM: CITY_WIDTH_M,
    heightM: CITY_HEIGHT_M,
    sectorSizeM: SECTOR_SIZE_M,
    blockSizeM: BLOCK_SIZE_M,
    sectorsWide: Math.ceil(CITY_WIDTH_M / SECTOR_SIZE_M),
    sectorsHigh: Math.ceil(CITY_HEIGHT_M / SECTOR_SIZE_M),
    activeRadius: 1,
    warmRadius: 3,
    maxActiveSectors: 9,
    maxWarmSectors: 40,
    maxMaterializedResidents: 480,
    maxMaterializedInteriors: 24,
    memoryBudgetMb: 256,
    coldSectorFootprintKb: 0.9,
    warmSectorFootprintKb: 18,
    activeSectorFootprintKb: 7_500,
    seedVersion: 1
  };
}

function districtBounds(index: number, count: number): MetricBounds {
  if (count <= 1) return { xM: 0, yM: 0, widthM: CITY_WIDTH_M, heightM: CITY_HEIGHT_M };
  if (index === 0) return { xM: 0, yM: 0, widthM: 16_000, heightM: CITY_HEIGHT_M };
  if (index === 1) return { xM: 16_000, yM: 12_000, widthM: 26_000, heightM: 24_000 };
  if (index === 2) return { xM: 16_000, yM: 0, widthM: 26_000, heightM: 12_000 };
  const bandHeight = CITY_HEIGHT_M / count;
  return { xM: 0, yM: Math.floor(index * bandHeight), widthM: CITY_WIDTH_M, heightM: Math.ceil(bandHeight) };
}

function districtForSector(xIndex: number, yIndex: number, districts: DistrictState[]): DistrictState {
  if (districts.length <= 1) return districts[0];
  const xM = xIndex * SECTOR_SIZE_M + SECTOR_SIZE_M / 2;
  const yM = yIndex * SECTOR_SIZE_M + SECTOR_SIZE_M / 2;
  if (xM < 16_000) return districts[0];
  if (yM >= 12_000) return districts[1] ?? districts[0];
  return districts[2] ?? districts[districts.length - 1] ?? districts[0];
}

function landUseFor(seed: string, district: DistrictState, xIndex: number, yIndex: number, districtIndex: number): SectorLandUse {
  const rng = new SeededRandom(`${seed}:sector-land:${district.id}:${xIndex}:${yIndex}`);
  const edge = xIndex === 0 || yIndex === 0 || xIndex === Math.ceil(CITY_WIDTH_M / SECTOR_SIZE_M) - 1 || yIndex === Math.ceil(CITY_HEIGHT_M / SECTOR_SIZE_M) - 1;
  if (edge && rng.chance(0.36)) return "vacant";
  if ((xIndex + yIndex) % 13 === 0) return "transport";
  if ((xIndex * 3 + yIndex) % 29 === 0) return "utility";
  if (districtIndex === 0) {
    if (rng.chance(0.54)) return "residential";
    if (rng.chance(0.52)) return "mixed";
    if (rng.chance(0.48)) return "commercial";
    return "industrial";
  }
  if (districtIndex === 1) {
    if (rng.chance(0.56)) return "industrial";
    if (rng.chance(0.5)) return "mixed";
    if (rng.chance(0.42)) return "transport";
    return "residential";
  }
  if (rng.chance(0.48)) return "corporate";
  if (rng.chance(0.45)) return "commercial";
  if (rng.chance(0.45)) return "residential";
  return "civic";
}

function densityWeight(landUse: SectorLandUse, district: DistrictState, xIndex: number, yIndex: number): number {
  const useWeight: Record<SectorLandUse, number> = {
    residential: 1.25,
    mixed: 1.1,
    commercial: 0.58,
    industrial: 0.34,
    corporate: 0.72,
    civic: 0.36,
    transport: 0.14,
    utility: 0.07,
    vacant: 0.025
  };
  const centerX = district.code.includes("TIER") ? 34 : district.code.includes("RING") ? 28 : 8;
  const centerY = district.code.includes("TIER") ? 6 : district.code.includes("RING") ? 24 : 18;
  const distance = Math.hypot(xIndex + 0.5 - centerX, yIndex + 0.5 - centerY);
  const centerBoost = Math.max(0.35, 1.45 - distance / 32);
  const verticality = 0.75 + district.costOfLiving / 110 + district.infrastructure / 180;
  return useWeight[landUse] * centerBoost * verticality;
}

function buildingEstimate(landUse: SectorLandUse, densityPerKm2: number, rng: SeededRandom): number {
  if (landUse === "vacant") return rng.integer(0, 4);
  if (landUse === "transport" || landUse === "utility") return rng.integer(3, 18);
  if (landUse === "industrial") return rng.integer(14, 38);
  if (landUse === "corporate") return rng.integer(24, 58);
  const base = landUse === "residential" ? 72 : landUse === "mixed" ? 60 : 44;
  return Math.max(8, Math.round(base + densityPerKm2 / 1_600 + rng.integer(-12, 18)));
}

function floorAreaEstimate(landUse: SectorLandUse, buildings: number, district: DistrictState, rng: SeededRandom): number {
  const averageFootprint = landUse === "industrial" ? rng.integer(2_400, 7_200) : landUse === "corporate" ? rng.integer(1_600, 4_800) : rng.integer(420, 1_800);
  const floors = landUse === "corporate" ? 16 + Math.round(district.corporateInfluence / 5) : landUse === "residential" || landUse === "mixed" ? 5 + Math.round(district.costOfLiving / 11) : 2 + Math.round(district.infrastructure / 35);
  return Math.round(buildings * averageFootprint * floors);
}

function roadLengthFor(landUse: SectorLandUse, xIndex: number, yIndex: number, rng: SeededRandom): number {
  const grid = 5_000 + ((xIndex + yIndex) % 4) * 600;
  const useModifier = landUse === "industrial" ? 1.22 : landUse === "vacant" ? 0.35 : landUse === "transport" ? 1.45 : 1;
  return Math.round(grid * useModifier + rng.integer(-350, 480));
}

function assignPopulation(sectors: MetropolitanSectorState[], districts: DistrictState[], represented: Record<string, number>): MetropolitanSectorState[] {
  const next = sectors.map((sector) => ({ ...sector }));
  for (const district of districts) {
    const local = next.filter((sector) => sector.districtId === district.id);
    const target = Math.max(district.population, Math.round(represented[district.id] ?? district.population));
    const weights = local.map((sector) => densityWeight(sector.landUse, district, sector.xIndex, sector.yIndex));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
    let allocated = 0;
    for (let index = 0; index < local.length; index += 1) {
      const population = index === local.length - 1 ? target - allocated : Math.max(0, Math.floor(target * weights[index] / totalWeight));
      allocated += population;
      const sector = local[index];
      const targetIndex = next.findIndex((item) => item.id === sector.id);
      const density = population;
      next[targetIndex] = {
        ...next[targetIndex],
        representedPopulation: population,
        representedHouseholds: Math.round(population / (2.15 + district.costOfLiving / 140)),
        densityPerKm2: density
      };
    }
  }
  return next;
}

function createSectors(seed: string, timestamp: number, districts: DistrictState[], represented: Record<string, number>): MetropolitanSectorState[] {
  const cfg = config();
  const sectors: MetropolitanSectorState[] = [];
  for (let yIndex = 0; yIndex < cfg.sectorsHigh; yIndex += 1) {
    for (let xIndex = 0; xIndex < cfg.sectorsWide; xIndex += 1) {
      const district = districtForSector(xIndex, yIndex, districts);
      const districtIndex = Math.max(0, districts.findIndex((item) => item.id === district.id));
      const landUse = landUseFor(seed, district, xIndex, yIndex, districtIndex);
      const sectorSeed = `${seed}:metro:${cfg.seedVersion}:${xIndex}:${yIndex}`;
      const rng = new SeededRandom(sectorSeed);
      const placeholderDensity = Math.max(50, Math.round(district.population / Math.max(1, cfg.sectorsWide * cfg.sectorsHigh / districts.length)));
      const buildings = buildingEstimate(landUse, placeholderDensity, rng);
      sectors.push({
        id: createStableEntityId("metro-sector", sectorSeed),
        code: `S-${xIndex.toString().padStart(2, "0")}-${yIndex.toString().padStart(2, "0")}`,
        xIndex,
        yIndex,
        bounds: { xM: xIndex * cfg.sectorSizeM, yM: yIndex * cfg.sectorSizeM, widthM: cfg.sectorSizeM, heightM: cfg.sectorSizeM },
        districtId: district.id,
        seed: sectorSeed,
        representedPopulation: 0,
        representedHouseholds: 0,
        buildingEstimate: buildings,
        floorAreaEstimateM2: floorAreaEstimate(landUse, buildings, district, rng),
        roadLengthM: roadLengthFor(landUse, xIndex, yIndex, rng),
        densityPerKm2: 0,
        landUse,
        detailLevel: "cold",
        lastTouchedAt: timestamp,
        lastSimulatedAt: timestamp,
        persistentDeltaCount: 0,
        materializedResidentCount: 0,
        materializedInteriorCount: 0,
        crowdLoad: 0,
        trafficLoad: 0
      });
    }
  }
  return assignPopulation(sectors, districts, represented);
}

function footprintFor(location: LocationState): LocationFootprintKind {
  if (location.name.includes("TOWER") || location.type === "office" && location.security >= 85) return "tower";
  if (location.type === "housing") return location.security < 55 ? "megablock" : "midrise";
  if (location.type === "education" || location.type === "clinic" && location.security >= 75) return "campus";
  if (location.type === "workshop" || location.type === "transport") return "warehouse";
  if (location.type === "government") return "campus";
  return location.security >= 65 ? "midrise" : "lowrise";
}

function floorsFor(location: LocationState, footprint: LocationFootprintKind, rng: SeededRandom): number {
  if (footprint === "tower") return rng.integer(72, 138);
  if (footprint === "megablock") return rng.integer(26, 52);
  if (footprint === "campus") return rng.integer(4, 16);
  if (footprint === "warehouse") return rng.integer(1, 5);
  if (footprint === "midrise") return rng.integer(8, 22);
  return rng.integer(1, 7);
}

function preferredLandUses(location: LocationState): SectorLandUse[] {
  if (location.type === "housing") return ["residential", "mixed"];
  if (location.type === "office") return ["corporate", "commercial", "mixed"];
  if (location.type === "workshop") return ["industrial", "utility"];
  if (location.type === "transport") return ["transport", "industrial"];
  if (location.type === "government") return ["civic", "corporate"];
  if (location.type === "education") return ["civic", "residential", "corporate"];
  if (location.type === "clinic") return ["civic", "mixed", "corporate"];
  return ["commercial", "mixed", "residential"];
}

function placeLocations(seed: string, sectors: MetropolitanSectorState[], locations: LocationState[]): LocationSpatialState[] {
  const used = new Set<string>();
  return locations.map((location, index) => {
    const preferred = preferredLandUses(location);
    const candidates = sectors.filter((sector) => sector.districtId === location.districtId && preferred.includes(sector.landUse));
    const fallback = sectors.filter((sector) => sector.districtId === location.districtId);
    const pool = candidates.length ? candidates : fallback;
    const rng = new SeededRandom(`${seed}:location-placement:${location.id}`);
    let sector = pool[rng.integer(0, Math.max(0, pool.length - 1))] ?? sectors[index % Math.max(1, sectors.length)];
    let guard = 0;
    while (sector && used.has(sector.id) && guard < pool.length) {
      sector = pool[(pool.indexOf(sector) + 1) % pool.length];
      guard += 1;
    }
    used.add(sector.id);
    const footprint = footprintFor(location);
    const width = footprint === "tower" ? rng.integer(110, 220) : footprint === "megablock" ? rng.integer(240, 460) : footprint === "campus" ? rng.integer(280, 620) : footprint === "warehouse" ? rng.integer(180, 520) : rng.integer(70, 230);
    const height = footprint === "tower" ? rng.integer(110, 220) : footprint === "megablock" ? rng.integer(220, 440) : footprint === "campus" ? rng.integer(240, 580) : footprint === "warehouse" ? rng.integer(160, 480) : rng.integer(60, 210);
    const xM = sector.bounds.xM + rng.integer(40, Math.max(41, sector.bounds.widthM - width - 40));
    const yM = sector.bounds.yM + rng.integer(40, Math.max(41, sector.bounds.heightM - height - 40));
    const floors = floorsFor(location, footprint, rng);
    const area = width * height * floors;
    const verticalPopulationCapacity = location.type === "housing" ? Math.round(area / (footprint === "megablock" ? 22 : 42)) : footprint === "tower" ? Math.round(area / 38) : Math.round(area / 85);
    return {
      locationId: location.id,
      sectorId: sector.id,
      districtId: location.districtId,
      addressCode: `${sector.code}/${(index + 1).toString().padStart(3, "0")}`,
      bounds: { xM, yM, widthM: width, heightM: height },
      floors,
      basementLevels: footprint === "tower" ? rng.integer(4, 10) : footprint === "megablock" ? rng.integer(2, 5) : rng.integer(0, 3),
      footprintKind: footprint,
      entranceCount: footprint === "megablock" || footprint === "campus" ? rng.integer(3, 10) : rng.integer(1, 4),
      serviceEntranceCount: footprint === "tower" || footprint === "campus" || footprint === "warehouse" ? rng.integer(1, 5) : rng.integer(0, 2),
      verticalPopulationCapacity,
      persistentInteriorSeed: `${seed}:interior:${location.id}:v1`
    };
  });
}

function createRoadNetwork(seed: string, sectors: MetropolitanSectorState[]): { nodes: RoadNodeState[]; links: RoadLinkState[] } {
  const nodes: RoadNodeState[] = [];
  const links: RoadLinkState[] = [];
  const cfg = config();
  const spacing = 4;
  for (let y = 0; y <= cfg.sectorsHigh; y += spacing) {
    for (let x = 0; x <= cfg.sectorsWide; x += spacing) {
      const sectorX = Math.min(cfg.sectorsWide - 1, x);
      const sectorY = Math.min(cfg.sectorsHigh - 1, y);
      const sector = sectors.find((item) => item.xIndex === sectorX && item.yIndex === sectorY) ?? sectors[0];
      nodes.push({
        id: createStableEntityId("road-node", `${seed}:${x}:${y}`),
        sectorId: sector.id,
        xM: Math.min(cfg.widthM, x * cfg.sectorSizeM),
        yM: Math.min(cfg.heightM, y * cfg.sectorSizeM),
        kind: x === 0 || y === 0 || x >= cfg.sectorsWide || y >= cfg.sectorsHigh ? "district-gate" : (x + y) % 12 === 0 ? "interchange" : "intersection"
      });
    }
  }
  const byCoord = new Map(nodes.map((node) => [`${node.xM}:${node.yM}`, node]));
  for (const node of nodes) {
    const east = byCoord.get(`${node.xM + spacing * cfg.sectorSizeM}:${node.yM}`);
    const south = byCoord.get(`${node.xM}:${node.yM + spacing * cfg.sectorSizeM}`);
    for (const target of [east, south]) {
      if (!target) continue;
      const lengthM = Math.round(Math.hypot(target.xM - node.xM, target.yM - node.yM));
      const className = (node.xM / cfg.sectorSizeM + node.yM / cfg.sectorSizeM) % 12 === 0 ? "expressway" as const : "arterial" as const;
      const districtIds = [...new Set([sectors.find((item) => item.id === node.sectorId)?.districtId, sectors.find((item) => item.id === target.sectorId)?.districtId].filter((value): value is string => Boolean(value)))];
      links.push({
        id: createStableEntityId("road-link", `${seed}:${node.id}:${target.id}`),
        fromNodeId: node.id,
        toNodeId: target.id,
        class: className,
        lengthM,
        lanes: className === "expressway" ? 8 : 4,
        capacityPerHour: className === "expressway" ? 10_800 : 4_800,
        speedLimitKph: className === "expressway" ? 105 : 68,
        districtIds
      });
    }
  }
  return { nodes, links };
}

function createTransit(seed: string, sectors: MetropolitanSectorState[], districts: DistrictState[]): { stations: TransitStationState[]; lines: TransitLineState[] } {
  const stations: TransitStationState[] = [];
  const lineDefinitions = [
    { scope: "red-spine", name: "RED SPINE", mode: "metro" as const, yM: 18_000, capacity: 680_000 },
    { scope: "crown-elevated", name: "CROWN ELEVATED", mode: "elevated" as const, yM: 7_000, capacity: 360_000 },
    { scope: "foundry-freight", name: "FOUNDRY FREIGHT", mode: "freight" as const, yM: 28_000, capacity: 240_000 }
  ];
  const lines: TransitLineState[] = [];
  for (const definition of lineDefinitions) {
    const lineId = createStableEntityId("transit-line", `${seed}:${definition.scope}`);
    const stationIds: string[] = [];
    for (let xM = 2_000; xM < CITY_WIDTH_M; xM += 4_000) {
      const xIndex = Math.min(Math.floor(xM / SECTOR_SIZE_M), Math.ceil(CITY_WIDTH_M / SECTOR_SIZE_M) - 1);
      const yIndex = Math.min(Math.floor(definition.yM / SECTOR_SIZE_M), Math.ceil(CITY_HEIGHT_M / SECTOR_SIZE_M) - 1);
      const sector = sectors.find((item) => item.xIndex === xIndex && item.yIndex === yIndex) ?? sectors[0];
      const district = districts.find((item) => item.id === sector.districtId) ?? districts[0];
      const stationId = createStableEntityId("transit-station", `${seed}:${definition.scope}:${xM}`);
      stationIds.push(stationId);
      stations.push({
        id: stationId,
        name: `${district.code} ${Math.round(xM / 1_000).toString().padStart(2, "0")}`,
        sectorId: sector.id,
        districtId: sector.districtId,
        xM,
        yM: definition.yM,
        lineIds: [lineId],
        dailyCapacity: Math.round(definition.capacity / 10)
      });
    }
    lines.push({
      id: lineId,
      name: definition.name,
      mode: definition.mode,
      stationIds,
      lengthM: CITY_WIDTH_M - 4_000,
      dailyCapacity: definition.capacity
    });
  }
  return { stations, lines };
}

function detailIds(focus: MetropolitanSectorState, sectors: MetropolitanSectorState[], radius: number, limit: number): string[] {
  return sectors
    .filter((sector) => Math.max(Math.abs(sector.xIndex - focus.xIndex), Math.abs(sector.yIndex - focus.yIndex)) <= radius)
    .sort((left, right) => Math.hypot(left.xIndex - focus.xIndex, left.yIndex - focus.yIndex) - Math.hypot(right.xIndex - focus.xIndex, right.yIndex - focus.yIndex))
    .slice(0, limit)
    .map((sector) => sector.id);
}

function memoryEstimate(cfg: MetropolitanConfig, activeCount: number, warmCount: number, coldCount: number, residentCount: number, interiorCount: number): number {
  const kb = activeCount * cfg.activeSectorFootprintKb
    + warmCount * cfg.warmSectorFootprintKb
    + coldCount * cfg.coldSectorFootprintKb
    + residentCount * 7.5
    + interiorCount * 280;
  return Math.round(kb / 1024 * 100) / 100;
}

function streamingState(cfg: MetropolitanConfig, focus: MetropolitanSectorState, sectors: MetropolitanSectorState[], previous?: SpatialStreamingState): SpatialStreamingState {
  const activeSectorIds = detailIds(focus, sectors, cfg.activeRadius, cfg.maxActiveSectors);
  const warmAll = detailIds(focus, sectors, cfg.warmRadius, cfg.maxWarmSectors + activeSectorIds.length);
  const warmSectorIds = warmAll.filter((id) => !activeSectorIds.includes(id)).slice(0, cfg.maxWarmSectors);
  const materializedResidentCount = Math.min(cfg.maxMaterializedResidents, activeSectorIds.reduce((sum, id) => sum + Math.max(8, Math.round((sectors.find((sector) => sector.id === id)?.representedPopulation ?? 0) / 1_800)), 0));
  const materializedInteriorCount = Math.min(cfg.maxMaterializedInteriors, Math.max(1, Math.round(activeSectorIds.length * 1.8)));
  const coldSectorCount = Math.max(0, sectors.length - activeSectorIds.length - warmSectorIds.length);
  const estimatedMemoryMb = memoryEstimate(cfg, activeSectorIds.length, warmSectorIds.length, coldSectorCount, materializedResidentCount, materializedInteriorCount);
  const previousActive = new Set(previous?.activeSectorIds ?? []);
  const previousWarm = new Set(previous?.warmSectorIds ?? []);
  const newLoaded = [...activeSectorIds, ...warmSectorIds].filter((id) => !previousActive.has(id) && !previousWarm.has(id)).length;
  const evicted = [...previousActive, ...previousWarm].filter((id) => !activeSectorIds.includes(id) && !warmSectorIds.includes(id)).length;
  const residentsDematerialized = Math.max(0, (previous?.materializedResidentCount ?? 0) - materializedResidentCount);
  const interiorsDematerialized = Math.max(0, (previous?.materializedInteriorCount ?? 0) - materializedInteriorCount);
  return {
    focusSectorId: focus.id,
    activeSectorIds,
    warmSectorIds,
    coldSectorCount,
    estimatedMemoryMb,
    peakEstimatedMemoryMb: Math.max(previous?.peakEstimatedMemoryMb ?? 0, estimatedMemoryMb),
    materializedResidentCount,
    materializedInteriorCount,
    sectorsActivated: (previous?.sectorsActivated ?? 0) + newLoaded,
    sectorsEvicted: (previous?.sectorsEvicted ?? 0) + evicted,
    residentsDematerialized: (previous?.residentsDematerialized ?? 0) + residentsDematerialized,
    interiorsDematerialized: (previous?.interiorsDematerialized ?? 0) + interiorsDematerialized,
    compactions: previous?.compactions ?? 0,
    lastCompactedAt: previous?.lastCompactedAt ?? focus.lastTouchedAt
  };
}

function districtSpatialStates(districts: DistrictState[], sectors: MetropolitanSectorState[]): DistrictSpatialState[] {
  return districts.map((district, index) => {
    const local = sectors.filter((sector) => sector.districtId === district.id);
    const bounds = districtBounds(index, districts.length);
    const representedPopulation = local.reduce((sum, sector) => sum + sector.representedPopulation, 0);
    const areaKm2 = Math.max(1, local.length);
    const uses = new Map<SectorLandUse, number>();
    for (const sector of local) uses.set(sector.landUse, (uses.get(sector.landUse) ?? 0) + 1);
    const dominantLandUse = [...uses.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "mixed";
    return {
      districtId: district.id,
      bounds,
      center: { xM: bounds.xM + bounds.widthM / 2, yM: bounds.yM + bounds.heightM / 2 },
      representedPopulation,
      densityPerKm2: Math.round(representedPopulation / areaKm2),
      sectorIds: local.map((sector) => sector.id),
      dominantLandUse,
      transitScore: clamp(Math.round(district.infrastructure * 0.72 + district.employmentRate * 0.28)),
      verticality: clamp(Math.round(district.costOfLiving * 0.45 + district.corporateInfluence * 0.35 + district.infrastructure * 0.2))
    };
  });
}

function totalsFor(state: Omit<MetropolitanState, "totals">): MetropolitanTotals {
  return {
    sectors: state.sectors.length,
    representedPopulation: state.sectors.reduce((sum, sector) => sum + sector.representedPopulation, 0),
    estimatedBuildings: state.sectors.reduce((sum, sector) => sum + sector.buildingEstimate, 0),
    estimatedFloorAreaM2: state.sectors.reduce((sum, sector) => sum + sector.floorAreaEstimateM2, 0),
    roadLengthM: state.sectors.reduce((sum, sector) => sum + sector.roadLengthM, 0),
    transitLengthM: state.transitLines.reduce((sum, line) => sum + line.lengthM, 0),
    persistentDeltas: state.deltas.length,
    archiveSummaries: state.archive.length
  };
}

export function createMetropolitanState(input: MetropolitanAdvanceInput): MetropolitanState {
  const cfg = config();
  const sectors = createSectors(input.seed, input.timestamp, input.districts, input.representedPopulationByDistrict);
  const locations = placeLocations(input.seed, sectors, input.locations);
  const roads = createRoadNetwork(input.seed, sectors);
  const transit = createTransit(input.seed, sectors, input.districts);
  const focusPlacement = locations.find((item) => item.locationId === input.targetLocationId)
    ?? locations.find((item) => item.locationId === input.activeLocationId)
    ?? locations[0];
  const focus = sectors.find((sector) => sector.id === focusPlacement?.sectorId) ?? sectors[0];
  const streaming = streamingState(cfg, focus, sectors);
  const nextSectors = sectors.map((sector) => ({
    ...sector,
    detailLevel: streaming.activeSectorIds.includes(sector.id) ? "active" as const : streaming.warmSectorIds.includes(sector.id) ? "warm" as const : "cold" as const,
    materializedResidentCount: streaming.activeSectorIds.includes(sector.id) ? Math.max(4, Math.round(sector.representedPopulation / 1_800)) : 0,
    materializedInteriorCount: streaming.activeSectorIds.includes(sector.id) ? 2 : 0
  }));
  const base = {
    version: 1 as const,
    config: cfg,
    districts: districtSpatialStates(input.districts, nextSectors),
    sectors: nextSectors,
    locations,
    roadNodes: roads.nodes,
    roadLinks: roads.links,
    transitStations: transit.stations,
    transitLines: transit.lines,
    deltas: [],
    archive: [],
    streaming,
    lastUpdatedAt: input.timestamp
  };
  return { ...base, totals: totalsFor(base) };
}

function sectorActivity(sector: MetropolitanSectorState, timestamp: number, transportServiceLevel: number, dataServiceLevel: number): Pick<MetropolitanSectorState, "crowdLoad" | "trafficLoad"> {
  const hour = new Date(timestamp).getUTCHours();
  const commute = hour >= 7 && hour <= 10 || hour >= 16 && hour <= 20;
  const night = hour >= 22 || hour <= 5;
  const crowdBase = sector.landUse === "commercial" || sector.landUse === "mixed" ? 56 : sector.landUse === "corporate" ? 48 : sector.landUse === "industrial" ? 34 : 26;
  const densityBoost = Math.min(35, sector.densityPerKm2 / 1_800);
  const crowdLoad = clamp(Math.round(crowdBase + densityBoost + (commute ? 18 : night ? -18 : 0)));
  const roadFactor = Math.min(28, sector.roadLengthM / 300);
  const trafficLoad = clamp(Math.round(26 + roadFactor + (commute ? 34 : night ? -12 : 0) - transportServiceLevel * 0.18 + (100 - dataServiceLevel) * 0.05));
  return { crowdLoad, trafficLoad };
}

function normalizePopulation(state: MetropolitanState, districts: DistrictState[], represented: Record<string, number>): MetropolitanSectorState[] {
  const currentByDistrict = new Map(state.sectors.map((sector) => [sector.id, sector]));
  const generated = assignPopulation(state.sectors, districts, represented);
  return generated.map((sector) => ({ ...currentByDistrict.get(sector.id), ...sector }));
}

function compactState(state: MetropolitanState, input: MetropolitanAdvanceInput, streaming: SpatialStreamingState): { archive: SpatialArchiveSummary[]; streaming: SpatialStreamingState; eventBudget: number; observationBudget: number } {
  const dayIndex = Math.floor(input.timestamp / DAY_MS);
  if (input.timestamp - streaming.lastCompactedAt < 7 * DAY_MS) {
    return { archive: state.archive, streaming, eventBudget: input.recentEventCount, observationBudget: input.recentObservationCount };
  }
  const coldTouched = state.sectors
    .filter((sector) => sector.detailLevel === "cold")
    .sort((left, right) => left.lastTouchedAt - right.lastTouchedAt)
    .slice(0, 12);
  const residentsDematerialized = coldTouched.reduce((sum, sector) => sum + sector.materializedResidentCount, 0);
  const interiorsDematerialized = coldTouched.reduce((sum, sector) => sum + sector.materializedInteriorCount, 0);
  const eventBudget = Math.min(input.recentEventCount, 240);
  const observationBudget = Math.min(input.recentObservationCount, 2_500);
  const expiredEvents = Math.max(0, input.recentEventCount - eventBudget);
  const expiredObservations = Math.max(0, input.recentObservationCount - observationBudget);
  const archiveEntry: SpatialArchiveSummary = {
    id: createStableEntityId("spatial-archive", `${input.seed}:${dayIndex}:${streaming.focusSectorId}`),
    sectorId: streaming.focusSectorId,
    dayIndex,
    eventsCompacted: expiredEvents,
    observationsExpired: expiredObservations,
    temporaryDeltasRemoved: 0,
    residentsDematerialized,
    interiorsDematerialized
  };
  return {
    archive: [...state.archive, archiveEntry].slice(-260),
    streaming: {
      ...streaming,
      compactions: streaming.compactions + 1,
      lastCompactedAt: input.timestamp,
      residentsDematerialized: streaming.residentsDematerialized + residentsDematerialized,
      interiorsDematerialized: streaming.interiorsDematerialized + interiorsDematerialized
    },
    eventBudget,
    observationBudget
  };
}

export function advanceMetropolitanState(state: MetropolitanState, input: MetropolitanAdvanceInput): MetropolitanAdvanceResult {
  if (input.timestamp <= state.lastUpdatedAt) {
    return { state, compactedEventBudget: input.recentEventCount, compactedObservationBudget: input.recentObservationCount };
  }
  const sectorsWithPopulation = normalizePopulation(state, input.districts, input.representedPopulationByDistrict);
  const focusPlacement = state.locations.find((item) => item.locationId === input.targetLocationId)
    ?? state.locations.find((item) => item.locationId === input.activeLocationId)
    ?? state.locations[0];
  const focus = sectorsWithPopulation.find((sector) => sector.id === input.focusSectorId)
    ?? sectorsWithPopulation.find((sector) => sector.id === focusPlacement?.sectorId)
    ?? sectorsWithPopulation[0];
  let streaming = streamingState(state.config, focus, sectorsWithPopulation, state.streaming);
  let sectors = sectorsWithPopulation.map((sector) => {
    const detailLevel: SpatialDetailLevel = streaming.activeSectorIds.includes(sector.id) ? "active" : streaming.warmSectorIds.includes(sector.id) ? "warm" : "cold";
    const activity = sectorActivity(sector, input.timestamp, input.transportServiceLevel, input.dataServiceLevel);
    const active = detailLevel === "active";
    const warm = detailLevel === "warm";
    const materializedResidentCount = active ? Math.min(80, Math.max(4, Math.round(sector.representedPopulation / 1_800))) : warm ? Math.min(12, Math.round(sector.representedPopulation / 12_000)) : 0;
    const materializedInteriorCount = active ? Math.min(4, Math.max(1, Math.round(sector.buildingEstimate / 45))) : 0;
    return {
      ...sector,
      detailLevel,
      lastTouchedAt: active || warm ? input.timestamp : sector.lastTouchedAt,
      lastSimulatedAt: input.timestamp,
      materializedResidentCount,
      materializedInteriorCount,
      persistentDeltaCount: state.deltas.filter((delta) => delta.sectorId === sector.id).length,
      ...activity
    };
  });
  const residentTotal = sectors.reduce((sum, sector) => sum + sector.materializedResidentCount, 0);
  const interiorTotal = sectors.reduce((sum, sector) => sum + sector.materializedInteriorCount, 0);
  if (residentTotal > state.config.maxMaterializedResidents || interiorTotal > state.config.maxMaterializedInteriors) {
    let residentRemaining = state.config.maxMaterializedResidents;
    let interiorRemaining = state.config.maxMaterializedInteriors;
    sectors = sectors.map((sector) => {
      if (sector.detailLevel !== "active") return { ...sector, materializedResidentCount: 0, materializedInteriorCount: 0 };
      const residents = Math.min(sector.materializedResidentCount, residentRemaining);
      const interiors = Math.min(sector.materializedInteriorCount, interiorRemaining);
      residentRemaining -= residents;
      interiorRemaining -= interiors;
      return { ...sector, materializedResidentCount: residents, materializedInteriorCount: interiors };
    });
  }
  const finalResidentTotal = sectors.reduce((sum, sector) => sum + sector.materializedResidentCount, 0);
  const finalInteriorTotal = sectors.reduce((sum, sector) => sum + sector.materializedInteriorCount, 0);
  const coldCount = sectors.filter((sector) => sector.detailLevel === "cold").length;
  const estimatedMemoryMb = memoryEstimate(state.config, streaming.activeSectorIds.length, streaming.warmSectorIds.length, coldCount, finalResidentTotal, finalInteriorTotal);
  streaming = {
    ...streaming,
    materializedResidentCount: finalResidentTotal,
    materializedInteriorCount: finalInteriorTotal,
    coldSectorCount: coldCount,
    estimatedMemoryMb,
    peakEstimatedMemoryMb: Math.max(streaming.peakEstimatedMemoryMb, estimatedMemoryMb)
  };
  const compacted = compactState({ ...state, sectors }, input, streaming);
  const base = {
    ...state,
    districts: districtSpatialStates(input.districts, sectors),
    sectors,
    archive: compacted.archive,
    streaming: compacted.streaming,
    lastUpdatedAt: input.timestamp
  };
  const next = { ...base, totals: totalsFor(base) };
  return { state: next, compactedEventBudget: compacted.eventBudget, compactedObservationBudget: compacted.observationBudget };
}

export function normalizeMetropolitanState(value: unknown, input: MetropolitanAdvanceInput): MetropolitanState {
  if (!value || typeof value !== "object") return createMetropolitanState(input);
  const raw = value as Partial<MetropolitanState>;
  if (raw.version !== 1 || !Array.isArray(raw.sectors) || !Array.isArray(raw.locations) || !raw.config || !raw.streaming) {
    return createMetropolitanState(input);
  }
  const requiredSectors = raw.config.sectorsWide * raw.config.sectorsHigh;
  if (raw.sectors.length !== requiredSectors || raw.config.widthM !== CITY_WIDTH_M || raw.config.heightM !== CITY_HEIGHT_M) {
    return createMetropolitanState(input);
  }
  return advanceMetropolitanState({
    version: 1,
    config: raw.config,
    districts: Array.isArray(raw.districts) ? raw.districts : [],
    sectors: raw.sectors,
    locations: raw.locations,
    roadNodes: Array.isArray(raw.roadNodes) ? raw.roadNodes : [],
    roadLinks: Array.isArray(raw.roadLinks) ? raw.roadLinks : [],
    transitStations: Array.isArray(raw.transitStations) ? raw.transitStations : [],
    transitLines: Array.isArray(raw.transitLines) ? raw.transitLines : [],
    deltas: Array.isArray(raw.deltas) ? raw.deltas : [],
    archive: Array.isArray(raw.archive) ? raw.archive : [],
    streaming: raw.streaming,
    totals: raw.totals ?? {
      sectors: raw.sectors.length,
      representedPopulation: 0,
      estimatedBuildings: 0,
      estimatedFloorAreaM2: 0,
      roadLengthM: 0,
      transitLengthM: 0,
      persistentDeltas: 0,
      archiveSummaries: 0
    },
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  }, input).state;
}

export function sectorForLocation(state: MetropolitanState, locationId: string): MetropolitanSectorState | null {
  const placement = state.locations.find((item) => item.locationId === locationId);
  return placement ? state.sectors.find((sector) => sector.id === placement.sectorId) ?? null : null;
}
