import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BusinessKind, BusinessState, BusinessStatus, LocalEconomyState } from "../../gameplay/economy/types";
import type { DistrictPulseState } from "../../world/city/districtPulse";
import type { CityState, DistrictState, LocationState, OrganizationState } from "../../world/state/types";
import { kernelSystemEntityId } from "../kernel/simulationKernel";
import type { KernelResource, KernelTransactionDraft } from "../kernel/types";
import type { BackgroundResident, HouseholdState, PopulationState, ResidentHealth } from "../population/types";
import type {
  InfrastructureAdvanceResult,
  InfrastructureBudgetDelta,
  InfrastructureIncident,
  InfrastructureKind,
  InfrastructureLinkState,
  InfrastructureMaintenanceOrder,
  InfrastructureNetworkState,
  InfrastructureNodeState,
  InfrastructureNotice,
  InfrastructureServiceState,
  InfrastructureState,
  InfrastructureStatus,
  InfrastructureTotals
} from "./types";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const KINDS: readonly InfrastructureKind[] = ["power", "water", "data", "transport", "waste"];

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function statusFor(level: number): InfrastructureStatus {
  if (level < 20) return "offline";
  if (level < 45) return "restricted";
  if (level < 70) return "strained";
  return "stable";
}

function businessStatusFor(level: number, current: BusinessStatus): BusinessStatus {
  if (level < 20) return "closed";
  if (level < 45) return current === "closed" ? current : "restricted";
  if (level < 70) return current === "closed" || current === "restricted" ? current : "strained";
  return current;
}

function resourceFor(kind: InfrastructureKind): KernelResource {
  if (kind === "power") return "energy-units";
  if (kind === "water") return "water-units";
  if (kind === "transport") return "transport-capacity";
  if (kind === "waste") return "waste-capacity";
  return "data-capacity";
}

export function infrastructureGridAccount(seed: string, kind: InfrastructureKind): string {
  return kernelSystemEntityId(seed, `${kind}-grid`);
}

function providerFor(kind: InfrastructureKind, city: CityState, organizations: OrganizationState[]): string {
  if (kind === "transport") return organizations.find((item) => item.type === "transport")?.id ?? city.id;
  if (kind === "power" || kind === "data") return organizations.find((item) => item.type === "corporation")?.id ?? city.id;
  return city.id;
}

function dependency(kind: InfrastructureKind, location: LocationState): number {
  const type = location.type;
  if (kind === "power") {
    if (type === "clinic" || type === "office") return 32;
    if (type === "workshop" || type === "transport") return 27;
    if (type === "housing") return 20;
    return 16;
  }
  if (kind === "water") {
    if (type === "clinic") return 28;
    if (type === "food") return 24;
    if (type === "housing") return 18;
    if (type === "workshop") return 11;
    return 7;
  }
  if (kind === "data") {
    if (type === "office") return 30;
    if (type === "clinic" || type === "transport") return 22;
    if (type === "market" || type === "workshop") return 14;
    return 9;
  }
  if (kind === "transport") {
    if (type === "transport") return 34;
    if (type === "market" || type === "office" || type === "workshop") return 18;
    if (type === "housing") return 15;
    return 11;
  }
  if (type === "housing" || type === "market" || type === "food") return 18;
  if (type === "clinic" || type === "workshop") return 16;
  return 8;
}

function priorityFor(location: LocationState): number {
  if (location.type === "clinic") return 100;
  if (location.type === "transport") return 92;
  if (location.type === "housing") return 82;
  if (location.type === "food") return 76;
  if (location.type === "market") return 68;
  if (location.type === "workshop") return 64;
  return 58;
}

function demandScale(
  kind: InfrastructureKind,
  location: LocationState,
  population: PopulationState,
  economy: LocalEconomyState
): number {
  const households = population.households.filter((item) => item.homeLocationId === location.id);
  const residents = households.reduce((sum, item) => sum + item.memberIds.length, 0);
  const business = economy.businesses.find((item) => item.locationId === location.id);
  const householdScale = location.type === "housing" ? 1 + residents / 18 : 1;
  const businessScale = business ? 0.8 + business.capacityLevel * 0.15 + business.demand / 180 : 1;
  const kindScale = kind === "transport" ? 1.1 : kind === "data" && location.type === "office" ? 1.2 : 1;
  return dependency(kind, location) * householdScale * businessScale * kindScale;
}

function networkId(seed: string, kind: InfrastructureKind): string {
  return createStableEntityId("infrastructure-network", `${seed}:${kind}`);
}

function nodeId(seed: string, kind: InfrastructureKind, scope: string): string {
  return createStableEntityId("infrastructure-node", `${seed}:${kind}:${scope}`);
}

function serviceId(seed: string, kind: InfrastructureKind, locationId: string): string {
  return createStableEntityId("infrastructure-service", `${seed}:${kind}:${locationId}`);
}

function emptyTotals(): InfrastructureTotals {
  return { generatedUnits: 0, deliveredUnits: 0, unmetUnits: 0, serviceRevenue: 0, maintenanceSpent: 0, maintenanceCompleted: 0, incidents: 0, outageHours: 0 };
}

export function createInfrastructureState(
  seed: string,
  timestamp: number,
  city: CityState,
  districts: DistrictState[],
  locations: LocationState[],
  organizations: OrganizationState[],
  population: PopulationState,
  economy: LocalEconomyState
): InfrastructureState {
  const services: InfrastructureServiceState[] = [];
  const networks: InfrastructureNetworkState[] = [];
  const nodes: InfrastructureNodeState[] = [];
  const links: InfrastructureLinkState[] = [];

  for (const kind of KINDS) {
    const id = networkId(seed, kind);
    const providerEntityId = providerFor(kind, city, organizations);
    const rng = new SeededRandom(`${seed}:infrastructure:${kind}`);
    const kindServices = locations.map((location) => {
      const baseDemand = round(demandScale(kind, location, population, economy));
      return {
        id: serviceId(seed, kind, location.id),
        networkId: id,
        kind,
        districtId: location.districtId,
        locationId: location.id,
        baseDemand,
        currentDemand: baseDemand,
        supplied: baseDemand,
        serviceLevel: 100,
        priority: priorityFor(location),
        status: "stable" as const,
        consecutiveDeficitHours: 0,
        lastUpdatedAt: timestamp
      };
    });
    services.push(...kindServices);
    const totalDemand = kindServices.reduce((sum, item) => sum + item.baseDemand, 0);
    const sourceCondition = clamp(Math.round(districts.reduce((sum, item) => sum + item.infrastructure, 0) / Math.max(1, districts.length)) + rng.integer(-8, 6));
    const totalCapacity = round(totalDemand * (1.08 + sourceCondition / 400));
    const sourceId = nodeId(seed, kind, "source");
    nodes.push({
      id: sourceId,
      networkId: id,
      kind,
      role: "source",
      name: `${kind.toUpperCase()} PRIMARY PLANT`,
      providerEntityId,
      capacity: totalCapacity,
      throughput: totalDemand,
      condition: sourceCondition,
      load: round(totalDemand / Math.max(1, totalCapacity) * 100),
      staffing: clamp(72 + rng.integer(-12, 14)),
      maintenanceBacklog: 0,
      status: statusFor(sourceCondition),
      lastMaintainedAt: timestamp,
      lastUpdatedAt: timestamp
    });

    for (const district of districts) {
      const districtDemand = kindServices.filter((item) => item.districtId === district.id).reduce((sum, item) => sum + item.baseDemand, 0);
      const hubId = nodeId(seed, kind, district.id);
      const condition = clamp(Math.round((sourceCondition + district.infrastructure) / 2) + rng.integer(-7, 7));
      const capacity = round(districtDemand * (0.94 + district.infrastructure / 320));
      nodes.push({
        id: hubId,
        networkId: id,
        kind,
        role: "district-hub",
        name: `${district.code} ${kind.toUpperCase()} HUB`,
        providerEntityId,
        districtId: district.id,
        capacity,
        throughput: districtDemand,
        condition,
        load: round(districtDemand / Math.max(1, capacity) * 100),
        staffing: clamp(66 + district.infrastructure * 0.22 + rng.integer(-10, 10)),
        maintenanceBacklog: 0,
        status: statusFor(condition),
        lastMaintainedAt: timestamp,
        lastUpdatedAt: timestamp
      });
      links.push({
        id: createStableEntityId("infrastructure-link", `${seed}:${kind}:${district.id}`),
        networkId: id,
        kind,
        sourceNodeId: sourceId,
        targetNodeId: hubId,
        districtId: district.id,
        capacity: round(capacity * 1.04),
        throughput: districtDemand,
        condition: clamp(condition + rng.integer(-5, 6)),
        lossRate: round(Math.max(0.01, (100 - district.infrastructure) / 850)),
        status: statusFor(condition),
        lastUpdatedAt: timestamp
      });
    }

    networks.push({
      id,
      kind,
      providerEntityId,
      reserveFund: Math.round(8_000 + totalDemand * rng.integer(25, 55)),
      tariffPerUnit: kind === "power" ? 0.11 : kind === "water" ? 0.08 : kind === "data" ? 0.06 : kind === "transport" ? 0.09 : 0.05,
      status: statusFor(sourceCondition),
      totalCapacity,
      totalDemand,
      totalDelivered: totalDemand,
      unmetDemand: 0,
      averageServiceLevel: 100,
      outageHours: 0,
      lastUpdatedAt: timestamp
    });
  }

  return {
    version: 1,
    networks,
    nodes,
    links,
    services,
    maintenance: [],
    incidents: [],
    totals: emptyTotals(),
    hourIndex: Math.floor(timestamp / HOUR_MS),
    dayIndex: Math.floor(timestamp / DAY_MS),
    simulatedHours: 0,
    lastUpdatedAt: timestamp
  };
}

export function normalizeInfrastructureState(
  value: unknown,
  seed: string,
  timestamp: number,
  city: CityState,
  districts: DistrictState[],
  locations: LocationState[],
  organizations: OrganizationState[],
  population: PopulationState,
  economy: LocalEconomyState
): InfrastructureState {
  const fresh = createInfrastructureState(seed, timestamp, city, districts, locations, organizations, population, economy);
  if (!value || typeof value !== "object") return fresh;
  const raw = value as Partial<InfrastructureState>;
  if (raw.version !== 1 || !Array.isArray(raw.networks) || !Array.isArray(raw.services)) return fresh;
  return {
    ...fresh,
    ...raw,
    networks: fresh.networks.map((base) => ({ ...base, ...(raw.networks?.find((item) => item.id === base.id) ?? {}) })),
    nodes: fresh.nodes.map((base) => ({ ...base, ...(raw.nodes?.find((item) => item.id === base.id) ?? {}) })),
    links: fresh.links.map((base) => ({ ...base, ...(raw.links?.find((item) => item.id === base.id) ?? {}) })),
    services: fresh.services.map((base) => ({ ...base, ...(raw.services?.find((item) => item.id === base.id) ?? {}) })),
    maintenance: Array.isArray(raw.maintenance) ? raw.maintenance : [],
    incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
    totals: { ...fresh.totals, ...(raw.totals ?? {}) }
  };
}

function peakFactor(hour: number, kind: InfrastructureKind): number {
  if (kind === "transport") return hour >= 6 && hour <= 9 || hour >= 16 && hour <= 20 ? 1.34 : hour <= 4 ? 0.55 : 0.82;
  if (kind === "power") return hour >= 17 && hour <= 23 ? 1.24 : hour <= 5 ? 0.78 : 1;
  if (kind === "water") return hour >= 5 && hour <= 9 || hour >= 18 && hour <= 22 ? 1.2 : 0.9;
  if (kind === "data") return hour >= 8 && hour <= 23 ? 1.16 : 0.7;
  return hour >= 18 && hour <= 23 ? 1.12 : 0.9;
}

function staffFactor(providerId: string, organizations: OrganizationState[], staffing: number): number {
  const organization = organizations.find((item) => item.id === providerId);
  const budgetFactor = organization ? clamp(organization.budget / 4_000_000 * 100, 45, 100) / 100 : 0.88;
  return Math.min(1, budgetFactor * clamp(staffing, 25, 100) / 100 + 0.18);
}

function targetCondition(
  targetKind: "node" | "link",
  targetId: string,
  nodes: InfrastructureNodeState[],
  links: InfrastructureLinkState[]
): number {
  return targetKind === "node" ? nodes.find((item) => item.id === targetId)?.condition ?? 100 : links.find((item) => item.id === targetId)?.condition ?? 100;
}

function pushBudgetDelta(deltas: InfrastructureBudgetDelta[], organizationId: string | undefined, delta: number): void {
  if (!organizationId || !delta) return;
  const current = deltas.find((item) => item.organizationId === organizationId);
  if (current) current.delta += delta;
  else deltas.push({ organizationId, delta });
}

function requiredKinds(kind: BusinessKind): readonly InfrastructureKind[] {
  if (kind === "medical") return ["power", "water", "data", "waste"];
  if (kind === "food-service") return ["power", "water", "waste"];
  if (kind === "repair") return ["power", "data", "transport"];
  if (kind === "logistics") return ["transport", "data", "power"];
  if (kind === "corporate") return ["power", "data", "transport"];
  return ["power", "data", "transport"];
}

export function getLocationServiceLevel(state: InfrastructureState, locationId: string, kind: InfrastructureKind): number {
  return state.services.find((item) => item.locationId === locationId && item.kind === kind)?.serviceLevel ?? 100;
}

export function getDistrictServiceLevel(state: InfrastructureState, districtId: string, kind: InfrastructureKind): number {
  const services = state.services.filter((item) => item.districtId === districtId && item.kind === kind);
  if (!services.length) return 100;
  return Math.round(services.reduce((sum, item) => sum + item.serviceLevel, 0) / services.length);
}

function applyInfrastructureToEconomy(economy: LocalEconomyState, state: InfrastructureState, daysAdvanced: number): LocalEconomyState {
  return {
    ...economy,
    businesses: economy.businesses.map((business) => {
      const levels = requiredKinds(business.kind).map((kind) => getLocationServiceLevel(state, business.locationId, kind));
      const level = levels.length ? Math.min(...levels) : 100;
      const coldChainLoss = daysAdvanced > 0 && (business.kind === "retail" || business.kind === "food-service" || business.kind === "medical") && getLocationServiceLevel(state, business.locationId, "power") < 45
        ? Math.min(18, daysAdvanced * 4)
        : 0;
      return {
        ...business,
        infrastructureServiceLevel: level,
        stock: clamp(business.stock - coldChainLoss),
        shortage: business.shortage || coldChainLoss > 0,
        status: businessStatusFor(level, business.status)
      };
    })
  };
}

function healthFor(score: number): ResidentHealth {
  if (score <= 25) return "disabled";
  if (score <= 48) return "ill";
  if (score <= 68) return "strained";
  return "healthy";
}

function applyInfrastructureToPopulation(
  population: PopulationState,
  state: InfrastructureState,
  daysAdvanced: number
): PopulationState {
  if (daysAdvanced <= 0) {
    return {
      ...population,
      residents: population.residents.map((resident) => ({
        ...resident,
        transportAccess: getDistrictServiceLevel(state, resident.districtId, "transport")
      }))
    };
  }
  const householdById = new Map(population.households.map((item) => [item.id, item]));
  return {
    ...population,
    residents: population.residents.map((resident) => {
      const household = householdById.get(resident.householdId);
      const home = household?.homeLocationId;
      const power = home ? getLocationServiceLevel(state, home, "power") : 20;
      const water = home ? getLocationServiceLevel(state, home, "water") : 15;
      const waste = home ? getLocationServiceLevel(state, home, "waste") : 20;
      const deficit = [power, water, waste].reduce((sum, level) => sum + Math.max(0, 55 - level), 0) / 55;
      const penalty = Math.min(8, Math.round(deficit * daysAdvanced * 1.4));
      const score = clamp(resident.healthScore - penalty);
      return {
        ...resident,
        healthScore: score,
        health: healthFor(score),
        transportAccess: getDistrictServiceLevel(state, resident.districtId, "transport")
      };
    })
  };
}

function createMaintenanceOrders(
  state: InfrastructureState,
  timestamp: number,
  seed: string
): InfrastructureMaintenanceOrder[] {
  const activeTargets = new Set(state.maintenance.filter((item) => item.status === "open" || item.status === "in-progress").map((item) => item.targetId));
  const orders = [...state.maintenance];
  for (const node of state.nodes) {
    if (node.condition >= 68 || activeTargets.has(node.id)) continue;
    const severity = Math.max(1, Math.round((72 - node.condition) / 8));
    orders.push({
      id: createStableEntityId("maintenance-order", `${seed}:node:${node.id}:${Math.floor(timestamp / DAY_MS)}`),
      networkId: node.networkId,
      kind: node.kind,
      targetKind: "node",
      targetId: node.id,
      providerEntityId: node.providerEntityId,
      status: "open",
      createdAt: timestamp,
      dueAt: timestamp + Math.max(6, 36 - severity * 4) * HOUR_MS,
      creditsCost: 260 + severity * 190,
      partsCost: 2 + severity * 2,
      laborHours: 4 + severity * 3,
      completedLaborHours: 0,
      conditionRestored: 10 + severity * 5
    });
  }
  for (const link of state.links) {
    if (link.condition >= 62 || activeTargets.has(link.id)) continue;
    const severity = Math.max(1, Math.round((68 - link.condition) / 8));
    const provider = state.networks.find((item) => item.id === link.networkId)?.providerEntityId ?? "provider-missing";
    orders.push({
      id: createStableEntityId("maintenance-order", `${seed}:link:${link.id}:${Math.floor(timestamp / DAY_MS)}`),
      networkId: link.networkId,
      kind: link.kind,
      targetKind: "link",
      targetId: link.id,
      providerEntityId: provider,
      status: "open",
      createdAt: timestamp,
      dueAt: timestamp + Math.max(8, 42 - severity * 4) * HOUR_MS,
      creditsCost: 180 + severity * 150,
      partsCost: 1 + severity * 2,
      laborHours: 3 + severity * 3,
      completedLaborHours: 0,
      conditionRestored: 9 + severity * 5
    });
  }
  return orders.slice(-400);
}

function updateIncident(
  incidents: InfrastructureIncident[],
  service: InfrastructureServiceState,
  timestamp: number,
  seed: string
): InfrastructureIncident[] {
  const active = incidents.find((item) => item.networkId === service.networkId && item.districtId === service.districtId && item.status === "active");
  if (service.serviceLevel < 26 && service.consecutiveDeficitHours >= 8) {
    if (active) return incidents;
    const incidentRng = new SeededRandom(`${seed}:incident:${service.networkId}:${service.districtId}:${Math.floor(timestamp / HOUR_MS)}`);
    if (!incidentRng.chance(0.035)) return incidents;
    const incident: InfrastructureIncident = {
      id: createStableEntityId("infrastructure-incident", `${seed}:${service.id}:${Math.floor(timestamp / HOUR_MS)}`),
      networkId: service.networkId,
      kind: service.kind,
      districtId: service.districtId,
      targetId: service.id,
      status: "active",
      startedAt: timestamp,
      severity: service.serviceLevel < 12 ? 3 : service.serviceLevel < 22 ? 2 : 1,
      cause: service.consecutiveDeficitHours > 18 ? "maintenance-delay" : "overload",
      serviceLoss: 100 - service.serviceLevel
    };
    return [...incidents, incident].slice(-300);
  }
  if (active && service.serviceLevel >= 65) {
    return incidents.map((item) => item.id === active.id ? { ...item, status: "resolved", resolvedAt: timestamp } : item);
  }
  return incidents;
}

export function advanceInfrastructure(
  current: InfrastructureState,
  timestamp: number,
  seed: string,
  city: CityState,
  districts: DistrictState[],
  locations: LocationState[],
  organizations: OrganizationState[],
  populationInput: PopulationState,
  economyInput: LocalEconomyState
): InfrastructureAdvanceResult {
  if (timestamp <= current.lastUpdatedAt) {
    return { state: current, economy: economyInput, population: populationInput, notices: [], organizationBudgetDeltas: [], transactions: [] };
  }

  let networks = current.networks.map((item) => ({ ...item }));
  let nodes = current.nodes.map((item) => ({ ...item }));
  let links = current.links.map((item) => ({ ...item }));
  let services = current.services.map((item) => ({ ...item }));
  let maintenance = current.maintenance.map((item) => ({ ...item }));
  let incidents = current.incidents.map((item) => ({ ...item }));
  let totals = { ...current.totals };
  const serviceRevenueBefore = totals.serviceRevenue;
  let economy = { ...economyInput, businesses: economyInput.businesses.map((item) => ({ ...item })) };
  let population = { ...populationInput, households: populationInput.households.map((item) => ({ ...item })), residents: populationInput.residents.map((item) => ({ ...item })) };
  const notices: InfrastructureNotice[] = [];
  const organizationBudgetDeltas: InfrastructureBudgetDelta[] = [];
  const transactions: KernelTransactionDraft[] = [];
  const targetHour = Math.floor(timestamp / HOUR_MS);
  let hourIndex = Math.max(current.hourIndex, Math.floor(current.lastUpdatedAt / HOUR_MS));
  const startDay = current.dayIndex;
  const networkDailyDelivery = new Map<string, number>();

  while (hourIndex < targetHour) {
    hourIndex += 1;
    const hourTimestamp = hourIndex * HOUR_MS;
    const hourOfDay = hourIndex % 24;
    const dayIndex = Math.floor(hourTimestamp / DAY_MS);

    for (const kind of KINDS) {
      const network = networks.find((item) => item.kind === kind);
      const source = nodes.find((item) => item.kind === kind && item.role === "source");
      if (!network || !source) continue;
      const kindServices = services.filter((item) => item.kind === kind).map((item) => {
        const jitter = new SeededRandom(`${seed}:infra-demand:${hourIndex}:${item.id}`).integer(-5, 6) / 100;
        return { ...item, currentDemand: round(Math.max(0.1, item.baseDemand * peakFactor(hourOfDay, kind) * (1 + jitter))) };
      });
      const totalDemand = kindServices.reduce((sum, item) => sum + item.currentDemand, 0);
      const sourceAvailability = source.capacity * source.condition / 100 * staffFactor(source.providerEntityId, organizations, source.staffing);
      let sourceRemaining = Math.max(0, sourceAvailability);
      let delivered = 0;
      let unmet = 0;

      for (const district of districts) {
        const districtServices = kindServices.filter((item) => item.districtId === district.id).sort((a, b) => b.priority - a.priority);
        const districtDemand = districtServices.reduce((sum, item) => sum + item.currentDemand, 0);
        const hub = nodes.find((item) => item.kind === kind && item.role === "district-hub" && item.districtId === district.id);
        const link = links.find((item) => item.kind === kind && item.districtId === district.id);
        if (!hub || !link) continue;
        const proportionalShare = totalDemand > 0 ? sourceAvailability * districtDemand / totalDemand : 0;
        const linkCapacity = link.capacity * link.condition / 100 * (1 - link.lossRate);
        let districtAvailable = Math.min(sourceRemaining, proportionalShare, hub.capacity * hub.condition / 100 * staffFactor(hub.providerEntityId, organizations, hub.staffing), linkCapacity);
        const originalAvailable = districtAvailable;
        for (const service of districtServices) {
          const supplied = Math.min(service.currentDemand, districtAvailable);
          districtAvailable -= supplied;
          delivered += supplied;
          const level = clamp(Math.round(supplied / Math.max(0.1, service.currentDemand) * 100));
          const updated: InfrastructureServiceState = {
            ...service,
            supplied: round(supplied),
            serviceLevel: level,
            status: statusFor(level),
            consecutiveDeficitHours: level < 65 ? service.consecutiveDeficitHours + 1 : 0,
            lastUpdatedAt: hourTimestamp
          };
          services = services.map((item) => item.id === updated.id ? updated : item);
          incidents = updateIncident(incidents, updated, hourTimestamp, seed);
        }
        const used = originalAvailable - districtAvailable;
        sourceRemaining = Math.max(0, sourceRemaining - used);
        const hubLoad = clamp(Math.round(used / Math.max(1, hub.capacity) * 100), 0, 180);
        const linkLoad = clamp(Math.round(used / Math.max(1, link.capacity) * 100), 0, 180);
        const hubWear = 0.002 + Math.max(0, hubLoad - 78) * 0.00034 + hub.maintenanceBacklog * 0.00008;
        const linkWear = 0.0015 + Math.max(0, linkLoad - 82) * 0.00028;
        nodes = nodes.map((item) => item.id === hub.id ? {
          ...item,
          throughput: round(used),
          load: hubLoad,
          condition: clamp(item.condition - hubWear),
          maintenanceBacklog: item.condition < 70 ? item.maintenanceBacklog + 0.03 : Math.max(0, item.maintenanceBacklog - 0.02),
          status: statusFor(Math.min(item.condition, 100 - Math.max(0, hubLoad - 100))),
          lastUpdatedAt: hourTimestamp
        } : item);
        links = links.map((item) => item.id === link.id ? {
          ...item,
          throughput: round(used),
          condition: clamp(item.condition - linkWear),
          status: statusFor(Math.min(item.condition, 100 - Math.max(0, linkLoad - 100))),
          lastUpdatedAt: hourTimestamp
        } : item);
        networkDailyDelivery.set(`${dayIndex}:${kind}:${district.id}`, (networkDailyDelivery.get(`${dayIndex}:${kind}:${district.id}`) ?? 0) + used);
      }

      unmet = Math.max(0, totalDemand - delivered);
      const sourceLoad = clamp(Math.round(delivered / Math.max(1, source.capacity) * 100), 0, 180);
      const sourceWear = 0.0015 + Math.max(0, sourceLoad - 80) * 0.0003 + source.maintenanceBacklog * 0.00006;
      nodes = nodes.map((item) => item.id === source.id ? {
        ...item,
        throughput: round(delivered),
        load: sourceLoad,
        condition: clamp(item.condition - sourceWear),
        maintenanceBacklog: item.condition < 72 ? item.maintenanceBacklog + 0.02 : Math.max(0, item.maintenanceBacklog - 0.01),
        status: statusFor(Math.min(item.condition, 100 - Math.max(0, sourceLoad - 100))),
        lastUpdatedAt: hourTimestamp
      } : item);
      const averageService = kindServices.length ? Math.round(services.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.serviceLevel, 0) / kindServices.length) : 100;
      networks = networks.map((item) => item.id === network.id ? {
        ...item,
        status: statusFor(averageService),
        totalDemand: round(totalDemand),
        totalDelivered: round(delivered),
        unmetDemand: round(unmet),
        averageServiceLevel: averageService,
        outageHours: item.outageHours + (averageService < 35 ? 1 : 0),
        lastUpdatedAt: hourTimestamp
      } : item);
      totals.generatedUnits += round(Math.min(sourceAvailability, delivered));
      totals.deliveredUnits += round(delivered);
      totals.unmetUnits += round(unmet);
      if (averageService < 35) totals.outageHours += 1;
    }

    maintenance = maintenance.map((order) => {
      if (order.status === "completed") return order;
      const network = networks.find((item) => item.id === order.networkId);
      if (!network) return order;
      if (order.status === "open") {
        if (network.reserveFund < order.creditsCost) return hourTimestamp > order.dueAt ? { ...order, status: "deferred" as const } : order;
        networks = networks.map((item) => item.id === network.id ? { ...item, reserveFund: item.reserveFund - order.creditsCost } : item);
        const ownerOrganization = organizations.find((item) => item.id === order.providerEntityId);
        if (ownerOrganization) pushBudgetDelta(organizationBudgetDeltas, ownerOrganization.id, -order.creditsCost);
        totals.maintenanceSpent += order.creditsCost;
        transactions.push({
          idempotencyKey: `${seed}:maintenance:${order.id}:funded`,
          timestamp: hourTimestamp,
          debitEntityId: order.providerEntityId,
          creditEntityId: kernelSystemEntityId(seed, "maintenance"),
          resource: "credits",
          amount: order.creditsCost,
          reason: "infrastructure-maintenance",
          description: `${order.kind} maintenance funded.`
        }, {
          idempotencyKey: `${seed}:maintenance:${order.id}:parts`,
          timestamp: hourTimestamp,
          debitEntityId: kernelSystemEntityId(seed, "wholesale"),
          creditEntityId: order.providerEntityId,
          resource: "parts-units",
          amount: order.partsCost,
          reason: "inventory-transfer",
          description: `${order.kind} replacement parts issued.`
        });
        return { ...order, status: "in-progress" as const, startedAt: hourTimestamp };
      }
      if (order.status === "deferred" && network.reserveFund >= order.creditsCost) return { ...order, status: "open" as const };
      if (order.status !== "in-progress") return order;
      const progressed = order.completedLaborHours + Math.max(1, Math.round(order.laborHours / 6));
      if (progressed < order.laborHours) return { ...order, completedLaborHours: progressed };
      if (order.targetKind === "node") {
        nodes = nodes.map((item) => item.id === order.targetId ? { ...item, condition: clamp(item.condition + order.conditionRestored), maintenanceBacklog: Math.max(0, item.maintenanceBacklog - 8), lastMaintainedAt: hourTimestamp, status: statusFor(item.condition + order.conditionRestored) } : item);
      } else {
        links = links.map((item) => item.id === order.targetId ? { ...item, condition: clamp(item.condition + order.conditionRestored), status: statusFor(item.condition + order.conditionRestored) } : item);
      }
      totals.maintenanceCompleted += 1;
      notices.push({ title: `${order.kind.toUpperCase()} maintenance completed.`, detail: `${order.targetKind} restored by ${order.conditionRestored} condition points.`, importance: 1 });
      return { ...order, status: "completed" as const, completedLaborHours: order.laborHours, completedAt: hourTimestamp };
    });

    if (hourOfDay === 0) {
      const temporaryState: InfrastructureState = { ...current, networks, nodes, links, services, maintenance, incidents, totals, hourIndex, dayIndex, simulatedHours: current.simulatedHours, lastUpdatedAt: hourTimestamp };
      maintenance = createMaintenanceOrders(temporaryState, hourTimestamp, seed);

      population = {
        ...population,
        households: population.households.map((household) => {
          const members = Math.max(1, household.memberIds.length);
          const home = household.homeLocationId;
          const charges = KINDS.map((kind) => {
            const network = networks.find((item) => item.kind === kind);
            const level = home ? getLocationServiceLevel({ ...temporaryState, maintenance }, home, kind) : 15;
            const base = network ? members * network.tariffPerUnit * (kind === "transport" ? 5 : kind === "power" ? 4 : kind === "water" ? 3 : 2) : 0;
            return { kind, provider: network?.providerEntityId, amount: Math.max(0, Math.round(base * (0.7 + level / 250))) };
          });
          let balance = household.balance;
          let paidTotal = 0;
          for (const charge of charges) {
            if (!charge.provider || charge.amount <= 0 || balance <= 0) continue;
            const paid = Math.min(balance, charge.amount);
            balance -= paid;
            paidTotal += paid;
            const network = networks.find((item) => item.kind === charge.kind);
            if (network) {
              networks = networks.map((item) => item.id === network.id ? { ...item, reserveFund: item.reserveFund + paid } : item);
              const organization = organizations.find((item) => item.id === charge.provider);
              if (organization) pushBudgetDelta(organizationBudgetDeltas, organization.id, paid);
            }
            totals.serviceRevenue += paid;
            transactions.push({
              idempotencyKey: `${seed}:utility:household:${dayIndex}:${household.id}:${charge.kind}`,
              timestamp: hourTimestamp,
              debitEntityId: household.id,
              creditEntityId: charge.provider,
              resource: "credits",
              amount: paid,
              reason: "utility-service",
              description: `${charge.kind} household service.`
            });
          }
          return {
            ...household,
            balance,
            dailyExpenses: household.dailyExpenses + paidTotal,
            lastLedger: household.lastLedger ? { ...household.lastLedger, utilitySpent: (household.lastLedger.utilitySpent ?? 0) + paidTotal } : household.lastLedger
          };
        })
      };

      economy = {
        ...economy,
        businesses: economy.businesses.map((business) => {
          const kinds = requiredKinds(business.kind);
          const levels = kinds.map((kind) => getLocationServiceLevel({ ...temporaryState, maintenance }, business.locationId, kind));
          const level = levels.length ? Math.min(...levels) : 100;
          const networkCharges = kinds.map((kind) => {
            const network = networks.find((item) => item.kind === kind);
            return { kind, network, amount: network ? Math.max(1, Math.round((business.capacityLevel + 1) * network.tariffPerUnit * (0.6 + level / 100) * 14)) : 0 };
          });
          let cash = business.cash;
          let utilityCost = 0;
          for (const charge of networkCharges) {
            if (!charge.network || cash <= 0) continue;
            const paid = Math.min(cash, charge.amount);
            cash -= paid;
            utilityCost += paid;
            const chargeNetwork = charge.network;
            networks = networks.map((item) => item.id === chargeNetwork.id ? { ...item, reserveFund: item.reserveFund + paid } : item);
            const organization = organizations.find((item) => item.id === chargeNetwork.providerEntityId);
            if (organization) pushBudgetDelta(organizationBudgetDeltas, organization.id, paid);
            totals.serviceRevenue += paid;
            transactions.push({
              idempotencyKey: `${seed}:utility:business:${dayIndex}:${business.id}:${charge.kind}`,
              timestamp: hourTimestamp,
              debitEntityId: business.id,
              creditEntityId: chargeNetwork.providerEntityId,
              resource: "credits",
              amount: paid,
              reason: "utility-service",
              description: `${charge.kind} commercial service.`
            });
          }
          return { ...business, cash, utilityCostsToday: (business.utilityCostsToday ?? 0) + utilityCost, infrastructureServiceLevel: level };
        })
      };

      for (const kind of KINDS) {
        for (const district of districts) {
          const amount = round(networkDailyDelivery.get(`${dayIndex}:${kind}:${district.id}`) ?? 0);
          if (amount <= 0) continue;
          transactions.push({
            idempotencyKey: `${seed}:utility-throughput:${dayIndex}:${kind}:${district.id}`,
            timestamp: hourTimestamp,
            debitEntityId: infrastructureGridAccount(seed, kind),
            creditEntityId: kernelSystemEntityId(seed, "consumption"),
            resource: resourceFor(kind),
            amount,
            reason: "utility-service",
            description: `${kind} delivered to ${district.name}.`
          });
        }
      }
    }
  }

  const targetDay = Math.floor(timestamp / DAY_MS);
  const daysAdvanced = Math.max(0, targetDay - startDay);
  const finalState: InfrastructureState = {
    version: 1,
    networks,
    nodes,
    links,
    services,
    maintenance: maintenance.slice(-400),
    incidents: incidents.slice(-300),
    totals,
    hourIndex: targetHour,
    dayIndex: targetDay,
    simulatedHours: current.simulatedHours + Math.max(0, targetHour - current.hourIndex),
    lastUpdatedAt: timestamp
  };
  economy = applyInfrastructureToEconomy(economy, finalState, daysAdvanced);
  population = applyInfrastructureToPopulation(population, finalState, daysAdvanced);
  population = { ...population, totals: { ...population.totals, utilitySales: (population.totals.utilitySales ?? 0) + Math.max(0, totals.serviceRevenue - serviceRevenueBefore) } };

  const previousStatus = new Map(current.networks.map((item) => [item.kind, item.status]));
  for (const network of finalState.networks) {
    if (previousStatus.get(network.kind) !== network.status) {
      notices.push({
        title: `${network.kind.toUpperCase()} network ${network.status}.`,
        detail: `${Math.round(network.totalDelivered)}/${Math.round(network.totalDemand)} units delivered · reserve ₵ ${Math.round(network.reserveFund)}.`,
        importance: network.status === "offline" ? 3 : network.status === "restricted" ? 2 : 1
      });
    }
  }
  const newIncidents = finalState.incidents.filter((item) => item.startedAt > current.lastUpdatedAt && item.status === "active");
  for (const incident of newIncidents.slice(0, 6)) {
    notices.push({ districtId: incident.districtId, title: `${incident.kind.toUpperCase()} service incident.`, detail: `${incident.cause} · service loss ${Math.round(incident.serviceLoss)}%.`, importance: incident.severity });
  }
  totals.incidents += newIncidents.length;

  return {
    state: { ...finalState, totals },
    economy,
    population,
    notices: notices.slice(0, 12),
    organizationBudgetDeltas,
    transactions
  };
}

export function applyInfrastructureToDistrictPulse(
  pulse: DistrictPulseState,
  state: InfrastructureState,
  districtId: string
): DistrictPulseState {
  const power = getDistrictServiceLevel(state, districtId, "power");
  const transport = getDistrictServiceLevel(state, districtId, "transport");
  return {
    ...pulse,
    powerGrid: power < 25 ? "offline" : power < 70 ? "unstable" : "stable",
    transitDelayMinutes: Math.max(0, Math.min(60, Math.round(pulse.transitDelayMinutes * 0.45 + (100 - transport) * 0.42)))
  };
}
