import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { VenueState } from "../urban/types";
import { createVenueOffers } from "./catalog";
import type {
  VenueOperationState,
  VenueOperationsInput,
  VenueOperationsState,
  VenueOperationsTotalsState,
  VenuePurchaseResult,
  VenueQueueState,
  VenueReceiptState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const MAX_RECEIPTS = 80;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function venueIsOpenAt(venue: VenueState, timestamp: number): boolean {
  if (!venue.active || venue.operatingStatus !== "operating") return false;
  if (venue.openHour === 0 && venue.closeHour === 24) return true;
  const hour = new Date(timestamp).getUTCHours();
  return venue.openHour < venue.closeHour
    ? hour >= venue.openHour && hour < venue.closeHour
    : hour >= venue.openHour || hour < venue.closeHour;
}

function queueFor(venue: VenueState, timestamp: number): VenueQueueState {
  const hour = new Date(timestamp).getUTCHours();
  const rush = hour >= 7 && hour <= 9 || hour >= 17 && hour <= 21 ? 1.45 : hour >= 0 && hour <= 5 ? .35 : 1;
  const open = venueIsOpenAt(venue, timestamp);
  const base = open ? Math.round((venue.demand * .045 + venue.popularity * .035) * rush * Math.max(.35, 1.25 - venue.staffing / 140)) : 0;
  const waitingCount = clamp(base, 0, 18);
  const serviceCapacityPerHour = Math.max(2, Math.round(2 + venue.staffing / 15));
  return {
    venueId: venue.id,
    waitingCount,
    estimatedWaitMinutes: waitingCount ? Math.max(2, Math.ceil(waitingCount / serviceCapacityPerHour * 60)) : 0,
    playerState: "none",
    servedToday: 0,
    abandonedToday: 0
  };
}

function operationFor(seed: string, timestamp: number, venue: VenueState): VenueOperationState {
  const rng = new SeededRandom(`${seed}:venue-operation:${venue.id}:v1`);
  const queue = queueFor(venue, timestamp);
  const status = venue.operatingStatus === "operating" && venue.active ? "operating" : venue.operatingStatus;
  return {
    venueId: venue.id,
    category: venue.category,
    status,
    cash: rng.integer(280, 8_000) * Math.max(1, venue.priceTier),
    revenueToday: 0,
    expensesToday: 0,
    staffPresent: status === "operating" && venueIsOpenAt(venue, timestamp) ? Math.max(1, Math.round(venue.staffing / 17)) : 0,
    serviceCapacityPerHour: Math.max(2, Math.round(2 + venue.staffing / 15)),
    queue,
    offers: createVenueOffers(venue),
    lastRestockedAt: timestamp,
    lastUpdatedAt: timestamp
  };
}

function totals(operations: VenueOperationState[], _receipts: VenueReceiptState[]): VenueOperationsTotalsState {
  return {
    operatingVenues: operations.filter((item) => item.status === "operating").length,
    closedVenues: operations.filter((item) => item.status !== "operating").length,
    waitingCustomers: operations.reduce((sum, item) => sum + item.queue.waitingCount, 0),
    sales: operations.reduce((sum, item) => sum + item.queue.servedToday, 0),
    revenue: operations.reduce((sum, item) => sum + item.revenueToday, 0),
    stockUnits: operations.reduce((sum, item) => sum + item.offers.reduce((offerSum, offer) => offerSum + offer.stock, 0), 0)
  };
}

function simulateAmbientTrade(
  offers: VenueOperationState["offers"],
  customerCount: number
): { offers: VenueOperationState["offers"]; served: number; revenue: number } {
  if (customerCount <= 0) return { offers, served: 0, revenue: 0 };
  const next = offers.map((offer) => ({ ...offer }));
  let served = 0;
  let revenue = 0;
  for (let customer = 0; customer < customerCount; customer += 1) {
    const available = next.filter((offer) => offer.active && offer.stock > 0);
    if (!available.length) break;
    const offer = available[customer % available.length];
    offer.stock -= 1;
    served += 1;
    revenue += offer.currentPrice;
  }
  return { offers: next, served, revenue };
}

export function createVenueOperationsState(input: VenueOperationsInput): VenueOperationsState {
  const operations = input.venues.map((venue) => operationFor(input.seed, input.timestamp, venue));
  return {
    version: 1,
    operations,
    receipts: [],
    totals: totals(operations, []),
    lastProcessedDay: Math.floor(input.timestamp / DAY_MS),
    lastUpdatedAt: input.timestamp
  };
}

function refreshOperation(
  previous: VenueOperationState | undefined,
  venue: VenueState,
  input: VenueOperationsInput,
  dayChanged: boolean
): VenueOperationState {
  const base = previous ?? operationFor(input.seed, input.timestamp, venue);
  const open = venueIsOpenAt(venue, input.timestamp);
  const generatedQueue = queueFor(venue, input.timestamp);
  const playerReady = base.queue.playerState === "waiting" && (base.queue.playerReadyAt ?? Number.POSITIVE_INFINITY) <= input.timestamp;
  const queue: VenueQueueState = {
    ...generatedQueue,
    servedToday: dayChanged ? 0 : base.queue.servedToday,
    abandonedToday: dayChanged ? 0 : base.queue.abandonedToday,
    playerState: playerReady ? "ready" : base.queue.playerState,
    playerJoinedAt: base.queue.playerJoinedAt,
    playerReadyAt: base.queue.playerReadyAt,
    waitingCount: Math.max(generatedQueue.waitingCount, base.queue.playerState === "waiting" ? 1 : 0)
  };
  const shouldRestock = dayChanged || input.timestamp - base.lastRestockedAt >= DAY_MS;
  const restockedOffers = createVenueOffers(venue).map((fresh) => {
    const old = base.offers.find((offer) => offer.id === fresh.id);
    if (!old) return fresh;
    return {
      ...fresh,
      stock: shouldRestock ? Math.min(fresh.maxStock, old.stock + Math.max(1, Math.round(fresh.maxStock * .55))) : Math.min(fresh.maxStock, old.stock),
      active: fresh.active
    };
  });
  const elapsedMinutes = Math.max(0, Math.min(24 * 60, Math.floor((input.timestamp - base.lastUpdatedAt) / 60_000)));
  const staffPresent = open ? Math.max(1, Math.round(venue.staffing / 17)) : 0;
  const serviceCapacityPerHour = Math.max(2, Math.round(2 + venue.staffing / 15));
  const expectedCustomers = open && elapsedMinutes >= 15
    ? Math.min(120, Math.floor(elapsedMinutes / 60 * serviceCapacityPerHour * (.18 + venue.demand / 145)))
    : 0;
  const ambient = simulateAmbientTrade(restockedOffers, expectedCustomers);
  const payrollAndUtilities = open ? Math.round(elapsedMinutes / 60 * staffPresent * (2.5 + venue.priceTier * .7)) : 0;
  const dailyOverhead = dayChanged ? Math.round(45 + venue.priceTier * 35 + venue.staffing * .8) : 0;
  const expenseDelta = payrollAndUtilities + dailyOverhead;
  const revenueToday = (dayChanged ? 0 : base.revenueToday) + ambient.revenue;
  const expensesToday = (dayChanged ? 0 : base.expensesToday) + expenseDelta;
  const cash = base.cash + ambient.revenue - expenseDelta;
  const venueStatus = venue.operatingStatus === "operating" && venue.active ? "operating" : venue.operatingStatus;
  const status = venueStatus === "operating" && cash < -1_500 ? "insolvent" as const : venueStatus;
  return {
    ...base,
    category: venue.category,
    status,
    cash,
    revenueToday,
    expensesToday,
    staffPresent,
    serviceCapacityPerHour,
    queue: { ...queue, servedToday: queue.servedToday + ambient.served },
    offers: ambient.offers,
    lastRestockedAt: shouldRestock ? input.timestamp : base.lastRestockedAt,
    lastUpdatedAt: input.timestamp
  };
}

export function advanceVenueOperationsState(state: VenueOperationsState | undefined, input: VenueOperationsInput): VenueOperationsState {
  if (!state || state.version !== 1 || !Array.isArray(state.operations)) return createVenueOperationsState(input);
  if (input.timestamp < state.lastUpdatedAt) return state;
  const previousById = new Map(state.operations.map((operation) => [operation.venueId, operation]));
  const day = Math.floor(input.timestamp / DAY_MS);
  const dayChanged = day !== state.lastProcessedDay;
  const operations = input.venues.map((venue) => refreshOperation(previousById.get(venue.id), venue, input, dayChanged));
  const receipts = Array.isArray(state.receipts) ? state.receipts.slice(-MAX_RECEIPTS) : [];
  return {
    version: 1,
    operations,
    receipts,
    totals: totals(operations, receipts),
    lastProcessedDay: day,
    lastUpdatedAt: input.timestamp
  };
}

export function joinVenueQueueState(state: VenueOperationsState, venueId: string, timestamp: number): { state: VenueOperationsState; waitMinutes: number } | null {
  const operation = state.operations.find((item) => item.venueId === venueId);
  if (!operation || operation.status !== "operating") return null;
  if (operation.queue.playerState === "ready") return { state, waitMinutes: 0 };
  const waitMinutes = Math.max(1, operation.queue.estimatedWaitMinutes);
  const operations = state.operations.map((item) => item.venueId !== venueId ? item : {
    ...item,
    queue: {
      ...item.queue,
      playerState: "waiting" as const,
      playerJoinedAt: timestamp,
      playerReadyAt: timestamp + waitMinutes * 60_000,
      waitingCount: Math.max(1, item.queue.waitingCount)
    }
  });
  return { state: { ...state, operations, totals: totals(operations, state.receipts), lastUpdatedAt: timestamp }, waitMinutes };
}

export function leaveVenueQueueState(state: VenueOperationsState, venueId: string, timestamp: number): VenueOperationsState {
  const operations = state.operations.map((item) => item.venueId !== venueId ? item : {
    ...item,
    queue: {
      ...item.queue,
      playerState: "none" as const,
      playerJoinedAt: undefined,
      playerReadyAt: undefined,
      abandonedToday: item.queue.abandonedToday + (item.queue.playerState === "waiting" ? 1 : 0)
    }
  });
  return { ...state, operations, totals: totals(operations, state.receipts), lastUpdatedAt: timestamp };
}

export function purchaseVenueOfferState(
  state: VenueOperationsState,
  venueId: string,
  offerId: string,
  timestamp: number
): VenuePurchaseResult | null {
  const operation = state.operations.find((item) => item.venueId === venueId);
  const offer = operation?.offers.find((item) => item.id === offerId);
  if (!operation || !offer || operation.status !== "operating" || !offer.active || offer.stock <= 0) return null;
  if (operation.queue.estimatedWaitMinutes > 0 && operation.queue.playerState !== "ready") return null;
  const price = offer.currentPrice;
  const receipt: VenueReceiptState = {
    id: createStableEntityId("venue-receipt", `${venueId}:${offerId}:${timestamp}:${state.receipts.length}`),
    venueId,
    offerId,
    offerName: offer.name,
    amount: price,
    timestamp
  };
  const operations = state.operations.map((item) => item.venueId !== venueId ? item : {
    ...item,
    cash: item.cash + price,
    revenueToday: item.revenueToday + price,
    offers: item.offers.map((candidate) => candidate.id === offerId ? { ...candidate, stock: Math.max(0, candidate.stock - 1) } : candidate),
    queue: {
      ...item.queue,
      playerState: "none" as const,
      playerJoinedAt: undefined,
      playerReadyAt: undefined,
      waitingCount: Math.max(0, item.queue.waitingCount - 1),
      servedToday: item.queue.servedToday + 1
    },
    lastUpdatedAt: timestamp
  });
  const receipts = [...state.receipts, receipt].slice(-MAX_RECEIPTS);
  const next = { ...state, operations, receipts, totals: totals(operations, receipts), lastUpdatedAt: timestamp };
  return { state: next, operation: operations.find((item) => item.venueId === venueId)!, offer: { ...offer, stock: offer.stock - 1 }, price, receipt };
}
