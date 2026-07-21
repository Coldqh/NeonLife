import { createStableEntityId } from "../../core/ids/entityId";
import { getFoodProduct, type FoodProduct, type PreparationRequirement } from "../../data/products/foodCatalog";

export interface FoodStack {
  id: string;
  productId: string;
  quantity: number;
  purchasedAt: number;
  expiresAt: number;
}

export interface HomeAppliances {
  heater: boolean;
  hotWater: boolean;
  kitchenModule: boolean;
  foodPrinter: boolean;
}

export interface FoodState {
  storage: FoodStack[];
  shopStocks: Record<string, Record<string, number>>;
  appliances: HomeAppliances;
  lastMealAt: number | null;
  lastMealProductId: string | null;
  discardedUnits: number;
  purchaseSequence: number;
}

export type FoodFreshness = "fresh" | "expiring" | "spoiled";

export interface FoodTransactionResult {
  state: FoodState;
  product: FoodProduct;
  quantity: number;
}

const MARKET_STOCK: Record<string, number> = {
  "kernel-9-brick": 18,
  "blueroot-noodles": 9,
  "hexa-meal-cartridge": 2,
  "vanta-protein-cuts": 4,
  "morrow-algae-chips": 14,
  "pulserush-c12": 12,
  "grey-fleshfruit": 3
};

const KITCHEN_STOCK: Record<string, number> = {
  "dockyard-stew-04": 8,
  "kernel-9-brick": 6,
  "blueroot-noodles": 5,
  "pulserush-c12": 7
};

const CLINIC_STOCK: Record<string, number> = {
  "sable-recovery-pack": 5,
  "kernel-9-brick": 4
};

export function createInitialFoodState(seed: string, timestamp: number, marketId: string, kitchenId: string, clinicId: string): FoodState {
  const starter = [
    createStack(seed, "kernel-9-brick", 2, timestamp, 0),
    createStack(seed, "blueroot-noodles", 1, timestamp, 1),
    createStack(seed, "pulserush-c12", 1, timestamp, 2)
  ];
  return {
    storage: starter,
    shopStocks: {
      [marketId]: { ...MARKET_STOCK },
      [kitchenId]: { ...KITCHEN_STOCK },
      [clinicId]: { ...CLINIC_STOCK }
    },
    appliances: {
      heater: true,
      hotWater: true,
      kitchenModule: false,
      foodPrinter: false
    },
    lastMealAt: null,
    lastMealProductId: null,
    discardedUnits: 0,
    purchaseSequence: 3
  };
}

function createStack(seed: string, productId: string, quantity: number, timestamp: number, sequence: number): FoodStack {
  const product = getFoodProduct(productId);
  return {
    id: createStableEntityId("food-stack", `${seed}:${productId}:${timestamp}:${sequence}`),
    productId,
    quantity,
    purchasedAt: timestamp,
    expiresAt: timestamp + product.shelfLifeHours * 60 * 60_000
  };
}

export function getFoodFreshness(stack: FoodStack, timestamp: number): FoodFreshness {
  if (timestamp >= stack.expiresAt) return "spoiled";
  const remaining = stack.expiresAt - timestamp;
  const total = stack.expiresAt - stack.purchasedAt;
  return remaining / Math.max(total, 1) <= 0.18 ? "expiring" : "fresh";
}

export function getFoodUnits(state: FoodState): number {
  return state.storage.reduce((total, stack) => total + stack.quantity, 0);
}

export function getFreshFoodUnits(state: FoodState, timestamp: number): number {
  return state.storage.reduce((total, stack) => total + (getFoodFreshness(stack, timestamp) === "spoiled" ? 0 : stack.quantity), 0);
}

export function canPrepare(requirement: PreparationRequirement, appliances: HomeAppliances, atHome: boolean): boolean {
  if (requirement === "none") return true;
  if (!atHome) return false;
  if (requirement === "heater") return appliances.heater;
  if (requirement === "hot-water") return appliances.hotWater;
  if (requirement === "kitchen-module") return appliances.kitchenModule;
  return appliances.foodPrinter;
}

export function purchaseFood(
  state: FoodState,
  seed: string,
  locationId: string,
  productId: string,
  quantity: number,
  timestamp: number
): FoodTransactionResult | null {
  const stock = state.shopStocks[locationId]?.[productId] ?? 0;
  if (quantity <= 0 || stock < quantity) return null;
  const product = getFoodProduct(productId);
  const stack = createStack(seed, productId, quantity, timestamp, state.purchaseSequence);
  return {
    product,
    quantity,
    state: {
      ...state,
      purchaseSequence: state.purchaseSequence + 1,
      storage: [...state.storage, stack],
      shopStocks: {
        ...state.shopStocks,
        [locationId]: {
          ...state.shopStocks[locationId],
          [productId]: stock - quantity
        }
      }
    }
  };
}

export function consumeFood(state: FoodState, productId: string, timestamp: number): FoodTransactionResult | null {
  const stackIndex = state.storage.findIndex((stack) => stack.productId === productId && stack.quantity > 0 && getFoodFreshness(stack, timestamp) !== "spoiled");
  if (stackIndex < 0) return null;
  const stack = state.storage[stackIndex];
  const nextStack = { ...stack, quantity: stack.quantity - 1 };
  const storage = state.storage.slice();
  if (nextStack.quantity <= 0) storage.splice(stackIndex, 1);
  else storage[stackIndex] = nextStack;
  return {
    product: getFoodProduct(productId),
    quantity: 1,
    state: {
      ...state,
      storage,
      lastMealAt: timestamp,
      lastMealProductId: productId
    }
  };
}

export function discardSpoiledFood(state: FoodState, timestamp: number): { state: FoodState; discarded: number } {
  let discarded = 0;
  const storage = state.storage.filter((stack) => {
    if (getFoodFreshness(stack, timestamp) !== "spoiled") return true;
    discarded += stack.quantity;
    return false;
  });
  return {
    discarded,
    state: {
      ...state,
      storage,
      discardedUnits: state.discardedUnits + discarded
    }
  };
}
