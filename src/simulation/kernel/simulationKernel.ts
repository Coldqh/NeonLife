import { createStableEntityId } from "../../core/ids/entityId";
import type { PlayerState } from "../../gameplay/player/demoPlayer";
import type { BusinessState, LocalEconomyState, SupplyClass } from "../../gameplay/economy/types";
import type { BackgroundResident, EmploymentRecord, HouseholdState, HousingMarketState, PopulationState } from "../population/types";
import type { CityState, DistrictState, LocationState, OrganizationState } from "../../world/state/types";
import type { InfrastructureKind, InfrastructureState } from "../infrastructure/types";
import type { ProductionResource, ProductionState, ProductionSupplyContract } from "../production/types";
import type { OrganizationAgreementState, OrganizationEcosystemState } from "../organizations/types";
import type { GovernmentCrimeState } from "../government/types";
import type {
  KernelAccountState,
  KernelAssetState,
  KernelAssetStatus,
  KernelContractState,
  KernelEntityKind,
  KernelIntegrityState,
  KernelResource,
  KernelResourceBalance,
  KernelTotalsState,
  KernelTransactionDraft,
  KernelTransactionState,
  KernelOwnershipState,
  SimulationKernelState
} from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MAX_TRANSACTIONS = 2_000;

export type KernelSystemAccount = "clearing" | "wholesale" | "maintenance" | "credit-bureau" | "housing-authority" | "city-services" | "consumption" | "power-grid" | "water-grid" | "data-grid" | "transport-grid" | "waste-grid" | "logistics-clearing" | "external-trade" | "production-consumption" | "production-output" | "unregistered-market" | "illegal-consumption" | "corrupt-officials";

export interface KernelSyncInput {
  timestamp: number;
  seed: string;
  city: CityState;
  districts: DistrictState[];
  locations: LocationState[];
  organizations: OrganizationState[];
  player: PlayerState;
  population: PopulationState;
  economy: LocalEconomyState;
  infrastructure: InfrastructureState;
  production: ProductionState;
  organizationEcosystem?: OrganizationEcosystemState;
  government?: GovernmentCrimeState;
  drafts?: KernelTransactionDraft[];
}

export function kernelSystemEntityId(seed: string, kind: KernelSystemAccount): string {
  return createStableEntityId("kernel-system", `${seed}:${kind}`);
}

export function employmentContractId(employmentId: string): string {
  return createStableEntityId("contract", `employment:${employmentId}`);
}

export function leaseContractId(householdId: string): string {
  return createStableEntityId("contract", `lease:${householdId}`);
}

export function supplyContractId(businessId: string): string {
  return createStableEntityId("contract", `supply:${businessId}`);
}

export function utilityContractId(networkId: string, districtId: string): string {
  return createStableEntityId("contract", `utility:${networkId}:${districtId}`);
}

export function productionContractId(contractId: string): string {
  return createStableEntityId("contract", `production:${contractId}`);
}

function accountId(entityId: string): string {
  return createStableEntityId("kernel-account", entityId);
}

function assetId(kind: string, sourceId: string): string {
  return createStableEntityId("asset", `${kind}:${sourceId}`);
}

function balance(resource: KernelResource, amount: number): KernelResourceBalance {
  return { resource, amount: Math.round(amount * 100) / 100 };
}

function resourceForSupply(supplyClass: SupplyClass): KernelResource {
  if (supplyClass === "food") return "food-units";
  if (supplyClass === "medical") return "medical-units";
  if (supplyClass === "parts") return "parts-units";
  if (supplyClass === "documents") return "document-units";
  return "mixed-units";
}

function resourceForProduction(resource: ProductionResource): KernelResource {
  if (resource === "food-units") return "food-units";
  if (resource === "medical-units") return "medical-units";
  if (resource === "parts-units") return "parts-units";
  if (resource === "document-units") return "document-units";
  if (resource === "mixed-units") return "mixed-units";
  if (resource === "biomass-feedstock") return "biomass-units";
  if (resource === "chemical-feedstock") return "chemical-units";
  if (resource === "alloy-feedstock") return "alloy-units";
  if (resource === "electronic-components") return "electronic-units";
  if (resource === "data-substrate") return "data-substrate-units";
  return "packaging-units";
}

function getBalance(account: KernelAccountState, resource: KernelResource): number {
  return account.balances.find((entry) => entry.resource === resource)?.amount ?? 0;
}

function setBalance(account: KernelAccountState, resource: KernelResource, amount: number, timestamp: number): KernelAccountState {
  const balances = account.balances.filter((entry) => entry.resource !== resource);
  balances.push(balance(resource, amount));
  return { ...account, balances, updatedAt: timestamp };
}

function entityKindFor(id: string, input: KernelSyncInput): KernelEntityKind {
  if (id === input.player.id) return "player";
  if (id === input.city.id) return "city";
  if (input.organizations.some((item) => item.id === id)) return "organization";
  if (input.population.households.some((item) => item.id === id)) return "household";
  if (input.population.residents.some((item) => item.id === id)) return "resident";
  if (input.economy.businesses.some((item) => item.id === id)) return "business";
  if (input.production.facilities.some((item) => item.id === id)) return "production-facility";
  if (input.locations.some((item) => item.id === id)) return "location";
  if (input.districts.some((item) => item.id === id)) return "district";
  return "system";
}

function account(entityId: string, entityKind: KernelEntityKind, balances: KernelResourceBalance[], timestamp: number): KernelAccountState {
  return { id: accountId(entityId), entityId, entityKind, balances, updatedAt: timestamp };
}

function snapshotAccounts(input: KernelSyncInput): KernelAccountState[] {
  const accounts: KernelAccountState[] = [
    account(input.player.id, "player", [balance("credits", input.player.balance)], input.timestamp),
    account(input.city.id, "city", [], input.timestamp)
  ];

  for (const organization of input.organizations) {
    accounts.push(account(organization.id, "organization", [balance("credits", organization.budget)], input.timestamp));
  }
  for (const district of input.districts) accounts.push(account(district.id, "district", [], input.timestamp));
  for (const location of input.locations) accounts.push(account(location.id, "location", [], input.timestamp));
  for (const business of input.economy.businesses) {
    accounts.push(account(business.id, "business", [
      balance("credits", business.cash),
      balance(resourceForSupply(business.supplyClass), business.stock),
      balance("labor-hours", Math.max(0, business.staffing) * 8)
    ], input.timestamp));
  }
  for (const facility of input.production.facilities) {
    accounts.push(account(facility.id, "production-facility", [
      balance("credits", facility.cash),
      ...facility.inventory.map((item) => balance(resourceForProduction(item.resource), item.amount)),
      balance("labor-hours", Math.max(0, facility.staffing) * 8)
    ], input.timestamp));
  }
  for (const household of input.population.households) {
    accounts.push(account(household.id, "household", [
      balance("credits", household.balance),
      balance("food-units", household.foodUnits)
    ], input.timestamp));
  }
  for (const resident of input.population.residents) {
    accounts.push(account(resident.id, "resident", [], input.timestamp));
  }
  for (const housing of input.population.housing) {
    accounts.push(account(housing.id, "location", [
      balance("credits", housing.maintenanceFund),
      balance("housing-beds", Math.max(0, housing.capacity - housing.occupied))
    ], input.timestamp));
  }
  for (const kind of ["clearing", "wholesale", "maintenance", "credit-bureau", "housing-authority", "city-services", "consumption", "power-grid", "water-grid", "data-grid", "transport-grid", "waste-grid", "logistics-clearing", "external-trade", "production-consumption", "production-output", "unregistered-market", "illegal-consumption", "corrupt-officials"] as const) {
    accounts.push(account(kernelSystemEntityId(input.seed, kind), "system", [], input.timestamp));
  }
  return dedupeAccounts(accounts);
}

function dedupeAccounts(accounts: KernelAccountState[]): KernelAccountState[] {
  const map = new Map<string, KernelAccountState>();
  for (const item of accounts) map.set(item.entityId, item);
  return [...map.values()];
}

function assetStatusFromBusiness(business: BusinessState): KernelAssetStatus {
  if (business.status === "closed") return "offline";
  if (business.status === "restricted") return "restricted";
  if (business.status === "strained") return "strained";
  return "active";
}

function assetStatusFromHousing(housing: HousingMarketState): KernelAssetStatus {
  if (housing.status === "critical") return "restricted";
  if (housing.status === "degraded") return "strained";
  return "active";
}

function buildAssets(input: KernelSyncInput): KernelAssetState[] {
  const assets: KernelAssetState[] = [];
  const businessLocations = new Set(input.economy.businesses.map((item) => item.locationId));
  const housingLocations = new Set(input.population.housing.map((item) => item.locationId));

  for (const business of input.economy.businesses) {
    const location = input.locations.find((item) => item.id === business.locationId);
    const owner = business.organizationId ?? business.id;
    assets.push({
      id: assetId("business", business.id),
      kind: "business-operation",
      name: location?.name ?? `BUSINESS ${business.id}`,
      ownerEntityId: owner,
      controllerEntityId: business.id,
      locationId: business.locationId,
      districtId: location?.districtId,
      status: assetStatusFromBusiness(business),
      condition: Math.max(0, Math.min(100, Math.round((business.stock + business.staffing) / 2))),
      capacity: business.capacityLevel,
      valuation: Math.max(0, Math.round(business.cash + business.stock * 18 + business.capacityLevel * 800)),
      resources: [
        balance(resourceForSupply(business.supplyClass), business.stock),
        balance("labor-hours", Math.max(0, business.staffing) * 8)
      ],
      updatedAt: input.timestamp
    });
  }

  for (const housing of input.population.housing) {
    const location = input.locations.find((item) => item.id === housing.locationId);
    const owner = housing.ownerOrganizationId ?? kernelSystemEntityId(input.seed, "housing-authority");
    assets.push({
      id: assetId("housing", housing.id),
      kind: "housing-block",
      name: location?.name ?? `HOUSING ${housing.id}`,
      ownerEntityId: owner,
      controllerEntityId: housing.id,
      locationId: housing.locationId,
      districtId: housing.districtId,
      status: assetStatusFromHousing(housing),
      condition: housing.condition,
      capacity: housing.capacity,
      valuation: Math.round(housing.capacity * housing.baseRentPerBedWeek * Math.max(1, housing.condition) * 0.6),
      resources: [balance("housing-beds", Math.max(0, housing.capacity - housing.occupied))],
      updatedAt: input.timestamp
    });
  }

  for (const location of input.locations) {
    if (businessLocations.has(location.id) || housingLocations.has(location.id)) continue;
    const owner = location.organizationId ?? input.city.id;
    assets.push({
      id: assetId("facility", location.id),
      kind: "facility",
      name: location.name,
      ownerEntityId: owner,
      controllerEntityId: owner,
      locationId: location.id,
      districtId: location.districtId,
      status: location.open ? "active" : "offline",
      condition: Math.max(20, location.security),
      capacity: 1,
      valuation: Math.round(20_000 + location.security * 1_200),
      resources: [],
      updatedAt: input.timestamp
    });
  }

  for (const node of input.infrastructure.nodes) {
    assets.push({
      id: assetId("infrastructure-node", node.id),
      kind: "infrastructure-node",
      name: node.name,
      ownerEntityId: node.providerEntityId,
      controllerEntityId: node.providerEntityId,
      districtId: node.districtId,
      status: node.status === "offline" ? "offline" : node.status === "restricted" ? "restricted" : node.status === "strained" ? "strained" : "active",
      condition: node.condition,
      capacity: node.capacity,
      valuation: Math.round(node.capacity * Math.max(1, node.condition) * 1_200),
      resources: [balance(node.kind === "power" ? "energy-units" : node.kind === "water" ? "water-units" : node.kind === "data" ? "data-capacity" : node.kind === "transport" ? "transport-capacity" : "waste-capacity", node.throughput)],
      updatedAt: input.timestamp
    });
  }

  for (const link of input.infrastructure.links) {
    const provider = input.infrastructure.networks.find((item) => item.id === link.networkId)?.providerEntityId ?? input.city.id;
    assets.push({
      id: assetId("infrastructure-link", link.id),
      kind: "infrastructure-link",
      name: `${link.kind.toUpperCase()} LINK ${link.districtId}`,
      ownerEntityId: provider,
      controllerEntityId: provider,
      districtId: link.districtId,
      status: link.status === "offline" ? "offline" : link.status === "restricted" ? "restricted" : link.status === "strained" ? "strained" : "active",
      condition: link.condition,
      capacity: link.capacity,
      valuation: Math.round(link.capacity * Math.max(1, link.condition) * 420),
      resources: [],
      updatedAt: input.timestamp
    });
  }

  for (const facility of input.production.facilities) {
    assets.push({
      id: assetId("production-facility", facility.id),
      kind: facility.kind === "warehouse" || facility.kind === "distribution-hub" ? "warehouse" : "production-facility",
      name: facility.name,
      ownerEntityId: facility.ownerEntityId,
      controllerEntityId: facility.id,
      locationId: facility.locationId,
      districtId: facility.districtId,
      status: facility.status === "offline" ? "offline" : facility.status === "restricted" ? "restricted" : facility.status === "strained" ? "strained" : "active",
      condition: facility.condition,
      capacity: facility.capacityLevel,
      valuation: Math.max(0, Math.round(facility.cash + facility.inventory.reduce((sum, item) => sum + item.amount * 8, 0) + facility.capacityLevel * 4_000)),
      resources: facility.inventory.map((item) => balance(resourceForProduction(item.resource), item.amount)),
      updatedAt: input.timestamp
    });
  }

  for (const district of input.districts) {
    assets.push({
      id: assetId("district-land", district.id),
      kind: "district-land",
      name: `${district.name} LAND REGISTER`,
      ownerEntityId: input.city.id,
      controllerEntityId: input.city.id,
      districtId: district.id,
      status: "active",
      condition: district.infrastructure,
      capacity: district.population,
      valuation: Math.round(district.population * Math.max(1, district.costOfLiving) * 34),
      resources: [],
      updatedAt: input.timestamp
    });
  }
  return assets;
}

function buildOwnership(assets: KernelAssetState[], timestamp: number): KernelOwnershipState[] {
  return assets.map((asset) => ({
    id: createStableEntityId("ownership", `${asset.id}:${asset.ownerEntityId}`),
    assetId: asset.id,
    ownerEntityId: asset.ownerEntityId,
    shareBasisPoints: 10_000,
    acquiredAt: timestamp
  }));
}

function activeEmploymentContract(input: KernelSyncInput, employment: EmploymentRecord): KernelContractState | null {
  const resident = input.population.residents.find((item) => item.id === employment.residentId);
  if (!resident) return null;
  const business = input.economy.businesses.find((item) => item.locationId === employment.locationId);
  const source = employment.organizationId ?? business?.id ?? kernelSystemEntityId(input.seed, "clearing");
  const status = employment.status === "unemployed" ? "ended" : employment.unpaidDays > 0 ? "breached" : employment.status === "absent" ? "suspended" : "active";
  return {
    id: employmentContractId(employment.id),
    kind: "employment",
    sourceEntityId: source,
    targetEntityId: resident.id,
    beneficiaryEntityId: resident.householdId,
    assetId: business ? assetId("business", business.id) : undefined,
    locationId: employment.locationId,
    status,
    startedAt: (employment.startedDay ?? input.population.dayIndex) * DAY_MS,
    endedAt: employment.endedDay ? employment.endedDay * DAY_MS : undefined,
    nextSettlementAt: (input.population.dayIndex + 1) * DAY_MS,
    breachCount: employment.unpaidDays,
    terms: [{ resource: "credits", amount: employment.wagePerDay, unitValue: 1, intervalMinutes: 24 * 60 }],
    metadata: {
      title: employment.title,
      shift: employment.shift,
      minimumSkill: employment.minimumSkill ?? 0,
      status: employment.status
    }
  };
}

function leaseContract(input: KernelSyncInput, household: HouseholdState): KernelContractState | null {
  if (!household.homeLocationId || household.kind === "unhoused") return null;
  const housing = input.population.housing.find((item) => item.locationId === household.homeLocationId);
  if (!housing) return null;
  const owner = housing.ownerOrganizationId ?? kernelSystemEntityId(input.seed, "housing-authority");
  return {
    id: leaseContractId(household.id),
    kind: "lease",
    sourceEntityId: household.id,
    targetEntityId: owner,
    assetId: assetId("housing", housing.id),
    locationId: housing.locationId,
    status: household.status === "displaced" ? "ended" : household.consecutiveRentMisses > 0 ? "breached" : "active",
    startedAt: input.timestamp - Math.max(1, household.moveCount + 1) * WEEK_MS,
    nextSettlementAt: (input.population.dayIndex + 1) * DAY_MS,
    breachCount: household.consecutiveRentMisses,
    terms: [{ resource: "credits", amount: Math.round(household.rentPerWeek / 7), unitValue: 1, intervalMinutes: 24 * 60 }],
    metadata: {
      members: household.memberIds.length,
      status: household.status,
      rentPerWeek: household.rentPerWeek
    }
  };
}

function supplyContract(input: KernelSyncInput, business: BusinessState): KernelContractState {
  const resource = resourceForSupply(business.supplyClass);
  return {
    id: supplyContractId(business.id),
    kind: "supply",
    sourceEntityId: kernelSystemEntityId(input.seed, "wholesale"),
    targetEntityId: business.id,
    assetId: assetId("business", business.id),
    locationId: business.locationId,
    status: business.status === "closed" ? "suspended" : "active",
    startedAt: input.timestamp - DAY_MS,
    nextSettlementAt: (input.population.dayIndex + 1) * DAY_MS,
    breachCount: business.shortage ? 1 : 0,
    terms: [{ resource, amount: Math.max(4, business.capacityLevel * 6), unitValue: Math.max(1, business.priceIndex / 100), intervalMinutes: 24 * 60 }],
    metadata: { supplyClass: business.supplyClass, targetStock: 72 + business.capacityLevel * 12, shortage: business.shortage }
  };
}

function utilityResource(kind: InfrastructureKind): KernelResource {
  if (kind === "power") return "energy-units";
  if (kind === "water") return "water-units";
  if (kind === "data") return "data-capacity";
  if (kind === "transport") return "transport-capacity";
  return "waste-capacity";
}

function utilityContracts(input: KernelSyncInput): KernelContractState[] {
  const result: KernelContractState[] = [];
  for (const network of input.infrastructure.networks) {
    for (const district of input.districts) {
      const services = input.infrastructure.services.filter((item) => item.networkId === network.id && item.districtId === district.id);
      const amount = services.reduce((sum, item) => sum + item.currentDemand, 0);
      const sourceNode = input.infrastructure.nodes.find((item) => item.networkId === network.id && item.role === "source");
      result.push({
        id: utilityContractId(network.id, district.id),
        kind: "utility",
        sourceEntityId: network.providerEntityId,
        targetEntityId: district.id,
        beneficiaryEntityId: district.id,
        assetId: sourceNode ? assetId("infrastructure-node", sourceNode.id) : undefined,
        status: network.status === "offline" ? "breached" : network.status === "restricted" ? "suspended" : "active",
        startedAt: input.timestamp,
        nextSettlementAt: input.timestamp + 24 * 60 * 60_000,
        breachCount: network.outageHours,
        terms: [{ resource: utilityResource(network.kind), amount, unitValue: network.tariffPerUnit, intervalMinutes: 24 * 60 }],
        metadata: { kind: network.kind, serviceLevel: network.averageServiceLevel, district: district.name }
      });
    }
  }
  return result;
}

function productionContract(input: KernelSyncInput, contractState: ProductionSupplyContract): KernelContractState {
  const source = input.production.facilities.find((item) => item.id === contractState.sourceFacilityId);
  const targetEntityId = contractState.targetFacilityId ?? contractState.targetBusinessId ?? kernelSystemEntityId(input.seed, "wholesale");
  return {
    id: productionContractId(contractState.id),
    kind: contractState.targetKind === "business" ? "logistics" : "procurement",
    sourceEntityId: contractState.sourceFacilityId,
    targetEntityId,
    beneficiaryEntityId: targetEntityId,
    assetId: source ? assetId("production-facility", source.id) : undefined,
    locationId: source?.locationId,
    status: contractState.status === "suspended" ? "suspended" : contractState.status === "breached" ? "breached" : "active",
    startedAt: input.timestamp - DAY_MS,
    nextSettlementAt: contractState.nextReviewAt,
    breachCount: contractState.breachCount,
    terms: [{ resource: resourceForProduction(contractState.resource), amount: contractState.batchSize, unitValue: contractState.unitPrice, intervalMinutes: 6 * 60 }],
    metadata: {
      resource: contractState.resource,
      reorderPoint: contractState.reorderPoint,
      targetStock: contractState.targetStock,
      legality: contractState.legality,
      targetKind: contractState.targetKind
    }
  };
}


function organizationAgreementContract(input: KernelSyncInput, agreement: OrganizationAgreementState): KernelContractState {
  const kind = agreement.kind === "supply-framework" ? "procurement"
    : agreement.kind === "service-concession" ? "service"
      : agreement.kind === "labor-compact" ? "employment"
        : agreement.kind === "joint-operation" ? "service"
          : "service";
  return {
    id: createStableEntityId("contract", `organization:${agreement.id}`),
    kind,
    sourceEntityId: agreement.sourceOrganizationId,
    targetEntityId: agreement.targetOrganizationId,
    beneficiaryEntityId: agreement.targetOrganizationId,
    status: agreement.status === "ended" ? "ended" : agreement.status === "breached" ? "breached" : agreement.status === "strained" ? "suspended" : "active",
    startedAt: agreement.startedAt,
    endedAt: agreement.endedAt,
    nextSettlementAt: agreement.reviewAt,
    breachCount: agreement.breachCount,
    terms: agreement.weeklyValue > 0 ? [{ resource: "credits", amount: agreement.weeklyValue, unitValue: 1, intervalMinutes: 7 * 24 * 60 }] : [],
    metadata: { kind: agreement.kind, linkedContracts: agreement.linkedContractIds.length, ...agreement.metadata }
  };
}

function governmentLicenseContracts(input: KernelSyncInput): KernelContractState[] {
  if (!input.government) return [];
  return input.government.licenses.map((license) => {
    const business = input.economy.businesses.find((item) => item.id === license.businessId);
    return {
      id: createStableEntityId("contract", `license:${license.id}`),
      kind: "license" as const,
      sourceEntityId: license.businessId,
      targetEntityId: input.government!.budget.authorityOrganizationId,
      beneficiaryEntityId: input.city.id,
      assetId: business ? assetId("business", business.id) : undefined,
      locationId: business?.locationId,
      status: license.status === "revoked" ? "ended" as const : license.status === "suspended" ? "suspended" as const : license.status === "probation" ? "breached" as const : "active" as const,
      startedAt: license.issuedAt,
      endedAt: license.status === "revoked" ? input.timestamp : undefined,
      nextSettlementAt: license.nextReviewAt,
      breachCount: license.violations,
      terms: [{ resource: "credits" as const, amount: license.feePerWeek, unitValue: 1, intervalMinutes: 7 * 24 * 60 }],
      metadata: { kind: license.kind, status: license.status, expiresAt: license.expiresAt }
    };
  });
}

function buildContracts(input: KernelSyncInput, previous: KernelContractState[]): KernelContractState[] {
  const generated = [
    ...input.population.employments.map((item) => activeEmploymentContract(input, item)).filter((item): item is KernelContractState => Boolean(item)),
    ...input.population.households.map((item) => leaseContract(input, item)).filter((item): item is KernelContractState => Boolean(item)),
    ...input.production.contracts.map((item) => productionContract(input, item)),
    ...utilityContracts(input),
    ...(input.organizationEcosystem?.agreements ?? []).map((item) => organizationAgreementContract(input, item)),
    ...governmentLicenseContracts(input)
  ];
  const generatedIds = new Set(generated.map((item) => item.id));
  const ended = previous
    .filter((item) => !generatedIds.has(item.id) && item.status !== "ended")
    .map((item) => ({ ...item, status: "ended" as const, endedAt: input.timestamp }));
  return [...generated, ...ended].slice(-2_500);
}

function applyTransaction(
  accounts: KernelAccountState[],
  transaction: KernelTransactionState,
  timestamp: number
): KernelAccountState[] {
  const next = [...accounts];
  const ensure = (entityId: string): number => {
    const existing = next.findIndex((item) => item.entityId === entityId);
    if (existing >= 0) return existing;
    next.push(account(entityId, "system", [], timestamp));
    return next.length - 1;
  };
  const debitIndex = ensure(transaction.debitEntityId);
  const creditIndex = ensure(transaction.creditEntityId);
  next[debitIndex] = setBalance(next[debitIndex], transaction.resource, getBalance(next[debitIndex], transaction.resource) - transaction.amount, timestamp);
  next[creditIndex] = setBalance(next[creditIndex], transaction.resource, getBalance(next[creditIndex], transaction.resource) + transaction.amount, timestamp);
  return next;
}

function transactionFromDraft(draft: KernelTransactionDraft): KernelTransactionState {
  return {
    ...draft,
    id: createStableEntityId("transaction", draft.idempotencyKey),
    amount: Math.max(0, Math.round(draft.amount * 100) / 100),
    balanceValue: Math.max(0, Math.round(draft.amount * (draft.unitValue ?? 1) * 100) / 100)
  };
}

function reconcileAccounts(
  accounts: KernelAccountState[],
  snapshot: KernelAccountState[],
  input: KernelSyncInput,
  existingIds: Set<string>
): { accounts: KernelAccountState[]; transactions: KernelTransactionState[] } {
  let nextAccounts = [...accounts];
  const transactions: KernelTransactionState[] = [];
  const clearing = kernelSystemEntityId(input.seed, "clearing");
  const protectedSystems = new Set([clearing, kernelSystemEntityId(input.seed, "wholesale"), kernelSystemEntityId(input.seed, "maintenance"), kernelSystemEntityId(input.seed, "credit-bureau"), kernelSystemEntityId(input.seed, "housing-authority"), kernelSystemEntityId(input.seed, "city-services"), kernelSystemEntityId(input.seed, "consumption"), kernelSystemEntityId(input.seed, "power-grid"), kernelSystemEntityId(input.seed, "water-grid"), kernelSystemEntityId(input.seed, "data-grid"), kernelSystemEntityId(input.seed, "transport-grid"), kernelSystemEntityId(input.seed, "waste-grid"), kernelSystemEntityId(input.seed, "logistics-clearing"), kernelSystemEntityId(input.seed, "external-trade"), kernelSystemEntityId(input.seed, "production-consumption"), kernelSystemEntityId(input.seed, "production-output"), kernelSystemEntityId(input.seed, "unregistered-market"), kernelSystemEntityId(input.seed, "illegal-consumption"), kernelSystemEntityId(input.seed, "corrupt-officials")]);

  for (const target of snapshot) {
    if (protectedSystems.has(target.entityId)) continue;
    let current = nextAccounts.find((item) => item.entityId === target.entityId);
    if (!current) {
      current = account(target.entityId, target.entityKind, [], input.timestamp);
      nextAccounts.push(current);
    }
    for (const desired of target.balances) {
      const actual = getBalance(current, desired.resource);
      const difference = Math.round((desired.amount - actual) * 100) / 100;
      if (Math.abs(difference) < 0.01) continue;
      const key = `${input.seed}:reconcile:${input.timestamp}:${target.entityId}:${desired.resource}:${difference}`;
      const transaction = transactionFromDraft({
        idempotencyKey: key,
        timestamp: input.timestamp,
        debitEntityId: difference > 0 ? clearing : target.entityId,
        creditEntityId: difference > 0 ? target.entityId : clearing,
        resource: desired.resource,
        amount: Math.abs(difference),
        reason: "domain-reconciliation",
        description: `Reconciled ${target.entityKind} state with simulation ledger.`
      });
      if (existingIds.has(transaction.id)) continue;
      existingIds.add(transaction.id);
      nextAccounts = applyTransaction(nextAccounts, transaction, input.timestamp);
      transactions.push(transaction);
      current = nextAccounts.find((item) => item.entityId === target.entityId) ?? current;
    }
  }
  return { accounts: nextAccounts, transactions };
}

function advanceClock(previous: SimulationKernelState["clock"] | undefined, timestamp: number): SimulationKernelState["clock"] {
  const last = previous?.lastAdvancedAt ?? timestamp;
  return {
    lastAdvancedAt: timestamp,
    minuteIndex: Math.floor(timestamp / MINUTE_MS),
    hourIndex: Math.floor(timestamp / HOUR_MS),
    dayIndex: Math.floor(timestamp / DAY_MS),
    weekIndex: Math.floor(timestamp / WEEK_MS),
    minutesAdvanced: Math.max(0, Math.floor(timestamp / MINUTE_MS) - Math.floor(last / MINUTE_MS)),
    hoursAdvanced: Math.max(0, Math.floor(timestamp / HOUR_MS) - Math.floor(last / HOUR_MS)),
    daysAdvanced: Math.max(0, Math.floor(timestamp / DAY_MS) - Math.floor(last / DAY_MS)),
    weeksAdvanced: Math.max(0, Math.floor(timestamp / WEEK_MS) - Math.floor(last / WEEK_MS))
  };
}

function integrityFor(
  input: KernelSyncInput,
  accounts: KernelAccountState[],
  assets: KernelAssetState[],
  ownership: KernelOwnershipState[],
  contracts: KernelContractState[],
  transactions: KernelTransactionState[]
): KernelIntegrityState {
  const allIds = [...accounts.map((item) => item.id), ...assets.map((item) => item.id), ...ownership.map((item) => item.id), ...contracts.map((item) => item.id), ...transactions.map((item) => item.id)];
  const duplicateIds = allIds.length - new Set(allIds).size;
  const assetIds = new Set(assets.map((item) => item.id));
  const entityIds = new Set(accounts.map((item) => item.entityId));
  const ownershipErrors = assets.filter((asset) => ownership.filter((item) => item.assetId === asset.id).reduce((sum, item) => sum + item.shareBasisPoints, 0) !== 10_000).length;
  const orphanReferences = ownership.filter((item) => !assetIds.has(item.assetId) || !entityIds.has(item.ownerEntityId)).length
    + contracts.filter((item) => !entityIds.has(item.sourceEntityId) || !entityIds.has(item.targetEntityId) || (item.assetId ? !assetIds.has(item.assetId) : false)).length;
  const negativePhysicalBalances = accounts.reduce((sum, item) => sum + (item.entityKind === "system" ? 0 : item.balances.filter((entry) => entry.resource !== "credits" && entry.amount < -0.01).length), 0);
  const reconciliation = transactions.filter((item) => item.reason === "domain-reconciliation");
  const reconciliationCreditVolume = reconciliation.filter((item) => item.resource === "credits").reduce((sum, item) => sum + item.amount, 0);
  const warnings: string[] = [];
  if (duplicateIds) warnings.push(`${duplicateIds} duplicate kernel identifiers.`);
  if (ownershipErrors) warnings.push(`${ownershipErrors} assets do not have exactly 100% registered ownership.`);
  if (orphanReferences) warnings.push(`${orphanReferences} contracts or ownership records reference missing entities.`);
  if (negativePhysicalBalances) warnings.push(`${negativePhysicalBalances} physical resource balances are negative.`);
  if (reconciliation.length > Math.max(40, input.population.households.length * 0.6)) warnings.push(`High reconciliation volume: ${reconciliation.length} domain adjustments.`);
  return {
    healthy: duplicateIds === 0 && ownershipErrors === 0 && orphanReferences === 0 && negativePhysicalBalances === 0,
    checkedAt: input.timestamp,
    duplicateIds,
    ownershipErrors,
    orphanReferences,
    negativePhysicalBalances,
    reconciliationTransactions: reconciliation.length,
    reconciliationCreditVolume,
    warnings
  };
}

function emptyTotals(): KernelTotalsState {
  return { transactions: 0, creditsTransferred: 0, physicalUnitsTransferred: 0, reconciliationTransactions: 0, reconciliationCreditVolume: 0, contractsCreated: 0, assetsTracked: 0 };
}

function addTransactionsToTotals(totals: KernelTotalsState, transactions: KernelTransactionState[]): KernelTotalsState {
  return {
    ...totals,
    transactions: totals.transactions + transactions.length,
    creditsTransferred: totals.creditsTransferred + transactions.filter((item) => item.resource === "credits").reduce((sum, item) => sum + item.amount, 0),
    physicalUnitsTransferred: totals.physicalUnitsTransferred + transactions.filter((item) => item.resource !== "credits").reduce((sum, item) => sum + item.amount, 0),
    reconciliationTransactions: totals.reconciliationTransactions + transactions.filter((item) => item.reason === "domain-reconciliation").length,
    reconciliationCreditVolume: totals.reconciliationCreditVolume + transactions.filter((item) => item.reason === "domain-reconciliation" && item.resource === "credits").reduce((sum, item) => sum + item.amount, 0)
  };
}

export function createSimulationKernel(input: KernelSyncInput): SimulationKernelState {
  const accounts = snapshotAccounts(input);
  const assets = buildAssets(input);
  const ownership = buildOwnership(assets, input.timestamp);
  const contracts = buildContracts(input, []);
  const integrity = integrityFor(input, accounts, assets, ownership, contracts, []);
  return {
    version: 1,
    clock: advanceClock(undefined, input.timestamp),
    accounts,
    assets,
    ownership,
    contracts,
    transactions: [],
    totals: { ...emptyTotals(), contractsCreated: contracts.length, assetsTracked: assets.length },
    integrity,
    lastUpdatedAt: input.timestamp
  };
}

export function normalizeSimulationKernel(value: unknown, input: KernelSyncInput): SimulationKernelState {
  if (!value || typeof value !== "object") return createSimulationKernel(input);
  const raw = value as Partial<SimulationKernelState>;
  if (raw.version !== 1 || !Array.isArray(raw.accounts) || !Array.isArray(raw.transactions)) return createSimulationKernel(input);
  return advanceSimulationKernel({
    version: 1,
    clock: raw.clock ?? advanceClock(undefined, input.timestamp),
    accounts: raw.accounts,
    assets: Array.isArray(raw.assets) ? raw.assets : [],
    ownership: Array.isArray(raw.ownership) ? raw.ownership : [],
    contracts: Array.isArray(raw.contracts) ? raw.contracts : [],
    transactions: raw.transactions,
    totals: raw.totals ?? emptyTotals(),
    integrity: raw.integrity ?? integrityFor(input, raw.accounts, [], [], [], raw.transactions),
    lastUpdatedAt: raw.lastUpdatedAt ?? input.timestamp
  }, input);
}

export function advanceSimulationKernel(state: SimulationKernelState, input: KernelSyncInput): SimulationKernelState {
  const existingIds = new Set(state.transactions.map((item) => item.id));
  let accounts = state.accounts.map((item) => ({ ...item, balances: item.balances.map((entry) => ({ ...entry })) }));
  const newTransactions: KernelTransactionState[] = [];

  for (const draft of input.drafts ?? []) {
    if (draft.amount <= 0) continue;
    const transaction = transactionFromDraft(draft);
    if (existingIds.has(transaction.id)) continue;
    existingIds.add(transaction.id);
    accounts = applyTransaction(accounts, transaction, input.timestamp);
    newTransactions.push(transaction);
  }

  const snapshot = snapshotAccounts(input);
  const reconciled = reconcileAccounts(accounts, snapshot, input, existingIds);
  accounts = reconciled.accounts;
  newTransactions.push(...reconciled.transactions);

  const assets = buildAssets(input);
  const ownership = buildOwnership(assets, input.timestamp);
  const contracts = buildContracts(input, state.contracts);
  const transactions = [...state.transactions, ...newTransactions].slice(-MAX_TRANSACTIONS);
  const previousContractIds = new Set(state.contracts.map((item) => item.id));
  const totals = {
    ...addTransactionsToTotals(state.totals, newTransactions),
    contractsCreated: state.totals.contractsCreated + contracts.filter((item) => !previousContractIds.has(item.id)).length,
    assetsTracked: assets.length
  };
  const integrity = integrityFor(input, accounts, assets, ownership, contracts, newTransactions);
  return {
    version: 1,
    clock: advanceClock(state.clock, input.timestamp),
    accounts,
    assets,
    ownership,
    contracts,
    transactions,
    totals,
    integrity,
    lastUpdatedAt: input.timestamp
  };
}
