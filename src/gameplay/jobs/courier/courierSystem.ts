import { createStableEntityId } from "../../../core/ids/entityId";
import { SeededRandom } from "../../../core/random/seededRandom";
import type { PersonState } from "../../../people/network/types";
import type { LocationState } from "../../../world/state/types";
import type { BusinessState } from "../../economy/types";

export type CourierOrderStatus = "available" | "accepted" | "in-transit" | "completed" | "failed" | "expired";
export type CourierRisk = "low" | "medium" | "high";
export type CargoLegality = "legal" | "restricted" | "unknown";

export interface CourierOrder {
  id: string;
  code: string;
  clientId: string;
  client: string;
  requestNote: string;
  businessId: string | null;
  economicPurpose: "personal" | "restock";
  pickupLocationId: string;
  dropoffLocationId: string;
  cargoName: string;
  cargoClass: "documents" | "food" | "medical" | "parts" | "sealed";
  weightKg: number;
  payout: number;
  latePenalty: number;
  deadlineAt: number;
  status: CourierOrderStatus;
  risk: CourierRisk;
  legality: CargoLegality;
  condition: number;
  acceptedAt: number | null;
  collectedAt: number | null;
  completedAt: number | null;
}

export interface CourierCargoState {
  orderId: string;
  name: string;
  weightKg: number;
  condition: number;
  collectedAt: number;
}

export interface CourierState {
  orders: CourierOrder[];
  activeOrderId: string | null;
  carriedCargo: CourierCargoState | null;
  boardGeneration: number;
  boardRefreshAt: number;
  rating: number;
  completedDeliveries: number;
  failedDeliveries: number;
  totalEarnings: number;
  cargoCapacityKg: number;
}

const CARGO = [
  { name: "sealed municipal documents", cargoClass: "documents" as const, weight: [0.4, 1.2], base: 48 },
  { name: "temperature-sensitive meal pack", cargoClass: "food" as const, weight: [1.4, 3.8], base: 62 },
  { name: "clinic reagent case", cargoClass: "medical" as const, weight: [2.2, 5.4], base: 86 },
  { name: "servo replacement kit", cargoClass: "parts" as const, weight: [3.5, 8.8], base: 74 },
  { name: "unregistered sealed parcel", cargoClass: "sealed" as const, weight: [1.0, 6.5], base: 112 }
] as const;

function locationOpenAt(location: LocationState, timestamp: number): boolean {
  if (!location.open) return false;
  const hour = new Date(timestamp).getUTCHours();
  const openHour = location.openHour ?? 0;
  const closeHour = location.closeHour ?? 24;
  if (openHour === closeHour) return true;
  if (openHour < closeHour) return hour >= openHour && hour < closeHour;
  return hour >= openHour || hour < closeHour;
}

function minutesUntilClose(location: LocationState, timestamp: number): number {
  const openHour = location.openHour ?? 0;
  const closeHour = location.closeHour ?? 24;
  if (openHour === closeHour) return Number.POSITIVE_INFINITY;
  if (!locationOpenAt(location, timestamp)) return 0;
  const date = new Date(timestamp);
  const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
  let closeMinute = closeHour * 60;
  if (closeMinute <= minuteOfDay) closeMinute += 24 * 60;
  return Math.max(0, closeMinute - minuteOfDay);
}

function eligibleLocations(locations: LocationState[], timestamp: number, minimumWindowMinutes = 90): LocationState[] {
  return locations.filter((location) => location.type !== "housing"
    && locationOpenAt(location, timestamp)
    && minutesUntilClose(location, timestamp) >= minimumWindowMinutes);
}

function requestFor(person: PersonState, cargoClass: CourierOrder["cargoClass"]): string {
  if (person.problem.type === "medical-debt" || person.problem.type === "family-care") {
    return cargoClass === "medical" ? "Груз нужен до конца текущей смены." : "Человек пытается закрыть семейную проблему до утра.";
  }
  if (person.problem.type === "missing-supply") return "Без этой поставки рабочий узел остановится.";
  if (person.problem.type === "job-risk") return "Опоздание станет ещё одной записью против клиента.";
  if (person.problem.type === "rent") return "Клиент берёт дешёвый маршрут и считает каждую единицу.";
  if (person.problem.type === "exhaustion") return "Клиент не может забрать груз лично после двойной смены.";
  if (person.problem.type === "unsafe-housing") return "Доставку нельзя оставлять у общего входа.";
  return "Клиент просит не передавать заказ третьим лицам.";
}

function chooseDropoff(person: PersonState, locations: LocationState[], fallback: LocationState): LocationState {
  const eligibleIds = new Set(locations.map((location) => location.id));
  return locations.find((location) => location.id === person.currentLocationId && eligibleIds.has(location.id))
    ?? locations.find((location) => location.id === person.workLocationId && eligibleIds.has(location.id))
    ?? locations.find((location) => location.id === person.homeLocationId && eligibleIds.has(location.id))
    ?? fallback;
}

function feasibleDeadlineMinutes(pickup: LocationState, dropoff: LocationState, rng: SeededRandom): number {
  // The board does not know which transport the player will use. Use a conservative
  // city-scale budget that includes reaching pickup, hand-off time and disruption.
  const sameDistrict = pickup.districtId === dropoff.districtId;
  const travelBudget = sameDistrict ? 110 : 280;
  const handlingAndRisk = 30 + rng.integer(20, 70);
  return travelBudget + handlingAndRisk;
}

function cargoForSupplyClass(supplyClass: BusinessState["supplyClass"]) {
  if (supplyClass === "food") return CARGO.find((cargo) => cargo.cargoClass === "food") ?? CARGO[0];
  if (supplyClass === "medical") return CARGO.find((cargo) => cargo.cargoClass === "medical") ?? CARGO[0];
  if (supplyClass === "parts") return CARGO.find((cargo) => cargo.cargoClass === "parts") ?? CARGO[0];
  if (supplyClass === "documents") return CARGO.find((cargo) => cargo.cargoClass === "documents") ?? CARGO[0];
  return CARGO.find((cargo) => cargo.cargoClass === "sealed") ?? CARGO[0];
}

function businessClient(people: PersonState[], business: BusinessState): PersonState | null {
  const workers = people.filter((person) => person.workLocationId === business.locationId && (person.lifeStatus ?? "alive") === "alive");
  return workers.sort((left, right) => right.problem.severity - left.problem.severity)[0] ?? null;
}

function createBoard(
  seed: string,
  timestamp: number,
  locations: LocationState[],
  people: PersonState[],
  businesses: BusinessState[],
  generation: number
): CourierOrder[] {
  const candidates = eligibleLocations(locations, timestamp);
  const livingPeople = people.filter((person) => (person.lifeStatus ?? "alive") === "alive");
  if (candidates.length < 2 || !livingPeople.length) return [];
  const rng = new SeededRandom(`${seed}:courier-board:${generation}`);
  const orders: CourierOrder[] = [];

  const urgentBusinesses = businesses
    .filter((business) => business.shortage || business.status === "restricted" || business.status === "closed")
    .sort((left, right) => left.stock - right.stock);

  for (let index = 0; index < 6; index += 1) {
    const business = index < Math.min(3, urgentBusinesses.length) ? urgentBusinesses[index] : null;
    const businessPerson = business ? businessClient(livingPeople, business) : null;
    const client = businessPerson ?? livingPeople[(index + rng.integer(0, livingPeople.length - 1)) % livingPeople.length];
    const businessLocation = business ? locations.find((location) => location.id === business.locationId) : null;
    const dropoff = businessLocation ?? chooseDropoff(client, candidates, rng.pick(candidates));
    const pickupCandidates = candidates.filter((location) => location.id !== dropoff.id);
    const pickup = rng.pick(pickupCandidates.length ? pickupCandidates : candidates);
    const cargo = business ? cargoForSupplyClass(business.supplyClass) : rng.pick(CARGO);
    const riskRoll = rng.integer(1, 100);
    const risk: CourierRisk = riskRoll > 80 ? "high" : riskRoll > 45 ? "medium" : "low";
    const legality: CargoLegality = cargo.cargoClass === "sealed"
      ? (rng.chance(0.55) ? "unknown" : "restricted")
      : cargo.cargoClass === "medical" && rng.chance(0.2) ? "restricted" : "legal";
    const weightKg = Math.round((cargo.weight[0] + rng.next() * (cargo.weight[1] - cargo.weight[0])) * 10) / 10;
    const problemPressure = Math.round(client.problem.severity / 10);
    const durationMinutes = feasibleDeadlineMinutes(pickup, dropoff, rng);
    const supplyUrgency = business ? Math.max(0, Math.round((55 - business.stock) * 0.9)) : 0;
    const payout = cargo.base + Math.round(weightKg * 5) + (risk === "high" ? 52 : risk === "medium" ? 24 : 0) + problemPressure + supplyUrgency;
    const code = `DLV-${generation.toString().padStart(2, "0")}${rng.integer(100, 999)}`;
    orders.push({
      id: createStableEntityId("courier-order", `${seed}:${generation}:${index}:${pickup.id}:${dropoff.id}:${client.id}`),
      code,
      clientId: client.id,
      client: client.name,
      requestNote: business
        ? `Рабочая точка теряет запас: ${business.stock}% · состояние ${business.status.toUpperCase()}.`
        : requestFor(client, cargo.cargoClass),
      businessId: business?.id ?? null,
      economicPurpose: business ? "restock" : "personal",
      pickupLocationId: pickup.id,
      dropoffLocationId: dropoff.id,
      cargoName: cargo.name,
      cargoClass: cargo.cargoClass,
      weightKg,
      payout,
      latePenalty: Math.max(18, Math.round(payout * 0.38)),
      deadlineAt: timestamp + durationMinutes * 60_000,
      status: "available",
      risk,
      legality,
      condition: 100,
      acceptedAt: null,
      collectedAt: null,
      completedAt: null
    });
  }
  return orders;
}

export function createInitialCourierState(seed: string, timestamp: number, locations: LocationState[], people: PersonState[], businesses: BusinessState[] = []): CourierState {
  return {
    orders: createBoard(seed, timestamp, locations, people, businesses, 1),
    activeOrderId: null,
    carriedCargo: null,
    boardGeneration: 1,
    boardRefreshAt: timestamp + 8 * 60 * 60_000,
    rating: 50,
    completedDeliveries: 0,
    failedDeliveries: 0,
    totalEarnings: 0,
    cargoCapacityKg: 9
  };
}

export function getActiveCourierOrder(state: CourierState): CourierOrder | null {
  return state.orders.find((order) => order.id === state.activeOrderId) ?? null;
}

export function refreshCourierBoard(
  state: CourierState,
  seed: string,
  timestamp: number,
  locations: LocationState[],
  people: PersonState[],
  businesses: BusinessState[] = []
): CourierState {
  if (timestamp < state.boardRefreshAt || state.activeOrderId) return state;
  const generation = state.boardGeneration + 1;
  return {
    ...state,
    orders: createBoard(seed, timestamp, locations, people, businesses, generation),
    boardGeneration: generation,
    boardRefreshAt: timestamp + 8 * 60 * 60_000
  };
}

export function expireCourierOrders(state: CourierState, timestamp: number): CourierState {
  return {
    ...state,
    orders: state.orders.map((order) => order.status === "available" && order.deadlineAt <= timestamp
      ? { ...order, status: "expired" as const }
      : order)
  };
}

export function acceptCourierOrder(state: CourierState, orderId: string, timestamp: number): CourierState {
  if (state.activeOrderId) return state;
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || order.status !== "available" || order.deadlineAt <= timestamp || order.weightKg > state.cargoCapacityKg) return state;
  return {
    ...state,
    activeOrderId: orderId,
    orders: state.orders.map((item) => item.id === orderId ? { ...item, status: "accepted", acceptedAt: timestamp } : item)
  };
}

export function collectCourierCargo(state: CourierState, currentLocationId: string, timestamp: number): CourierState {
  const active = getActiveCourierOrder(state);
  if (!active || active.status !== "accepted" || active.pickupLocationId !== currentLocationId) return state;
  return {
    ...state,
    carriedCargo: {
      orderId: active.id,
      name: active.cargoName,
      weightKg: active.weightKg,
      condition: active.condition,
      collectedAt: timestamp
    },
    orders: state.orders.map((item) => item.id === active.id ? { ...item, status: "in-transit", collectedAt: timestamp } : item)
  };
}

export interface CourierCompletion {
  state: CourierState;
  payout: number;
  lateMinutes: number;
  condition: number;
  ratingDelta: number;
}

export function completeCourierOrder(state: CourierState, currentLocationId: string, timestamp: number): CourierCompletion | null {
  const active = getActiveCourierOrder(state);
  if (!active || active.status !== "in-transit" || active.dropoffLocationId !== currentLocationId) return null;
  const lateMinutes = Math.max(0, Math.ceil((timestamp - active.deadlineAt) / 60_000));
  const lateLoss = lateMinutes > 0 ? Math.min(active.latePenalty, Math.ceil(lateMinutes / 5) * 4) : 0;
  const conditionLoss = active.condition < 90 ? Math.ceil((90 - active.condition) * 0.7) : 0;
  const payout = Math.max(0, active.payout - lateLoss - conditionLoss);
  const ratingDelta = lateMinutes === 0 && active.condition >= 90 ? 3 : lateMinutes <= 15 && active.condition >= 70 ? 1 : -3;
  return {
    payout,
    lateMinutes,
    condition: active.condition,
    ratingDelta,
    state: {
      ...state,
      activeOrderId: null,
      carriedCargo: null,
      completedDeliveries: state.completedDeliveries + 1,
      totalEarnings: state.totalEarnings + payout,
      rating: Math.max(0, Math.min(100, state.rating + ratingDelta)),
      orders: state.orders.map((item) => item.id === active.id ? { ...item, status: "completed", completedAt: timestamp } : item)
    }
  };
}

export interface CourierTravelOutcome {
  state: CourierState;
  incident: "none" | "inspection" | "damage";
  conditionLoss: number;
}

export function applyCourierTravelRisk(state: CourierState, seed: string, timestamp: number, pressure: number): CourierTravelOutcome {
  const active = getActiveCourierOrder(state);
  if (!active || active.status !== "in-transit") return { state, incident: "none", conditionLoss: 0 };
  const rng = new SeededRandom(`${seed}:courier-risk:${active.id}:${timestamp}`);
  const riskBase = active.risk === "high" ? 0.32 : active.risk === "medium" ? 0.18 : 0.08;
  const chance = Math.min(0.7, riskBase + pressure / 500);
  if (!rng.chance(chance)) return { state, incident: "none", conditionLoss: 0 };
  const inspection = active.legality !== "legal" && rng.chance(0.48);
  const conditionLoss = inspection ? 0 : rng.integer(4, active.risk === "high" ? 18 : 11);
  return {
    incident: inspection ? "inspection" : "damage",
    conditionLoss,
    state: {
      ...state,
      carriedCargo: state.carriedCargo?.orderId === active.id
        ? { ...state.carriedCargo, condition: Math.max(0, state.carriedCargo.condition - conditionLoss) }
        : state.carriedCargo,
      orders: state.orders.map((item) => item.id === active.id
        ? { ...item, condition: Math.max(0, item.condition - conditionLoss) }
        : item)
    }
  };
}
