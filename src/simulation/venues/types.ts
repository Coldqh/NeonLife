import type { EntityId } from "../../core/ids/entityId";
import type { VenueCategory, VenueState } from "../urban/types";

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
  status: "operating" | "closed" | "renovation" | "vacant" | "insolvent";
  cash: number;
  revenueToday: number;
  expensesToday: number;
  staffPresent: number;
  serviceCapacityPerHour: number;
  queue: VenueQueueState;
  offers: VenueOfferState[];
  lastRestockedAt: number;
  lastUpdatedAt: number;
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
  stockUnits: number;
}

export interface VenueOperationsState {
  version: 1;
  operations: VenueOperationState[];
  receipts: VenueReceiptState[];
  totals: VenueOperationsTotalsState;
  lastProcessedDay: number;
  lastUpdatedAt: number;
}

export interface VenueOperationsInput {
  seed: string;
  timestamp: number;
  venues: VenueState[];
}

export interface VenuePurchaseResult {
  state: VenueOperationsState;
  operation: VenueOperationState;
  offer: VenueOfferState;
  price: number;
  receipt: VenueReceiptState;
}
