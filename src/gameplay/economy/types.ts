import type { EntityId } from "../../core/ids/entityId";

export type BusinessKind = "retail" | "food-service" | "medical" | "repair" | "logistics" | "corporate";
export type BusinessStatus = "stable" | "strained" | "restricted" | "closed";
export type SupplyClass = "food" | "medical" | "parts" | "documents" | "mixed";

export interface BusinessState {
  id: EntityId;
  locationId: EntityId;
  organizationId?: EntityId;
  kind: BusinessKind;
  supplyClass: SupplyClass;
  cash: number;
  stock: number;
  staffing: number;
  demand: number;
  priceIndex: number;
  status: BusinessStatus;
  shortage: boolean;
  capacityLevel: number;
  targetStaff: number;
  revenueToday: number;
  operatingCostsToday: number;
  payrollToday: number;
  supplierCostsToday: number;
  utilityCostsToday: number;
  infrastructureServiceLevel: number;
  rollingProfit: number;
  profitableDays: number;
  lossDays: number;
  lastSettlementDay: number;
  lastStatusChangeAt: number;
  lastUpdatedAt: number;
}

export interface LocalEconomyState {
  businesses: BusinessState[];
  lastUpdatedAt: number;
  cycle: number;
}

export interface EconomyNotice {
  locationId: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
  previousStatus: BusinessStatus;
  status: BusinessStatus;
}
