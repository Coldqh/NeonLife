import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { FoodState } from "../food/foodSystem";
import type { DistrictPulseState } from "../../world/city/districtPulse";
import type { LocationState } from "../../world/state/types";
import type { HumanNetworkState, PersonState } from "../../people/network/types";
import type { CourierOrder } from "../jobs/courier/courierSystem";
import type { PopulationState } from "../../simulation/population/types";
import { kernelSystemEntityId } from "../../simulation/kernel/simulationKernel";
import type { KernelTransactionDraft } from "../../simulation/kernel/types";
import { getPopulationWorkerAvailability } from "../../simulation/population/populationSystem";
import type { BusinessKind, BusinessState, BusinessStatus, EconomyNotice, LocalEconomyState, SupplyClass } from "./types";

const CYCLE_MS = 6 * 60 * 60_000;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function businessKind(location: LocationState): BusinessKind | null {
  if (location.type === "market") return "retail";
  if (location.type === "food") return "food-service";
  if (location.type === "clinic") return "medical";
  if (location.type === "workshop") return "repair";
  if (location.type === "office") return "corporate";
  if (location.type === "transport" && location.name.includes("MESHLINE")) return "logistics";
  return null;
}

function supplyClass(kind: BusinessKind): SupplyClass {
  if (kind === "retail" || kind === "food-service") return "food";
  if (kind === "medical") return "medical";
  if (kind === "repair") return "parts";
  if (kind === "corporate") return "documents";
  return "mixed";
}

function initialCash(kind: BusinessKind, rng: SeededRandom): number {
  if (kind === "corporate") return rng.integer(18_000, 32_000);
  if (kind === "medical") return rng.integer(8_000, 15_000);
  if (kind === "logistics") return rng.integer(5_000, 10_000);
  return rng.integer(1_400, 6_500);
}

function initialStock(kind: BusinessKind, rng: SeededRandom): number {
  if (kind === "corporate") return rng.integer(70, 94);
  if (kind === "logistics") return rng.integer(58, 84);
  return rng.integer(42, 78);
}

function workersAt(people: PersonState[], locationId: string): PersonState[] {
  return people.filter((person) => person.workLocationId === locationId);
}

function staffingFor(people: PersonState[], population: PopulationState, locationId: string, fallback: number): number {
  const knownWorkers = workersAt(people, locationId);
  const background = getPopulationWorkerAvailability(population, locationId);
  if (!knownWorkers.length && !background.total) return fallback;
  const knownStrain = knownWorkers.length
    ? knownWorkers.reduce((total, person) => total + person.fatigue * 0.55 + person.stress * 0.45, 0) / knownWorkers.length
    : 38;
  const attendanceRate = background.total ? background.active / background.total : 0.72;
  const illnessPenalty = background.total ? background.ill / background.total * 28 : 0;
  const scaleBonus = Math.min(16, Math.log2(Math.max(1, background.total)) * 3.5);
  return clamp(Math.round(42 + attendanceRate * 42 + scaleBonus - knownStrain * 0.32 - illnessPenalty), 8, 100);
}

function statusFor(stock: number, staffing: number, cash: number): BusinessStatus {
  if (stock <= 4 || staffing <= 16 || cash <= 0) return "closed";
  if (stock < 18 || staffing < 31 || cash < 240) return "restricted";
  if (stock < 42 || staffing < 52 || cash < 900) return "strained";
  return "stable";
}

function priceIndexFor(stock: number, demand: number, status: BusinessStatus, transitDelayMinutes: number): number {
  const scarcity = Math.max(0, 55 - stock) * 0.72;
  const demandPressure = Math.max(0, demand - 50) * 0.32;
  const statusPressure = status === "closed" ? 42 : status === "restricted" ? 24 : status === "strained" ? 10 : 0;
  return clamp(Math.round(94 + scarcity + demandPressure + statusPressure + transitDelayMinutes * 0.7), 82, 175);
}

function capacityFor(kind: BusinessKind): number {
  if (kind === "retail") return 1_500;
  if (kind === "food-service") return 650;
  if (kind === "medical") return 220;
  return 100;
}

function totalFoodStock(food: FoodState, locationId: string): number | null {
  const stock = food.shopStocks[locationId];
  if (!stock) return null;
  return Object.values(stock).reduce((total, value) => total + value, 0);
}

function consumeFoodStock(food: FoodState, locationId: string, units: number, rng: SeededRandom): FoodState {
  const current = food.shopStocks[locationId];
  if (!current || units <= 0) return food;
  const next = { ...current };
  const keys = Object.keys(next);
  let remaining = units;
  let safety = 0;
  while (remaining > 0 && keys.some((key) => next[key] > 0) && safety < 200) {
    const key = rng.pick(keys);
    if (next[key] > 0) {
      next[key] -= 1;
      remaining -= 1;
    }
    safety += 1;
  }
  return { ...food, shopStocks: { ...food.shopStocks, [locationId]: next } };
}

function restockFoodStock(food: FoodState, locationId: string, units: number): FoodState {
  const current = food.shopStocks[locationId];
  if (!current || units <= 0) return food;
  const keys = Object.keys(current);
  if (!keys.length) return food;
  const each = Math.max(1, Math.floor(units / keys.length));
  const next = Object.fromEntries(keys.map((key) => [key, current[key] + each]));
  return { ...food, shopStocks: { ...food.shopStocks, [locationId]: next } };
}

function statusTitle(name: string, status: BusinessStatus): string {
  if (status === "closed") return `${name} прекратил обслуживание.`;
  if (status === "restricted") return `${name} ограничил работу.`;
  if (status === "strained") return `${name} работает с перебоями.`;
  return `${name} вернулся к устойчивой работе.`;
}

function statusDetail(status: BusinessStatus, stock: number, staffing: number, priceIndex: number): string {
  if (status === "closed") return `Запас ${stock}% · персонал ${staffing}% · обслуживание остановлено.`;
  if (status === "restricted") return `Запас ${stock}% · персонал ${staffing}% · цены ${priceIndex}%.`;
  if (status === "strained") return `Поставки и смены нестабильны · цены ${priceIndex}%.`;
  return `Запас ${stock}% · персонал ${staffing}% · цены стабилизированы.`;
}

export function createLocalEconomy(
  seed: string,
  timestamp: number,
  locations: LocationState[],
  people: PersonState[],
  population: PopulationState,
  food: FoodState,
  pulse: DistrictPulseState
): LocalEconomyState {
  const rng = new SeededRandom(`${seed}:local-economy`);
  const businesses = locations.flatMap((location): BusinessState[] => {
    const kind = businessKind(location);
    if (!kind) return [];
    const foodUnits = totalFoodStock(food, location.id);
    const stock = foodUnits === null
      ? initialStock(kind, rng)
      : clamp(Math.round(foodUnits / capacityFor(kind) * 100), 8, 100);
    const staffing = staffingFor(people, population, location.id, rng.integer(48, 82));
    const demand = clamp(rng.integer(38, 72) + Math.round(pulse.marketActivity / 8));
    const cash = initialCash(kind, rng);
    const status = statusFor(stock, staffing, cash);
    return [{
      id: createStableEntityId("business", `${seed}:${location.id}`),
      locationId: location.id,
      organizationId: location.organizationId,
      kind,
      supplyClass: supplyClass(kind),
      cash,
      stock,
      staffing,
      demand,
      priceIndex: priceIndexFor(stock, demand, status, pulse.transitDelayMinutes),
      status,
      shortage: stock < 42,
      capacityLevel: 1,
      targetStaff: Math.max(3, getPopulationWorkerAvailability(population, location.id).total || Math.round(staffing / 12)),
      revenueToday: 0,
      operatingCostsToday: 0,
      payrollToday: 0,
      supplierCostsToday: 0,
      utilityCostsToday: 0,
      infrastructureServiceLevel: 100,
      rollingProfit: 0,
      profitableDays: 0,
      lossDays: 0,
      lastSettlementDay: Math.floor(timestamp / (24 * 60 * 60_000)),
      lastStatusChangeAt: timestamp,
      lastUpdatedAt: timestamp
    }];
  });
  return { businesses, lastUpdatedAt: timestamp, cycle: Math.floor(timestamp / CYCLE_MS) };
}

export interface EconomyAdvanceResult {
  state: LocalEconomyState;
  food: FoodState;
  notices: EconomyNotice[];
  transactions: KernelTransactionDraft[];
}

export function advanceLocalEconomy(
  state: LocalEconomyState,
  timestamp: number,
  seed: string,
  locations: LocationState[],
  people: PersonState[],
  population: PopulationState,
  foodState: FoodState,
  pulse: DistrictPulseState
): EconomyAdvanceResult {
  if (timestamp <= state.lastUpdatedAt) return { state, food: foodState, notices: [], transactions: [] };
  const targetCycle = Math.floor(timestamp / CYCLE_MS);
  let cycle = Math.max(state.cycle, Math.floor(state.lastUpdatedAt / CYCLE_MS));
  let businesses = state.businesses;
  let food = foodState;
  const notices: EconomyNotice[] = [];
  const transactions: KernelTransactionDraft[] = [];

  while (cycle < targetCycle) {
    cycle += 1;
    businesses = businesses.map((business) => {
      const location = locations.find((item) => item.id === business.locationId);
      if (!location) return business;
      const rng = new SeededRandom(`${seed}:economy:${cycle}:${business.id}`);
      const baseStaffing = staffingFor(people, population, business.locationId, business.staffing);
      const infrastructureLevel = business.infrastructureServiceLevel ?? 100;
      const staffing = clamp(Math.round(baseStaffing * (0.55 + infrastructureLevel / 225)), 4, 100);
      const demand = clamp(Math.round(
        business.demand * 0.55
        + pulse.marketActivity * 0.28
        + (business.kind === "medical" ? 8 : 0)
        + rng.integer(-9, 12)
      ), 18, 100);
      const consumption = Math.max(1, Math.round(demand / 17));
      const foodBefore = totalFoodStock(food, business.locationId);
      food = consumeFoodStock(food, business.locationId, consumption, rng);
      const actualFoodStock = totalFoodStock(food, business.locationId);
      const physicalFoodConsumed = foodBefore === null || actualFoodStock === null ? 0 : Math.max(0, foodBefore - actualFoodStock);
      let stock = actualFoodStock === null
        ? clamp(business.stock - consumption + rng.integer(-2, 2))
        : clamp(Math.round(actualFoodStock / capacityFor(business.kind) * 100));
      const passiveRevenue = Math.round(demand * business.priceIndex / 58);
      const operatingCost = Math.max(8, Math.round(10 + business.capacityLevel * 4 + pulse.transitDelayMinutes * 0.35));
      let cash = Math.max(-500, business.cash + passiveRevenue - operatingCost);
      if (passiveRevenue > 0) transactions.push({
        idempotencyKey: `${seed}:economy:${cycle}:${business.id}:revenue`,
        timestamp: cycle * CYCLE_MS,
        debitEntityId: kernelSystemEntityId(seed, "consumption"),
        creditEntityId: business.id,
        resource: "credits",
        amount: passiveRevenue,
        reason: "retail-service",
        description: `Background customer revenue for ${business.kind}.`
      });
      if (operatingCost > 0) transactions.push({
        idempotencyKey: `${seed}:economy:${cycle}:${business.id}:operating`,
        timestamp: cycle * CYCLE_MS,
        debitEntityId: business.id,
        creditEntityId: kernelSystemEntityId(seed, "city-services"),
        resource: "credits",
        amount: operatingCost,
        reason: "operating-settlement",
        description: `Operating costs for ${business.kind}.`
      });
      if (physicalFoodConsumed > 0) transactions.push({
        idempotencyKey: `${seed}:economy:${cycle}:${business.id}:food-consumption`,
        timestamp: cycle * CYCLE_MS,
        debitEntityId: business.id,
        creditEntityId: kernelSystemEntityId(seed, "consumption"),
        resource: "food-units",
        amount: physicalFoodConsumed,
        reason: "inventory-transfer",
        description: `Food units sold to background customers.`
      });
      // Wholesale inventory is replenished only by Production & Logistics.
      // This cycle consumes stock and records demand, but never creates supplies from nowhere.
      const restockCost = 0;
      let status = statusFor(stock, staffing, cash);
      if (infrastructureLevel < 20) status = "closed";
      else if (infrastructureLevel < 45 && status !== "closed") status = "restricted";
      else if (infrastructureLevel < 70 && status === "stable") status = "strained";
      const priceIndex = priceIndexFor(stock, demand, status, pulse.transitDelayMinutes);
      if (status !== business.status && notices.length < 5) {
        notices.push({
          locationId: business.locationId,
          title: statusTitle(location.name, status),
          detail: statusDetail(status, stock, staffing, priceIndex),
          importance: status === "closed" ? 3 : status === "restricted" ? 2 : 1,
          previousStatus: business.status,
          status
        });
      }
      return {
        ...business,
        cash,
        stock,
        staffing,
        demand,
        priceIndex,
        status,
        shortage: stock < 42,
        revenueToday: business.revenueToday + passiveRevenue,
        operatingCostsToday: business.operatingCostsToday + operatingCost,
        supplierCostsToday: business.supplierCostsToday + restockCost,
        lastStatusChangeAt: status === business.status ? business.lastStatusChangeAt : timestamp,
        lastUpdatedAt: timestamp
      };
    });
  }

  return {
    state: { businesses, lastUpdatedAt: timestamp, cycle },
    food,
    notices,
    transactions
  };
}

export function getBusinessAtLocation(state: LocalEconomyState, locationId: string | null | undefined): BusinessState | null {
  if (!locationId) return null;
  return state.businesses.find((business) => business.locationId === locationId) ?? null;
}

export function localPrice(basePrice: number, business: BusinessState | null | undefined): number {
  return Math.max(1, Math.round(basePrice * (business?.priceIndex ?? 100) / 100));
}

export function businessCanServe(business: BusinessState | null | undefined): boolean {
  return !business || business.status !== "closed";
}

export function registerBusinessSale(state: LocalEconomyState, locationId: string, revenue: number): LocalEconomyState {
  return {
    ...state,
    businesses: state.businesses.map((business) => business.locationId === locationId
      ? { ...business, cash: business.cash + revenue, revenueToday: business.revenueToday + revenue, demand: clamp(business.demand + 2), stock: clamp(business.stock - 1) }
      : business)
  };
}

export interface CourierSupplyResult {
  state: LocalEconomyState;
  food: FoodState;
}

export function applyCourierSupplyDelivery(
  state: LocalEconomyState,
  food: FoodState,
  order: CourierOrder,
  payout: number,
  condition: number,
  lateMinutes: number
): CourierSupplyResult {
  if (!order.businessId) return { state, food };
  const quality = clamp(Math.round(condition - Math.min(45, lateMinutes)), 0, 100);
  const stockGain = Math.max(2, Math.round(quality / 5));
  const target = state.businesses.find((business) => business.id === order.businessId);
  return {
    food: target ? restockFoodStock(food, target.locationId, stockGain) : food,
    state: {
      ...state,
      businesses: state.businesses.map((business) => {
        if (business.id !== order.businessId) return business;
        const stock = clamp(business.stock + stockGain);
        const cash = business.cash - payout;
        const status = statusFor(stock, business.staffing, cash);
        return {
          ...business,
          cash,
          stock,
          supplierCostsToday: business.supplierCostsToday + payout,
          shortage: stock < 42,
          status,
          priceIndex: priceIndexFor(stock, business.demand, status, 0)
        };
      })
    }
  };
}

export function applyRequestToEconomy(
  state: LocalEconomyState,
  food: FoodState,
  locationId: string,
  requestType: "medicine" | "supply" | "loan" | "cover-shift" | "move-load"
): { state: LocalEconomyState; food: FoodState } {
  const stockGain = requestType === "supply" ? 18 : requestType === "move-load" ? 8 : 0;
  const staffingGain = requestType === "cover-shift" ? 14 : 0;
  return {
    food: stockGain > 0 ? restockFoodStock(food, locationId, stockGain) : food,
    state: {
      ...state,
      businesses: state.businesses.map((business) => {
        if (business.locationId !== locationId) return business;
        const stock = clamp(business.stock + stockGain);
        const staffing = clamp(business.staffing + staffingGain);
        const status = statusFor(stock, staffing, business.cash);
        return {
          ...business,
          stock,
          staffing,
          shortage: stock < 42,
          status,
          priceIndex: priceIndexFor(stock, business.demand, status, 0)
        };
      })
    }
  };
}

export function applyEconomyPressureToPeople(
  people: HumanNetworkState,
  economy: LocalEconomyState,
  notices: EconomyNotice[]
): HumanNetworkState {
  if (!notices.length) return people;
  const affected = new Map(notices.map((notice) => [notice.locationId, notice.status]));
  return {
    ...people,
    people: people.people.map((person) => {
      const status = affected.get(person.workLocationId);
      if (!status) return person;
      const stressDelta = status === "closed" ? 10 : status === "restricted" ? 6 : status === "strained" ? 3 : -3;
      const severityDelta = status === "closed" ? 7 : status === "restricted" ? 4 : status === "stable" ? -3 : 1;
      return {
        ...person,
        stress: clamp(person.stress + stressDelta),
        problem: { ...person.problem, severity: clamp(person.problem.severity + severityDelta) }
      };
    })
  };
}
