import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { VenueOperatingStatus, VenueState } from "../urban/types";
import { createVenueOffers } from "./catalog";
import type {
  VenueLedgerEntryState,
  VenueOperationState,
  VenueOperationsInput,
  VenueOperationsState,
  VenueOperationsTotalsState,
  VenuePurchaseResult,
  VenueQueueState,
  VenueReceiptState,
  VenueRegistryEntryState,
  VenueSupplyOrderState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const MAX_RECEIPTS = 80;
const MAX_LEDGER_ENTRIES = 1_200;
const MAX_SUPPLY_ORDERS = 800;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function operationAccountId(venueId: string): string {
  return `venue-account:${venueId}`;
}

function consumerPoolId(venue: VenueState): string {
  return `consumer-pool:${venue.districtId}`;
}

function supplierId(venue: VenueState): string {
  return `supplier:${venue.districtId}:${venue.category}`;
}

function utilityProviderId(venue: VenueState): string {
  return `utility-provider:${venue.districtId}`;
}

function staffPoolId(venue: VenueState): string {
  return `venue-staff:${venue.id}`;
}

function landlordId(venue: VenueState, input: VenueOperationsInput): string {
  return input.landlordByBuildingId?.[venue.buildingId] ?? venue.organizationId ?? `landlord:${venue.buildingId}`;
}

export function venueIsOpenAt(venue: VenueState, timestamp: number): boolean {
  if (!venue.active || venue.operatingStatus !== "operating") return false;
  if (venue.openHour === 0 && venue.closeHour === 24) return true;
  const hour = new Date(timestamp).getUTCHours();
  return venue.openHour < venue.closeHour
    ? hour >= venue.openHour && hour < venue.closeHour
    : hour >= venue.openHour || hour < venue.closeHour;
}

function overlapMinutes(start: number, end: number, intervalStart: number, intervalEnd: number): number {
  return Math.max(0, Math.min(end, intervalEnd) - Math.max(start, intervalStart)) / 60_000;
}

function openMinutesBetween(venue: VenueState, start: number, end: number): number {
  if (!venue.active || venue.operatingStatus !== "operating" || end <= start) return 0;
  if (venue.openHour === 0 && venue.closeHour === 24) return (end - start) / 60_000;
  let minutes = 0;
  const firstDay = Math.floor(start / DAY_MS) - 1;
  const lastDay = Math.floor((end - 1) / DAY_MS) + 1;
  for (let day = firstDay; day <= lastDay; day += 1) {
    const dayStart = day * DAY_MS;
    if (venue.openHour < venue.closeHour) {
      minutes += overlapMinutes(start, end, dayStart + venue.openHour * HOUR_MS, dayStart + venue.closeHour * HOUR_MS);
    } else {
      minutes += overlapMinutes(start, end, dayStart + venue.openHour * HOUR_MS, dayStart + DAY_MS);
      minutes += overlapMinutes(start, end, dayStart, dayStart + venue.closeHour * HOUR_MS);
    }
  }
  return minutes;
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
  const rng = new SeededRandom(`${seed}:venue-operation:${venue.id}:v2`);
  const queue = queueFor(venue, timestamp);
  const status = venue.operatingStatus;
  return {
    venueId: venue.id,
    category: venue.category,
    status,
    cash: rng.integer(280, 8_000) * Math.max(1, venue.priceTier),
    revenueToday: 0,
    expensesToday: 0,
    lifetimeRevenue: 0,
    lifetimeExpenses: 0,
    staffPresent: status === "operating" && venueIsOpenAt(venue, timestamp) ? Math.max(1, Math.round(venue.staffing / 17)) : 0,
    serviceCapacityPerHour: Math.max(2, Math.round(2 + venue.staffing / 15)),
    queue,
    offers: createVenueOffers(venue),
    lastRestockedAt: timestamp,
    lastUpdatedAt: timestamp
  };
}

function migrateOperation(seed: string, timestamp: number, venue: VenueState, value: Partial<VenueOperationState> | undefined): VenueOperationState {
  const fresh = operationFor(seed, timestamp, venue);
  if (!value) return fresh;
  return {
    ...fresh,
    ...value,
    venueId: venue.id,
    category: venue.category,
    status: value.status ?? venue.operatingStatus,
    lifetimeRevenue: value.lifetimeRevenue ?? value.revenueToday ?? 0,
    lifetimeExpenses: value.lifetimeExpenses ?? value.expensesToday ?? 0,
    queue: { ...fresh.queue, ...value.queue, venueId: venue.id },
    offers: Array.isArray(value.offers) ? value.offers : fresh.offers,
    lastUpdatedAt: typeof value.lastUpdatedAt === "number" ? value.lastUpdatedAt : timestamp
  };
}

function totals(operations: VenueOperationState[], supplyOrders: VenueSupplyOrderState[]): VenueOperationsTotalsState {
  return {
    operatingVenues: operations.filter((item) => item.status === "operating").length,
    closedVenues: operations.filter((item) => item.status !== "operating").length,
    waitingCustomers: operations.reduce((sum, item) => sum + item.queue.waitingCount, 0),
    sales: operations.reduce((sum, item) => sum + item.queue.servedToday, 0),
    revenue: operations.reduce((sum, item) => sum + item.revenueToday, 0),
    expenses: operations.reduce((sum, item) => sum + item.expensesToday, 0),
    stockUnits: operations.reduce((sum, item) => sum + item.offers.reduce((offerSum, offer) => offerSum + offer.stock, 0), 0),
    pendingSupplyOrders: supplyOrders.filter((item) => item.status === "ordered" || item.status === "in-transit").length
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

function ledgerEntry(
  venue: VenueState,
  timestamp: number,
  kind: VenueLedgerEntryState["kind"],
  debitEntityId: string,
  creditEntityId: string,
  amount: number,
  description: string,
  postToKernel = true
): VenueLedgerEntryState | null {
  const rounded = Math.max(0, Math.round(amount));
  if (!rounded) return null;
  const idempotencyKey = `${venue.id}:${kind}:${timestamp}:${debitEntityId}:${creditEntityId}:${rounded}:${description}`;
  return {
    id: createStableEntityId("venue-ledger", idempotencyKey),
    idempotencyKey,
    timestamp,
    venueId: venue.id,
    kind,
    debitEntityId,
    creditEntityId,
    amount: rounded,
    description,
    postToKernel
  };
}

function nextDayBoundary(timestamp: number): number {
  return (Math.floor(timestamp / DAY_MS) + 1) * DAY_MS;
}

function supplyDelayHours(seed: string, venueId: string, offerId: string, timestamp: number): number {
  const rng = new SeededRandom(`${seed}:venue-supply-delay:${venueId}:${offerId}:${Math.floor(timestamp / DAY_MS)}`);
  return rng.integer(6, 18);
}

function processDeliveredOrders(
  operation: VenueOperationState,
  orders: VenueSupplyOrderState[],
  timestamp: number
): { operation: VenueOperationState; orders: VenueSupplyOrderState[] } {
  let delivered = false;
  const nextOrders = orders.map((order) => {
    if (order.venueId !== operation.venueId || order.status === "delivered" || order.status === "cancelled" || order.arrivesAt > timestamp) return order;
    delivered = true;
    return { ...order, status: "delivered" as const, deliveredAt: timestamp };
  });
  if (!delivered) return { operation, orders: nextOrders };
  const deliveredByOffer = new Map<string, number>();
  for (const order of nextOrders) {
    if (order.venueId !== operation.venueId || order.status !== "delivered" || order.deliveredAt !== timestamp) continue;
    deliveredByOffer.set(order.offerId, (deliveredByOffer.get(order.offerId) ?? 0) + order.quantity);
  }
  return {
    operation: {
      ...operation,
      offers: operation.offers.map((offer) => ({
        ...offer,
        stock: Math.min(offer.maxStock, offer.stock + (deliveredByOffer.get(offer.id) ?? 0))
      })),
      lastRestockedAt: timestamp
    },
    orders: nextOrders
  };
}

function createSupplyOrders(
  operation: VenueOperationState,
  venue: VenueState,
  input: VenueOperationsInput,
  orders: VenueSupplyOrderState[],
  timestamp: number
): { operation: VenueOperationState; orders: VenueSupplyOrderState[]; ledger: VenueLedgerEntryState[] } {
  if (operation.status !== "operating") return { operation, orders, ledger: [] };
  let cash = operation.cash;
  const nextOrders = [...orders];
  const ledger: VenueLedgerEntryState[] = [];
  for (const offer of operation.offers) {
    if (!offer.active || offer.maxStock <= 0 || offer.stock > Math.max(2, Math.floor(offer.maxStock * .28))) continue;
    const pending = nextOrders.some((order) => order.venueId === venue.id && order.offerId === offer.id && (order.status === "ordered" || order.status === "in-transit"));
    if (pending) continue;
    const quantity = Math.max(1, offer.maxStock - offer.stock);
    const unitCost = Math.max(1, Math.round(offer.currentPrice * .42));
    const totalCost = quantity * unitCost;
    if (cash < totalCost) continue;
    const id = createStableEntityId("venue-supply-order", `${venue.id}:${offer.id}:${timestamp}`);
    nextOrders.push({
      id,
      venueId: venue.id,
      offerId: offer.id,
      supplierEntityId: supplierId(venue),
      quantity,
      unitCost,
      totalCost,
      orderedAt: timestamp,
      arrivesAt: timestamp + supplyDelayHours(input.seed, venue.id, offer.id, timestamp) * HOUR_MS,
      status: "in-transit"
    });
    cash -= totalCost;
    const entry = ledgerEntry(venue, timestamp, "supplies", operationAccountId(venue.id), supplierId(venue), totalCost, `${venue.name}: заказ поставки ${offer.name}`);
    if (entry) ledger.push(entry);
  }
  return { operation: { ...operation, cash }, orders: nextOrders, ledger };
}

function advanceOperation(
  base: VenueOperationState,
  venue: VenueState,
  input: VenueOperationsInput,
  initialOrders: VenueSupplyOrderState[]
): { operation: VenueOperationState; orders: VenueSupplyOrderState[]; ledger: VenueLedgerEntryState[] } {
  if (input.timestamp <= base.lastUpdatedAt) return { operation: base, orders: initialOrders, ledger: [] };
  let operation: VenueOperationState = {
    ...base,
    category: venue.category,
    status: base.status === "insolvent" ? "insolvent" : venue.operatingStatus,
    offers: base.offers.map((offer) => ({ ...offer }))
  };
  let orders = initialOrders.map((order) => ({ ...order }));
  const generatedLedger: VenueLedgerEntryState[] = [];
  if (input.externallyManaged) {
    const generatedQueue = queueFor({ ...venue, operatingStatus: operation.status, active: operation.status === "operating" }, input.timestamp);
    const playerReady = operation.queue.playerState === "waiting" && (operation.queue.playerReadyAt ?? Number.POSITIVE_INFINITY) <= input.timestamp;
    return {
      operation: {
        ...operation,
        staffPresent: operation.status === "operating" && venueIsOpenAt({ ...venue, operatingStatus: operation.status, active: true }, input.timestamp)
          ? Math.max(1, Math.round(venue.staffing / 17))
          : 0,
        serviceCapacityPerHour: Math.max(2, Math.round(2 + venue.staffing / 15)),
        queue: {
          ...generatedQueue,
          servedToday: operation.queue.servedToday,
          abandonedToday: operation.queue.abandonedToday,
          playerState: playerReady ? "ready" : operation.queue.playerState,
          playerJoinedAt: operation.queue.playerJoinedAt,
          playerReadyAt: operation.queue.playerReadyAt,
          waitingCount: Math.max(generatedQueue.waitingCount, operation.queue.playerState === "waiting" ? 1 : 0)
        },
        lastUpdatedAt: input.timestamp
      },
      orders,
      ledger: []
    };
  }
  let cursor = base.lastUpdatedAt;
  let activeDay = Math.floor(cursor / DAY_MS);

  while (cursor < input.timestamp) {
    const chunkEnd = Math.min(input.timestamp, nextDayBoundary(cursor));
    const chunkDay = Math.floor(cursor / DAY_MS);
    if (chunkDay !== activeDay) {
      activeDay = chunkDay;
      operation = {
        ...operation,
        revenueToday: 0,
        expensesToday: 0,
        queue: { ...operation.queue, servedToday: 0, abandonedToday: 0 }
      };
    }

    const delivered = processDeliveredOrders(operation, orders, chunkEnd);
    operation = delivered.operation;
    orders = delivered.orders;

    const openMinutes = operation.status === "operating" ? openMinutesBetween(venue, cursor, chunkEnd) : 0;
    const openHours = openMinutes / 60;
    const staffPresent = openMinutes > 0 ? Math.max(1, Math.round(venue.staffing / 17)) : 0;
    const serviceCapacityPerHour = Math.max(2, Math.round(2 + venue.staffing / 15));
    const expectedCustomers = openMinutes >= 15
      ? Math.min(180, Math.floor(openHours * serviceCapacityPerHour * (.18 + venue.demand / 145)))
      : 0;
    const ambient = simulateAmbientTrade(operation.offers, expectedCustomers);
    const payroll = Math.round(openHours * staffPresent * (2.5 + venue.priceTier * .7));
    const utilities = Math.round(openHours * (1.8 + venue.priceTier * 1.1));
    const startsAtDayBoundary = cursor === chunkDay * DAY_MS || cursor === base.lastUpdatedAt;
    const rent = startsAtDayBoundary && openMinutes > 0 ? Math.round(18 + venue.priceTier * 16 + venue.quality * .28) : 0;
    const expenseDelta = payroll + utilities + rent;
    const cash = operation.cash + ambient.revenue - expenseDelta;
    const status: VenueOperatingStatus = operation.status === "operating" && cash < -1_500 ? "insolvent" : operation.status;

    operation = {
      ...operation,
      status,
      cash,
      revenueToday: operation.revenueToday + ambient.revenue,
      expensesToday: operation.expensesToday + expenseDelta,
      lifetimeRevenue: operation.lifetimeRevenue + ambient.revenue,
      lifetimeExpenses: operation.lifetimeExpenses + expenseDelta,
      staffPresent: status === "operating" ? staffPresent : 0,
      serviceCapacityPerHour,
      queue: { ...operation.queue, servedToday: operation.queue.servedToday + ambient.served },
      offers: ambient.offers,
      lastUpdatedAt: chunkEnd
    };

    const saleEntry = ledgerEntry(venue, chunkEnd, "sale", consumerPoolId(venue), operationAccountId(venue.id), ambient.revenue, `${venue.name}: агрегированные продажи`);
    const payrollEntry = ledgerEntry(venue, chunkEnd, "payroll", operationAccountId(venue.id), staffPoolId(venue), payroll, `${venue.name}: фонд смены`);
    const utilityEntry = ledgerEntry(venue, chunkEnd, "utilities", operationAccountId(venue.id), utilityProviderId(venue), utilities, `${venue.name}: коммунальные расходы`);
    const rentEntry = ledgerEntry(venue, chunkEnd, "rent", operationAccountId(venue.id), landlordId(venue, input), rent, `${venue.name}: аренда помещения`);
    for (const entry of [saleEntry, payrollEntry, utilityEntry, rentEntry]) if (entry) generatedLedger.push(entry);

    const supplied = createSupplyOrders(operation, venue, input, orders, chunkEnd);
    operation = supplied.operation;
    orders = supplied.orders;
    generatedLedger.push(...supplied.ledger);
    cursor = chunkEnd;
  }

  const generatedQueue = queueFor({ ...venue, operatingStatus: operation.status, active: operation.status === "operating" }, input.timestamp);
  const playerReady = operation.queue.playerState === "waiting" && (operation.queue.playerReadyAt ?? Number.POSITIVE_INFINITY) <= input.timestamp;
  operation = {
    ...operation,
    staffPresent: operation.status === "operating" && venueIsOpenAt({ ...venue, operatingStatus: operation.status, active: true }, input.timestamp)
      ? Math.max(1, Math.round(venue.staffing / 17))
      : 0,
    queue: {
      ...generatedQueue,
      servedToday: operation.queue.servedToday,
      abandonedToday: operation.queue.abandonedToday,
      playerState: playerReady ? "ready" : operation.queue.playerState,
      playerJoinedAt: operation.queue.playerJoinedAt,
      playerReadyAt: operation.queue.playerReadyAt,
      waitingCount: Math.max(generatedQueue.waitingCount, operation.queue.playerState === "waiting" ? 1 : 0)
    },
    lastUpdatedAt: input.timestamp
  };
  return { operation, orders, ledger: generatedLedger };
}

function mergeRegistry(state: VenueOperationsState | undefined, input: VenueOperationsInput): VenueRegistryEntryState[] {
  const previous = state && Array.isArray(state.registry) ? state.registry : [];
  const byId = new Map(previous.map((entry) => [entry.venue.id, entry]));
  const materializedIds = new Set(input.venues.map((venue) => venue.id));
  for (const venue of input.venues) {
    const old = byId.get(venue.id);
    byId.set(venue.id, {
      venue: { ...(old?.venue ?? venue), ...venue, lastUpdatedAt: input.timestamp },
      materialized: true,
      firstSeenAt: old?.firstSeenAt ?? input.timestamp,
      lastSeenAt: input.timestamp
    });
  }
  return [...byId.values()].map((entry) => materializedIds.has(entry.venue.id) ? entry : { ...entry, materialized: false });
}

function synchronizeRegistry(registry: VenueRegistryEntryState[], operations: VenueOperationState[], timestamp: number): VenueRegistryEntryState[] {
  const byId = new Map(operations.map((operation) => [operation.venueId, operation]));
  return registry.map((entry) => {
    const operation = byId.get(entry.venue.id);
    if (!operation) return entry;
    return {
      ...entry,
      venue: {
        ...entry.venue,
        operatingStatus: operation.status,
        active: operation.status === "operating",
        lastUpdatedAt: timestamp
      }
    };
  });
}

function normalizeState(state: VenueOperationsState | undefined, input: VenueOperationsInput, registry: VenueRegistryEntryState[]): VenueOperationsState {
  const raw = state as unknown as Partial<VenueOperationsState> | undefined;
  const oldOperations = Array.isArray(raw?.operations) ? raw.operations : [];
  const oldById = new Map(oldOperations.map((operation) => [operation.venueId, operation]));
  const operations = registry.map((entry) => migrateOperation(input.seed, input.timestamp, entry.venue, oldById.get(entry.venue.id)));
  const supplyOrders = Array.isArray(raw?.supplyOrders) ? raw.supplyOrders : [];
  const ledger = Array.isArray(raw?.ledger) ? raw.ledger : [];
  const receipts = Array.isArray(raw?.receipts) ? raw.receipts.slice(-MAX_RECEIPTS) : [];
  return {
    version: 2,
    operations,
    registry,
    supplyOrders,
    ledger,
    receipts,
    totals: totals(operations, supplyOrders),
    lastProcessedDay: typeof raw?.lastProcessedDay === "number" ? raw.lastProcessedDay : Math.floor(input.timestamp / DAY_MS),
    lastUpdatedAt: typeof raw?.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
}

export function createVenueOperationsState(input: VenueOperationsInput): VenueOperationsState {
  const registry = mergeRegistry(undefined, input);
  const operations = registry.map((entry) => operationFor(input.seed, input.timestamp, entry.venue));
  return {
    version: 2,
    operations,
    registry,
    supplyOrders: [],
    ledger: [],
    receipts: [],
    totals: totals(operations, []),
    lastProcessedDay: Math.floor(input.timestamp / DAY_MS),
    lastUpdatedAt: input.timestamp
  };
}

export function advanceVenueOperationsState(state: VenueOperationsState | undefined, input: VenueOperationsInput): VenueOperationsState {
  const registry = mergeRegistry(state, input);
  const normalized = normalizeState(state, input, registry);
  if (input.timestamp < normalized.lastUpdatedAt) return normalized;
  const operationById = new Map(normalized.operations.map((operation) => [operation.venueId, operation]));
  let supplyOrders = normalized.supplyOrders.map((order) => ({ ...order }));
  const newLedger: VenueLedgerEntryState[] = [];
  const operations = registry.map((entry) => {
    const base = operationById.get(entry.venue.id) ?? operationFor(input.seed, normalized.lastUpdatedAt, entry.venue);
    const advanced = advanceOperation(base, entry.venue, input, supplyOrders);
    supplyOrders = advanced.orders;
    newLedger.push(...advanced.ledger);
    return advanced.operation;
  });
  const synchronizedRegistry = synchronizeRegistry(registry, operations, input.timestamp);
  const ledger = [...normalized.ledger, ...newLedger].slice(-MAX_LEDGER_ENTRIES);
  supplyOrders = supplyOrders
    .filter((order) => order.status !== "delivered" || (order.deliveredAt ?? order.arrivesAt) >= input.timestamp - 14 * DAY_MS)
    .slice(-MAX_SUPPLY_ORDERS);
  const receipts = normalized.receipts.slice(-MAX_RECEIPTS);
  return {
    version: 2,
    operations,
    registry: synchronizedRegistry,
    supplyOrders,
    ledger,
    receipts,
    totals: totals(operations, supplyOrders),
    lastProcessedDay: Math.floor(input.timestamp / DAY_MS),
    lastUpdatedAt: input.timestamp
  };
}

export function synchronizeVenueStatesFromOperations(venues: VenueState[], state: VenueOperationsState, timestamp: number): VenueState[] {
  const byId = new Map(state.operations.map((operation) => [operation.venueId, operation]));
  return venues.map((venue) => {
    const operation = byId.get(venue.id);
    if (!operation) return venue;
    return {
      ...venue,
      operatingStatus: operation.status,
      active: operation.status === "operating",
      lastUpdatedAt: timestamp
    };
  });
}

export function getRegisteredVenues(state: VenueOperationsState): VenueRegistryEntryState[] {
  return Array.isArray(state.registry) ? state.registry : [];
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
  return { state: { ...state, operations, totals: totals(operations, state.supplyOrders), lastUpdatedAt: timestamp }, waitMinutes };
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
  return { ...state, operations, totals: totals(operations, state.supplyOrders), lastUpdatedAt: timestamp };
}

export function purchaseVenueOfferState(
  state: VenueOperationsState,
  venueId: string,
  offerId: string,
  timestamp: number,
  buyerEntityId = "player"
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
    lifetimeRevenue: item.lifetimeRevenue + price,
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
  const venue = state.registry.find((entry) => entry.venue.id === venueId)?.venue;
  const saleLedger = venue ? ledgerEntry(venue, timestamp, "sale", buyerEntityId, operationAccountId(venueId), price, `${venue.name}: ${offer.name}`, false) : null;
  const ledger = saleLedger ? [...state.ledger, saleLedger].slice(-MAX_LEDGER_ENTRIES) : state.ledger;
  const next = { ...state, operations, receipts, ledger, totals: totals(operations, state.supplyOrders), lastUpdatedAt: timestamp };
  return { state: next, operation: operations.find((item) => item.venueId === venueId)!, offer: { ...offer, stock: offer.stock - 1 }, price, receipt };
}
