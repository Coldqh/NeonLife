import { createInitialEvents } from "../../core/events/demoEvents";
import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import { SAVE_SCHEMA_VERSION } from "../../core/saves/types";
import { INITIAL_GAME_TIMESTAMP } from "../../core/time/gameTime";
import { createInitialPlayer } from "../../gameplay/player/demoPlayer";
import { createInitialFoodState } from "../../gameplay/food/foodSystem";
import { createInitialHousing } from "../../gameplay/housing/housingSystem";
import { createInitialCourierState } from "../../gameplay/jobs/courier/courierSystem";
import { createLocalEconomy } from "../../gameplay/economy/localEconomy";
import { createPressureState } from "../../gameplay/pressure/pressureSystem";
import { createPrimaryContact } from "../../people/demoNpc";
import { createHumanNetwork, getPerson, toKnownNpc } from "../../people/network/humanNetwork";
import { createPopulationState } from "../../simulation/population/populationSystem";
import { advanceSimulationKernel, createSimulationKernel } from "../../simulation/kernel/simulationKernel";
import { createInfrastructureState } from "../../simulation/infrastructure/infrastructureSystem";
import { createProductionState } from "../../simulation/production/productionSystem";
import { createOrganizationEcosystem } from "../../simulation/organizations/organizationSystem";
import { createGovernmentCrimeState } from "../../simulation/government/governmentSystem";
import { createHealthCyberwareState } from "../../simulation/health/healthSystem";
import { createInitialDistrictPulse } from "../city/districtPulse";
import { createWorldMeta } from "../city/demoWorld";
import type {
  CityState,
  DistrictState,
  GameSession,
  LocationState,
  OrganizationState,
  ScheduledWorldEvent,
  WorldState
} from "../state/types";

const CITY_NAMES = ["LYSARA", "VEYRA", "CAELON", "ORISSA-9"] as const;
const LOWER_DISTRICTS = ["UNDERLINE", "LOWER TRACE", "SILTWARD", "NIGHT BLOCKS"] as const;
const INDUSTRIAL_DISTRICTS = ["FOUNDRY ARC", "IRON RING", "FREIGHT BELT", "ASSEMBLY WARD"] as const;
const CORPORATE_DISTRICTS = ["GLASSWARD", "CROWN ARRAY", "WHITE SECTOR", "AURELIS HEIGHTS"] as const;

function createDistrict(
  seed: string,
  scope: string,
  name: string,
  code: string,
  population: number,
  values: Omit<DistrictState, "id" | "name" | "code" | "population" | "locationIds">
): DistrictState {
  return {
    id: createStableEntityId("district", `${seed}:${scope}`),
    name,
    code,
    population,
    ...values,
    locationIds: []
  };
}

function createOrganization(
  seed: string,
  scope: string,
  name: string,
  code: string,
  type: OrganizationState["type"],
  budget: number,
  reputation: number,
  employeeCount: number
): OrganizationState {
  return {
    id: createStableEntityId("org", `${seed}:${scope}`),
    name,
    code,
    type,
    budget,
    reputation,
    employeeCount,
    locationIds: []
  };
}

function createLocation(
  seed: string,
  scope: string,
  districtId: string,
  name: string,
  code: string,
  type: LocationState["type"],
  security: number,
  organizationId?: string,
  openHour = 0,
  closeHour = 24
): LocationState {
  return {
    id: createStableEntityId("location", `${seed}:${scope}`),
    districtId,
    organizationId,
    name,
    code,
    type,
    open: true,
    security,
    openHour,
    closeHour
  };
}

function attachLocations(
  districts: DistrictState[],
  organizations: OrganizationState[],
  locations: LocationState[]
): void {
  for (const location of locations) {
    const district = districts.find((item) => item.id === location.districtId);
    if (district) district.locationIds.push(location.id);
    if (location.organizationId) {
      const organization = organizations.find((item) => item.id === location.organizationId);
      if (organization) organization.locationIds.push(location.id);
    }
  }
}

function createQueue(seed: string, start: number, world: WorldState): ScheduledWorldEvent[] {
  return [
    {
      id: createStableEntityId("scheduled", `${seed}:rent-warning`),
      dueAt: start + 5 * 24 * 60 * 60_000,
      type: "rent-warning",
      status: "queued",
      entityIds: [world.playerId],
      payload: { daysLeft: 2 }
    }
  ];
}

export function createWorldSession(seed: string): GameSession {
  const rng = new SeededRandom(seed);
  const cityName = rng.pick(CITY_NAMES);
  const lowerName = rng.pick(LOWER_DISTRICTS);
  const industrialName = rng.pick(INDUSTRIAL_DISTRICTS);
  const corporateName = rng.pick(CORPORATE_DISTRICTS);

  const lower = createDistrict(seed, "lower", lowerName, "BLOCK 07", rng.integer(178_000, 244_000), {
    securityLevel: rng.integer(28, 39),
    costOfLiving: rng.integer(22, 34),
    infrastructure: rng.integer(39, 52),
    pollution: rng.integer(55, 72),
    corporateInfluence: rng.integer(9, 18),
    gangInfluence: rng.integer(42, 61),
    governmentInfluence: rng.integer(23, 36),
    employmentRate: rng.integer(52, 66)
  });
  const industrial = createDistrict(seed, "industrial", industrialName, "RING 12", rng.integer(104_000, 151_000), {
    securityLevel: rng.integer(42, 55),
    costOfLiving: rng.integer(34, 47),
    infrastructure: rng.integer(55, 68),
    pollution: rng.integer(70, 86),
    corporateInfluence: rng.integer(38, 56),
    gangInfluence: rng.integer(24, 39),
    governmentInfluence: rng.integer(31, 44),
    employmentRate: rng.integer(67, 79)
  });
  const corporate = createDistrict(seed, "corporate", corporateName, "TIER 03", rng.integer(71_000, 103_000), {
    securityLevel: rng.integer(76, 91),
    costOfLiving: rng.integer(81, 96),
    infrastructure: rng.integer(85, 97),
    pollution: rng.integer(12, 25),
    corporateInfluence: rng.integer(82, 95),
    gangInfluence: rng.integer(2, 9),
    governmentInfluence: rng.integer(55, 71),
    employmentRate: rng.integer(83, 94)
  });
  const districts = [lower, industrial, corporate];

  const aurelian = createOrganization(seed, "aurelian", "AURELIAN SYSTEMS", "AUR/SYS", "corporation", 84_000_000, 71, 18_400);
  const vectra = createOrganization(seed, "vectra", "VECTRA WORKS", "VEC/WRK", "company", 2_840_000, 48, 318);
  const meshline = createOrganization(seed, "meshline", "MESHLINE COURIER CO-OP", "MSH/DLV", "company", 1_140_000, 46, 214);
  const transit = createOrganization(seed, "transit", "NORTHLINE TRANSIT", "NL/T", "transport", 18_200_000, 43, 4_900);
  const medical = createOrganization(seed, "medical", "CIVIC MEDICAL UNION", "CMU", "medical", 31_600_000, 57, 7_120);
  const civic = createOrganization(seed, "civic-authority", `${cityName} CIVIC AUTHORITY`, "CIV/AUTH", "government", 46_000_000, 39, 8_200);
  const police = createOrganization(seed, "police", "DISTRICT SECURITY BUREAU", "DSB", "police", 27_900_000, 32, 6_300);
  const gang = createOrganization(seed, "cutwire", "CUTWIRE", "CW", "gang", 410_000, 19, 86);
  const habstack = createOrganization(seed, "habstack-trust", "HABSTACK PROPERTY TRUST", "HAB/TRUST", "company", 780_000, 28, 54);
  const marketCoop = createOrganization(seed, "underline-market", "UNDERLINE MARKET COOPERATIVE", "MKT/COOP", "independent", 620_000, 44, 96);
  const kitchenCollective = createOrganization(seed, "night-kitchen", "NIGHT KITCHEN COLLECTIVE", "FOOD/COL", "independent", 240_000, 38, 34);
  const organizations = [aurelian, vectra, meshline, transit, medical, civic, police, gang, habstack, marketCoop, kitchenCollective];

  const housing = createLocation(seed, "capsule", lower.id, "HAB-STACK 07", "HAB/U07", "housing", 31, habstack.id, 0, 24);
  const canteen = createLocation(seed, "canteen", lower.id, "NIGHT KITCHEN 14", "FOOD/U14", "food", 24, kitchenCollective.id, 18, 5);
  const transitNode = createLocation(seed, "transit-node", lower.id, "TRANSIT NODE U-07", "MOVE/U07", "transport", 46, transit.id, 0, 24);
  const workerDorm = createLocation(seed, "worker-dorm", industrial.id, "WORKER DORM 12", "HAB/R12", "housing", 47, vectra.id, 0, 24);
  const workshop = createLocation(seed, "workshop", industrial.id, "VECTRA SERVICE NODE", "VEC/SN-12", "workshop", 58, vectra.id, 6, 2);
  const clinic = createLocation(seed, "clinic", lower.id, "CMU WALK-IN CLINIC", "CMU/U03", "clinic", 52, medical.id, 0, 24);
  const traumaStation = createLocation(seed, "trauma-station", industrial.id, "CMU INDUSTRIAL TRAUMA STATION", "CMU/R08", "clinic", 68, medical.id, 0, 24);
  const regionalHospital = createLocation(seed, "regional-hospital", corporate.id, "CMU REGIONAL HOSPITAL", "CMU/T02", "clinic", 86, medical.id, 0, 24);
  const occupationalClinic = createLocation(seed, "occupational-clinic", corporate.id, "AURELIAN OCCUPATIONAL CLINIC", "AUR/MED-01", "clinic", 92, aurelian.id, 6, 23);
  const undergroundClinic = createLocation(seed, "underground-clinic", lower.id, "CUTWIRE BACKROOM SURGERY", "CW/MED-U", "clinic", 19, gang.id, 20, 5);
  const crownHousing = createLocation(seed, "crown-housing", corporate.id, "CROWN RESIDENCES 03", "HAB/T03", "housing", 88, aurelian.id, 0, 24);
  const tower = createLocation(seed, "tower", corporate.id, "AURELIAN CROWN TOWER", "AUR/CT-01", "office", 94, aurelian.id, 7, 22);
  const market = createLocation(seed, "market", lower.id, "UNDERLINE NIGHT MARKET", "MKT/U09", "market", 26, marketCoop.id, 16, 6);
  const courierHub = createLocation(seed, "courier-hub", lower.id, "MESHLINE DISPATCH HALL", "MSH/U11", "transport", 41, meshline.id, 0, 24);
  const civicHall = createLocation(seed, "civic-hall", corporate.id, `${cityName} CIVIC ADMINISTRATION`, "CIV/T01", "government", 82, civic.id, 7, 21);
  const lowerLearningHub = createLocation(seed, "lower-learning-hub", lower.id, "CIVIC LEARNING HUB U-04", "EDU/U04", "education", 44, civic.id, 7, 20);
  const technicalInstitute = createLocation(seed, "technical-institute", industrial.id, "VECTRA TECHNICAL INSTITUTE", "EDU/R12", "education", 63, vectra.id, 6, 22);
  const corporateAcademy = createLocation(seed, "corporate-academy", corporate.id, "AURELIAN ACADEMY", "EDU/T03", "education", 91, aurelian.id, 7, 22);
  const locations = [housing, canteen, transitNode, workerDorm, workshop, clinic, traumaStation, regionalHospital, occupationalClinic, undergroundClinic, crownHousing, tower, market, courierHub, civicHall, lowerLearningHub, technicalInstitute, corporateAcademy];
  attachLocations(districts, organizations, locations);

  const player = createInitialPlayer(seed, lower.name, lower.code);
  const people = createHumanNetwork(seed, INITIAL_GAME_TIMESTAMP, locations);
  const selectedPerson = getPerson(people, people.selectedPersonId);
  const primaryContact = selectedPerson
    ? toKnownNpc(selectedPerson, locations, INITIAL_GAME_TIMESTAMP)
    : createPrimaryContact(seed, housing.name);
  const meta = createWorldMeta(seed);
  meta.currentTimestamp = INITIAL_GAME_TIMESTAMP;

  const city: CityState = {
    id: createStableEntityId("city", `${seed}:city`),
    name: cityName,
    code: `CITY/${rng.integer(10, 99)}`,
    population: districts.reduce((total, district) => total + district.population, 0),
    weather: "ACID RAIN",
    temperatureC: 11,
    networkStatus: "stable"
  };

  const housingState = createInitialHousing(housing.id, INITIAL_GAME_TIMESTAMP);
  const foodState = createInitialFoodState(seed, INITIAL_GAME_TIMESTAMP, market.id, canteen.id, clinic.id);
  const districtPulse = createInitialDistrictPulse(INITIAL_GAME_TIMESTAMP, seed);
  const population = createPopulationState(seed, INITIAL_GAME_TIMESTAMP, districts, locations, organizations, people.people);
  const economy = createLocalEconomy(seed, INITIAL_GAME_TIMESTAMP, locations, people.people, population, foodState, districtPulse);
  const pressure = createPressureState(seed, INITIAL_GAME_TIMESTAMP, housingState, people.people, locations);

  const infrastructure = createInfrastructureState(seed, INITIAL_GAME_TIMESTAMP, city, districts, locations, organizations, population, economy);
  const production = createProductionState(seed, INITIAL_GAME_TIMESTAMP, districts, locations, organizations, economy);

  const world: WorldState = {
    meta,
    city,
    districts,
    locations,
    organizations,
    activeDistrictId: lower.id,
    playerId: player.id,
    primaryContactId: primaryContact.id
  };
  const kernel = createSimulationKernel({
    timestamp: INITIAL_GAME_TIMESTAMP,
    seed,
    city,
    districts,
    locations,
    organizations,
    player,
    population,
    economy,
    infrastructure,
    production,
    food: foodState
  });
  const organizationEcosystem = createOrganizationEcosystem({
    timestamp: INITIAL_GAME_TIMESTAMP,
    seed,
    organizations,
    population,
    economy,
    infrastructure,
    production,
    kernel,
    districts,
    locations
  });
  const government = createGovernmentCrimeState({
    timestamp: INITIAL_GAME_TIMESTAMP,
    seed,
    cityId: city.id,
    districts,
    locations,
    organizations,
    population,
    economy,
    infrastructure,
    production,
    organizationEcosystem
  });
  const health = createHealthCyberwareState({
    timestamp: INITIAL_GAME_TIMESTAMP,
    seed,
    districts,
    locations,
    organizations,
    population,
    economy,
    infrastructure,
    production,
    government
  });
  const syncedKernel = advanceSimulationKernel(kernel, {
    timestamp: INITIAL_GAME_TIMESTAMP,
    seed,
    city,
    districts,
    locations,
    organizations,
    player,
    population,
    economy,
    infrastructure,
    production,
    organizationEcosystem,
    government,
    health,
    food: foodState
  });

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    timestamp: INITIAL_GAME_TIMESTAMP,
    world,
    player,
    primaryContact,
    people,
    pressure,
    economy,
    population,
    kernel: syncedKernel,
    infrastructure,
    production,
    organizationEcosystem,
    government,
    health,
    events: createInitialEvents({
      seed,
      districtName: lower.name,
      districtCode: lower.code,
      marketName: market.name,
      housingName: housing.name
    }),
    eventQueue: createQueue(seed, INITIAL_GAME_TIMESTAMP, world),
    currentActivity: `В жилом блоке ${housing.name}`,
    district: districtPulse,
    life: {
      currentLocationId: housing.id,
      housing: housingState,
      food: foodState,
      lastSleepAt: null
    },
    jobs: {
      courier: createInitialCourierState(seed, INITIAL_GAME_TIMESTAMP, locations, people.people, economy.businesses)
    }
  };
}
