import type { EntityId } from "../../core/ids/entityId";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { ProductInventoryState } from "../inventory/types";
import type { KernelTransactionDraft, SimulationKernelState } from "../kernel/types";
import type { MetropolitanState } from "../spatial/types";
import type { UrbanFabricState, VenueCategory, VenueOperatingStatus } from "../urban/types";
import type { WorldCoreState } from "../worldCore/types";
import type { DistrictState, LocationState, OrganizationState } from "../../world/state/types";
import type { PopulationState } from "../population/types";
import type { GovernmentCrimeState } from "../government/types";
import type { InfrastructureState } from "../infrastructure/types";

export type BusinessCompanyKind = "corporate" | "independent" | "franchise" | "cooperative" | "public" | "criminal";
export type BusinessCompanyStatus = "active" | "strained" | "insolvent" | "dissolved";
export type BusinessStrategy = "value" | "premium" | "volume" | "specialist" | "expansion" | "survival";
export type BusinessLeaseStatus = "active" | "arrears" | "terminated" | "owner-occupied";
export type BusinessLicenseStatus = "active" | "probation" | "suspended" | "revoked" | "unlicensed";
export type BusinessLifecycleEventKind = "opened" | "closed" | "bankrupt" | "reopened" | "lease-default" | "license-suspended" | "acquired";

export interface BusinessCompanyState {
  id: EntityId;
  name: string;
  kind: BusinessCompanyKind;
  parentOrganizationId?: EntityId;
  founderResidentId?: EntityId;
  businessIds: EntityId[];
  strategy: BusinessStrategy;
  status: BusinessCompanyStatus;
  treasury: number;
  debt: number;
  reputation: number;
  foundedDay: number;
  dissolvedDay?: number;
  lastUpdatedAt: number;
}

export interface UnifiedBusinessState {
  id: EntityId;
  venueId?: EntityId;
  aliases: EntityId[];
  companyId: EntityId;
  ownerEntityId: EntityId;
  operatorEntityId: EntityId;
  landlordEntityId: EntityId;
  districtId: EntityId;
  sectorId: EntityId;
  buildingId: EntityId;
  unitId: EntityId;
  locationId?: EntityId;
  name: string;
  category: VenueCategory | "logistics" | "corporate" | "education" | "government" | "transport";
  status: VenueOperatingStatus | "restricted" | "strained";
  companyKind: BusinessCompanyKind;
  strategy: BusinessStrategy;
  materialized: boolean;
  inventoryId: EntityId;
  licenseStatus: BusinessLicenseStatus;
  foundedDay: number;
  closedDay?: number;
  priceIndex: number;
  reputation: number;
  quality: number;
  demandScore: number;
  marketShare: number;
  targetStaff: number;
  activeWorkers: number;
  serviceCapacity: number;
  stockUnits: number;
  inventoryValue: number;
  cash: number;
  debt: number;
  revenueToday: number;
  expensesToday: number;
  profitToday: number;
  lifetimeRevenue: number;
  lifetimeExpenses: number;
  consecutiveLossDays: number;
  rentArrearsDays: number;
  taxArrears: number;
  lastOpenedAt?: number;
  lastClosedAt?: number;
  lastUpdatedAt: number;
}

export interface BusinessLeaseState {
  id: EntityId;
  businessId: EntityId;
  premisesId: EntityId;
  landlordEntityId: EntityId;
  tenantCompanyId: EntityId;
  monthlyRent: number;
  deposit: number;
  status: BusinessLeaseStatus;
  startedDay: number;
  nextPaymentDay: number;
  arrearsDays: number;
  terminatedDay?: number;
}

export interface BusinessMarketState {
  id: EntityId;
  districtId: EntityId;
  category: UnifiedBusinessState["category"];
  representedPopulation: number;
  activeBusinessIds: EntityId[];
  dailyDemandUnits: number;
  suppliedUnits: number;
  unmetDemandUnits: number;
  averagePriceIndex: number;
  concentration: number;
  openingsToday: number;
  closuresToday: number;
  lastUpdatedDay: number;
}

export interface BusinessLifecycleEventState {
  id: EntityId;
  businessId: EntityId;
  companyId: EntityId;
  districtId: EntityId;
  kind: BusinessLifecycleEventKind;
  dayIndex: number;
  timestamp: number;
  detail: string;
}

export interface BusinessEconomyDailySnapshot {
  dayIndex: number;
  activeBusinesses: number;
  insolventBusinesses: number;
  closedBusinesses: number;
  openings: number;
  closures: number;
  revenue: number;
  expenses: number;
  profit: number;
  unitsSold: number;
  unmetDemandUnits: number;
  independentShare: number;
  marketConcentration: number;
}

export interface BusinessEconomyTotals {
  companies: number;
  businesses: number;
  activeBusinesses: number;
  materializedBusinesses: number;
  leases: number;
  openings: number;
  closures: number;
  bankruptcies: number;
  acquisitions: number;
  revenue: number;
  expenses: number;
  unitsSold: number;
  taxesPaid: number;
  rentPaid: number;
  payrollPaid: number;
}

export interface BusinessEconomyIntegrityState {
  healthy: boolean;
  checkedAt: number;
  duplicateBusinessIds: number;
  duplicateVenueLinks: number;
  orphanCompanies: number;
  orphanLeases: number;
  missingPremises: number;
  missingInventories: number;
  cashDrift: number;
  warnings: string[];
}

export interface BusinessEconomyState {
  version: 1;
  companies: BusinessCompanyState[];
  businesses: UnifiedBusinessState[];
  leases: BusinessLeaseState[];
  markets: BusinessMarketState[];
  events: BusinessLifecycleEventState[];
  history: BusinessEconomyDailySnapshot[];
  totals: BusinessEconomyTotals;
  integrity: BusinessEconomyIntegrityState;
  lastProcessedDay: number;
  simulatedDays: number;
  lastUpdatedAt: number;
}

export interface BusinessEconomyInput {
  seed: string;
  timestamp: number;
  playerId: EntityId;
  districts: DistrictState[];
  locations: LocationState[];
  organizations: OrganizationState[];
  metropolitan: MetropolitanState;
  urban: UrbanFabricState;
  population: PopulationState;
  government: GovernmentCrimeState;
  infrastructure: InfrastructureState;
  economy: LocalEconomyState;
  worldCore: WorldCoreState;
  productInventory: ProductInventoryState;
  kernel?: SimulationKernelState;
  previous?: BusinessEconomyState;
}

export interface BusinessEconomyAdvanceResult {
  state: BusinessEconomyState;
  worldCore: WorldCoreState;
  productInventory: ProductInventoryState;
  urban: UrbanFabricState;
  economy: LocalEconomyState;
  drafts: KernelTransactionDraft[];
}
