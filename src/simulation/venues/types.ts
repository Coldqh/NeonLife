import type { EntityId } from "../../core/ids/entityId";
import type { VenueCategory, VenueOperatingStatus, VenueState } from "../urban/types";

export type VenueOfferKind =
  | "food-goods"
  | "meal"
  | "medical"
  | "vehicle-service"
  | "lodging"
  | "entertainment"
  | "apparel"
  | "office-service"
  | "cyberware";

export interface VenueOfferEffects {
  healthDelta?: number;
  fatigueDelta?: number;
  stressDelta?: number;
  hungerDelta?: number;
  vehicleConditionDelta?: number;
  vehicleFuelDelta?: number;
}

export interface VenueOfferState {
  id: EntityId;
  venueId: EntityId;
  code: string;
  name: string;
  description: string;
  kind: VenueOfferKind;
  productId?: string;
  basePrice: number;
  currentPrice: number;
  stock: number;
  maxStock: number;
  durationMinutes: number;
  effects: VenueOfferEffects;
  active: boolean;
}

export type VenueQueuePlayerState = "none" | "waiting" | "ready";

export interface VenueQueueState {
  venueId: EntityId;
  waitingCount: number;
  estimatedWaitMinutes: number;
  playerState: VenueQueuePlayerState;
  playerJoinedAt?: number;
  playerReadyAt?: number;
  servedToday: number;
  abandonedToday: number;
}

export interface VenueOperationState {
  venueId: EntityId;
  category: VenueCategory;
  status: VenueOperatingStatus;
  cash: number;
  revenueToday: number;
  expensesToday: number;
  lifetimeRevenue: number;
  lifetimeExpenses: number;
  staffPresent: number;
  serviceCapacityPerHour: number;
  queue: VenueQueueState;
  offers: VenueOfferState[];
  lastRestockedAt: number;
  lastUpdatedAt: number;
}

export interface VenueRegistryEntryState {
  venue: VenueState;
  materialized: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
}

export type VenueSupplyOrderStatus = "ordered" | "in-transit" | "delivered" | "cancelled";

export interface VenueSupplyOrderState {
  id: EntityId;
  venueId: EntityId;
  offerId: EntityId;
  supplierEntityId: EntityId;
  quantity: number;
  unitCost: number;
  totalCost: number;
  orderedAt: number;
  arrivesAt: number;
  deliveredAt?: number;
  status: VenueSupplyOrderStatus;
}

export type VenueLedgerKind = "sale" | "payroll" | "utilities" | "rent" | "supplies" | "tax";

export interface VenueLedgerEntryState {
  id: EntityId;
  idempotencyKey: string;
  timestamp: number;
  venueId: EntityId;
  kind: VenueLedgerKind;
  debitEntityId: EntityId;
  creditEntityId: EntityId;
  amount: number;
  description: string;
  postToKernel: boolean;
}

export interface VenueReceiptState {
  id: EntityId;
  venueId: EntityId;
  offerId: EntityId;
  offerName: string;
  amount: number;
  timestamp: number;
}

export interface VenueOperationsTotalsState {
  operatingVenues: number;
  closedVenues: number;
  waitingCustomers: number;
  sales: number;
  revenue: number;
  expenses: number;
  stockUnits: number;
  pendingSupplyOrders: number;
}

export interface VenueOperationsState {
  version: 2;
  operations: VenueOperationState[];
  registry: VenueRegistryEntryState[];
  supplyOrders: VenueSupplyOrderState[];
  ledger: VenueLedgerEntryState[];
  receipts: VenueReceiptState[];
  totals: VenueOperationsTotalsState;
  lastProcessedDay: number;
  lastUpdatedAt: number;
}

export interface VenueOperationsInput {
  seed: string;
  timestamp: number;
  venues: VenueState[];
  landlordByBuildingId?: Record<EntityId, EntityId>;
  externallyManaged?: boolean;
}

export interface VenuePurchaseResult {
  state: VenueOperationsState;
  operation: VenueOperationState;
  offer: VenueOfferState;
  price: number;
  receipt: VenueReceiptState;
}
