import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { DistrictState, LocationState } from "../../world/state/types";
import type {
  DistrictSpatialState,
  LocationFootprintKind,
  LocationSpatialState,
  MapDistrictState,
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

function sectorKey(xIndex: number, yIndex: number): string {
  return `${xIndex}:${yIndex}`;
}

function districtSeedCells(seed: string, districts: DistrictState[], cfg: MetropolitanConfig): Array<{ districtId: string; xIndex: number; yIndex: number }> {
  if (!districts.length) throw new Error("Metropolitan generation requires at least one district");
  const rng = new SeededRandom(`${seed}:administrative-district-seeds:v2`);
  const candidates = Array.from({ length: cfg.sectorsHigh }, (_, yIndex) =>
    Array.from({ length: cfg.sectorsWide }, (_, xIndex) => ({ xIndex, yIndex }))
  ).flat();
  const selected: Array<{ districtId: string; xIndex: number; yIndex: number }> = [];
  for (const district of districts) {
    if (!selected.length) {
      const first = candidates[rng.integer(0, candidates.length - 1)];
      selected.push({ districtId: district.id, ...first });
      continue;
    }
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const minimumDistance = Math.min(...selected.map((item) => Math.hypot(candidate.xIndex - item.xIndex, candidate.yIndex - item.yIndex)));
      const edgePenalty = candidate.xIndex === 0 || candidate.yIndex === 0 || candidate.xIndex === cfg.sectorsWide - 1 || candidate.yIndex === cfg.sectorsHigh - 1 ? 1.2 : 0;
      const score = minimumDistance - edgePenalty + new SeededRandom(`${seed}:district-seed-score:${district.id}:${candidate.xIndex}:${candidate.yIndex}`).next() * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    selected.push({ districtId: district.id, ...best });
  }
  return selected;
}

function administrativeDistrictAssignments(seed: string, districts: DistrictState[], cfg: MetropolitanConfig): Map<string, DistrictState> {
  const seeds = districtSeedCells(seed, districts, cfg);
  const districtById = new Map(districts.map((district) => [district.id, district]));
  const assignments = new Map<string, DistrictState>();
  for (let yIndex = 0; yIndex < cfg.sectorsHigh; yIndex += 1) {
    for (let xIndex = 0; xIndex < cfg.sectorsWide; xIndex += 1) {
      const nearest = [...seeds].sort((left, right) => {
        const leftDistance = (xIndex - left.xIndex) ** 2 + (yIndex - left.yIndex) ** 2;
        const rightDistance = (xIndex - right.xIndex) ** 2 + (yIndex - right.yIndex) ** 2;
        return leftDistance - rightDistance || left.districtId.localeCompare(right.districtId);
      })[0];
      assignments.set(sectorKey(xIndex, yIndex), districtById.get(nearest.districtId) ?? districts[0]);
    }
  }
  return assignments;
}

function weightedLandUse(rng: SeededRandom, weights: Array<[SectorLandUse, number]>): SectorLandUse {
  const total = weights.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  let cursor = rng.next() * Math.max(1, total);
  for (const [landUse, weight] of weights) {
    cursor -= Math.max(0, weight);
    if (cursor <= 0) return landUse;
  }
  return weights[weights.length - 1]?.[0] ?? "mixed";
}

function landUseFor(seed: string, district: DistrictState, xIndex: number, yIndex: number, districtIndex: number): SectorLandUse {
  const rng = new SeededRandom(`${seed}:sector-land:${district.id}:${xIndex}:${yIndex}`);
  const edge = xIndex === 0 || yIndex === 0 || xIndex === Math.ceil(CITY_WIDTH_M / SECTOR_SIZE_M) - 1 || yIndex === Math.ceil(CITY_HEIGHT_M / SECTOR_SIZE_M) - 1;
  if (edge && rng.chance(0.22)) return "vacant";
  if ((xIndex * 7 + yIndex * 11 + districtIndex) % 41 === 0) return "transport";
  if ((xIndex * 13 + yIndex * 5 + districtIndex) % 67 === 0) return "utility";
  const industrialBias = district.pollution * 0.9 + (100 - district.costOfLiving) * 0.3;
  const corporateBias = district.corporateInfluence + district.costOfLiving * 0.55;
  const residentialBias = 82 + (100 - district.pollution) * 0.3;
  return weightedLandUse(rng, [
    ["residential", residentialBias],
    ["mixed", 94],
    ["commercial", 44 + district.employmentRate * 0.45],
    ["industrial", 20 + industrialBias],
    ["corporate", 8 + corporateBias * 0.55],
    ["civic", 18 + district.governmentInfluence * 0.5],
    ["transport", 10 + district.infrastructure * 0.2]
  ]);
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
  const distance = Math.hypot(xIndex + 0.5 - CITY_WIDTH_M / SECTOR_SIZE_M / 2, yIndex + 0.5 - CITY_HEIGHT_M / SECTOR_SIZE_M / 2);
  const centerBoost = Math.max(0.62, 1.32 - distance / 55);
  const verticality = 0.75 + district.costOfLiving / 110 + district.corporateInfluence / 190;
  return Math.max(0.001, useWeight[landUse] * centerBoost * verticality);
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
  const assignments = administrativeDistrictAssignments(seed, districts, cfg);
  for (let yIndex = 0; yIndex < cfg.sectorsHigh; yIndex += 1) {
    for (let xIndex = 0; xIndex < cfg.sectorsWide; xIndex += 1) {
      const district = assignments.get(sectorKey(xIndex, yIndex)) ?? districts[0];
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
        mapDistrictId: "",
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


const MAP_DISTRICT_PREFIXES = [
  "NEON", "ASH", "GLASS", "GHOST", "IRON", "LOWLIGHT", "EMBER", "SILT", "CROWN", "STATIC", "BLACK", "COPPER", "VOID", "RED", "NORTH", "SOUTH"
] as const;
const MAP_DISTRICT_SUFFIXES = [
  "WARD", "QUAY", "TRACE", "HEIGHTS", "BLOCKS", "MARKET", "YARDS", "GATE", "ROW", "CROSS", "TERRACE", "BELT", "ARC", "COMMON", "DOCKS", "ARRAY"
] as const;

function boundsForSectors(sectors: MetropolitanSectorState[]): MetricBounds {
  const cfg = config();
  if (!sectors.length) return { xM: 0, yM: 0, widthM: cfg.sectorSizeM, heightM: cfg.sectorSizeM };
  const minX = Math.min(...sectors.map((sector) => sector.bounds.xM));
  const minY = Math.min(...sectors.map((sector) => sector.bounds.yM));
  const maxX = Math.max(...sectors.map((sector) => sector.bounds.xM + sector.bounds.widthM));
  const maxY = Math.max(...sectors.map((sector) => sector.bounds.yM + sector.bounds.heightM));
  return { xM: minX, yM: minY, widthM: maxX - minX, heightM: maxY - minY };
}

function dominantLandUseFor(sectors: MetropolitanSectorState[]): SectorLandUse {
  const counts = new Map<SectorLandUse, number>();
  for (const sector of sectors) counts.set(sector.landUse, (counts.get(sector.landUse) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "mixed";
}

function neighborhoodCounts(sectors: MetropolitanSectorState[], districts: DistrictState[]): Map<string, number> {
  const localCounts = new Map(districts.map((district) => [district.id, sectors.filter((sector) => sector.districtId === district.id).length]));
  const maximum = Math.max(districts.length, districts.length * 6);
  const target = Math.max(districts.length, Math.min(maximum, Math.round(sectors.length / 126)));
  const base = target >= districts.length * 2 ? 2 : 1;
  const counts = new Map(districts.map((district) => [district.id, localCounts.get(district.id) ? base : 0]));
  while ([...counts.values()].reduce((sum, value) => sum + value, 0) < target) {
    const candidate = districts
      .filter((district) => (counts.get(district.id) ?? 0) < 6 && (localCounts.get(district.id) ?? 0) > 0)
      .sort((left, right) => {
        const leftScore = (localCounts.get(left.id) ?? 0) / Math.max(1, counts.get(left.id) ?? 1);
        const rightScore = (localCounts.get(right.id) ?? 0) / Math.max(1, counts.get(right.id) ?? 1);
        return rightScore - leftScore || left.id.localeCompare(right.id);
      })[0];
    if (!candidate) break;
    counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
  }
  return counts;
}

function mapDistrictSeeds(seed: string, administrativeDistrictId: string, sectors: MetropolitanSectorState[], count: number): MetropolitanSectorState[] {
  const rng = new SeededRandom(`${seed}:map-district-seeds:v1:${administrativeDistrictId}`);
  const selected: MetropolitanSectorState[] = [];
  if (!sectors.length) return selected;
  selected.push(sectors[rng.integer(0, sectors.length - 1)]);
  while (selected.length < Math.min(count, sectors.length)) {
    let best = sectors[0];
    let bestScore = -Infinity;
    for (const sector of sectors) {
      if (selected.some((item) => item.id === sector.id)) continue;
      const distance = Math.min(...selected.map((item) => Math.abs(item.xIndex - sector.xIndex) + Math.abs(item.yIndex - sector.yIndex)));
      const score = distance + new SeededRandom(`${seed}:map-district-spread:${administrativeDistrictId}:${sector.id}`).next() * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = sector;
      }
    }
    selected.push(best);
  }
  return selected;
}

function uniqueMapDistrictName(seed: string, administrativeDistrict: DistrictState, index: number, used: Set<string>): string {
  const rng = new SeededRandom(`${seed}:map-district-name:${administrativeDistrict.id}:${index}`);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const name = `${MAP_DISTRICT_PREFIXES[(rng.integer(0, MAP_DISTRICT_PREFIXES.length - 1) + attempt) % MAP_DISTRICT_PREFIXES.length]} ${MAP_DISTRICT_SUFFIXES[(rng.integer(0, MAP_DISTRICT_SUFFIXES.length - 1) + attempt * 3) % MAP_DISTRICT_SUFFIXES.length]}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${administrativeDistrict.name} ${String(index + 1).padStart(2, "0")}`;
  used.add(fallback);
  return fallback;
}

function createMapDistricts(seed: string, sourceSectors: MetropolitanSectorState[], administrativeDistricts: DistrictState[]): { sectors: MetropolitanSectorState[]; mapDistricts: MapDistrictState[] } {
  const sectors = sourceSectors.map((sector) => ({ ...sector }));
  const byCoordinate = new Map(sectors.map((sector) => [sectorKey(sector.xIndex, sector.yIndex), sector]));
  const sectorIndex = new Map(sectors.map((sector, index) => [sector.id, index]));
  const usedNames = new Set<string>();
  const counts = neighborhoodCounts(sectors, administrativeDistricts);
  const mapDistricts: MapDistrictState[] = [];
  let globalIndex = 0;

  for (const administrativeDistrict of administrativeDistricts) {
    const local = sectors.filter((sector) => sector.districtId === administrativeDistrict.id);
    if (!local.length) continue;
    const count = counts.get(administrativeDistrict.id) ?? 1;
    const seeds = mapDistrictSeeds(seed, administrativeDistrict.id, local, count);
    const ownerBySectorId = new Map<string, number>();
    const queue: Array<{ sector: MetropolitanSectorState; owner: number }> = [];
    seeds.forEach((sector, owner) => {
      ownerBySectorId.set(sector.id, owner);
      queue.push({ sector, owner });
    });
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const { sector, owner } = queue[cursor];
      const neighbors = [
        byCoordinate.get(sectorKey(sector.xIndex - 1, sector.yIndex)),
        byCoordinate.get(sectorKey(sector.xIndex + 1, sector.yIndex)),
        byCoordinate.get(sectorKey(sector.xIndex, sector.yIndex - 1)),
        byCoordinate.get(sectorKey(sector.xIndex, sector.yIndex + 1))
      ].filter((item): item is MetropolitanSectorState => item !== undefined && item.districtId === administrativeDistrict.id);
      for (const neighbor of neighbors) {
        if (ownerBySectorId.has(neighbor.id)) continue;
        ownerBySectorId.set(neighbor.id, owner);
        queue.push({ sector: neighbor, owner });
      }
    }
    for (const sector of local) {
      if (ownerBySectorId.has(sector.id)) continue;
      const owner = seeds
        .map((item, index) => ({ index, distance: Math.abs(item.xIndex - sector.xIndex) + Math.abs(item.yIndex - sector.yIndex) }))
        .sort((left, right) => left.distance - right.distance || left.index - right.index)[0]?.index ?? 0;
      ownerBySectorId.set(sector.id, owner);
    }

    for (let localIndex = 0; localIndex < seeds.length; localIndex += 1) {
      const districtId = createStableEntityId("map-district", `${seed}:map-district:v1:${administrativeDistrict.id}:${localIndex}`);
      const districtSectors = local.filter((sector) => ownerBySectorId.get(sector.id) === localIndex);
      for (const sector of districtSectors) {
        const index = sectorIndex.get(sector.id);
        if (index !== undefined) sectors[index] = { ...sectors[index], mapDistrictId: districtId };
      }
      const bounds = boundsForSectors(districtSectors);
      const representedPopulation = districtSectors.reduce((sum, sector) => sum + sector.representedPopulation, 0);
      const averageCrowd = districtSectors.reduce((sum, sector) => sum + sector.crowdLoad, 0) / Math.max(1, districtSectors.length);
      const averageTraffic = districtSectors.reduce((sum, sector) => sum + sector.trafficLoad, 0) / Math.max(1, districtSectors.length);
      mapDistricts.push({
        id: districtId,
        name: uniqueMapDistrictName(seed, administrativeDistrict, localIndex, usedNames),
        code: `D-${String(globalIndex + 1).padStart(2, "0")}`,
        administrativeDistrictId: administrativeDistrict.id,
        bounds,
        center: {
          xM: districtSectors.reduce((sum, sector) => sum + sector.bounds.xM + sector.bounds.widthM / 2, 0) / Math.max(1, districtSectors.length),
          yM: districtSectors.reduce((sum, sector) => sum + sector.bounds.yM + sector.bounds.heightM / 2, 0) / Math.max(1, districtSectors.length)
        },
        sectorIds: districtSectors.map((sector) => sector.id),
        representedPopulation,
        dominantLandUse: dominantLandUseFor(districtSectors),
        transitScore: clamp(Math.round(administrativeDistrict.infrastructure * 0.72 + administrativeDistrict.employmentRate * 0.28)),
        activityScore: clamp(Math.round(averageCrowd * 0.62 + averageTraffic * 0.38 + administrativeDistrict.employmentRate * 0.18)),
        riskScore: clamp(Math.round((100 - administrativeDistrict.securityLevel) * 0.58 + administrativeDistrict.gangInfluence * 0.42))
      });
      globalIndex += 1;
    }
  }

  const fallbackDistrict = mapDistricts[0];
  return {
    sectors: sectors.map((sector) => sector.mapDistrictId || !fallbackDistrict ? sector : { ...sector, mapDistrictId: fallbackDistrict.id }),
    mapDistricts
  };
}

function refreshMapDistricts(existing: MapDistrictState[], sectors: MetropolitanSectorState[], administrativeDistricts: DistrictState[]): MapDistrictState[] {
  const administrativeById = new Map(administrativeDistricts.map((district) => [district.id, district]));
  return existing.flatMap((district) => {
    const local = sectors.filter((sector) => sector.mapDistrictId === district.id);
    const administrative = administrativeById.get(district.administrativeDistrictId);
    if (!local.length || !administrative) return [];
    const bounds = boundsForSectors(local);
    const averageCrowd = local.reduce((sum, sector) => sum + sector.crowdLoad, 0) / local.length;
    const averageTraffic = local.reduce((sum, sector) => sum + sector.trafficLoad, 0) / local.length;
    return [{
      ...district,
      bounds,
      center: {
        xM: local.reduce((sum, sector) => sum + sector.bounds.xM + sector.bounds.widthM / 2, 0) / local.length,
        yM: local.reduce((sum, sector) => sum + sector.bounds.yM + sector.bounds.heightM / 2, 0) / local.length
      },
      sectorIds: local.map((sector) => sector.id),
      representedPopulation: local.reduce((sum, sector) => sum + sector.representedPopulation, 0),
      dominantLandUse: dominantLandUseFor(local),
      transitScore: clamp(Math.round(administrative.infrastructure * 0.72 + administrative.employmentRate * 0.28)),
      activityScore: clamp(Math.round(averageCrowd * 0.62 + averageTraffic * 0.38 + administrative.employmentRate * 0.18)),
      riskScore: clamp(Math.round((100 - administrative.securityLevel) * 0.58 + administrative.gangInfluence * 0.42))
    }];
  });
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
  const spacing = 2;
  const byGrid = new Map<string, RoadNodeState>();
  const sectorAt = (xM: number, yM: number) => sectors.find((sector) =>
    sector.xIndex === Math.min(cfg.sectorsWide - 1, Math.max(0, Math.floor(xM / cfg.sectorSizeM)))
    && sector.yIndex === Math.min(cfg.sectorsHigh - 1, Math.max(0, Math.floor(yM / cfg.sectorSizeM)))
  ) ?? sectors[0];

  for (let yIndex = 0; yIndex <= cfg.sectorsHigh; yIndex += spacing) {
    for (let xIndex = 0; xIndex <= cfg.sectorsWide; xIndex += spacing) {
      const edge = xIndex === 0 || yIndex === 0 || xIndex === cfg.sectorsWide || yIndex === cfg.sectorsHigh;
      const rng = new SeededRandom(`${seed}:road-node:v2:${xIndex}:${yIndex}`);
      const xM = clamp(xIndex * cfg.sectorSizeM + (edge ? 0 : rng.integer(-240, 240)), 0, cfg.widthM);
      const yM = clamp(yIndex * cfg.sectorSizeM + (edge ? 0 : rng.integer(-240, 240)), 0, cfg.heightM);
      const sector = sectorAt(xM, yM);
      const node: RoadNodeState = {
        id: createStableEntityId("road-node", `${seed}:v2:${xIndex}:${yIndex}`),
        sectorId: sector.id,
        xM,
        yM,
        kind: edge ? "district-gate" : (xIndex + yIndex) % 12 === 0 ? "interchange" : "intersection"
      };
      nodes.push(node);
      byGrid.set(sectorKey(xIndex, yIndex), node);
    }
  }

  const addLink = (from: RoadNodeState, to: RoadNodeState, className: RoadLinkState["class"], name: string, scope: string): void => {
    const corridorId = createStableEntityId("road-corridor", `${seed}:road-corridor:v2:${scope}`);
    const lengthM = Math.round(Math.hypot(to.xM - from.xM, to.yM - from.yM));
    const fromSector = sectors.find((sector) => sector.id === from.sectorId);
    const toSector = sectors.find((sector) => sector.id === to.sectorId);
    const baseTraffic = ((fromSector?.trafficLoad ?? 0) + (toSector?.trafficLoad ?? 0)) / 2;
    const classLoad = className === "expressway" ? 18 : className === "arterial" ? 10 : className === "collector" ? 4 : 0;
    const districtIds = [...new Set([fromSector?.districtId, toSector?.districtId].filter((value): value is string => Boolean(value)))];
    links.push({
      id: createStableEntityId("road-link", `${seed}:road-link:v2:${from.id}:${to.id}`),
      corridorId,
      name,
      fromNodeId: from.id,
      toNodeId: to.id,
      class: className,
      lengthM,
      lanes: className === "expressway" ? 8 : className === "arterial" ? 6 : className === "collector" ? 4 : 2,
      capacityPerHour: className === "expressway" ? 10_800 : className === "arterial" ? 6_800 : className === "collector" ? 3_400 : 1_600,
      speedLimitKph: className === "expressway" ? 105 : className === "arterial" ? 72 : className === "collector" ? 52 : 36,
      trafficLoad: clamp(Math.round(baseTraffic + classLoad)),
      districtIds
    });
  };

  const horizontalNames = ["NORTH TRACE", "CROWN WAY", "NEON SPINE", "FOUNDRY ARC", "SOUTH BELT", "HARBOR RUN", "LOWLINE"];
  const verticalNames = ["WEST GATE", "SILT AVENUE", "MERIDIAN", "GLASS ROAD", "EAST LINK", "FREIGHT WAY", "OUTER TRACE"];
  for (let yIndex = 0; yIndex <= cfg.sectorsHigh; yIndex += spacing) {
    for (let xIndex = 0; xIndex < cfg.sectorsWide; xIndex += spacing) {
      const from = byGrid.get(sectorKey(xIndex, yIndex));
      const to = byGrid.get(sectorKey(Math.min(cfg.sectorsWide, xIndex + spacing), yIndex));
      if (!from || !to) continue;
      const className: RoadLinkState["class"] = [8, 18, 28].includes(yIndex) ? "expressway" : yIndex % 6 === 0 ? "arterial" : "collector";
      const corridorIndex = Math.round(yIndex / 6) % horizontalNames.length;
      addLink(from, to, className, horizontalNames[corridorIndex], `horizontal:${yIndex}`);
    }
  }
  for (let xIndex = 0; xIndex <= cfg.sectorsWide; xIndex += spacing) {
    for (let yIndex = 0; yIndex < cfg.sectorsHigh; yIndex += spacing) {
      const from = byGrid.get(sectorKey(xIndex, yIndex));
      const to = byGrid.get(sectorKey(xIndex, Math.min(cfg.sectorsHigh, yIndex + spacing)));
      if (!from || !to) continue;
      const className: RoadLinkState["class"] = [10, 24, 36].includes(xIndex) ? "expressway" : xIndex % 6 === 0 ? "arterial" : "collector";
      const corridorIndex = Math.round(xIndex / 6) % verticalNames.length;
      addLink(from, to, className, verticalNames[corridorIndex], `vertical:${xIndex}`);
    }
  }

  const diagonalPairs: Array<[string, Array<[number, number]>]> = [
    ["RED DIAGONAL", Array.from({ length: 18 }, (_, index) => [Math.min(cfg.sectorsWide, index * 2), Math.min(cfg.sectorsHigh, index * 2)] as [number, number])],
    ["CROSSCITY CUT", Array.from({ length: 18 }, (_, index) => [Math.min(cfg.sectorsWide, index * 2 + 6), Math.max(0, cfg.sectorsHigh - index * 2)] as [number, number])]
  ];
  for (const [name, points] of diagonalPairs) {
    const unique = points.filter(([xIndex, yIndex], index) => index === 0 || xIndex !== points[index - 1][0] || yIndex !== points[index - 1][1]);
    for (let index = 1; index < unique.length; index += 1) {
      const from = byGrid.get(sectorKey(unique[index - 1][0], unique[index - 1][1]));
      const to = byGrid.get(sectorKey(unique[index][0], unique[index][1]));
      if (from && to) addLink(from, to, "arterial", name, `diagonal:${name}`);
    }
  }
  return { nodes, links };
}

function createTransit(seed: string, sectors: MetropolitanSectorState[], mapDistricts: MapDistrictState[]): { stations: TransitStationState[]; lines: TransitLineState[] } {
  const stations: TransitStationState[] = [];
  const lines: TransitLineState[] = [];
  const stationByCoordinate = new Map<string, TransitStationState>();
  const cfg = config();
  const sectorAt = (xM: number, yM: number) => sectors.find((sector) =>
    sector.xIndex === Math.min(cfg.sectorsWide - 1, Math.max(0, Math.floor(xM / cfg.sectorSizeM)))
    && sector.yIndex === Math.min(cfg.sectorsHigh - 1, Math.max(0, Math.floor(yM / cfg.sectorSizeM)))
  ) ?? sectors[0];
  const stationAt = (lineId: string, scope: string, xM: number, yM: number, index: number): TransitStationState => {
    const key = `${Math.round(xM / 250)}:${Math.round(yM / 250)}`;
    const existing = stationByCoordinate.get(key);
    if (existing) {
      if (!existing.lineIds.includes(lineId)) existing.lineIds.push(lineId);
      return existing;
    }
    const sector = sectorAt(xM, yM);
    const mapDistrict = mapDistricts.find((district) => district.id === sector.mapDistrictId);
    const station: TransitStationState = {
      id: createStableEntityId("transit-station", `${seed}:transit-station:v2:${scope}:${index}`),
      name: `${mapDistrict?.name ?? sector.code} ${String(index + 1).padStart(2, "0")}`,
      sectorId: sector.id,
      districtId: sector.districtId,
      xM,
      yM,
      lineIds: [lineId],
      dailyCapacity: 68_000
    };
    stations.push(station);
    stationByCoordinate.set(key, station);
    return station;
  };

  const definitions: Array<{
    scope: string;
    name: string;
    mode: TransitLineState["mode"];
    capacity: number;
    points: Array<{ xM: number; yM: number }>;
  }> = [
    {
      scope: "red-spine",
      name: "RED SPINE",
      mode: "metro",
      capacity: 760_000,
      points: Array.from({ length: 11 }, (_, index) => ({ xM: 1_000 + index * 4_000, yM: 18_000 + Math.round(Math.sin(index * 0.8) * 700) }))
    },
    {
      scope: "crown-elevated",
      name: "CROWN ELEVATED",
      mode: "elevated",
      capacity: 420_000,
      points: Array.from({ length: 10 }, (_, index) => ({ xM: 3_000 + index * 4_000, yM: 7_000 + Math.round(Math.sin(index * 0.65 + 1.2) * 500) }))
    },
    {
      scope: "harbor-line",
      name: "HARBOR LINE",
      mode: "regional-rail",
      capacity: 510_000,
      points: Array.from({ length: 10 }, (_, index) => ({ xM: 3_000 + index * 4_000, yM: 29_000 + Math.round(Math.sin(index * 0.7) * 650) }))
    },
    {
      scope: "meridian",
      name: "MERIDIAN METRO",
      mode: "metro",
      capacity: 640_000,
      points: Array.from({ length: 9 }, (_, index) => ({ xM: 14_000 + Math.round(Math.sin(index * 0.75) * 550), yM: 2_000 + index * 4_000 }))
    },
    {
      scope: "east-link",
      name: "EAST LINK",
      mode: "elevated",
      capacity: 390_000,
      points: Array.from({ length: 9 }, (_, index) => ({ xM: 32_000 + Math.round(Math.sin(index * 0.6 + 2) * 600), yM: 2_000 + index * 4_000 }))
    },
    {
      scope: "foundry-freight",
      name: "FOUNDRY FREIGHT",
      mode: "freight",
      capacity: 260_000,
      points: Array.from({ length: 9 }, (_, index) => ({ xM: 5_000 + index * 4_000, yM: 34_000 - Math.round(index * 2_800) }))
    }
  ];

  for (const definition of definitions) {
    const lineId = createStableEntityId("transit-line", `${seed}:transit-line:v2:${definition.scope}`);
    const lineStations = definition.points.map((point, index) => stationAt(lineId, definition.scope, clamp(point.xM, 0, cfg.widthM), clamp(point.yM, 0, cfg.heightM), index));
    const lengthM = lineStations.slice(1).reduce((sum, station, index) => sum + Math.hypot(station.xM - lineStations[index].xM, station.yM - lineStations[index].yM), 0);
    lines.push({
      id: lineId,
      name: definition.name,
      mode: definition.mode,
      stationIds: lineStations.map((station) => station.id),
      lengthM: Math.round(lengthM),
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
  return districts.flatMap((district) => {
    const local = sectors.filter((sector) => sector.districtId === district.id);
    if (!local.length) return [];
    const bounds = boundsForSectors(local);
    const representedPopulation = local.reduce((sum, sector) => sum + sector.representedPopulation, 0);
    const areaKm2 = Math.max(1, local.length);
    return [{
      districtId: district.id,
      bounds,
      center: {
        xM: local.reduce((sum, sector) => sum + sector.bounds.xM + sector.bounds.widthM / 2, 0) / local.length,
        yM: local.reduce((sum, sector) => sum + sector.bounds.yM + sector.bounds.heightM / 2, 0) / local.length
      },
      representedPopulation,
      densityPerKm2: Math.round(representedPopulation / areaKm2),
      sectorIds: local.map((sector) => sector.id),
      dominantLandUse: dominantLandUseFor(local),
      transitScore: clamp(Math.round(district.infrastructure * 0.72 + district.employmentRate * 0.28)),
      verticality: clamp(Math.round(district.costOfLiving * 0.45 + district.corporateInfluence * 0.35 + district.infrastructure * 0.2))
    }];
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
  const generatedSectors = createSectors(input.seed, input.timestamp, input.districts, input.representedPopulationByDistrict);
  const mapped = createMapDistricts(input.seed, generatedSectors, input.districts);
  const locations = placeLocations(input.seed, mapped.sectors, input.locations);
  const roads = createRoadNetwork(input.seed, mapped.sectors);
  const transit = createTransit(input.seed, mapped.sectors, mapped.mapDistricts);
  const focusPlacement = locations.find((item) => item.locationId === input.targetLocationId)
    ?? locations.find((item) => item.locationId === input.activeLocationId)
    ?? locations[0];
  const focus = mapped.sectors.find((sector) => sector.id === focusPlacement?.sectorId) ?? mapped.sectors[0];
  const streaming = streamingState(cfg, focus, mapped.sectors);
  const nextSectors = mapped.sectors.map((sector) => ({
    ...sector,
    detailLevel: streaming.activeSectorIds.includes(sector.id) ? "active" as const : streaming.warmSectorIds.includes(sector.id) ? "warm" as const : "cold" as const,
    materializedResidentCount: streaming.activeSectorIds.includes(sector.id) ? Math.max(4, Math.round(sector.representedPopulation / 1_800)) : 0,
    materializedInteriorCount: streaming.activeSectorIds.includes(sector.id) ? 2 : 0
  }));
  const base = {
    version: 2 as const,
    config: cfg,
    districts: districtSpatialStates(input.districts, nextSectors),
    mapDistricts: refreshMapDistricts(mapped.mapDistricts, nextSectors, input.districts),
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

function refreshRoadTraffic(links: RoadLinkState[], nodes: RoadNodeState[], sectors: MetropolitanSectorState[]): RoadLinkState[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sectorById = new Map(sectors.map((sector) => [sector.id, sector]));
  return links.map((link) => {
    const fromSector = sectorById.get(nodeById.get(link.fromNodeId)?.sectorId ?? "");
    const toSector = sectorById.get(nodeById.get(link.toNodeId)?.sectorId ?? "");
    const average = ((fromSector?.trafficLoad ?? 0) + (toSector?.trafficLoad ?? 0)) / 2;
    const capacityRelief = link.class === "expressway" ? 12 : link.class === "arterial" ? 6 : link.class === "collector" ? 2 : 0;
    return { ...link, trafficLoad: clamp(Math.round(average - capacityRelief)) };
  });
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
    mapDistricts: refreshMapDistricts(state.mapDistricts, sectors, input.districts),
    sectors,
    roadLinks: refreshRoadTraffic(state.roadLinks, state.roadNodes, sectors),
    archive: compacted.archive,
    streaming: compacted.streaming,
    lastUpdatedAt: input.timestamp
  };
  const next = { ...base, totals: totalsFor(base) };
  return { state: next, compactedEventBudget: compacted.eventBudget, compactedObservationBudget: compacted.observationBudget };
}

export function normalizeMetropolitanState(value: unknown, input: MetropolitanAdvanceInput): MetropolitanState {
  if (!value || typeof value !== "object") return createMetropolitanState(input);
  const raw = value as Partial<MetropolitanState> & { version?: number };
  if (![1, 2].includes(raw.version ?? 0) || !Array.isArray(raw.sectors) || !Array.isArray(raw.locations) || !raw.config || !raw.streaming) {
    return createMetropolitanState(input);
  }
  const requiredSectors = raw.config.sectorsWide * raw.config.sectorsHigh;
  if (raw.sectors.length !== requiredSectors || raw.config.widthM !== CITY_WIDTH_M || raw.config.heightM !== CITY_HEIGHT_M) {
    return createMetropolitanState(input);
  }

  const rawSectors = raw.sectors.map((sector) => ({
    ...sector,
    mapDistrictId: typeof (sector as MetropolitanSectorState & { mapDistrictId?: string }).mapDistrictId === "string"
      ? (sector as MetropolitanSectorState & { mapDistrictId: string }).mapDistrictId
      : ""
  }));
  const hasValidMapDistricts = Array.isArray(raw.mapDistricts)
    && raw.mapDistricts.length > 0
    && rawSectors.every((sector) => raw.mapDistricts?.some((district) => district.id === sector.mapDistrictId));
  const mapped = hasValidMapDistricts
    ? { sectors: rawSectors, mapDistricts: raw.mapDistricts as MapDistrictState[] }
    : createMapDistricts(input.seed, rawSectors, input.districts);

  const hasCurrentRoadGraph = Array.isArray(raw.roadNodes)
    && Array.isArray(raw.roadLinks)
    && raw.roadNodes.length >= 200
    && raw.roadLinks.every((link) => typeof (link as RoadLinkState).corridorId === "string" && typeof (link as RoadLinkState).trafficLoad === "number");
  const roads = hasCurrentRoadGraph
    ? { nodes: raw.roadNodes as RoadNodeState[], links: raw.roadLinks as RoadLinkState[] }
    : createRoadNetwork(input.seed, mapped.sectors);
  const hasCurrentTransit = Array.isArray(raw.transitStations)
    && Array.isArray(raw.transitLines)
    && raw.transitLines.length >= 5
    && raw.transitLines.every((line) => line.stationIds.length >= 5);
  const transit = hasCurrentTransit
    ? { stations: raw.transitStations as TransitStationState[], lines: raw.transitLines as TransitLineState[] }
    : createTransit(input.seed, mapped.sectors, mapped.mapDistricts);

  const normalized: MetropolitanState = {
    version: 2,
    config: { ...config(), ...raw.config, seedVersion: 1 },
    districts: districtSpatialStates(input.districts, mapped.sectors),
    mapDistricts: refreshMapDistricts(mapped.mapDistricts, mapped.sectors, input.districts),
    sectors: mapped.sectors,
    locations: raw.locations,
    roadNodes: roads.nodes,
    roadLinks: roads.links,
    transitStations: transit.stations,
    transitLines: transit.lines,
    deltas: Array.isArray(raw.deltas) ? raw.deltas : [],
    archive: Array.isArray(raw.archive) ? raw.archive : [],
    streaming: raw.streaming,
    totals: raw.totals ?? {
      sectors: mapped.sectors.length,
      representedPopulation: 0,
      estimatedBuildings: 0,
      estimatedFloorAreaM2: 0,
      roadLengthM: 0,
      transitLengthM: 0,
      persistentDeltas: 0,
      archiveSummaries: 0
    },
    lastUpdatedAt: Math.min(typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp - 1, input.timestamp - 1)
  };
  return advanceMetropolitanState(normalized, input).state;
}

export function sectorForLocation(state: MetropolitanState, locationId: string): MetropolitanSectorState | null {
  const placement = state.locations.find((item) => item.locationId === locationId);
  return placement ? state.sectors.find((sector) => sector.id === placement.sectorId) ?? null : null;
}
