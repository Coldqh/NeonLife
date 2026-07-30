import { createStableEntityId } from "../../core/ids/entityId";
import type { BusinessState, BusinessStatus, SupplyClass } from "../../gameplay/economy/types";
import type { PlayerWorkContractState } from "../../gameplay/jobs/work/types";
import type { KernelAccountState, KernelTransactionDraft, SimulationKernelState } from "../kernel/types";
import type { EmploymentRecord, ShiftType } from "../population/types";
import type { VenueCategory, VenueOperatingStatus, VenueState } from "../urban/types";
import type {
  WorldCoreBusinessState,
  WorldCoreBusinessStatus,
  WorldCoreEmploymentState,
  WorldCoreEmploymentStatus,
  WorldCoreInput,
  WorldCoreIntegrityState,
  WorldCoreProjectionResult,
  WorldCoreState
} from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function creditBalance(account: KernelAccountState | undefined): number | undefined {
  if (!account) return undefined;
  return account.balances.find((entry) => entry.resource === "credits")?.amount ?? 0;
}

function clock(timestamp: number, previous?: WorldCoreState): WorldCoreState["clock"] {
  return {
    timestamp,
    minuteIndex: Math.floor(timestamp / MINUTE_MS),
    hourIndex: Math.floor(timestamp / HOUR_MS),
    dayIndex: Math.floor(timestamp / DAY_MS),
    weekIndex: Math.floor(timestamp / WEEK_MS),
    revision: previous && previous.clock.timestamp !== timestamp ? previous.clock.revision + 1 : previous?.clock.revision ?? 0
  };
}

function supplyClassForVenue(category: VenueCategory): SupplyClass {
  if (["convenience", "food", "bar", "market", "hotel"].includes(category)) return "food";
  if (["clinic", "pharmacy", "cyberware"].includes(category)) return "medical";
  if (category === "repair") return "parts";
  if (category === "office-service") return "documents";
  return "mixed";
}

function venueCategoryForLegacy(business: BusinessState): WorldCoreBusinessState["category"] {
  if (business.kind === "retail") return "market";
  if (business.kind === "food-service") return "food";
  if (business.kind === "medical") return "clinic";
  if (business.kind === "repair") return "repair";
  if (business.kind === "logistics") return "logistics";
  return "corporate";
}

function institutionCategory(type: string): WorldCoreBusinessState["category"] {
  if (type === "education") return "education";
  if (type === "government") return "government";
  if (type === "transport") return "transport";
  if (type === "clinic") return "clinic";
  if (type === "workshop") return "repair";
  if (type === "food") return "food";
  if (type === "market") return "market";
  return "corporate";
}

function statusFromLegacy(status: BusinessStatus): WorldCoreBusinessStatus {
  if (status === "closed") return "closed";
  if (status === "restricted") return "restricted";
  if (status === "strained") return "strained";
  return "operating";
}

function legacyStatusFromCore(status: WorldCoreBusinessStatus): BusinessStatus {
  if (["closed", "vacant", "renovation", "insolvent", "seized"].includes(status)) return "closed";
  if (status === "restricted") return "restricted";
  if (status === "strained") return "strained";
  return "stable";
}

function venueStatusFromCore(status: WorldCoreBusinessStatus): VenueOperatingStatus {
  if (status === "restricted" || status === "strained") return "operating";
  return status;
}

function employmentStatus(record: EmploymentRecord): WorldCoreEmploymentStatus {
  if (record.status === "unemployed" || record.endedDay !== undefined) return "ended";
  if (record.unpaidDays > 0) return "breached";
  if (record.status === "absent") return "suspended";
  return "active";
}

function playerEmploymentStatus(contract: PlayerWorkContractState): WorldCoreEmploymentStatus {
  if (contract.status === "dismissed" || contract.status === "resigned") return "ended";
  if (contract.unpaidWages > 0) return "breached";
  if (contract.status === "warning") return "suspended";
  return "active";
}

function shiftForPlayerContract(contract: PlayerWorkContractState): ShiftType {
  return contract.shiftStartHour >= 18 || contract.shiftStartHour < 6 ? "night" : "day";
}

function previousBusiness(input: WorldCoreInput, aliases: string[], id: string): WorldCoreBusinessState | undefined {
  if (!input.previous) return undefined;
  const previousId = input.previous.aliasToBusinessId[id]
    ?? aliases.map((alias) => input.previous?.aliasToBusinessId[alias]).find(Boolean)
    ?? id;
  return input.previous.businesses.find((item) => item.id === previousId);
}

function canonicalCash(
  previous: WorldCoreBusinessState | undefined,
  kernel: SimulationKernelState | undefined,
  id: string,
  legacyCash: number | undefined,
  venueCash: number | undefined
): number {
  if (previous) {
    const legacyDelta = legacyCash === undefined || previous.legacyCashObserved === undefined ? 0 : legacyCash - previous.legacyCashObserved;
    const venueDelta = venueCash === undefined || previous.venueCashObserved === undefined ? 0 : venueCash - previous.venueCashObserved;
    return Math.round((previous.cash + legacyDelta + venueDelta) * 100) / 100;
  }
  const kernelCash = creditBalance(kernel?.accounts.find((account) => account.entityId === id));
  if (kernelCash !== undefined) return kernelCash;
  if (legacyCash !== undefined && venueCash !== undefined) return Math.max(legacyCash, venueCash);
  return legacyCash ?? venueCash ?? 0;
}

function venueStock(venue: VenueState, input: WorldCoreInput): { units: number; percent: number } {
  const operation = input.urban.venueOperations.operations.find((item) => item.venueId === venue.id);
  if (!operation) return { units: 0, percent: venue.stock };
  const units = operation.offers.reduce((sum, offer) => sum + Math.max(0, offer.stock), 0);
  const capacity = operation.offers.reduce((sum, offer) => sum + Math.max(0, offer.maxStock), 0);
  return { units, percent: capacity > 0 ? clamp(Math.round(units / capacity * 100)) : venue.stock };
}

function buildBusinesses(input: WorldCoreInput): WorldCoreBusinessState[] {
  const venueEntries = input.urban.venueOperations.registry;
  const matchedVenueIds = new Set<string>();
  const result: WorldCoreBusinessState[] = [];

  for (const legacy of input.economy.businesses) {
    const location = input.locations.find((item) => item.id === legacy.locationId);
    const venue = venueEntries.find((entry) => entry.venue.anchorLocationId === legacy.locationId)?.venue;
    if (venue) matchedVenueIds.add(venue.id);
    const operation = venue ? input.urban.venueOperations.operations.find((item) => item.venueId === venue.id) : undefined;
    const aliases = [legacy.id, ...(venue ? [venue.id, `venue-account:${venue.id}`] : [])];
    const previous = previousBusiness(input, aliases, legacy.id);
    const cash = canonicalCash(previous, input.kernel, legacy.id, legacy.cash, operation?.cash);
    const stock = venue ? venueStock(venue, input) : { units: Math.max(0, Math.round(legacy.stock)), percent: legacy.stock };
    const status = cash < -1_500
      ? "insolvent" as const
      : operation && operation.status !== "operating"
        ? operation.status
        : statusFromLegacy(legacy.status);
    const activeWorkers = input.population.employments.filter((employment) => employment.locationId === legacy.locationId && employment.status !== "unemployed").length;
    result.push({
      id: legacy.id,
      source: venue ? "merged" : "legacy",
      aliases: [...new Set(aliases)],
      legacyBusinessId: legacy.id,
      venueId: venue?.id,
      locationId: legacy.locationId,
      districtId: venue?.districtId ?? location?.districtId ?? input.locations[0]?.districtId ?? "district-missing",
      buildingId: venue?.buildingId,
      unitId: venue?.unitId,
      ownerEntityId: venue?.organizationId ?? legacy.organizationId ?? legacy.id,
      operatorEntityId: legacy.id,
      name: venue?.name ?? location?.name ?? `BUSINESS ${legacy.id}`,
      category: venue?.category ?? venueCategoryForLegacy(legacy),
      supplyClass: venue ? supplyClassForVenue(venue.category) : legacy.supplyClass,
      status,
      cash,
      legacyCashObserved: legacy.cash,
      venueCashObserved: operation?.cash,
      stockPercent: stock.percent,
      stockUnits: stock.units,
      targetStaff: Math.max(1, legacy.targetStaff),
      activeWorkers,
      lastUpdatedAt: input.timestamp
    });
  }

  for (const entry of venueEntries) {
    const venue = entry.venue;
    if (matchedVenueIds.has(venue.id)) continue;
    const operation = input.urban.venueOperations.operations.find((item) => item.venueId === venue.id);
    const id = `venue-account:${venue.id}`;
    const aliases = [id, venue.id];
    const previous = previousBusiness(input, aliases, id);
    const cash = canonicalCash(previous, input.kernel, id, undefined, operation?.cash ?? 0);
    const stock = venueStock(venue, input);
    const status = cash < -1_500 ? "insolvent" as const : operation?.status ?? venue.operatingStatus;
    const playerWorkers = input.work.contracts.filter((contract) => contract.venueId === venue.id && (contract.status === "active" || contract.status === "warning")).length;
    result.push({
      id,
      source: "venue",
      aliases,
      venueId: venue.id,
      locationId: venue.anchorLocationId,
      districtId: venue.districtId,
      buildingId: venue.buildingId,
      unitId: venue.unitId,
      ownerEntityId: venue.organizationId ?? id,
      operatorEntityId: id,
      name: venue.name,
      category: venue.category,
      supplyClass: supplyClassForVenue(venue.category),
      status,
      cash,
      venueCashObserved: operation?.cash ?? 0,
      stockPercent: stock.percent,
      stockUnits: stock.units,
      targetStaff: Math.max(1, Math.round(venue.staffing / 12)),
      activeWorkers: playerWorkers,
      lastUpdatedAt: input.timestamp
    });
  }

  const coveredLocations = new Set(result.map((business) => business.locationId).filter(Boolean));
  const employmentLocationIds = new Set(input.population.employments.filter((item) => item.status !== "unemployed").map((item) => item.locationId));
  for (const locationId of employmentLocationIds) {
    if (coveredLocations.has(locationId)) continue;
    const location = input.locations.find((item) => item.id === locationId);
    if (!location) continue;
    const id = createStableEntityId("core-business", `institution:${location.id}`);
    const aliases = [id];
    const previous = previousBusiness(input, aliases, id);
    const owner = location.organizationId ?? id;
    const kernelCash = creditBalance(input.kernel?.accounts.find((account) => account.entityId === id));
    const activeWorkers = input.population.employments.filter((item) => item.locationId === location.id && item.status !== "unemployed").length;
    result.push({
      id,
      source: "institution",
      aliases,
      locationId: location.id,
      districtId: location.districtId,
      ownerEntityId: owner,
      operatorEntityId: owner,
      name: location.name,
      category: institutionCategory(location.type),
      supplyClass: location.type === "clinic" ? "medical" : location.type === "workshop" ? "parts" : location.type === "food" || location.type === "market" ? "food" : "mixed",
      status: location.open ? "operating" : "closed",
      cash: kernelCash ?? previous?.cash ?? 0,
      stockPercent: 100,
      stockUnits: 0,
      targetStaff: Math.max(1, activeWorkers),
      activeWorkers,
      lastUpdatedAt: input.timestamp
    });
  }

  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function buildAliasMap(businesses: WorldCoreBusinessState[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const business of businesses) {
    map[business.id] = business.id;
    for (const alias of business.aliases) map[alias] = business.id;
  }
  return map;
}

function businessByLocation(businesses: WorldCoreBusinessState[], locationId: string): WorldCoreBusinessState | undefined {
  return businesses.find((business) => business.locationId === locationId);
}

function buildEmployments(input: WorldCoreInput, businesses: WorldCoreBusinessState[]): WorldCoreEmploymentState[] {
  const result: WorldCoreEmploymentState[] = [];
  for (const employment of input.population.employments) {
    const business = businessByLocation(businesses, employment.locationId);
    if (!business) continue;
    result.push({
      id: employment.id,
      residentId: employment.residentId,
      businessId: business.id,
      sourceEmploymentId: employment.id,
      role: employment.title,
      status: employmentStatus(employment),
      wagePerDay: employment.wagePerDay,
      shift: employment.shift,
      startedAt: (employment.startedDay ?? input.population.dayIndex) * DAY_MS,
      playerControlled: false,
      lastUpdatedAt: input.timestamp
    });
  }
  for (const contract of input.work.contracts) {
    const business = businesses.find((item) => item.venueId === contract.venueId);
    if (!business) continue;
    result.push({
      id: createStableEntityId("core-employment", `player:${contract.id}`),
      residentId: input.playerId,
      businessId: business.id,
      sourcePlayerContractId: contract.id,
      role: contract.title,
      status: playerEmploymentStatus(contract),
      wagePerDay: Math.round(contract.wagePerHour * contract.shiftDurationHours),
      shift: shiftForPlayerContract(contract),
      startedAt: contract.startedAt,
      playerControlled: true,
      lastUpdatedAt: input.timestamp
    });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function accountDrift(kernel: SimulationKernelState | undefined, businesses: WorldCoreBusinessState[]): number {
  if (!kernel) return 0;
  return businesses.filter((business) => {
    const current = creditBalance(kernel.accounts.find((account) => account.entityId === business.id));
    return current === undefined || Math.abs(current - business.cash) >= 0.02;
  }).length;
}

function integrity(
  input: WorldCoreInput,
  businesses: WorldCoreBusinessState[],
  employments: WorldCoreEmploymentState[],
  aliases: Record<string, string>
): WorldCoreIntegrityState {
  const aliasCount = businesses.reduce((sum, business) => sum + new Set([business.id, ...business.aliases]).size, 0);
  const duplicateAliases = aliasCount - Object.keys(aliases).length;
  const businessIds = new Set(businesses.map((item) => item.id));
  const organizationIds = new Set(input.organizations.map((item) => item.id));
  const orphanBusinesses = businesses.filter((item) => !item.ownerEntityId || (!organizationIds.has(item.ownerEntityId) && item.ownerEntityId !== item.id && item.source !== "venue")).length;
  const residentIds = new Set([...input.population.residents.map((item) => item.id), input.playerId]);
  const orphanEmployments = employments.filter((item) => !businessIds.has(item.businessId) || !residentIds.has(item.residentId)).length;
  const drift = accountDrift(input.kernel, businesses);
  const clockDrift = input.kernel ? Math.abs(input.kernel.clock.lastAdvancedAt - input.timestamp) : 0;
  const legacyVenueCashDrift = businesses.filter((item) => item.source === "merged" && item.legacyCashObserved !== undefined && item.venueCashObserved !== undefined && Math.abs(item.legacyCashObserved - item.venueCashObserved) >= 0.02).length;
  const warnings: string[] = [];
  if (duplicateAliases) warnings.push(`${duplicateAliases} business aliases collide.`);
  if (orphanBusinesses) warnings.push(`${orphanBusinesses} businesses have no valid owner.`);
  if (orphanEmployments) warnings.push(`${orphanEmployments} employments reference missing residents or businesses.`);
  if (drift) warnings.push(`${drift} canonical business accounts differ from the kernel snapshot.`);
  if (clockDrift) warnings.push(`World clock differs from kernel by ${clockDrift} ms.`);
  if (legacyVenueCashDrift) warnings.push(`${legacyVenueCashDrift} merged businesses still have divergent compatibility balances.`);
  return {
    healthy: duplicateAliases === 0 && orphanBusinesses === 0 && orphanEmployments === 0 && clockDrift === 0,
    checkedAt: input.timestamp,
    duplicateAliases,
    orphanBusinesses,
    orphanEmployments,
    accountDrift: drift,
    clockDrift,
    legacyVenueCashDrift,
    warnings
  };
}

export function createWorldCoreState(input: Omit<WorldCoreInput, "previous">): WorldCoreState {
  return advanceWorldCoreState({ ...input, previous: undefined });
}

export function normalizeWorldCoreState(value: unknown, input: Omit<WorldCoreInput, "previous">): WorldCoreState {
  const previous = value && typeof value === "object" && (value as Partial<WorldCoreState>).version === 1
    ? value as WorldCoreState
    : undefined;
  return advanceWorldCoreState({ ...input, previous });
}

export function advanceWorldCoreState(input: WorldCoreInput): WorldCoreState {
  const businesses = buildBusinesses(input);
  const aliasToBusinessId = buildAliasMap(businesses);
  const employments = buildEmployments(input, businesses);
  return {
    version: 1,
    businesses,
    employments,
    aliasToBusinessId,
    clock: clock(input.timestamp, input.previous),
    integrity: integrity(input, businesses, employments, aliasToBusinessId),
    lastUpdatedAt: input.timestamp
  };
}

export function remapWorldCoreTransactions(state: WorldCoreState, drafts: KernelTransactionDraft[]): KernelTransactionDraft[] {
  return drafts.map((draft) => ({
    ...draft,
    debitEntityId: state.aliasToBusinessId[draft.debitEntityId] ?? draft.debitEntityId,
    creditEntityId: state.aliasToBusinessId[draft.creditEntityId] ?? draft.creditEntityId
  }));
}

export function synchronizeWorldCoreFromKernel(state: WorldCoreState, kernel: SimulationKernelState): WorldCoreState {
  const businesses = state.businesses.map((business) => {
    const cash = creditBalance(kernel.accounts.find((account) => account.entityId === business.id));
    if (cash === undefined) return business;
    return {
      ...business,
      cash,
      legacyCashObserved: business.legacyBusinessId ? cash : business.legacyCashObserved,
      venueCashObserved: business.venueId ? cash : business.venueCashObserved,
      lastUpdatedAt: kernel.lastUpdatedAt
    };
  });
  const drift = accountDrift(kernel, businesses);
  const clockDrift = Math.abs(kernel.clock.lastAdvancedAt - state.clock.timestamp);
  const warnings = state.integrity.warnings.filter((warning) => !warning.includes("kernel snapshot") && !warning.includes("World clock") && !warning.includes("compatibility balances"));
  if (drift) warnings.push(`${drift} canonical business accounts differ from the kernel snapshot.`);
  if (clockDrift) warnings.push(`World clock differs from kernel by ${clockDrift} ms.`);
  return {
    ...state,
    businesses,
    clock: { ...state.clock, timestamp: kernel.clock.lastAdvancedAt, minuteIndex: kernel.clock.minuteIndex, hourIndex: kernel.clock.hourIndex, dayIndex: kernel.clock.dayIndex, weekIndex: kernel.clock.weekIndex },
    integrity: {
      ...state.integrity,
      healthy: state.integrity.duplicateAliases === 0 && state.integrity.orphanBusinesses === 0 && state.integrity.orphanEmployments === 0 && drift === 0 && clockDrift === 0,
      accountDrift: drift,
      clockDrift,
      legacyVenueCashDrift: 0,
      checkedAt: kernel.lastUpdatedAt,
      warnings
    },
    lastUpdatedAt: kernel.lastUpdatedAt
  };
}

export function projectWorldCoreState(input: WorldCoreInput, state: WorldCoreState): WorldCoreProjectionResult {
  const businessById = new Map(state.businesses.map((business) => [business.id, business]));
  const economy = {
    ...input.economy,
    businesses: input.economy.businesses.map((legacy) => {
      const canonicalId = state.aliasToBusinessId[legacy.id] ?? legacy.id;
      const business = businessById.get(canonicalId);
      if (!business) return legacy;
      return {
        ...legacy,
        cash: business.cash,
        stock: business.stockPercent,
        shortage: business.stockPercent < 42,
        status: legacyStatusFromCore(business.status),
        lastUpdatedAt: input.timestamp
      };
    }),
    lastUpdatedAt: input.timestamp
  };
  const operationByVenueId = new Map(input.urban.venueOperations.operations.map((operation) => [operation.venueId, operation]));
  const operations = input.urban.venueOperations.operations.map((operation) => {
    const canonicalId = state.aliasToBusinessId[`venue-account:${operation.venueId}`] ?? state.aliasToBusinessId[operation.venueId];
    const business = canonicalId ? businessById.get(canonicalId) : undefined;
    if (!business) return operation;
    return { ...operation, cash: business.cash, status: venueStatusFromCore(business.status), lastUpdatedAt: input.timestamp };
  });
  const operationMap = new Map(operations.map((operation) => [operation.venueId, operation]));
  const registry = input.urban.venueOperations.registry.map((entry) => {
    const operation = operationMap.get(entry.venue.id) ?? operationByVenueId.get(entry.venue.id);
    if (!operation) return entry;
    return {
      ...entry,
      venue: {
        ...entry.venue,
        operatingStatus: operation.status,
        active: operation.status === "operating",
        lastUpdatedAt: input.timestamp
      }
    };
  });
  const urban = {
    ...input.urban,
    venues: input.urban.venues.map((venue) => {
      const operation = operationMap.get(venue.id);
      return operation ? { ...venue, operatingStatus: operation.status, active: operation.status === "operating", lastUpdatedAt: input.timestamp } : venue;
    }),
    venueOperations: {
      ...input.urban.venueOperations,
      operations,
      registry,
      lastUpdatedAt: input.timestamp
    },
    lastUpdatedAt: input.timestamp
  };
  return { state, economy, population: input.population, urban, work: input.work };
}

export function worldCoreManagedLocationIds(state: WorldCoreState): Set<string> {
  return new Set(state.businesses.filter((business) => business.source === "merged").map((business) => business.locationId).filter((value): value is string => Boolean(value)));
}
