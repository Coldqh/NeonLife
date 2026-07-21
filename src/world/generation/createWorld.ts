import { createInitialEvents } from "../../core/events/demoEvents";
import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import { SAVE_SCHEMA_VERSION } from "../../core/saves/types";
import { INITIAL_GAME_TIMESTAMP } from "../../core/time/gameTime";
import { createInitialPlayer } from "../../gameplay/player/demoPlayer";
import { createInitialFoodState } from "../../gameplay/food/foodSystem";
import { createInitialHousing } from "../../gameplay/housing/housingSystem";
import { createPrimaryContact } from "../../people/demoNpc";
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
  const lower = world.districts[0];
  const workshop = world.locations.find((location) => location.type === "workshop");
  return [
    {
      id: createStableEntityId("scheduled", `${seed}:grid-restoration`),
      dueAt: start + 99 * 60_000,
      type: "grid-restoration",
      status: "queued",
      entityIds: [lower.id],
      payload: { district: lower.name }
    },
    {
      id: createStableEntityId("scheduled", `${seed}:vacancy-expiry`),
      dueAt: start + 159 * 60_000,
      type: "vacancy-expiry",
      status: "queued",
      entityIds: workshop ? [workshop.id] : [],
      payload: { location: workshop?.name ?? "SERVICE NODE" }
    },
    {
      id: createStableEntityId("scheduled", `${seed}:rent-warning`),
      dueAt: start + 5 * 24 * 60 * 60_000,
      type: "rent-warning",
      status: "queued",
      entityIds: [world.playerId],
      payload: { daysLeft: 2 }
    },
    {
      id: createStableEntityId("scheduled", `${seed}:patrol-shift`),
      dueAt: start + 49 * 60_000,
      type: "patrol-shift",
      status: "queued",
      entityIds: [lower.id],
      payload: { checkpoint: "TRANSIT NODE U-07" }
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
  const transit = createOrganization(seed, "transit", "NORTHLINE TRANSIT", "NL/T", "transport", 18_200_000, 43, 4_900);
  const medical = createOrganization(seed, "medical", "CIVIC MEDICAL UNION", "CMU", "medical", 31_600_000, 57, 7_120);
  const police = createOrganization(seed, "police", "DISTRICT SECURITY BUREAU", "DSB", "police", 27_900_000, 32, 6_300);
  const gang = createOrganization(seed, "cutwire", "CUTWIRE", "CW", "gang", 410_000, 19, 86);
  const organizations = [aurelian, vectra, transit, medical, police, gang];

  const housing = createLocation(seed, "capsule", lower.id, "HAB-STACK 07", "HAB/U07", "housing", 31, undefined, 0, 24);
  const canteen = createLocation(seed, "canteen", lower.id, "NIGHT KITCHEN 14", "FOOD/U14", "food", 24, undefined, 18, 5);
  const transitNode = createLocation(seed, "transit-node", lower.id, "TRANSIT NODE U-07", "MOVE/U07", "transport", 46, transit.id, 0, 24);
  const workshop = createLocation(seed, "workshop", industrial.id, "VECTRA SERVICE NODE", "VEC/SN-12", "workshop", 58, vectra.id, 6, 2);
  const clinic = createLocation(seed, "clinic", lower.id, "CMU WALK-IN CLINIC", "CMU/U03", "clinic", 52, medical.id, 0, 24);
  const tower = createLocation(seed, "tower", corporate.id, "AURELIAN CROWN TOWER", "AUR/CT-01", "office", 94, aurelian.id, 7, 22);
  const market = createLocation(seed, "market", lower.id, "UNDERLINE NIGHT MARKET", "MKT/U09", "market", 26, undefined, 16, 6);
  const locations = [housing, canteen, transitNode, workshop, clinic, tower, market];
  attachLocations(districts, organizations, locations);

  const player = createInitialPlayer(seed, lower.name, lower.code);
  const primaryContact = createPrimaryContact(seed, workshop.name);
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

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    timestamp: INITIAL_GAME_TIMESTAMP,
    world,
    player,
    primaryContact,
    events: createInitialEvents({
      seed,
      districtName: lower.name,
      districtCode: lower.code,
      contactName: primaryContact.name,
      companyName: workshop.name
    }),
    eventQueue: createQueue(seed, INITIAL_GAME_TIMESTAMP, world),
    currentActivity: `В жилом блоке ${housing.name}`,
    district: createInitialDistrictPulse(INITIAL_GAME_TIMESTAMP, seed),
    life: {
      currentLocationId: housing.id,
      housing: createInitialHousing(housing.id, INITIAL_GAME_TIMESTAMP),
      food: createInitialFoodState(seed, INITIAL_GAME_TIMESTAMP, market.id, canteen.id, clinic.id),
      lastSleepAt: null
    }
  };
}
