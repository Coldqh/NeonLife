import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BusinessState, BusinessStatus, LocalEconomyState } from "../../gameplay/economy/types";
import type { FoodState } from "../../gameplay/food/foodSystem";
import { FOOD_CATALOG, getFoodProduct } from "../../data/products/foodCatalog";
import type { HumanNetworkState, PersonState } from "../../people/network/types";
import type { DistrictState, LocationState, OrganizationState } from "../../world/state/types";
import { advanceLaborMarketDay, createLaborMarketState } from "../labor/laborMarket";
import { advancePopulationLifecycleDay, createPopulationLifecycleState, normalizePopulationLifecycleState } from "../lifecycle/lifecycleSystem";
import { employmentContractId, kernelSystemEntityId, leaseContractId } from "../kernel/simulationKernel";
import type { KernelTransactionDraft } from "../kernel/types";
import type {
  BackgroundResident,
  DistrictPopulationCohort,
  EmploymentRecord,
  HouseholdDailyLedger,
  HouseholdKind,
  HouseholdPantryItem,
  HouseholdSpendingMode,
  HouseholdState,
  HousingMarketState,
  HouseholdStatus,
  OrganizationBudgetDelta,
  PopulationAdvanceResult,
  PopulationNotice,
  PopulationState,
  PopulationTransactionTotals,
  ResidentHealth,
  ResidentLifeStage,
  ShiftType
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const FIRST_NAMES = ["SENA", "TAVI", "RHEA", "ORIN", "KORA", "JUNO", "ELI", "VARA", "NEM", "CASS", "LYS", "DARA", "IVO", "MAREN", "TESS", "REN", "SOL", "NIKA", "ARLO", "VEI"] as const;
const LAST_NAMES = ["ORREL", "HALDEN", "MIREN", "ROTH", "SAYE", "KELL", "VOSS", "CALDER", "NOLL", "KORREN", "MORR", "TAREN", "VALE", "SORR", "KERN", "PELL", "DARO", "VENN", "RUSK", "TELO"] as const;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function lifeStageFor(age: number): ResidentLifeStage {
  if (age < 18) return "child";
  if (age >= 66) return "elderly";
  return "working-age";
}

function healthFor(score: number): ResidentHealth {
  if (score <= 25) return "disabled";
  if (score <= 48) return "ill";
  if (score <= 68) return "strained";
  return "healthy";
}

function householdStatus(balance: number, debt: number, deficitDays: number, rentMisses: number, kind: HouseholdKind): HouseholdStatus {
  if (kind === "unhoused" || (rentMisses >= 60 && debt >= 1_000)) return "displaced";
  if (rentMisses >= 14 || debt >= 700) return "arrears";
  if (deficitDays >= 3 || balance < 120 || debt > 0) return "strained";
  return "stable";
}

function housingLocationsForDistrict(locations: LocationState[], districtId: string): LocationState[] {
  return locations.filter((location) => location.districtId === districtId && location.type === "housing");
}

function workLocations(locations: LocationState[]): LocationState[] {
  return locations.filter((location) => location.type !== "housing" && location.type !== "government");
}

function householdKindsForDistrict(district: DistrictState): readonly HouseholdKind[] {
  if (district.costOfLiving >= 75) return ["single", "couple", "family", "single", "couple", "shared"];
  if (district.infrastructure <= 50) return ["single", "family", "shared", "dormitory", "temporary", "unhoused"];
  return ["single", "couple", "family", "shared", "dormitory", "temporary"];
}

function householdSize(kind: HouseholdKind, rng: SeededRandom): number {
  if (kind === "single" || kind === "unhoused") return 1;
  if (kind === "couple") return 2;
  if (kind === "family") return rng.integer(3, 5);
  if (kind === "shared") return rng.integer(2, 4);
  if (kind === "dormitory") return rng.integer(3, 6);
  return rng.integer(1, 3);
}

function ageForMember(kind: HouseholdKind, index: number, rng: SeededRandom): number {
  if (kind === "family") {
    if (index < 2) return rng.integer(25, 51);
    return rng.integer(2, 20);
  }
  if (kind === "couple") return rng.integer(22, 66);
  if (kind === "dormitory" || kind === "shared") return rng.integer(18, 48);
  if (kind === "unhoused") return rng.integer(19, 67);
  return rng.chance(0.14) ? rng.integer(66, 82) : rng.integer(18, 64);
}

function roleForLocation(location: LocationState): string {
  if (location.type === "clinic") return "CLINIC SUPPORT";
  if (location.type === "market") return "MARKET WORKER";
  if (location.type === "food") return "FOOD SERVICE";
  if (location.type === "workshop") return "SERVICE WORKER";
  if (location.type === "office") return "OFFICE STAFF";
  if (location.type === "transport") return "TRANSIT WORKER";
  if (location.type === "education") return "EDUCATION STAFF";
  return "GENERAL WORKER";
}

function shiftForLocation(location: LocationState, rng: SeededRandom): ShiftType {
  if (location.openHour !== undefined && location.closeHour !== undefined && location.closeHour < location.openHour) return "night";
  return rng.chance(0.2) ? "rotating" : "day";
}

function wageFor(location: LocationState, skill: number, rng: SeededRandom): number {
  const base = location.type === "office" ? 82 : location.type === "clinic" ? 68 : location.type === "education" ? 66 : location.type === "workshop" ? 64 : 48;
  return Math.round(base + skill * 0.42 + rng.integer(-8, 10));
}

function businessAt(economy: LocalEconomyState, locationId: string): BusinessState | undefined {
  return economy.businesses.find((business) => business.locationId === locationId);
}

function employmentAvailable(record: EmploymentRecord, resident: BackgroundResident, economy: LocalEconomyState): boolean {
  const business = businessAt(economy, record.locationId);
  if (resident.healthScore <= 32) return false;
  if ((resident.transportAccess ?? 100) < 20) return false;
  if (business && business.status === "closed" && business.cash <= -200) return false;
  return true;
}

function cohortFor(
  district: DistrictState,
  residents: BackgroundResident[],
  households: HouseholdState[],
  employments: EmploymentRecord[],
  representedPopulation = district.population
): DistrictPopulationCohort {
  const localResidents = residents.filter((resident) => resident.districtId === district.id);
  const localHouseholds = households.filter((household) => household.districtId === district.id);
  const employedIds = new Set(employments.filter((job) => job.status === "active").map((job) => job.residentId));
  const workingAge = localResidents.filter((resident) => resident.lifeStage === "working-age");
  const scale = localResidents.length ? representedPopulation / localResidents.length : 0;
  return {
    districtId: district.id,
    sampleSize: localResidents.length,
    representedPopulation: Math.round(representedPopulation),
    children: Math.round(localResidents.filter((resident) => resident.lifeStage === "child").length * scale),
    workingAge: Math.round(workingAge.length * scale),
    elderly: Math.round(localResidents.filter((resident) => resident.lifeStage === "elderly").length * scale),
    employed: Math.round(workingAge.filter((resident) => employedIds.has(resident.id)).length * scale),
    unemployed: Math.round(workingAge.filter((resident) => !employedIds.has(resident.id)).length * scale),
    ill: Math.round(localResidents.filter((resident) => resident.health === "ill" || resident.health === "disabled").length * scale),
    unhoused: Math.round(localResidents.filter((resident) => {
      const household = localHouseholds.find((item) => item.id === resident.householdId);
      return household?.status === "displaced";
    }).length * scale),
    households: localHouseholds.length,
    householdsInArrears: localHouseholds.filter((household) => household.status === "arrears" || household.status === "displaced").length,
    averageHouseholdBalance: localHouseholds.length
      ? Math.round(localHouseholds.reduce((sum, household) => sum + household.balance, 0) / localHouseholds.length)
      : 0,
    averageRent: localHouseholds.length
      ? Math.round(localHouseholds.reduce((sum, household) => sum + household.rentPerWeek, 0) / localHouseholds.length)
      : 0,
    foodSecureHouseholds: localHouseholds.filter((household) => household.foodUnits >= household.memberIds.length * 2).length
  };
}

function createActiveResident(
  seed: string,
  person: PersonState,
  districtId: string,
  householdId: string,
  employmentId: string | null
): BackgroundResident {
  const score = clamp(100 - Math.round(person.fatigue * 0.35 + person.stress * 0.25));
  return {
    id: createStableEntityId("resident", `${seed}:active:${person.id}`),
    name: person.name,
    age: person.age,
    lifeStage: lifeStageFor(person.age),
    districtId,
    householdId,
    homeLocationId: person.homeLocationId,
    employmentId,
    health: healthFor(score),
    healthScore: score,
    skillLevel: 48,
    savings: person.money,
    transportAccess: 100,
    activePersonId: person.id
  };
}

export function createPopulationState(
  seed: string,
  timestamp: number,
  districts: DistrictState[],
  locations: LocationState[],
  organizations: OrganizationState[],
  people: PersonState[]
): PopulationState {
  let residents: BackgroundResident[] = [];
  let households: HouseholdState[] = [];
  const employments: EmploymentRecord[] = [];
  const workNodes = workLocations(locations);
  const organizationByLocation = new Map<string, OrganizationState>();
  for (const organization of organizations) {
    for (const locationId of organization.locationIds) organizationByLocation.set(locationId, organization);
  }

  for (const [districtIndex, district] of districts.entries()) {
    const rng = new SeededRandom(`${seed}:population:${district.id}`);
    const targetResidents = districtIndex === 0 ? 112 : districtIndex === 1 ? 82 : 58;
    const homes = housingLocationsForDistrict(locations, district.id);
    const fallbackHome = homes[0] ?? null;
    const kinds = householdKindsForDistrict(district);
    let residentIndex = 0;
    let householdIndex = 0;

    while (residentIndex < targetResidents) {
      const kind = rng.pick(kinds);
      const size = Math.min(householdSize(kind, rng), targetResidents - residentIndex);
      const home = kind === "unhoused" ? null : homes.length ? rng.pick(homes) : fallbackHome;
      const householdId = createStableEntityId("household", `${seed}:${district.id}:${householdIndex}`);
      const memberIds: string[] = [];
      const districtCost = Math.round(district.costOfLiving * 1.8);
      const rent = kind === "unhoused" ? 0 : kind === "dormitory" ? districtCost : districtCost + size * rng.integer(8, 22);
      const startingBalance = kind === "unhoused" ? rng.integer(0, 45) : rng.integer(90, district.costOfLiving >= 75 ? 1800 : 760);

      for (let memberIndex = 0; memberIndex < size; memberIndex += 1) {
        const age = ageForMember(kind, memberIndex, rng);
        const stage = lifeStageFor(age);
        const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
        const residentId = createStableEntityId("resident", `${seed}:${district.id}:${residentIndex}:${name}`);
        const skill = stage === "working-age" ? rng.integer(18, 88) : rng.integer(0, 24);
        let employmentId: string | null = null;
        if (stage === "working-age" && workNodes.length && rng.chance(district.employmentRate / 100)) {
          const location = rng.pick(workNodes);
          employmentId = createStableEntityId("employment", `${seed}:${residentId}:${location.id}`);
          const organization = organizationByLocation.get(location.id);
          employments.push({
            id: employmentId,
            residentId,
            organizationId: organization?.id,
            locationId: location.id,
            title: roleForLocation(location),
            wagePerDay: wageFor(location, skill, rng),
            shift: shiftForLocation(location, rng),
            status: "active",
            absenceDays: 0,
            unpaidDays: 0
          });
        }
        const pollutionPenalty = Math.round(district.pollution * 0.22);
        const healthScore = clamp(rng.integer(62, 96) - pollutionPenalty - (kind === "unhoused" ? 20 : 0));
        residents.push({
          id: residentId,
          name,
          age,
          lifeStage: stage,
          districtId: district.id,
          householdId,
          homeLocationId: home?.id ?? null,
          employmentId,
          health: healthFor(healthScore),
          healthScore,
          skillLevel: skill,
          savings: rng.integer(0, 260),
          transportAccess: 100
        });
        memberIds.push(residentId);
        residentIndex += 1;
      }

      households.push({
        id: householdId,
        districtId: district.id,
        homeLocationId: home?.id ?? null,
        kind,
        memberIds,
        balance: startingBalance,
        debt: kind === "unhoused" ? rng.integer(80, 460) : rng.integer(0, 180),
        foodUnits: Math.max(0, size * rng.integer(2, 6)),
        pantry: [
          { productId: "kernel-9-brick", units: Math.max(1, size * rng.integer(1, 3)) },
          { productId: "morrow-algae-chips", units: rng.integer(0, Math.max(1, size)) }
        ].filter((item) => item.units > 0),
        rentPerWeek: rent,
        dailyIncome: 0,
        dailyExpenses: 0,
        housingSecurity: kind === "unhoused" ? 0 : clamp((home?.security ?? district.securityLevel) + rng.integer(-12, 10)),
        status: kind === "unhoused" ? "displaced" : "stable",
        spendingMode: kind === "unhoused" ? "survival" : startingBalance > 700 ? "comfortable" : startingBalance > 280 ? "standard" : "restricted",
        consecutiveDeficitDays: 0,
        consecutiveRentMisses: 0,
        moveCount: 0,
        lastLedger: null
      });
      householdIndex += 1;
    }
  }

  const residentByActivePerson = new Map<string, BackgroundResident>();
  for (const person of people) {
    const existing = residents.find((resident) => !resident.activePersonId && resident.age >= Math.max(18, person.age - 6) && resident.age <= person.age + 6);
    const district = districts.find((item) => locations.find((location) => location.id === person.homeLocationId)?.districtId === item.id) ?? districts[0];
    const household = existing ? households.find((item) => item.id === existing.householdId) : households.find((item) => item.districtId === district.id);
    if (!household) continue;
    let employmentId = existing?.employmentId ?? null;
    if (!employmentId) {
      const location = locations.find((item) => item.id === person.workLocationId);
      if (location) {
        employmentId = createStableEntityId("employment", `${seed}:active:${person.id}:${location.id}`);
        const organization = organizationByLocation.get(location.id);
        employments.push({
          id: employmentId,
          residentId: createStableEntityId("resident", `${seed}:active:${person.id}`),
          organizationId: organization?.id,
          locationId: location.id,
          title: person.roleLabel,
          wagePerDay: wageFor(location, 48, new SeededRandom(`${seed}:active-wage:${person.id}`)),
          shift: person.schedule.some((block) => block.activity === "work" && block.startHour >= 18) ? "night" : "day",
          status: "active",
          absenceDays: 0,
          unpaidDays: 0
        });
      }
    }
    const activeResident = createActiveResident(seed, person, district.id, household.id, employmentId);
    if (existing) {
      const index = residents.findIndex((resident) => resident.id === existing.id);
      residents[index] = activeResident;
      household.memberIds = household.memberIds.map((id) => id === existing.id ? activeResident.id : id);
      const employment = employments.find((record) => record.residentId === existing.id);
      if (employment) employment.residentId = activeResident.id;
    } else {
      residents.push(activeResident);
      household.memberIds.push(activeResident.id);
    }
    residentByActivePerson.set(person.id, activeResident);
  }

  const housing: HousingMarketState[] = locations
    .filter((location) => location.type === "housing")
    .map((location) => {
      const district = districts.find((item) => item.id === location.districtId);
      const occupied = households.filter((household) => household.homeLocationId === location.id).reduce((sum, household) => sum + household.memberIds.length, 0);
      const capacity = Math.max(occupied + 8, Math.round((district?.population ?? 100_000) / 1_900));
      const quality = clamp(Math.round((location.security + (district?.infrastructure ?? 50)) / 2));
      return {
        id: createStableEntityId("housing-market", `${seed}:${location.id}`),
        locationId: location.id,
        districtId: location.districtId,
        ownerOrganizationId: location.organizationId,
        capacity,
        occupied,
        baseRentPerBedWeek: Math.max(42, Math.round((district?.costOfLiving ?? 40) * 2.1 + quality * 0.35)),
        quality,
        condition: clamp(quality + 8),
        maintenanceFund: Math.round(occupied * 18),
        rentCollectedToday: 0,
        arrearsHouseholds: 0,
        status: quality < 32 ? "critical" : quality < 52 ? "degraded" : "stable",
        lastUpdatedAt: timestamp
      };
    });

  const initialDay = Math.floor(timestamp / DAY_MS);
  const lifecycleCreated = createPopulationLifecycleState(seed, initialDay, residents, households, districts, locations);
  residents = lifecycleCreated.residents;
  households = lifecycleCreated.households;
  const totals: PopulationTransactionTotals = { wagesPaid: 0, unpaidWages: 0, rentPaid: 0, foodSales: 0, medicalSales: 0, transportSales: 0, discretionarySales: 0, utilitySales: 0, debtRepaid: 0, maintenanceSpent: 0, moves: 0 };
  const cohorts = districts.map((district) => cohortFor(district, residents, households, employments));
  return {
    residents,
    households,
    employments,
    housing,
    cohorts,
    laborMarket: createLaborMarketState(initialDay),
    lifecycle: lifecycleCreated.state,
    totals,
    lastUpdatedAt: timestamp,
    dayIndex: initialDay,
    simulatedDays: 0
  };
}

function pushBudgetDelta(deltas: OrganizationBudgetDelta[], organizationId: string | undefined, delta: number): void {
  if (!organizationId || delta === 0) return;
  const existing = deltas.find((item) => item.organizationId === organizationId);
  if (existing) existing.delta += delta;
  else deltas.push({ organizationId, delta });
}

function emptyTotals(): PopulationTransactionTotals {
  return { wagesPaid: 0, unpaidWages: 0, rentPaid: 0, foodSales: 0, medicalSales: 0, transportSales: 0, discretionarySales: 0, utilitySales: 0, debtRepaid: 0, maintenanceSpent: 0, moves: 0 };
}

function addTotals(target: PopulationTransactionTotals, delta: Partial<PopulationTransactionTotals>): void {
  for (const [key, value] of Object.entries(delta) as Array<[keyof PopulationTransactionTotals, number | undefined]>) {
    if (typeof value === "number") target[key] += value;
  }
}

function recomputeCohorts(state: PopulationState, districts: DistrictState[]): DistrictPopulationCohort[] {
  return districts.map((district) => cohortFor(
    district,
    state.residents,
    state.households,
    state.employments,
    state.lifecycle.representedPopulationByDistrict[district.id] ?? district.population
  ));
}

function businessStatus(stock: number, staffing: number, cash: number): BusinessStatus {
  if (stock <= 4 || staffing <= 16 || cash <= 0) return "closed";
  if (stock < 18 || staffing < 31 || cash < 240) return "restricted";
  if (stock < 42 || staffing < 52 || cash < 900) return "strained";
  return "stable";
}

function spendingMode(balance: number, debt: number, members: number): HouseholdSpendingMode {
  const perPerson = balance / Math.max(1, members);
  if (debt > 500 || perPerson < 35) return "survival";
  if (debt > 120 || perPerson < 110) return "restricted";
  if (perPerson < 360) return "standard";
  return "comfortable";
}

function pantryUnits(pantry: HouseholdPantryItem[]): number {
  return pantry.reduce((sum, item) => sum + item.units, 0);
}

function consumePantry(pantry: HouseholdPantryItem[], units: number): { pantry: HouseholdPantryItem[]; consumed: number } {
  const next = pantry.map((item) => ({ ...item }));
  let remaining = units;
  for (const item of next) {
    if (remaining <= 0) break;
    const used = Math.min(item.units, remaining);
    item.units -= used;
    remaining -= used;
  }
  return { pantry: next.filter((item) => item.units > 0), consumed: units - remaining };
}

function addPantryUnit(pantry: HouseholdPantryItem[], productId: string): HouseholdPantryItem[] {
  const next = pantry.map((item) => ({ ...item }));
  const item = next.find((entry) => entry.productId === productId);
  if (item) item.units += 1;
  else next.push({ productId, units: 1 });
  return next;
}

function foodPreference(mode: HouseholdSpendingMode): readonly string[] {
  if (mode === "survival") return ["morrow-algae-chips", "kernel-9-brick", "grey-fleshfruit"];
  if (mode === "restricted") return ["kernel-9-brick", "morrow-algae-chips", "blueroot-noodles", "grey-fleshfruit"];
  if (mode === "standard") return ["blueroot-noodles", "kernel-9-brick", "dockyard-stew-04", "morrow-algae-chips", "vanta-protein-cuts"];
  return ["hexa-meal-cartridge", "vanta-protein-cuts", "dockyard-stew-04", "blueroot-noodles", "sable-recovery-pack"];
}

function businessForLocation(businesses: BusinessState[], locationId: string): BusinessState | undefined {
  return businesses.find((business) => business.locationId === locationId);
}

function updateBusiness(businesses: BusinessState[], businessId: string, update: (business: BusinessState) => BusinessState): BusinessState[] {
  return businesses.map((business) => business.id === businessId ? update(business) : business);
}

function purchaseFoodForHousehold(
  household: HouseholdState,
  unitsNeeded: number,
  locations: LocationState[],
  businesses: BusinessState[],
  food: FoodState
): { household: HouseholdState; businesses: BusinessState[]; food: FoodState; spent: number; bought: number; purchases: HouseholdDailyLedger["purchases"] } {
  let balance = household.balance;
  let pantry = household.pantry;
  let nextBusinesses = businesses;
  let nextFood = food;
  let spent = 0;
  let bought = 0;
  const purchases: HouseholdDailyLedger["purchases"] = [];
  const foodLocations = locations.filter((location) => Boolean(nextFood.shopStocks[location.id]));
  const localLocations = [
    ...foodLocations.filter((location) => location.districtId === household.districtId),
    ...foodLocations.filter((location) => location.districtId !== household.districtId)
  ];
  const preferences = foodPreference(household.spendingMode);

  for (let unit = 0; unit < unitsNeeded; unit += 1) {
    let completed = false;
    for (const productId of preferences) {
      const product = FOOD_CATALOG.find((item) => item.id === productId);
      if (!product) continue;
      for (const location of localLocations) {
        const stock = nextFood.shopStocks[location.id]?.[productId] ?? 0;
        const business = businessForLocation(nextBusinesses, location.id);
        if (stock <= 0 || business?.status === "closed") continue;
        const remoteFee = location.districtId === household.districtId ? 0 : 2;
        const price = Math.max(1, Math.round(product.price * (business?.priceIndex ?? 100) / 100) + remoteFee);
        if (balance < price) continue;
        balance -= price;
        spent += price;
        bought += 1;
        pantry = addPantryUnit(pantry, productId);
        nextFood = {
          ...nextFood,
          shopStocks: {
            ...nextFood.shopStocks,
            [location.id]: { ...nextFood.shopStocks[location.id], [productId]: stock - 1 }
          }
        };
        if (business) {
          nextBusinesses = updateBusiness(nextBusinesses, business.id, (current) => ({
            ...current,
            cash: current.cash + price,
            revenueToday: current.revenueToday + price,
            stock: clamp(current.stock - 1),
            demand: clamp(current.demand + 1)
          }));
        }
        const existing = purchases.find((entry) => entry.productId === productId && entry.locationId === location.id);
        if (existing) { existing.units += 1; existing.paid += price; }
        else purchases.push({ productId, units: 1, locationId: location.id, paid: price });
        completed = true;
        break;
      }
      if (completed) break;
    }
    if (!completed) break;
  }

  return { household: { ...household, balance, pantry, foodUnits: pantryUnits(pantry) }, businesses: nextBusinesses, food: nextFood, spent, bought, purchases };
}

function findServiceBusiness(businesses: BusinessState[], locations: LocationState[], districtId: string, kind: BusinessState["kind"]): BusinessState | undefined {
  return businesses.find((business) => business.kind === kind && locations.find((location) => location.id === business.locationId)?.districtId === districtId && business.status !== "closed")
    ?? businesses.find((business) => business.kind === kind && business.status !== "closed");
}

function settleServicePurchase(businesses: BusinessState[], business: BusinessState | undefined, amount: number): BusinessState[] {
  if (!business || amount <= 0) return businesses;
  return updateBusiness(businesses, business.id, (current) => ({ ...current, cash: current.cash + amount, revenueToday: current.revenueToday + amount, demand: clamp(current.demand + 1) }));
}

function housingStatus(condition: number): HousingMarketState["status"] {
  if (condition < 28) return "critical";
  if (condition < 52) return "degraded";
  return "stable";
}

function housingRentFor(housing: HousingMarketState, members: number): number {
  const qualityFactor = 0.7 + housing.quality / 180;
  return Math.max(20, Math.round(housing.baseRentPerBedWeek * Math.max(1, members) * qualityFactor));
}

function chooseHousing(
  household: HouseholdState,
  housing: HousingMarketState[],
  occupied: Map<string, number>,
  allowBetter: boolean
): HousingMarketState | null {
  const current = housing.find((item) => item.locationId === household.homeLocationId);
  const affordable = Math.max(55, household.dailyIncome * 5 + household.balance * 0.15);
  const candidates = housing
    .filter((item) => item.locationId !== household.homeLocationId)
    .filter((item) => item.capacity - (occupied.get(item.locationId) ?? item.occupied) >= household.memberIds.length)
    .filter((item) => housingRentFor(item, household.memberIds.length) <= affordable)
    .filter((item) => allowBetter ? item.quality > (current?.quality ?? 0) + 10 : true)
    .sort((left, right) => {
      if (allowBetter) return right.quality - left.quality || housingRentFor(left, household.memberIds.length) - housingRentFor(right, household.memberIds.length);
      return housingRentFor(left, household.memberIds.length) - housingRentFor(right, household.memberIds.length) || right.condition - left.condition;
    });
  return candidates[0] ?? null;
}

function settleBusinessesDaily(businesses: BusinessState[], employments: EmploymentRecord[], dayIndex: number, notices: PopulationNotice[], locations: LocationState[]): { businesses: BusinessState[]; employments: EmploymentRecord[] } {
  let nextEmployments = employments;
  const nextBusinesses = businesses.map((business) => {
    const profit = business.revenueToday - business.operatingCostsToday - business.payrollToday - business.supplierCostsToday - (business.utilityCostsToday ?? 0);
    const rollingProfit = Math.round(business.rollingProfit * 0.72 + profit * 0.28);
    let profitableDays = profit > 80 ? business.profitableDays + 1 : Math.max(0, business.profitableDays - 1);
    let lossDays = profit < -80 ? business.lossDays + 1 : Math.max(0, business.lossDays - 1);
    let capacityLevel = business.capacityLevel;
    let targetStaff = business.targetStaff;
    if (profitableDays >= 5 && business.cash > 2_000 && business.status === "stable") {
      capacityLevel = Math.min(5, capacityLevel + 1);
      targetStaff += 1;
      profitableDays = 0;
      const location = locations.find((item) => item.id === business.locationId);
      if (location) notices.push({ districtId: location.districtId, title: `${location.name} расширяет смену.`, detail: `Прибыль удерживалась несколько дней · открыто дополнительное рабочее место.`, importance: 1 });
    }
    if (lossDays >= 4 && targetStaff > 2) {
      targetStaff -= 1;
      lossDays = 0;
      const activeJobs = nextEmployments.filter((job) => job.locationId === business.locationId && job.status !== "unemployed");
      const jobToCut = activeJobs.sort((a, b) => a.wagePerDay - b.wagePerDay)[0];
      if (jobToCut) nextEmployments = nextEmployments.map((job) => job.id === jobToCut.id ? { ...job, status: "unemployed", absenceDays: 0, separationReason: "layoff" as const, endedDay: dayIndex } : job);
      const location = locations.find((item) => item.id === business.locationId);
      if (location) notices.push({ districtId: location.districtId, title: `${location.name} сокращает штат.`, detail: `Убыточная работа не удержала прежнее число смен.`, importance: 2 });
    }
    const status = businessStatus(business.stock, business.staffing, business.cash);
    return {
      ...business,
      capacityLevel,
      targetStaff,
      rollingProfit,
      profitableDays,
      lossDays,
      status,
      shortage: business.stock < 42,
      revenueToday: 0,
      operatingCostsToday: 0,
      payrollToday: 0,
      supplierCostsToday: 0,
      utilityCostsToday: 0,
      lastSettlementDay: dayIndex
    };
  });
  return { businesses: nextBusinesses, employments: nextEmployments };
}

export function advancePopulation(
  state: PopulationState,
  timestamp: number,
  seed: string,
  districts: DistrictState[],
  locations: LocationState[],
  organizations: OrganizationState[],
  economy: LocalEconomyState,
  foodState: FoodState
): PopulationAdvanceResult {
  if (timestamp <= state.lastUpdatedAt) return { state, economy, food: foodState, notices: [], organizationBudgetDeltas: [], transactions: [] };
  const targetDay = Math.floor(timestamp / DAY_MS);
  let dayIndex = Math.max(state.dayIndex, Math.floor(state.lastUpdatedAt / DAY_MS));
  const normalizedLifecycle = normalizePopulationLifecycleState(state.lifecycle, seed, dayIndex, state.residents, state.households, districts, locations);
  let residents = normalizedLifecycle.residents.map((resident) => ({ ...resident }));
  let households = normalizedLifecycle.households.map((household) => ({ ...household, pantry: household.pantry?.map((item) => ({ ...item })) ?? [{ productId: "kernel-9-brick", units: Math.max(0, household.foodUnits) }] }));
  let employments = state.employments.map((employment) => ({ ...employment, unpaidDays: employment.unpaidDays ?? 0 }));
  let laborMarket = state.laborMarket ?? createLaborMarketState(dayIndex);
  let lifecycle = normalizedLifecycle.state;
  let housing = state.housing.map((item) => ({ ...item }));
  let businesses = economy.businesses.map((business) => ({ ...business }));
  let food = foodState;
  const notices: PopulationNotice[] = [];
  const organizationBudgetDeltas: OrganizationBudgetDelta[] = [];
  const transactions: KernelTransactionDraft[] = [];
  const totals = { ...state.totals };
  const organizationBudgets = new Map(organizations.map((organization) => [organization.id, organization.budget]));

  while (dayIndex < targetDay) {
    dayIndex += 1;
    const dayRng = new SeededRandom(`${seed}:population-day:${dayIndex}`);
    const dayTotals = emptyTotals();
    const householdIncome = new Map<string, number>();

    employments = employments.map((employment) => {
      const resident = residents.find((item) => item.id === employment.residentId);
      if (!resident || resident.lifeStage !== "working-age") return { ...employment, status: "unemployed" as const };
      if (employment.status === "unemployed") return employment;
      const available = employmentAvailable(employment, resident, { ...economy, businesses });
      if (!available) {
        const nextAbsence = employment.absenceDays + 1;
        const employer = businessForLocation(businesses, employment.locationId);
        const lost = Boolean(employer && employer.status === "closed" && employer.cash <= -200 && nextAbsence >= 5);
        if (lost) notices.push({ districtId: resident.districtId, title: `${resident.name} потерял рабочую смену.`, detail: `${employment.title} · рабочая точка не удержала место.`, importance: 2 });
        return { ...employment, status: lost ? "unemployed" as const : "absent" as const, absenceDays: nextAbsence, separationReason: lost ? "closure" as const : employment.separationReason, endedDay: lost ? dayIndex : employment.endedDay };
      }

      const business = businessForLocation(businesses, employment.locationId);
      const wage = employment.wagePerDay;
      let paid = 0;
      if (employment.organizationId) {
        const availableBudget = organizationBudgets.get(employment.organizationId) ?? 0;
        paid = Math.min(wage, availableBudget);
        organizationBudgets.set(employment.organizationId, availableBudget - paid);
        pushBudgetDelta(organizationBudgetDeltas, employment.organizationId, -paid);
      } else if (business) {
        paid = Math.min(wage, Math.max(0, business.cash));
        businesses = updateBusiness(businesses, business.id, (current) => ({ ...current, cash: current.cash - paid, payrollToday: current.payrollToday + paid }));
      }
      const unpaid = wage - paid;
      addTotals(dayTotals, { wagesPaid: paid, unpaidWages: unpaid });
      householdIncome.set(resident.householdId, (householdIncome.get(resident.householdId) ?? 0) + paid);
      if (paid > 0) {
        transactions.push({
          idempotencyKey: `${seed}:day:${dayIndex}:wage:${employment.id}`,
          timestamp: dayIndex * DAY_MS,
          debitEntityId: employment.organizationId ?? business?.id ?? kernelSystemEntityId(seed, "clearing"),
          creditEntityId: resident.householdId,
          resource: "credits",
          amount: paid,
          reason: "wage",
          contractId: employmentContractId(employment.id),
          description: `${employment.title} daily wage.`
        });
      }
      const unpaidDays = unpaid > 0 ? employment.unpaidDays + 1 : 0;
      const lostForNonPayment = unpaidDays >= 3;
      if (lostForNonPayment) notices.push({ districtId: resident.districtId, title: `${resident.name} покинул неоплачиваемую смену.`, detail: `${employment.title} · зарплата не выплачивалась ${unpaidDays} дня.`, importance: 2 });
      return { ...employment, status: lostForNonPayment ? "unemployed" as const : "active" as const, absenceDays: 0, unpaidDays, separationReason: lostForNonPayment ? "nonpayment" as const : undefined, endedDay: lostForNonPayment ? dayIndex : undefined };
    });

    housing = housing.map((item) => ({ ...item, rentCollectedToday: 0, arrearsHouseholds: 0 }));

    households = households.map((sourceHousehold) => {
      let household = { ...sourceHousehold, balance: sourceHousehold.balance + (householdIncome.get(sourceHousehold.id) ?? 0) };
      const members = residents.filter((resident) => resident.householdId === household.id);
      const income = householdIncome.get(household.id) ?? 0;
      const dailyFoodNeed = Math.max(1, Math.ceil(members.reduce((sum, member) => sum + (member.lifeStage === "child" ? 0.75 : member.lifeStage === "elderly" ? 0.85 : 1), 0)));
      household.spendingMode = spendingMode(household.balance, household.debt, members.length);
      const consumed = consumePantry(household.pantry, dailyFoodNeed);
      household.pantry = consumed.pantry;
      if (consumed.consumed > 0) transactions.push({
        idempotencyKey: `${seed}:day:${dayIndex}:food-consumed-stock:${household.id}`,
        timestamp: dayIndex * DAY_MS,
        debitEntityId: household.id,
        creditEntityId: kernelSystemEntityId(seed, "consumption"),
        resource: "food-units",
        amount: consumed.consumed,
        reason: "inventory-transfer",
        description: `Household daily food consumption.`
      });
      let unmet = dailyFoodNeed - consumed.consumed;
      let purchases: HouseholdDailyLedger["purchases"] = [];
      let foodSpent = 0;
      if (unmet > 0) {
        const purchase = purchaseFoodForHousehold(household, Math.min(unmet + dailyFoodNeed, dailyFoodNeed * 3), locations, businesses, food);
        household = purchase.household;
        businesses = purchase.businesses;
        food = purchase.food;
        foodSpent = purchase.spent;
        purchases = purchase.purchases;
        const afterPurchase = consumePantry(household.pantry, unmet);
        household.pantry = afterPurchase.pantry;
        unmet -= afterPurchase.consumed;
        if (afterPurchase.consumed > 0) transactions.push({
          idempotencyKey: `${seed}:day:${dayIndex}:food-consumed-purchase:${household.id}`,
          timestamp: dayIndex * DAY_MS,
          debitEntityId: household.id,
          creditEntityId: kernelSystemEntityId(seed, "consumption"),
          resource: "food-units",
          amount: afterPurchase.consumed,
          reason: "inventory-transfer",
          description: `Freshly purchased food consumed by household.`
        });
      }
      for (const purchase of purchases) {
        const seller = businessForLocation(businesses, purchase.locationId);
        const sellerId = seller?.id ?? kernelSystemEntityId(seed, "wholesale");
        transactions.push({
          idempotencyKey: `${seed}:day:${dayIndex}:food-credit:${household.id}:${purchase.locationId}:${purchase.productId}`,
          timestamp: dayIndex * DAY_MS,
          debitEntityId: household.id,
          creditEntityId: sellerId,
          resource: "credits",
          amount: purchase.paid,
          unitValue: purchase.units ? purchase.paid / purchase.units : purchase.paid,
          reason: "food-sale",
          description: `${purchase.productId} household purchase.`
        });
        transactions.push({
          idempotencyKey: `${seed}:day:${dayIndex}:food-unit:${household.id}:${purchase.locationId}:${purchase.productId}`,
          timestamp: dayIndex * DAY_MS,
          debitEntityId: kernelSystemEntityId(seed, "wholesale"),
          creditEntityId: household.id,
          resource: "food-units",
          amount: purchase.units,
          unitValue: purchase.units ? purchase.paid / purchase.units : 0,
          reason: "inventory-transfer",
          description: `${purchase.productId} moved into household pantry.`
        });
      }

      let rentPaid = 0;
      const housingUnit = housing.find((item) => item.locationId === household.homeLocationId);
      const rentDue = housingUnit && household.kind !== "unhoused" ? Math.round(housingRentFor(housingUnit, members.length) / 7) : 0;
      if (rentDue > 0 && household.balance >= rentDue) {
        household.balance -= rentDue;
        rentPaid = rentDue;
        household.consecutiveRentMisses = 0;
        housing = housing.map((item) => item.id === housingUnit?.id ? { ...item, rentCollectedToday: item.rentCollectedToday + rentPaid, maintenanceFund: item.maintenanceFund + Math.round(rentPaid * 0.28) } : item);
        const ownerId = housingUnit?.ownerOrganizationId ?? kernelSystemEntityId(seed, "housing-authority");
        const maintenanceShare = Math.round(rentPaid * 0.28);
        const ownerShare = rentPaid - maintenanceShare;
        if (housingUnit?.ownerOrganizationId) pushBudgetDelta(organizationBudgetDeltas, housingUnit.ownerOrganizationId, ownerShare);
        if (ownerShare > 0) transactions.push({
          idempotencyKey: `${seed}:day:${dayIndex}:rent-owner:${household.id}`,
          timestamp: dayIndex * DAY_MS,
          debitEntityId: household.id,
          creditEntityId: ownerId,
          resource: "credits",
          amount: ownerShare,
          reason: "rent",
          contractId: leaseContractId(household.id),
          assetId: housingUnit ? createStableEntityId("asset", `housing:${housingUnit.id}`) : undefined,
          description: `Daily lease payment to housing owner.`
        });
        if (maintenanceShare > 0) transactions.push({
          idempotencyKey: `${seed}:day:${dayIndex}:rent-maintenance:${household.id}`,
          timestamp: dayIndex * DAY_MS,
          debitEntityId: household.id,
          creditEntityId: housingUnit?.id ?? kernelSystemEntityId(seed, "maintenance"),
          resource: "credits",
          amount: maintenanceShare,
          reason: "rent",
          contractId: leaseContractId(household.id),
          assetId: housingUnit ? createStableEntityId("asset", `housing:${housingUnit.id}`) : undefined,
          description: `Housing maintenance reserve contribution.`
        });
      } else if (rentDue > 0) {
        household.debt += rentDue;
        household.consecutiveRentMisses += 1;
        housing = housing.map((item) => item.id === housingUnit?.id ? { ...item, arrearsHouseholds: item.arrearsHouseholds + 1 } : item);
      }

      const workingMembers = members.filter((member) => member.lifeStage === "working-age" && employments.some((job) => job.residentId === member.id && job.status === "active")).length;
      const transportDue = workingMembers * 4;
      const transportSpent = Math.min(transportDue, household.balance);
      household.balance -= transportSpent;
      const transportBusiness = findServiceBusiness(businesses, locations, household.districtId, "logistics");
      businesses = settleServicePurchase(businesses, transportBusiness, transportSpent);
      if (transportSpent > 0) transactions.push({
        idempotencyKey: `${seed}:day:${dayIndex}:transport:${household.id}`,
        timestamp: dayIndex * DAY_MS,
        debitEntityId: household.id,
        creditEntityId: transportBusiness?.id ?? kernelSystemEntityId(seed, "city-services"),
        resource: "credits",
        amount: transportSpent,
        reason: "transport-service",
        description: `Household commuting settlement.`
      });

      // Clinical spending is settled by Health & Cyberware from actual diagnoses,
      // triage, supplies, coverage and treatment. Population accounting does not
      // create generic medical purchases from a health flag.
      const medicalSpent = 0;

      const discretionaryTarget = household.spendingMode === "comfortable" ? Math.round(members.length * 8) : household.spendingMode === "standard" ? Math.round(members.length * 3) : 0;
      const discretionarySpent = Math.min(discretionaryTarget, Math.max(0, household.balance - 120));
      household.balance -= discretionarySpent;
      const leisureBusiness = findServiceBusiness(businesses, locations, household.districtId, "food-service");
      businesses = settleServicePurchase(businesses, leisureBusiness, discretionarySpent);
      if (discretionarySpent > 0) transactions.push({
        idempotencyKey: `${seed}:day:${dayIndex}:discretionary:${household.id}`,
        timestamp: dayIndex * DAY_MS,
        debitEntityId: household.id,
        creditEntityId: leisureBusiness?.id ?? kernelSystemEntityId(seed, "city-services"),
        resource: "credits",
        amount: discretionarySpent,
        reason: "discretionary-service",
        description: `Household discretionary spending.`
      });

      let debtPaid = 0;
      if (household.debt > 0 && household.balance > 180) {
        debtPaid = Math.min(household.debt, Math.round((household.balance - 130) * 0.32));
        household.debt -= debtPaid;
        household.balance -= debtPaid;
        transactions.push({
          idempotencyKey: `${seed}:day:${dayIndex}:debt:${household.id}`,
          timestamp: dayIndex * DAY_MS,
          debitEntityId: household.id,
          creditEntityId: kernelSystemEntityId(seed, "credit-bureau"),
          resource: "credits",
          amount: debtPaid,
          reason: "debt-repayment",
          description: `Household debt repayment.`
        });
      }

      const expenses = foodSpent + rentPaid + transportSpent + medicalSpent + discretionarySpent + debtPaid;
      const deficit = unmet > 0 || household.consecutiveRentMisses > 0 || household.balance <= 0;
      const deficitDays = deficit ? household.consecutiveDeficitDays + 1 : Math.max(0, household.consecutiveDeficitDays - 1);
      const nextStatus = householdStatus(household.balance, household.debt, deficitDays, household.consecutiveRentMisses, household.kind);
      if (nextStatus !== household.status && (nextStatus === "arrears" || nextStatus === "displaced" || household.status === "displaced")) notices.push({ districtId: household.districtId, title: nextStatus === "displaced" ? "Домохозяйство потеряло устойчивое жильё." : "Домохозяйство вошло в просрочку.", detail: `${members.length} чел. · доход ₵${income} · расходы ₵${expenses} · долг ₵${household.debt}.`, importance: nextStatus === "displaced" ? 3 : 2 });
      addTotals(dayTotals, { rentPaid, foodSales: foodSpent, medicalSales: medicalSpent, transportSales: transportSpent, discretionarySales: discretionarySpent, debtRepaid: debtPaid });
      return {
        ...household,
        foodUnits: pantryUnits(household.pantry),
        dailyIncome: income,
        dailyExpenses: expenses,
        status: nextStatus,
        consecutiveDeficitDays: deficitDays,
        lastLedger: { dayIndex, income, rentPaid, foodSpent, transportSpent, medicalSpent, discretionarySpent, utilitySpent: 0, debtPaid, unmetFoodUnits: unmet, purchases }
      };
    });

    const occupied = new Map<string, number>();
    for (const household of households) if (household.homeLocationId) occupied.set(household.homeLocationId, (occupied.get(household.homeLocationId) ?? 0) + household.memberIds.length);
    households = households.map((household) => {
      const shouldMove = household.status === "displaced" || household.consecutiveRentMisses >= 28;
      const canUpgrade = !shouldMove && household.status === "stable" && household.balance > 1_000 && dayRng.chance(0.015);
      if (!shouldMove && !canUpgrade) return household;
      const target = chooseHousing(household, housing, occupied, canUpgrade);
      if (!target) {
        if (household.homeLocationId && household.consecutiveRentMisses < 60) return household;
        if (household.homeLocationId) occupied.set(household.homeLocationId, Math.max(0, (occupied.get(household.homeLocationId) ?? 0) - household.memberIds.length));
        addTotals(dayTotals, { moves: household.homeLocationId ? 1 : 0 });
        return { ...household, homeLocationId: null, kind: "unhoused" as const, status: "displaced" as const, housingSecurity: 0, moveCount: household.moveCount + (household.homeLocationId ? 1 : 0) };
      }
      if (household.homeLocationId) occupied.set(household.homeLocationId, Math.max(0, (occupied.get(household.homeLocationId) ?? 0) - household.memberIds.length));
      occupied.set(target.locationId, (occupied.get(target.locationId) ?? 0) + household.memberIds.length);
      addTotals(dayTotals, { moves: 1 });
      notices.push({ districtId: household.districtId, title: canUpgrade ? "Домохозяйство сменило жильё." : "Домохозяйство нашло более дешёвое место.", detail: `${household.memberIds.length} чел. · новый объект ${locations.find((item) => item.id === target.locationId)?.name ?? "HOUSING"}.`, importance: canUpgrade ? 1 : 2 });
      return { ...household, homeLocationId: target.locationId, kind: target.capacity > 90 ? "dormitory" as const : household.memberIds.length > 2 ? "shared" as const : household.kind, rentPerWeek: housingRentFor(target, household.memberIds.length), housingSecurity: target.condition, status: "strained" as const, consecutiveRentMisses: 0, moveCount: household.moveCount + 1 };
    });

    residents = residents.map((resident) => {
      const household = households.find((item) => item.id === resident.householdId);
      const district = districts.find((item) => item.id === resident.districtId);
      const unmetFood = household?.lastLedger?.unmetFoodUnits ?? 0;
      const chronicFoodStress = unmetFood > 0 && (household?.consecutiveDeficitDays ?? 0) >= 3;
      const foodPenalty = chronicFoodStress
        ? ((household?.consecutiveDeficitDays ?? 0) >= 12 ? 2 : 1)
        : 0;
      const housingPenalty = household?.status === "displaced"
        ? (dayRng.chance(0.10) ? 1 : 0)
        : household?.status === "arrears" && dayRng.chance(0.025) ? 1 : 0;
      const environmentalRisk = district
        ? Math.min(0.18, (district.pollution + Math.max(0, 55 - district.infrastructure)) / 1_800)
        : 0.03;
      const pollutionPenalty = dayRng.chance(environmentalRisk) ? 1 : 0;
      const recovery = household?.status === "stable" && household.foodUnits > household.memberIds.length && resident.healthScore < 82
        ? 1
        : 0;
      const healthScore = clamp(resident.healthScore - foodPenalty - housingPenalty - pollutionPenalty + recovery);
      return { ...resident, homeLocationId: household?.homeLocationId ?? null, healthScore, health: healthFor(healthScore), savings: Math.max(0, resident.savings + dayRng.integer(-3, 2)), transportAccess: resident.transportAccess ?? 100 };
    });

    housing = housing.map((unit) => {
      const occupiedBeds = occupied.get(unit.locationId) ?? 0;
      const maintenanceSpend = Math.min(unit.maintenanceFund, Math.max(0, Math.round(unit.capacity * 0.5)));
      const occupancyRate = occupiedBeds / Math.max(1, unit.capacity);
      const neglect = unit.rentCollectedToday < Math.max(20, occupiedBeds * 2) ? 2 : 0;
      const crowding = occupancyRate > 0.96 ? 3 : 0;
      const condition = clamp(unit.condition + Math.round(maintenanceSpend / Math.max(20, unit.capacity)) - neglect - crowding);
      addTotals(dayTotals, { maintenanceSpent: maintenanceSpend });
      if (maintenanceSpend > 0) transactions.push({
        idempotencyKey: `${seed}:day:${dayIndex}:maintenance:${unit.id}`,
        timestamp: dayIndex * DAY_MS,
        debitEntityId: unit.id,
        creditEntityId: kernelSystemEntityId(seed, "city-services"),
        resource: "credits",
        amount: maintenanceSpend,
        reason: "maintenance",
        assetId: createStableEntityId("asset", `housing:${unit.id}`),
        description: `Housing maintenance expenditure.`
      });
      return { ...unit, occupied: occupiedBeds, condition, maintenanceFund: Math.max(0, unit.maintenanceFund - maintenanceSpend), status: housingStatus(condition), lastUpdatedAt: timestamp };
    });

    const settled = settleBusinessesDaily(businesses, employments, dayIndex, notices, locations);
    businesses = settled.businesses;
    employments = settled.employments;

    const laborAdvance = advanceLaborMarketDay(
      laborMarket,
      dayIndex,
      seed,
      residents,
      employments,
      households,
      businesses,
      locations
    );
    laborMarket = laborAdvance.state;
    residents = laborAdvance.residents;
    employments = laborAdvance.employments;
    businesses = laborAdvance.businesses;
    notices.push(...laborAdvance.notices);

    const lifecycleAdvance = advancePopulationLifecycleDay({
      state: lifecycle,
      dayIndex,
      seed,
      residents,
      households,
      employments,
      housing,
      districts,
      locations,
      organizations
    });
    lifecycle = lifecycleAdvance.state;
    residents = lifecycleAdvance.residents;
    households = lifecycleAdvance.households;
    employments = lifecycleAdvance.employments;
    housing = lifecycleAdvance.housing;
    notices.push(...lifecycleAdvance.notices);
    transactions.push(...lifecycleAdvance.transactions);
    for (const delta of lifecycleAdvance.organizationBudgetDeltas) pushBudgetDelta(organizationBudgetDeltas, delta.organizationId, delta.delta);
    const existingResidentIds = new Set(residents.map((resident) => resident.id));
    laborMarket = {
      ...laborMarket,
      applications: laborMarket.applications.filter((application) => existingResidentIds.has(application.residentId)),
      vacancies: laborMarket.vacancies.map((vacancy) => ({ ...vacancy, applicationIds: vacancy.applicationIds.filter((id) => laborMarket.applications.some((application) => application.id === id && existingResidentIds.has(application.residentId))) }))
    };
    addTotals(totals, dayTotals);
  }

  const nextState: PopulationState = { ...state, residents, households, employments, housing, laborMarket, lifecycle, totals, lastUpdatedAt: timestamp, dayIndex, simulatedDays: state.simulatedDays + Math.max(0, targetDay - state.dayIndex), cohorts: [] };
  nextState.cohorts = recomputeCohorts(nextState, districts);
  return { state: nextState, economy: { ...economy, businesses }, food, notices: notices.slice(0, 10), organizationBudgetDeltas, transactions };
}

export function synchronizeActivePeopleFromPopulation(network: HumanNetworkState, population: PopulationState): HumanNetworkState {
  return {
    ...network,
    people: network.people.map((person) => {
      const resident = population.residents.find((item) => item.activePersonId === person.id);
      if (!resident) {
        const archived = population.lifecycle.archive.slice().reverse().find((item) => item.activePersonId === person.id);
        if (!archived) return person;
        return {
          ...person,
          age: archived.age,
          lifeStatus: archived.status === "deceased" ? "deceased" as const : "migrated" as const,
          status: archived.status === "deceased" ? "DECEASED" : "LEFT CITY",
          lifecycleNote: archived.status === "deceased" ? archived.cause : `Destination: ${archived.destination ?? "EXTERNAL REGION"}`,
          fatigue: 0,
          stress: 0
        };
      }
      const household = population.households.find((item) => item.id === resident.householdId);
      const stressDelta = household?.status === "displaced" ? 18 : household?.status === "arrears" ? 9 : household?.status === "strained" ? 3 : -1;
      const problemSeverity = clamp(person.problem.severity + stressDelta);
      return {
        ...person,
        age: resident.age,
        lifeStatus: "alive" as const,
        lifecycleNote: resident.educationLevel ? `Education: ${resident.educationLevel}` : person.lifecycleNote,
        money: Math.max(0, resident.savings + Math.round((household?.balance ?? 0) / Math.max(1, household?.memberIds.length ?? 1))),
        stress: clamp(person.stress + stressDelta),
        fatigue: clamp(person.fatigue + (resident.health === "ill" || resident.health === "disabled" ? 5 : -1)),
        problem: { ...person.problem, severity: problemSeverity }
      };
    })
  };
}

export function getPopulationWorkerAvailability(state: PopulationState, locationId: string): { total: number; active: number; ill: number } {
  const jobs = state.employments.filter((employment) => employment.locationId === locationId && employment.status !== "unemployed");
  const residentById = new Map(state.residents.map((resident) => [resident.id, resident]));
  const ill = jobs.filter((job) => {
    const resident = residentById.get(job.residentId);
    return resident?.health === "ill" || resident?.health === "disabled";
  }).length;
  return { total: jobs.length, active: jobs.filter((job) => job.status === "active").length, ill };
}
