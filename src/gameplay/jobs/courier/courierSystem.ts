import { createStableEntityId } from "../../../core/ids/entityId";
import { SeededRandom } from "../../../core/random/seededRandom";
import type { LocationState } from "../../../world/state/types";

export type CourierOrderStatus = "available" | "accepted" | "in-transit" | "completed" | "failed" | "expired";
export type CourierRisk = "low" | "medium" | "high";
export type CargoLegality = "legal" | "restricted" | "unknown";

export interface CourierOrder {
  id: string;
  code: string;
  client: string;
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

export interface CourierState {
  orders: CourierOrder[];
  activeOrderId: string | null;
  boardGeneration: number;
  boardRefreshAt: number;
  rating: number;
  completedDeliveries: number;
  failedDeliveries: number;
  totalEarnings: number;
  cargoCapacityKg: number;
}

const CLIENTS = ["MESHLINE CO-OP", "CMU DISPATCH", "VANTA SUPPLY", "NORTHLINE FREIGHT", "SABLE LABS", "PRIVATE NODE"] as const;
const CARGO = [
  { name: "sealed municipal documents", cargoClass: "documents" as const, weight: [0.4, 1.2], base: 48 },
  { name: "temperature-sensitive meal pack", cargoClass: "food" as const, weight: [1.4, 3.8], base: 62 },
  { name: "clinic reagent case", cargoClass: "medical" as const, weight: [2.2, 5.4], base: 86 },
  { name: "servo replacement kit", cargoClass: "parts" as const, weight: [3.5, 8.8], base: 74 },
  { name: "unregistered sealed parcel", cargoClass: "sealed" as const, weight: [1.0, 6.5], base: 112 }
] as const;

function eligibleLocations(locations: LocationState[]): LocationState[] {
  return locations.filter((location) => location.type !== "housing" && location.open);
}

function createBoard(seed: string, timestamp: number, locations: LocationState[], generation: number): CourierOrder[] {
  const candidates = eligibleLocations(locations);
  if (candidates.length < 2) return [];
  const rng = new SeededRandom(`${seed}:courier-board:${generation}`);
  const orders: CourierOrder[] = [];

  for (let index = 0; index < 6; index += 1) {
    const pickup = rng.pick(candidates);
    const destinations = candidates.filter((location) => location.id !== pickup.id);
    const dropoff = rng.pick(destinations);
    const cargo = rng.pick(CARGO);
    const riskRoll = rng.integer(1, 100);
    const risk: CourierRisk = riskRoll > 80 ? "high" : riskRoll > 45 ? "medium" : "low";
    const legality: CargoLegality = cargo.cargoClass === "sealed"
      ? (rng.chance(0.55) ? "unknown" : "restricted")
      : cargo.cargoClass === "medical" && rng.chance(0.2) ? "restricted" : "legal";
    const weightKg = Math.round((cargo.weight[0] + rng.next() * (cargo.weight[1] - cargo.weight[0])) * 10) / 10;
    const durationMinutes = rng.integer(48, 150);
    const payout = cargo.base + Math.round(weightKg * 5) + (risk === "high" ? 52 : risk === "medium" ? 24 : 0);
    const code = `DLV-${generation.toString().padStart(2, "0")}${rng.integer(100, 999)}`;
    orders.push({
      id: createStableEntityId("courier-order", `${seed}:${generation}:${index}:${pickup.id}:${dropoff.id}`),
      code,
      client: rng.pick(CLIENTS),
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

export function createInitialCourierState(seed: string, timestamp: number, locations: LocationState[]): CourierState {
  return {
    orders: createBoard(seed, timestamp, locations, 1),
    activeOrderId: null,
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

export function refreshCourierBoard(state: CourierState, seed: string, timestamp: number, locations: LocationState[]): CourierState {
  if (timestamp < state.boardRefreshAt || state.activeOrderId) return state;
  const generation = state.boardGeneration + 1;
  return {
    ...state,
    orders: createBoard(seed, timestamp, locations, generation),
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
    orders: state.orders.map((item) => item.id === active.id ? { ...item, status: "in-transit", collectedAt: timestamp } : item)
  };
}

export interface CourierCompletion {
  state: CourierState;
  payout: number;
  lateMinutes: number;
  condition: number;
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
    state: {
      ...state,
      activeOrderId: null,
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
      orders: state.orders.map((item) => item.id === active.id
        ? { ...item, condition: Math.max(0, item.condition - conditionLoss) }
        : item)
    }
  };
}
