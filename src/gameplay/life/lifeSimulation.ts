import type { EventCategory, WorldEvent } from "../../core/events/types";
import { createStableEntityId } from "../../core/ids/entityId";
import { processEventQueue } from "../../core/simulation/eventQueue";
import { advanceGameTime } from "../../core/time/gameTime";
import { getFoodProduct } from "../../data/products/foodCatalog";
import { advanceHumanNetwork, getPerson, recordPlayerAction, toKnownNpc } from "../../people/network/humanNetwork";
import { advancePopulation, synchronizeActivePeopleFromPopulation } from "../../simulation/population/populationSystem";
import { advanceSimulationKernel, kernelSystemEntityId } from "../../simulation/kernel/simulationKernel";
import { advanceInfrastructure, applyInfrastructureToDistrictPulse } from "../../simulation/infrastructure/infrastructureSystem";
import { advanceProductionAndLogistics } from "../../simulation/production/productionSystem";
import { advanceOrganizationEcosystem } from "../../simulation/organizations/organizationSystem";
import { advanceGovernmentCrime } from "../../simulation/government/governmentSystem";
import { advanceHealthCyberware } from "../../simulation/health/healthSystem";
import { advanceDataSurveillance } from "../../simulation/data/dataSystem";
import { advanceMetropolitanState } from "../../simulation/spatial/metropolitanSystem";
import {
  advanceUrbanFabricState,
  ensureBuildingAccessDetail,
  ensureUnitInteriorDetail,
  synchronizeMetropolitanFromUrban
} from "../../simulation/urban/urbanSystem";
import { advanceMetropolitanMobilityState, synchronizeMetropolitanFromMobility } from "../../simulation/mobility/mobilitySystem";
import { advanceLocalSceneState } from "../../simulation/localScene/localSceneSystem";
import type { SpatialPositionState } from "../../simulation/localScene/types";
import {
  advancePhysicalVehiclesState,
  estimatePhysicalVehicleTravel,
  getPhysicalVehicle,
  physicalVehiclePositionAtLocation,
  playerVehiclePosition
} from "../../simulation/vehicles/physicalVehicleSystem";
import type { VehicleCommand } from "../../simulation/vehicles/types";
import {
  advanceTransitOperationsState,
  estimateTransitJourney,
  getTransitAdvancePosition,
  getTransitBoardingVehicle,
  getTransitCurrentFare,
  getTransitDestinationPosition,
  getTransitLegMinutes,
  getTransitRemainingMinutes,
  getTransitStop,
  phoneActivityLabel
} from "../../simulation/transit/transitOperationsSystem";
import type { TransitCommand, TransitPhoneActivity } from "../../simulation/transit/types";
import {
  advanceBuildingAccessState,
  findAccessDoor,
  recordAccessDenied,
  setAccessDoorOpen
} from "../../simulation/access/buildingAccessSystem";
import { canPrepare, consumeFood, discardSpoiledFood, purchaseFood } from "../food/foodSystem";
import { calculateSleepRecovery, getHousingDaysLeft } from "../housing/housingSystem";
import { getTravelOptions, isLocationOpen } from "../travel/travelSystem";
import {
  acceptCourierOrder as acceptCourierOrderState,
  applyCourierTravelRisk,
  collectCourierCargo,
  completeCourierOrder,
  expireCourierOrders,
  getActiveCourierOrder,
  refreshCourierBoard
} from "../jobs/courier/courierSystem";
import { advanceDistrictPulse } from "../../world/city/districtPulse";
import {
  acceptNpcRequest as acceptNpcRequestState,
  advancePressureState,
  closePressureDay,
  completeNpcRequest as completeNpcRequestState,
  declineNpcRequest as declineNpcRequestState,
  extendRentObligation,
  payObligation as payObligationState,
  trackPressureMetrics
} from "../pressure/pressureSystem";
import type { GameSession } from "../../world/state/types";
import {
  advanceLocalEconomy,
  applyCourierSupplyDelivery,
  applyEconomyPressureToPeople,
  applyRequestToEconomy,
  businessCanServe,
  getBusinessAtLocation,
  localPrice,
  registerBusinessSale
} from "../economy/localEconomy";

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function createEvent(session: GameSession, timestamp: number, category: EventCategory, title: string, detail: string | undefined, importance: 1 | 2 | 3): WorldEvent {
  return {
    id: createStableEntityId("event", `${session.world.meta.seed}:${timestamp}:${category}:${title}:${session.events.length}`),
    timestamp,
    category,
    title,
    detail,
    importance
  };
}

function locationNameForSession(session: GameSession, locationId: string): string {
  return session.world.locations.find((location) => location.id === locationId)?.name ?? "UNKNOWN NODE";
}

interface ProgressOptions {
  category?: EventCategory;
  title?: string;
  detail?: string;
  importance?: 1 | 2 | 3;
  balanceDelta?: number;
  fatigueDelta?: number;
  stressDelta?: number;
  hungerDelta?: number;
  healthDelta?: number;
  activity?: string;
  targetLocationId?: string;
  playerPosition?: SpatialPositionState;
  vehicleCommand?: VehicleCommand;
  transitCommand?: TransitCommand;
  suppressTimeEvent?: boolean;
  deliveryCompleted?: boolean;
  requestsCompleted?: number;
  relationChanges?: number;
  worldEvents?: number;
  trackBalance?: boolean;
}

export function progressLife(session: GameSession, minutes: number, options: ProgressOptions = {}): GameSession {
  const nextTimestamp = advanceGameTime(session.timestamp, minutes);
  const pulse = advanceDistrictPulse(session.district, nextTimestamp);
  const queued = processEventQueue(session, nextTimestamp);
  const network = advanceHumanNetwork(session.people, nextTimestamp, session.world.meta.seed, session.world.locations);
  const populationAdvance = advancePopulation(
    session.population,
    nextTimestamp,
    session.world.meta.seed,
    session.world.districts,
    session.world.locations,
    session.world.organizations,
    session.economy,
    session.life.food
  );
  const populationSyncedPeople = synchronizeActivePeopleFromPopulation(network.state, populationAdvance.state);
  const economyAdvance = advanceLocalEconomy(
    populationAdvance.economy,
    nextTimestamp,
    session.world.meta.seed,
    session.world.locations,
    populationSyncedPeople.people,
    populationAdvance.state,
    populationAdvance.food,
    pulse.state
  );
  const infrastructureAdvance = advanceInfrastructure(
    session.infrastructure,
    nextTimestamp,
    session.world.meta.seed,
    session.world.city,
    session.world.districts,
    session.world.locations,
    session.world.organizations,
    populationAdvance.state,
    economyAdvance.state
  );
  const productionAdvance = advanceProductionAndLogistics(
    session.production,
    nextTimestamp,
    session.world.meta.seed,
    session.world.districts,
    session.world.locations,
    session.world.organizations,
    infrastructureAdvance.population,
    infrastructureAdvance.economy,
    economyAdvance.food,
    infrastructureAdvance.state
  );
  const budgetAdjustedOrganizations = session.world.organizations.map((organization) => {
    const populationDelta = populationAdvance.organizationBudgetDeltas.find((item) => item.organizationId === organization.id)?.delta ?? 0;
    const infrastructureDelta = infrastructureAdvance.organizationBudgetDeltas.find((item) => item.organizationId === organization.id)?.delta ?? 0;
    const productionDelta = productionAdvance.organizationBudgetDeltas.find((item) => item.organizationId === organization.id)?.delta ?? 0;
    const budgetChange = populationDelta + infrastructureDelta + productionDelta;
    return budgetChange ? { ...organization, budget: Math.max(0, organization.budget + budgetChange) } : organization;
  });
  const organizationAdvance = advanceOrganizationEcosystem(session.organizationEcosystem, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    organizations: budgetAdjustedOrganizations,
    population: infrastructureAdvance.population,
    economy: productionAdvance.economy,
    infrastructure: infrastructureAdvance.state,
    production: productionAdvance.state,
    kernel: session.kernel,
    districts: session.world.districts,
    locations: session.world.locations
  });
  const governmentAdvance = advanceGovernmentCrime(session.government, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    cityId: session.world.city.id,
    districts: session.world.districts,
    locations: session.world.locations,
    organizations: organizationAdvance.organizations,
    population: organizationAdvance.population,
    economy: organizationAdvance.economy,
    infrastructure: organizationAdvance.infrastructure,
    production: organizationAdvance.production,
    organizationEcosystem: organizationAdvance.state
  });
  const healthAdvance = advanceHealthCyberware(session.health, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    districts: session.world.districts,
    locations: session.world.locations,
    organizations: governmentAdvance.organizations,
    population: governmentAdvance.population,
    economy: governmentAdvance.economy,
    infrastructure: governmentAdvance.infrastructure,
    production: governmentAdvance.production,
    government: governmentAdvance.state
  });
  const dataAdvance = advanceDataSurveillance(session.data, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    cityId: session.world.city.id,
    districts: session.world.districts,
    locations: session.world.locations,
    organizations: healthAdvance.organizations,
    population: healthAdvance.population,
    economy: healthAdvance.economy,
    infrastructure: governmentAdvance.infrastructure,
    organizationEcosystem: organizationAdvance.state,
    government: healthAdvance.government,
    health: healthAdvance.state
  });
  const metropolitanAdvance = advanceMetropolitanState(session.metropolitan, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    activeLocationId: session.life.currentLocationId,
    targetLocationId: options.targetLocationId,
    focusSectorId: options.playerPosition?.sectorId,
    districts: session.world.districts,
    locations: session.world.locations,
    representedPopulationByDistrict: dataAdvance.population.lifecycle.representedPopulationByDistrict,
    transportServiceLevel: governmentAdvance.infrastructure.networks.find((item) => item.kind === "transport")?.averageServiceLevel ?? 100,
    dataServiceLevel: governmentAdvance.infrastructure.networks.find((item) => item.kind === "data")?.averageServiceLevel ?? 100,
    recentEventCount: session.events.length,
    recentObservationCount: dataAdvance.state.observations.length
  });
  const urbanAdvance = advanceUrbanFabricState(session.urban, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    activeLocationId: session.life.currentLocationId,
    targetLocationId: options.targetLocationId,
    metropolitan: metropolitanAdvance.state,
    districts: session.world.districts,
    locations: session.world.locations,
    organizations: dataAdvance.organizations,
    population: dataAdvance.population,
    transportServiceLevel: governmentAdvance.infrastructure.networks.find((item) => item.kind === "transport")?.averageServiceLevel ?? 100,
    dataServiceLevel: governmentAdvance.infrastructure.networks.find((item) => item.kind === "data")?.averageServiceLevel ?? 100
  });
  let urbanState = urbanAdvance.state;
  if (options.playerPosition?.buildingId) {
    urbanState = ensureBuildingAccessDetail(
      urbanState,
      session.world.meta.seed,
      nextTimestamp,
      options.playerPosition.buildingId,
      session.player.id,
      session.life.housing.locationId
    );
    if (options.playerPosition.unitId) {
      urbanState = ensureUnitInteriorDetail(urbanState, session.world.meta.seed, nextTimestamp, options.playerPosition.unitId);
    }
  }
  const urbanSynchronizedMetropolitan = synchronizeMetropolitanFromUrban(metropolitanAdvance.state, urbanState);
  const mobilityState = advanceMetropolitanMobilityState(session.mobility, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    metropolitan: urbanSynchronizedMetropolitan,
    urban: urbanState,
    districts: session.world.districts,
    locations: session.world.locations,
    organizations: dataAdvance.organizations,
    population: dataAdvance.population,
    economy: healthAdvance.economy,
    production: healthAdvance.production,
    transportServiceLevel: governmentAdvance.infrastructure.networks.find((item) => item.kind === "transport")?.averageServiceLevel ?? 100,
    dataServiceLevel: governmentAdvance.infrastructure.networks.find((item) => item.kind === "data")?.averageServiceLevel ?? 100,
    activeLocationId: session.life.currentLocationId,
    targetLocationId: options.targetLocationId
  });
  const metropolitanState = synchronizeMetropolitanFromMobility(urbanSynchronizedMetropolitan, mobilityState);
  const populationState = {
    ...dataAdvance.population,
    lifecycle: {
      ...dataAdvance.population.lifecycle,
      representedPopulationByDistrict: urbanAdvance.representedPopulationByDistrict
    }
  };
  const compactedDataState = metropolitanAdvance.compactedObservationBudget < dataAdvance.state.observations.length
    ? { ...dataAdvance.state, observations: dataAdvance.state.observations.slice(-Math.max(250, metropolitanAdvance.compactedObservationBudget)) }
    : dataAdvance.state;
  const infrastructurePulse = applyInfrastructureToDistrictPulse(pulse.state, governmentAdvance.infrastructure, session.world.activeDistrictId);
  const infrastructureSyncedPeople = synchronizeActivePeopleFromPopulation(populationSyncedPeople, dataAdvance.population);
  let peopleState = applyEconomyPressureToPeople(infrastructureSyncedPeople, healthAdvance.economy, economyAdvance.notices);
  const pressureAdvance = advancePressureState(session.pressure, nextTimestamp, session.world.meta.seed, peopleState.people);
  for (const notice of pressureAdvance.notices) {
    if (!notice.personId || !notice.memorySummary) continue;
    peopleState = recordPlayerAction(
      peopleState,
      session.world.meta.seed,
      notice.personId,
      nextTimestamp,
      notice.memorySummary,
      {
        trust: notice.trustDelta,
        respect: notice.respectDelta,
        irritation: notice.irritationDelta,
        importance: notice.importance * 28,
        emotionalValue: notice.importance === 3 ? -42 : -18
      }
    );
  }

  const requestedTarget = options.targetLocationId
    ? session.world.locations.find((location) => location.id === options.targetLocationId)
    : undefined;
  const evictionTarget = pressureAdvance.evicted
    ? session.world.locations.find((location) => location.type === "transport")
    : undefined;
  const targetLocation = evictionTarget ?? requestedTarget;
  const targetDistrict = targetLocation
    ? session.world.districts.find((district) => district.id === targetLocation.districtId)
    : undefined;
  const provisionalLocalScene = advanceLocalSceneState(session.localScene, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    activeLocationId: session.life.currentLocationId,
    targetLocationId: targetLocation?.id,
    locations: session.world.locations,
    people: peopleState,
    population: populationState,
    metropolitan: metropolitanState,
    urban: urbanState,
    mobility: mobilityState,
    playerPosition: options.playerPosition
  });
  const vehiclesState = advancePhysicalVehiclesState(session.vehicles, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    playerId: session.player.id,
    activeLocationId: session.life.currentLocationId,
    targetLocationId: targetLocation?.id,
    playerPosition: provisionalLocalScene.playerPosition,
    metropolitan: metropolitanState,
    urban: urbanState,
    mobility: mobilityState,
    population: populationState,
    organizations: dataAdvance.organizations,
    command: options.vehicleCommand
  });
  const transitState = advanceTransitOperationsState(session.transit, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    playerId: session.player.id,
    activeLocationId: session.life.currentLocationId,
    playerPosition: provisionalLocalScene.playerPosition,
    locations: session.world.locations,
    districts: session.world.districts,
    people: peopleState,
    population: populationState,
    metropolitan: metropolitanState,
    mobility: mobilityState,
    physicalVehicles: vehiclesState,
    command: options.transitCommand
  });
  const localSceneState = advanceLocalSceneState(provisionalLocalScene, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    activeLocationId: session.life.currentLocationId,
    targetLocationId: targetLocation?.id,
    locations: session.world.locations,
    people: peopleState,
    population: populationState,
    metropolitan: metropolitanState,
    urban: urbanState,
    mobility: mobilityState,
    playerPosition: transitState.player.position
  });

  const generated: WorldEvent[] = [];
  if (options.title && options.category) {
    generated.push(createEvent(
      session,
      nextTimestamp,
      options.category,
      options.title,
      options.detail,
      options.importance ?? 1
    ));
  }
  if (minutes >= 60 && !options.suppressTimeEvent) {
    generated.push(createEvent(session, nextTimestamp, "system", `Прошло ${minutes} минут.`, options.activity, 1));
  }
  for (const notice of network.notices) {
    generated.push(createEvent(session, nextTimestamp, "contact", notice.title, notice.detail, notice.importance));
  }
  for (const notice of economyAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of populationAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of infrastructureAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of productionAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of organizationAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of governmentAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of healthAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of dataAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of pressureAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, notice.category, notice.title, notice.detail, notice.importance));
  }

  const baselineFatigue = Math.max(0, Math.round(minutes / 120));
  const baselineHunger = Math.max(0, Math.round(minutes / 150));
  const housingDaysLeft = getHousingDaysLeft(session.life.housing, nextTimestamp);
  const courierState = refreshCourierBoard(
    expireCourierOrders(session.jobs.courier, nextTimestamp),
    session.world.meta.seed,
    nextTimestamp,
    session.world.locations,
    peopleState.people,
    healthAdvance.economy.businesses
  );
  const selectedPerson = getPerson(peopleState, session.world.primaryContactId)
    ?? getPerson(peopleState, peopleState.selectedPersonId);
  const worldEventCount = options.worldEvents ?? (queued.events.length + pulse.events.length + network.notices.length + economyAdvance.notices.length + populationAdvance.notices.length + infrastructureAdvance.notices.length + productionAdvance.notices.length + organizationAdvance.notices.length + governmentAdvance.notices.length + healthAdvance.notices.length + dataAdvance.notices.length + pressureAdvance.notices.length);
  const pressure = trackPressureMetrics(pressureAdvance.state, {
    balanceDelta: options.trackBalance === false ? 0 : options.balanceDelta,
    deliveries: options.deliveryCompleted ? 1 : 0,
    requestsCompleted: options.requestsCompleted,
    relationChanges: options.relationChanges,
    worldEvents: worldEventCount
  });
  const nextOrganizations = dataAdvance.organizations;
  const representedPopulation = urbanAdvance.representedPopulationByDistrict;
  const nextDistricts = session.world.districts.map((district) => ({
    ...district,
    population: Math.round(representedPopulation[district.id] ?? district.population)
  }));
  const nextCity = {
    ...session.world.city,
    population: nextDistricts.reduce((sum, district) => sum + district.population, 0),
    networkStatus: governmentAdvance.infrastructure.networks.find((item) => item.kind === "data")?.status === "offline"
      ? "offline" as const
      : governmentAdvance.infrastructure.networks.some((item) => item.status === "restricted" || item.status === "offline") ? "degraded" as const : "stable" as const
  };
  const nextPlayer = {
    ...session.player,
    balance: Math.max(0, session.player.balance + (options.balanceDelta ?? 0)),
    housingDaysLeft,
    district: targetDistrict?.name ?? session.player.district,
    sector: targetDistrict?.code ?? session.player.sector,
    condition: {
      health: clamp(session.player.condition.health + (options.healthDelta ?? 0)),
      fatigue: clamp(session.player.condition.fatigue + baselineFatigue + (options.fatigueDelta ?? 0)),
      stress: clamp(session.player.condition.stress + (options.stressDelta ?? 0)),
      hunger: clamp(session.player.condition.hunger + baselineHunger + (options.hungerDelta ?? 0))
    }
  };
  const buildingAccessState = advanceBuildingAccessState(session.buildingAccess, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    player: nextPlayer,
    playerHomeLocationId: session.life.housing.locationId,
    locations: session.world.locations,
    population: populationState,
    urban: urbanState,
    localScene: localSceneState
  });
  const kernelDrafts = [...populationAdvance.transactions, ...economyAdvance.transactions, ...infrastructureAdvance.transactions, ...productionAdvance.transactions, ...organizationAdvance.transactions, ...governmentAdvance.transactions, ...healthAdvance.transactions, ...dataAdvance.transactions];
  if ((options.balanceDelta ?? 0) !== 0) {
    const amount = Math.abs(options.balanceDelta ?? 0);
    kernelDrafts.push({
      idempotencyKey: `${session.world.meta.seed}:player:${nextTimestamp}:${options.title ?? options.activity ?? "action"}:${options.balanceDelta}`,
      timestamp: nextTimestamp,
      debitEntityId: (options.balanceDelta ?? 0) < 0 ? session.player.id : kernelSystemEntityId(session.world.meta.seed, "clearing"),
      creditEntityId: (options.balanceDelta ?? 0) < 0 ? kernelSystemEntityId(session.world.meta.seed, "clearing") : session.player.id,
      resource: "credits",
      amount,
      reason: "player-action",
      description: options.title ?? options.activity ?? "Player balance action."
    });
  }
  const kernel = advanceSimulationKernel(session.kernel, {
    timestamp: nextTimestamp,
    seed: session.world.meta.seed,
    city: nextCity,
    districts: nextDistricts,
    locations: session.world.locations,
    organizations: nextOrganizations,
    player: nextPlayer,
    population: populationState,
    economy: healthAdvance.economy,
    infrastructure: governmentAdvance.infrastructure,
    production: healthAdvance.production,
    organizationEcosystem: organizationAdvance.state,
    government: dataAdvance.government,
    health: healthAdvance.state,
    data: compactedDataState,
    vehicles: vehiclesState,
    food: productionAdvance.food,
    drafts: kernelDrafts
  });

  return {
    ...session,
    timestamp: nextTimestamp,
    world: {
      ...session.world,
      meta: { ...session.world.meta, currentTimestamp: nextTimestamp },
      city: nextCity,
      districts: nextDistricts,
      organizations: nextOrganizations,
      activeDistrictId: targetDistrict?.id ?? session.world.activeDistrictId,
      primaryContactId: selectedPerson?.id ?? session.world.primaryContactId
    },
    primaryContact: selectedPerson
      ? toKnownNpc(selectedPerson, session.world.locations, nextTimestamp)
      : session.primaryContact,
    people: peopleState,
    pressure,
    economy: healthAdvance.economy,
    population: populationState,
    kernel,
    infrastructure: governmentAdvance.infrastructure,
    production: healthAdvance.production,
    organizationEcosystem: organizationAdvance.state,
    government: dataAdvance.government,
    health: healthAdvance.state,
    data: compactedDataState,
    metropolitan: metropolitanState,
    urban: urbanState,
    mobility: mobilityState,
    localScene: localSceneState,
    buildingAccess: buildingAccessState,
    vehicles: vehiclesState,
    transit: transitState,
    district: infrastructurePulse,
    eventQueue: queued.queue,
    currentActivity: pressureAdvance.evicted
      ? `Без постоянного жилья · ${targetLocation?.name ?? "TRANSIT NODE"}`
      : options.activity ?? session.currentActivity,
    life: {
      ...session.life,
      food: productionAdvance.food,
      currentLocationId: targetLocation?.id ?? session.life.currentLocationId
    },
    jobs: {
      ...session.jobs,
      courier: courierState
    },
    player: nextPlayer,
    events: [...generated, ...queued.events.reverse(), ...pulse.events.reverse(), ...session.events].slice(0, 100)
  };
}

export function travelToLocation(session: GameSession, locationId: string): GameSession {
  if (session.localScene.playerPosition.state === "vehicle" || session.transit.player.journey) return session;
  const option = getTravelOptions(session).find((item) => item.location.id === locationId);
  if (!option) return session;
  if (option.mode === "bus" || option.mode === "metro") return startTransitJourney(session, locationId);
  if (session.player.balance < option.cost) return session;
  const open = isLocationOpen(option.location, session.timestamp + option.durationMinutes * 60_000);
  const progressed = progressLife(session, option.durationMinutes, {
    category: "personal",
    title: `Прибытие: ${option.location.name}.`,
    detail: `${option.districtName} · ${option.mode.toUpperCase()} ${option.routeCode} · ${option.distanceKm} км · ₵ ${option.cost} · трафик ${option.congestionPercent}%${open ? "" : " · объект закрыт"}`,
    importance: open ? 1 : 2,
    balanceDelta: -option.cost,
    fatigueDelta: 2,
    stressDelta: option.sameDistrict ? 0 : 1,
    activity: `На месте: ${option.location.name}`,
    targetLocationId: option.location.id
  });
  const risk = applyCourierTravelRisk(
    progressed.jobs.courier,
    progressed.world.meta.seed,
    progressed.timestamp,
    progressed.district.gangPressure + progressed.district.policePresence
  );
  if (risk.incident === "none") return progressed;
  const active = getActiveCourierOrder(risk.state);
  const incident = risk.incident === "inspection"
    ? createEvent(progressed, progressed.timestamp, "work", "Курьерский груз попал под проверку.", `${active?.code ?? "DELIVERY"} · пломба сверена, данные рейса записаны.`, 3)
    : createEvent(progressed, progressed.timestamp, "work", "Груз получил повреждение в пути.", `${active?.code ?? "DELIVERY"} · состояние −${risk.conditionLoss}%.`, 2);
  return {
    ...progressed,
    jobs: { ...progressed.jobs, courier: risk.state },
    events: [incident, ...progressed.events].slice(0, 100)
  };
}


function transitInput(session: GameSession, timestamp = session.timestamp, playerPosition: SpatialPositionState = session.localScene.playerPosition) {
  return {
    timestamp,
    seed: session.world.meta.seed,
    playerId: session.player.id,
    activeLocationId: session.life.currentLocationId,
    playerPosition,
    locations: session.world.locations,
    districts: session.world.districts,
    people: session.people,
    population: session.population,
    metropolitan: session.metropolitan,
    mobility: session.mobility,
    physicalVehicles: session.vehicles
  };
}

function transitStopPosition(session: GameSession, stopId: string, state: "outside" | "in-transit", timestamp: number, routeId?: string, vehicleId?: string): SpatialPositionState | null {
  const stop = getTransitStop(session.transit, stopId);
  if (!stop) return null;
  return {
    sectorId: stop.sectorId,
    xM: stop.xM,
    yM: stop.yM,
    transitRouteId: routeId,
    vehicleId,
    state,
    updatedAt: timestamp
  };
}

export function startTransitJourney(session: GameSession, locationId: string): GameSession {
  if (session.transit.player.journey || session.localScene.playerPosition.state === "vehicle") return session;
  const option = getTravelOptions(session).find((item) => item.location.id === locationId);
  if (!option || (option.mode !== "bus" && option.mode !== "metro")) return session;
  const estimate = estimateTransitJourney(session.transit, transitInput(session), session.life.currentLocationId, locationId, option.mode)
    ?? estimateTransitJourney(session.transit, transitInput(session), session.life.currentLocationId, locationId);
  if (!estimate || session.player.balance < estimate.totalFare) return session;
  const position = transitStopPosition(session, estimate.originStopId, "outside", session.timestamp);
  const stop = getTransitStop(session.transit, estimate.originStopId);
  if (!position || !stop) return session;
  const firstRoute = session.transit.routes.find((route) => route.id === estimate.segments[0]?.routeId);
  return progressLife(session, estimate.walkingMinutes + estimate.waitingMinutes, {
    category: "personal",
    title: `Ожидание транспорта: ${stop.name}.`,
    detail: `${firstRoute?.code ?? option.routeCode} · пешком ${estimate.walkingMinutes} мин. · ожидание ${estimate.waitingMinutes} мин. · ${estimate.segments.length > 1 ? `${estimate.segments.length - 1} пересадка` : "прямой маршрут"}`,
    importance: firstRoute?.status === "delayed" || firstRoute?.status === "crowded" ? 2 : 1,
    fatigueDelta: estimate.walkingMinutes >= 12 ? 1 : 0,
    stressDelta: estimate.waitingMinutes >= 15 ? 1 : 0,
    activity: `На остановке: ${stop.name}`,
    playerPosition: position,
    transitCommand: {
      kind: "begin",
      destinationLocationId: locationId,
      segments: estimate.segments,
      expectedArrivalAt: estimate.expectedArrivalAt
    }
  });
}

export function boardTransitVehicle(session: GameSession): GameSession {
  const journey = session.transit.player.journey;
  if (!journey || journey.phase !== "waiting") return session;
  const vehicle = getTransitBoardingVehicle(session.transit);
  const fare = getTransitCurrentFare(session.transit);
  if (!vehicle || session.player.balance < fare) return session;
  const segment = journey.segments[journey.activeSegmentIndex];
  const route = session.transit.routes.find((item) => item.id === segment.routeId);
  const position = transitStopPosition(session, journey.currentStopId, "in-transit", session.timestamp, segment.routeId, vehicle.id);
  if (!position) return session;
  return progressLife(session, 2, {
    category: "personal",
    title: `Посадка: ${route?.code ?? "TRANSIT"} ${vehicle.fleetNumber}.`,
    detail: `${vehicle.mode.toUpperCase()} · водитель ${vehicle.crew.name} · ₵ ${fare} · заполнение ${route?.crowdingPercent ?? 0}%`,
    importance: route?.status === "crowded" ? 2 : 1,
    balanceDelta: -fare,
    fatigueDelta: 0,
    activity: `В салоне ${vehicle.fleetNumber}`,
    playerPosition: position,
    transitCommand: { kind: "board", vehicleId: vehicle.id }
  });
}

export function takeTransitSeat(session: GameSession, seatId: string): GameSession {
  const journey = session.transit.player.journey;
  const seat = session.transit.cabin?.seats.find((item) => item.id === seatId);
  if (!journey || journey.phase !== "onboard" || !seat || seat.occupiedBy !== null) return session;
  return progressLife(session, 1, {
    category: "personal",
    title: "Свободное место занято.",
    detail: `${seat.kind === "priority" ? "Приоритетное" : "Обычное"} место · ряд ${seat.index + 1}`,
    importance: 1,
    fatigueDelta: -1,
    activity: "Сидит в общественном транспорте",
    playerPosition: session.transit.player.position,
    transitCommand: { kind: "take-seat", seatId }
  });
}

export function standInTransit(session: GameSession): GameSession {
  const journey = session.transit.player.journey;
  if (!journey?.seatId || journey.phase !== "onboard") return session;
  return progressLife(session, 1, {
    category: "personal",
    title: "Место освобождено.",
    detail: "Игрок продолжает поездку стоя.",
    importance: 1,
    activity: "Стоит в салоне",
    playerPosition: session.transit.player.position,
    transitCommand: { kind: "stand" }
  });
}

export function yieldTransitSeat(session: GameSession, passengerId: string): GameSession {
  const journey = session.transit.player.journey;
  const passenger = session.transit.cabin?.passengers.find((item) => item.id === passengerId);
  if (!journey?.seatId || journey.phase !== "onboard" || !passenger?.standing || passenger.priorityNeed === "none") return session;
  return progressLife(session, 1, {
    category: "contact",
    title: `Место уступлено: ${passenger.name}.`,
    detail: `${passenger.priorityNeed.toUpperCase()} · отношение пассажира улучшилось`,
    importance: 1,
    stressDelta: -1,
    relationChanges: 1,
    activity: "Стоит в салоне",
    playerPosition: session.transit.player.position,
    transitCommand: { kind: "yield-seat", passengerId }
  });
}

export function rideTransitToNextStop(session: GameSession): GameSession {
  const journey = session.transit.player.journey;
  if (!journey || journey.phase !== "onboard") return session;
  const minutes = getTransitLegMinutes(session.transit);
  const position = getTransitAdvancePosition(session.transit, transitInput(session, session.timestamp + minutes * 60_000));
  const nextStop = getTransitStop(session.transit, journey.nextStopId);
  return progressLife(session, minutes, {
    category: "personal",
    title: `Следующая остановка: ${nextStop?.name ?? "маршрут продолжается"}.`,
    detail: `${minutes} мин. · ${session.transit.cabin?.totalPassengerCount ?? 0} пассажиров`,
    importance: 1,
    fatigueDelta: journey.seatId ? -1 : 0,
    activity: nextStop ? `У остановки: ${nextStop.name}` : "В пути",
    playerPosition: position,
    transitCommand: { kind: "advance" }
  });
}

export function interactWithTransitPassenger(session: GameSession, passengerId: string): GameSession {
  const journey = session.transit.player.journey;
  const passenger = session.transit.cabin?.passengers.find((item) => item.id === passengerId);
  if (!journey || journey.phase !== "onboard" || !passenger) return session;
  const minutes = getTransitLegMinutes(session.transit);
  const position = getTransitAdvancePosition(session.transit, transitInput(session, session.timestamp + minutes * 60_000));
  let progressed = progressLife(session, minutes, {
    category: "contact",
    title: `Разговор в салоне: ${passenger.name}.`,
    detail: `${passenger.roleLabel} · настроение ${passenger.mood.toUpperCase()} · разговор до следующей остановки`,
    importance: 1,
    stressDelta: passenger.mood === "friendly" ? -1 : passenger.mood === "irritated" ? 1 : 0,
    relationChanges: passenger.activePersonId ? 1 : 0,
    activity: `Разговор с ${passenger.name}`,
    playerPosition: position,
    transitCommand: { kind: "interact-advance", passengerId }
  });
  if (passenger.activePersonId) {
    const people = recordPlayerAction(
      progressed.people,
      progressed.world.meta.seed,
      passenger.activePersonId,
      progressed.timestamp,
      "Игрок поговорил с ним во время поездки в общественном транспорте.",
      { trust: passenger.mood === "friendly" ? 2 : 1, irritation: passenger.mood === "irritated" ? 1 : 0, importance: 28, emotionalValue: passenger.mood === "friendly" ? 8 : 2 }
    );
    const contact = getPerson(people, passenger.activePersonId);
    progressed = {
      ...progressed,
      people,
      primaryContact: contact ? toKnownNpc(contact, progressed.world.locations, progressed.timestamp) : progressed.primaryContact,
      world: { ...progressed.world, primaryContactId: contact?.id ?? progressed.world.primaryContactId }
    };
  }
  return progressed;
}

export function usePhoneInTransit(session: GameSession, activity: TransitPhoneActivity): GameSession {
  const journey = session.transit.player.journey;
  if (!journey || journey.phase !== "onboard") return session;
  const minutes = getTransitLegMinutes(session.transit);
  const position = getTransitAdvancePosition(session.transit, transitInput(session, session.timestamp + minutes * 60_000));
  const stressDelta = activity === "messages" ? -2 : activity === "city-feed" ? -1 : activity === "job-board" ? 0 : 1;
  return progressLife(session, minutes, {
    category: activity === "job-board" ? "work" : "personal",
    title: `Телефон в дороге: ${phoneActivityLabel(activity)}.`,
    detail: `${minutes} полезных минут · поездка продолжается до следующей остановки`,
    importance: 1,
    stressDelta,
    activity: `Телефон: ${phoneActivityLabel(activity)}`,
    playerPosition: position,
    transitCommand: { kind: "phone-advance", activity, productiveMinutes: minutes }
  });
}

export function alightTransitVehicle(session: GameSession): GameSession {
  const journey = session.transit.player.journey;
  if (!journey || journey.phase !== "arrived") return session;
  const destination = session.world.locations.find((item) => item.id === journey.destinationLocationId);
  const position = getTransitDestinationPosition(session.transit, transitInput(session, session.timestamp + 60_000));
  if (!destination) return session;
  return progressLife(session, 1, {
    category: "personal",
    title: `Выход: ${destination.name}.`,
    detail: `${journey.segments.length > 1 ? `${journey.segments.length - 1} пересадка · ` : ""}${journey.interactions} разговоров · ${journey.phoneMinutes} мин. в телефоне`,
    importance: 1,
    fatigueDelta: journey.seatId ? 0 : 1,
    activity: `На месте: ${destination.name}`,
    targetLocationId: destination.id,
    playerPosition: position,
    transitCommand: { kind: "alight" }
  });
}

export function skipTransitJourney(session: GameSession): GameSession {
  const journey = session.transit.player.journey;
  if (!journey) return session;
  const destination = session.world.locations.find((item) => item.id === journey.destinationLocationId);
  if (!destination) return session;
  const minutes = getTransitRemainingMinutes(session.transit);
  const remainingFare = Math.max(0, journey.segments.reduce((sum, segment) => sum + segment.fare, 0) - journey.farePaid);
  if (session.player.balance < remainingFare) return session;
  const position = getTransitDestinationPosition(session.transit, transitInput(session, session.timestamp + minutes * 60_000));
  return progressLife(session, minutes, {
    category: "personal",
    title: `Поездка пропущена: ${destination.name}.`,
    detail: `${minutes} мин. промотано · оставшаяся оплата ₵ ${remainingFare}`,
    importance: 1,
    balanceDelta: -remainingFare,
    fatigueDelta: journey.seatId ? 0 : 1,
    activity: `На месте: ${destination.name}`,
    targetLocationId: destination.id,
    playerPosition: position,
    transitCommand: { kind: "skip" }
  });
}


function buildingStreetPosition(session: GameSession, buildingId: string, timestamp: number): SpatialPositionState | null {
  const building = session.urban.buildings.find((item) => item.id === buildingId);
  const sector = building ? session.metropolitan.sectors.find((item) => item.id === building.sectorId) : undefined;
  if (!building || !sector) return null;
  const xM = Math.max(sector.bounds.xM + 1, Math.min(sector.bounds.xM + sector.bounds.widthM - 1, building.bounds.xM + building.bounds.widthM / 2));
  const yM = Math.max(sector.bounds.yM + 1, Math.min(sector.bounds.yM + sector.bounds.heightM - 1, building.bounds.yM - 2));
  return {
    sectorId: building.sectorId,
    xM: Math.round(xM * 10) / 10,
    yM: Math.round(yM * 10) / 10,
    locationId: building.anchorLocationId ?? session.localScene.playerPosition.locationId ?? session.life.currentLocationId,
    state: "outside",
    updatedAt: timestamp
  };
}

function buildingInteriorPosition(session: GameSession, buildingId: string, floor: number, timestamp: number, unitId?: string, roomId?: string): SpatialPositionState | null {
  const building = session.urban.buildings.find((item) => item.id === buildingId);
  if (!building) return null;
  return {
    sectorId: building.sectorId,
    xM: Math.round((building.bounds.xM + building.bounds.widthM / 2) * 10) / 10,
    yM: Math.round((building.bounds.yM + building.bounds.heightM / 2) * 10) / 10,
    locationId: building.anchorLocationId ?? session.localScene.playerPosition.locationId ?? session.life.currentLocationId,
    buildingId,
    unitId,
    roomId,
    floor,
    state: "inside",
    updatedAt: timestamp
  };
}

function accessInput(session: GameSession) {
  return {
    timestamp: session.timestamp,
    seed: session.world.meta.seed,
    player: session.player,
    playerHomeLocationId: session.life.housing.locationId,
    locations: session.world.locations,
    population: session.population,
    urban: session.urban,
    localScene: session.localScene
  };
}

export function approachLocalBuilding(session: GameSession, buildingId: string): GameSession {
  if (session.localScene.playerPosition.state !== "outside") return session;
  const local = session.localScene.buildings.find((item) => item.buildingId === buildingId);
  const position = buildingStreetPosition(session, buildingId, session.timestamp);
  if (!local || !position) return session;
  const minutes = Math.max(1, Math.min(15, Math.ceil(local.distanceToPlayerM / 78)));
  const building = session.urban.buildings.find((item) => item.id === buildingId);
  return progressLife(session, minutes, {
    category: "personal",
    title: `Подход к зданию ${building?.addressCode ?? buildingId.slice(-6).toUpperCase()}.`,
    detail: `${building?.use.toUpperCase() ?? "BUILDING"} · пешком ${Math.round(local.distanceToPlayerM)} м`,
    importance: 1,
    fatigueDelta: minutes >= 8 ? 1 : 0,
    activity: `У входа: ${building?.addressCode ?? "UNKNOWN BUILDING"}`,
    playerPosition: position
  });
}

export function enterLocalBuilding(session: GameSession, buildingId: string, entrance: "public" | "service" = "public"): GameSession {
  const local = session.localScene.buildings.find((item) => item.buildingId === buildingId);
  const building = session.urban.buildings.find((item) => item.id === buildingId);
  if (!local || !building || session.localScene.playerPosition.state !== "outside" || local.distanceToPlayerM > 20) return session;
  const urban = ensureBuildingAccessDetail(
    session.urban,
    session.world.meta.seed,
    session.timestamp,
    buildingId,
    session.player.id,
    session.life.housing.locationId
  );
  const prepared: GameSession = { ...session, urban };
  const access = advanceBuildingAccessState(session.buildingAccess, accessInput(prepared));
  const entry = access.buildingEntries.find((item) => item.buildingId === buildingId);
  const doorId = entrance === "service" ? entry?.serviceDoorId : entry?.publicDoorId;
  const door = findAccessDoor(access, doorId);
  if (!door || door.locked || door.decision === "closed" || door.decision === "unavailable") {
    const denied = recordAccessDenied(access, session.timestamp);
    return progressLife({ ...prepared, buildingAccess: denied }, 1, {
      category: "personal",
      title: "Вход закрыт.",
      detail: `${building.addressCode} · ${door?.reason ?? "Нет доступного входа"}${door?.alarmed ? " · сигнализация активна" : ""}`,
      importance: door?.alarmed ? 2 : 1,
      activity: `У входа: ${building.addressCode}`,
      playerPosition: buildingStreetPosition(prepared, buildingId, session.timestamp) ?? session.localScene.playerPosition
    });
  }
  const opened = setAccessDoorOpen(access, door.id, true, session.timestamp);
  const position = buildingInteriorPosition(prepared, buildingId, 1, session.timestamp);
  if (!position) return session;
  return progressLife({ ...prepared, buildingAccess: opened }, 2, {
    category: "personal",
    title: `Вход: ${building.addressCode}.`,
    detail: `${door.label} · ${door.playerAuthorized ? "доступ подтверждён" : "дверь открыта"} · security ${building.security}%`,
    importance: 1,
    activity: `Внутри: ${building.addressCode} · этаж 1`,
    playerPosition: position
  });
}

export function leaveLocalBuilding(session: GameSession): GameSession {
  const buildingId = session.localScene.playerPosition.buildingId;
  if (!buildingId || session.localScene.playerPosition.state !== "inside") return session;
  const building = session.urban.buildings.find((item) => item.id === buildingId);
  const position = buildingStreetPosition(session, buildingId, session.timestamp);
  if (!building || !position) return session;
  return progressLife(session, 2, {
    category: "personal",
    title: `Выход: ${building.addressCode}.`,
    detail: `${building.use.toUpperCase()} · улица`,
    importance: 1,
    activity: `У входа: ${building.addressCode}`,
    playerPosition: position
  });
}

export function moveInsideBuilding(session: GameSession, floor: number, method: "stairs" | "elevator"): GameSession {
  const buildingId = session.localScene.playerPosition.buildingId;
  const building = buildingId ? session.urban.buildings.find((item) => item.id === buildingId) : undefined;
  if (!building || session.localScene.playerPosition.state !== "inside") return session;
  const minimumFloor = building.basementLevels > 0 ? -building.basementLevels : 1;
  if (floor === 0 || floor < minimumFloor || floor > building.floors) return session;
  if (method === "elevator" && (building.elevatorCount <= 0 || building.utilityService < 25)) return session;
  if (method === "stairs" && building.stairwellCount <= 0) return session;
  const currentFloor = session.localScene.playerPosition.floor ?? 1;
  const difference = Math.abs(floor - currentFloor);
  const minutes = method === "elevator" ? Math.max(1, Math.ceil(difference / 10)) : Math.max(1, Math.ceil(difference / 2));
  const position = buildingInteriorPosition(session, building.id, floor, session.timestamp);
  if (!position) return session;
  return progressLife(session, minutes, {
    category: "personal",
    title: `${method === "elevator" ? "Лифт" : "Лестница"}: этаж ${floor}.`,
    detail: `${building.addressCode} · ${difference} этажей`,
    importance: 1,
    fatigueDelta: method === "stairs" && difference >= 4 ? 1 : 0,
    activity: `Внутри: ${building.addressCode} · этаж ${floor}`,
    playerPosition: position
  });
}

export function enterBuildingUnit(session: GameSession, unitId: string): GameSession {
  const buildingId = session.localScene.playerPosition.buildingId;
  const unit = session.urban.units.find((item) => item.id === unitId);
  if (!buildingId || !unit || unit.buildingId !== buildingId || unit.floor !== (session.localScene.playerPosition.floor ?? 1)) return session;
  let urban = ensureUnitInteriorDetail(session.urban, session.world.meta.seed, session.timestamp, unitId);
  const prepared: GameSession = { ...session, urban };
  const access = advanceBuildingAccessState(session.buildingAccess, accessInput(prepared));
  const unitAccess = access.units.find((item) => item.unitId === unitId);
  const door = findAccessDoor(access, unitAccess?.doorId);
  if (!unitAccess || !door || door.locked) {
    const denied = recordAccessDenied(access, session.timestamp);
    return progressLife({ ...prepared, buildingAccess: denied }, 1, {
      category: "personal",
      title: `Дверь ${unit.unitNumber} закрыта.`,
      detail: `${unitAccess?.reason ?? "Нет доступа"}${door?.alarmed ? " · сигнализация активна" : ""}`,
      importance: door?.alarmed ? 2 : 1,
      activity: `Коридор · этаж ${unit.floor}`,
      playerPosition: session.localScene.playerPosition
    });
  }
  const opened = setAccessDoorOpen(access, door.id, true, session.timestamp);
  const position = buildingInteriorPosition(prepared, buildingId, unit.floor, session.timestamp, unitId);
  if (!position) return session;
  return progressLife({ ...prepared, buildingAccess: opened }, 1, {
    category: "personal",
    title: `Вход в помещение ${unit.unitNumber}.`,
    detail: `${unit.use.toUpperCase()} · ${unit.areaM2} м² · ${unitAccess.playerAuthorized ? "доступ подтверждён" : "дверь открыта"}`,
    importance: 1,
    activity: `Помещение ${unit.unitNumber} · этаж ${unit.floor}`,
    playerPosition: position
  });
}

export function leaveBuildingUnit(session: GameSession): GameSession {
  const position = session.localScene.playerPosition;
  if (!position.buildingId || !position.unitId) return session;
  const unit = session.urban.units.find((item) => item.id === position.unitId);
  const next = buildingInteriorPosition(session, position.buildingId, position.floor ?? unit?.floor ?? 1, session.timestamp);
  if (!next) return session;
  return progressLife(session, 1, {
    category: "personal",
    title: `Выход из помещения ${unit?.unitNumber ?? "UNKNOWN"}.`,
    detail: `Коридор · этаж ${next.floor ?? 1}`,
    importance: 1,
    activity: `Коридор · этаж ${next.floor ?? 1}`,
    playerPosition: next
  });
}

export function enterInteriorRoom(session: GameSession, roomId: string): GameSession {
  const position = session.localScene.playerPosition;
  if (!position.buildingId || !position.unitId || position.roomId) return session;
  const room = session.buildingAccess.rooms.find((item) => item.roomId === roomId && item.unitId === position.unitId);
  if (!room || room.decision !== "open") return session;
  const next = buildingInteriorPosition(session, position.buildingId, position.floor ?? room.floor, session.timestamp, position.unitId, roomId);
  if (!next) return session;
  return progressLife(session, 1, {
    category: "personal",
    title: `Комната: ${room.kind.replace(/-/g, " ").toUpperCase()}.`,
    detail: `Помещение ${session.urban.units.find((item) => item.id === position.unitId)?.unitNumber ?? "UNKNOWN"}`,
    importance: 1,
    activity: room.kind.replace(/-/g, " ").toUpperCase(),
    playerPosition: next
  });
}

export function leaveInteriorRoom(session: GameSession): GameSession {
  const position = session.localScene.playerPosition;
  if (!position.buildingId || !position.unitId || !position.roomId) return session;
  const next = buildingInteriorPosition(session, position.buildingId, position.floor ?? 1, session.timestamp, position.unitId);
  if (!next) return session;
  return progressLife(session, 1, {
    category: "personal",
    title: "Выход в помещение.",
    detail: `Этаж ${next.floor ?? 1}`,
    importance: 1,
    activity: "Внутри помещения",
    playerPosition: next
  });
}

function physicalVehicleInput(session: GameSession, timestamp = session.timestamp, targetLocationId?: string, playerPosition: SpatialPositionState = session.localScene.playerPosition) {
  return {
    timestamp,
    seed: session.world.meta.seed,
    playerId: session.player.id,
    activeLocationId: session.life.currentLocationId,
    targetLocationId,
    playerPosition,
    metropolitan: session.metropolitan,
    urban: session.urban,
    mobility: session.mobility,
    population: session.population,
    organizations: session.world.organizations
  };
}

export function approachPhysicalVehicle(session: GameSession, vehicleId: string): GameSession {
  if (session.localScene.playerPosition.state !== "outside") return session;
  const vehicle = getPhysicalVehicle(session.vehicles, vehicleId);
  if (!vehicle || !vehicle.visible || vehicle.state === "moving" || vehicle.position.sectorId !== session.localScene.playerPosition.sectorId) return session;
  const minutes = Math.max(1, Math.min(12, Math.ceil(vehicle.distanceToPlayerM / 82)));
  const position = playerVehiclePosition(vehicle, session.timestamp, "outside");
  return progressLife(session, minutes, {
    category: "personal",
    title: `Подход к машине ${vehicle.plate}.`,
    detail: `${vehicle.modelName} · ${Math.round(vehicle.distanceToPlayerM)} м · ${vehicle.state.toUpperCase()}`,
    importance: 1,
    fatigueDelta: minutes >= 8 ? 1 : 0,
    activity: `У машины: ${vehicle.modelName} ${vehicle.plate}`,
    playerPosition: position
  });
}

export function enterPhysicalVehicle(session: GameSession, vehicleId: string): GameSession {
  if (session.localScene.playerPosition.state !== "outside") return session;
  const vehicle = getPhysicalVehicle(session.vehicles, vehicleId);
  if (!vehicle || vehicle.distanceToPlayerM > 6 || vehicle.state === "moving" || vehicle.state === "disabled") return session;
  const seat = vehicle.access === "owned" || vehicle.access === "authorized" ? "driver" as const : "passenger" as const;
  if (seat === "passenger" && (vehicle.locked || vehicle.access !== "public")) return session;
  if (seat === "driver" && !vehicle.playerCanDrive) return session;
  const position = playerVehiclePosition(vehicle, session.timestamp, "vehicle");
  return progressLife(session, 1, {
    category: "personal",
    title: `Посадка: ${vehicle.modelName}.`,
    detail: `${vehicle.plate} · ${seat === "driver" ? "место водителя" : "пассажирское место"} · топливо ${vehicle.fuelL}/${vehicle.fuelCapacityL} л`,
    importance: 1,
    activity: `В машине: ${vehicle.modelName}`,
    playerPosition: position,
    vehicleCommand: { kind: "enter", vehicleId, seat }
  });
}

export function leavePhysicalVehicle(session: GameSession): GameSession {
  const vehicleId = session.vehicles.player.currentVehicleId;
  const vehicle = getPhysicalVehicle(session.vehicles, vehicleId);
  if (!vehicle || session.localScene.playerPosition.state !== "vehicle") return session;
  const position = playerVehiclePosition(vehicle, session.timestamp, "outside");
  return progressLife(session, 1, {
    category: "personal",
    title: `Выход из машины ${vehicle.plate}.`,
    detail: `${vehicle.modelName} · машина припаркована`,
    importance: 1,
    activity: `У машины: ${vehicle.modelName} ${vehicle.plate}`,
    playerPosition: position,
    vehicleCommand: { kind: "exit", vehicleId: vehicle.id }
  });
}

export function drivePhysicalVehicleToLocation(session: GameSession, locationId: string): GameSession {
  const vehicleId = session.vehicles.player.currentVehicleId;
  const vehicle = getPhysicalVehicle(session.vehicles, vehicleId);
  if (!vehicle || session.vehicles.player.seat !== "driver" || session.localScene.playerPosition.state !== "vehicle") return session;
  if (!vehicle.playerCanDrive || vehicle.condition < 18) return session;
  const target = session.world.locations.find((location) => location.id === locationId);
  if (!target || target.id === session.life.currentLocationId) return session;
  const estimate = estimatePhysicalVehicleTravel(session.vehicles, physicalVehicleInput(session), vehicle.id, session.life.currentLocationId, target.id);
  if (!estimate || vehicle.fuelL + 0.001 < estimate.fuelUsedL) return session;
  const arrivalTimestamp = session.timestamp + estimate.durationMinutes * 60_000;
  const position = physicalVehiclePositionAtLocation(
    physicalVehicleInput(session, arrivalTimestamp, target.id),
    vehicle.id,
    target.id,
    "vehicle"
  );
  const district = session.world.districts.find((item) => item.id === target.districtId);
  return progressLife(session, estimate.durationMinutes, {
    category: "personal",
    title: `Прибытие на машине: ${target.name}.`,
    detail: `${vehicle.modelName} ${vehicle.plate} · ${Math.round(estimate.distanceM / 100) / 10} км · ${estimate.averageSpeedKph} км/ч · топливо −${estimate.fuelUsedL} л · трафик ${estimate.congestionPercent}%`,
    importance: estimate.congestionPercent >= 85 ? 2 : 1,
    fatigueDelta: 1,
    stressDelta: estimate.congestionPercent >= 75 ? 1 : 0,
    activity: `В машине у ${target.name}`,
    targetLocationId: target.id,
    playerPosition: position,
    vehicleCommand: {
      kind: "drive",
      vehicleId: vehicle.id,
      destinationLocationId: target.id,
      distanceM: estimate.distanceM,
      durationMinutes: estimate.durationMinutes,
      fuelUsedL: estimate.fuelUsedL
    }
  });
}

export function servicePhysicalVehicle(session: GameSession, vehicleId: string): GameSession {
  if (session.localScene.playerPosition.state !== "outside") return session;
  const currentLocation = session.world.locations.find((location) => location.id === session.life.currentLocationId);
  const vehicle = getPhysicalVehicle(session.vehicles, vehicleId);
  if (!vehicle || currentLocation?.type !== "workshop" || vehicle.distanceToPlayerM > 30 || vehicle.state === "moving") return session;
  if (vehicle.access !== "owned" && vehicle.access !== "authorized") return session;
  const fuelAddedL = Math.max(0, Math.round((vehicle.fuelCapacityL - vehicle.fuelL) * 10) / 10);
  const conditionRestored = Math.max(0, Math.round((92 - vehicle.condition) * 10) / 10);
  if (fuelAddedL <= 0 && conditionRestored <= 0) return session;
  const cost = Math.max(12, Math.ceil(fuelAddedL * 3.2 + conditionRestored * 8.5));
  if (session.player.balance < cost) return session;
  return progressLife(session, 45, {
    category: "personal",
    title: `Обслуживание машины ${vehicle.plate}.`,
    detail: `Топливо +${fuelAddedL} л · состояние +${conditionRestored}% · ₵ ${cost}`,
    importance: 1,
    balanceDelta: -cost,
    activity: `Сервис завершён: ${vehicle.modelName}`,
    playerPosition: session.localScene.playerPosition,
    vehicleCommand: { kind: "service", vehicleId, fuelAddedL, conditionRestored }
  });
}

export function acceptCourierOrder(session: GameSession, orderId: string): GameSession {
  const nextState = acceptCourierOrderState(session.jobs.courier, orderId, session.timestamp);
  if (nextState === session.jobs.courier) return session;
  const order = nextState.orders.find((item) => item.id === orderId);
  if (!order) return session;
  const pickup = session.world.locations.find((location) => location.id === order.pickupLocationId);
  const dropoff = session.world.locations.find((location) => location.id === order.dropoffLocationId);
  const people = recordPlayerAction(
    session.people,
    session.world.meta.seed,
    order.clientId,
    session.timestamp,
    `Игрок принял доставку ${order.code}.`,
    { trust: 1, respect: 1, importance: 35, emotionalValue: 4 }
  );
  const client = getPerson(people, order.clientId);
  return {
    ...session,
    jobs: { ...session.jobs, courier: nextState },
    people,
    world: { ...session.world, primaryContactId: order.clientId },
    primaryContact: client ? toKnownNpc(client, session.world.locations, session.timestamp) : session.primaryContact,
    player: { ...session.player, occupation: "FREELANCE COURIER" },
    currentActivity: `Заказ принят: ${order.code}`,
    events: [
      createEvent(session, session.timestamp, "work", `Принят заказ ${order.code}.`, `${order.client} · ${pickup?.name} → ${dropoff?.name} · оплата ₵ ${order.payout}`, 2),
      createEvent(session, session.timestamp, "contact", `${order.client} ждёт доставку.`, order.requestNote, order.risk === "high" ? 3 : 2),
      ...session.events
    ].slice(0, 100)
  };
}

export function pickupCourierOrder(session: GameSession): GameSession {
  const active = getActiveCourierOrder(session.jobs.courier);
  const nextState = collectCourierCargo(session.jobs.courier, session.life.currentLocationId, session.timestamp + 6 * 60_000);
  if (!active || nextState === session.jobs.courier) return session;
  const progressed = progressLife(session, 6, {
    category: "work",
    title: `Груз получен: ${active.code}.`,
    detail: `${active.cargoName} · ${active.weightKg} кг · пломба ${active.condition}%`,
    fatigueDelta: 1,
    activity: `Доставка ${active.code}: груз на руках`
  });
  const people = recordPlayerAction(
    progressed.people,
    progressed.world.meta.seed,
    active.clientId,
    progressed.timestamp,
    `Груз по заказу ${active.code} забран со склада.`,
    { respect: 1, importance: 28, emotionalValue: 2 }
  );
  const client = getPerson(people, active.clientId);
  return {
    ...progressed,
    people,
    primaryContact: client ? toKnownNpc(client, progressed.world.locations, progressed.timestamp) : progressed.primaryContact,
    jobs: { ...progressed.jobs, courier: nextState }
  };
}

export function deliverCourierOrder(session: GameSession): GameSession {
  const active = getActiveCourierOrder(session.jobs.courier);
  if (!active) return session;
  const clientAtDelivery = getPerson(session.people, active.clientId);
  if (clientAtDelivery && clientAtDelivery.currentLocationId !== active.dropoffLocationId) {
    const redirected = {
      ...session.jobs.courier,
      orders: session.jobs.courier.orders.map((order) => order.id === active.id
        ? { ...order, dropoffLocationId: clientAtDelivery.currentLocationId }
        : order)
    };
    const location = session.world.locations.find((item) => item.id === clientAtDelivery.currentLocationId);
    return {
      ...session,
      jobs: { ...session.jobs, courier: redirected },
      world: { ...session.world, primaryContactId: clientAtDelivery.id },
      primaryContact: toKnownNpc(clientAtDelivery, session.world.locations, session.timestamp),
      currentActivity: `Клиент сменил точку: ${location?.name ?? "UNKNOWN NODE"}`,
      events: [
        createEvent(
          session,
          session.timestamp,
          "contact",
          `${clientAtDelivery.name} ушёл с точки передачи.`,
          `Новая точка: ${location?.name ?? "неизвестный узел"}. Заказ ${active.code} остаётся активным.`,
          2
        ),
        ...session.events
      ].slice(0, 100)
    };
  }
  const completionTimestamp = session.timestamp + 5 * 60_000;
  const completion = completeCourierOrder(session.jobs.courier, session.life.currentLocationId, completionTimestamp);
  if (!completion) return session;
  const progressed = progressLife(session, 5, {
    category: "work",
    title: `Заказ ${active.code} закрыт.`,
    detail: `${completion.lateMinutes ? `Опоздание ${completion.lateMinutes} мин. · ` : "В срок · "}состояние ${completion.condition}% · начислено ₵ ${completion.payout}`,
    importance: completion.lateMinutes > 15 || completion.condition < 70 ? 3 : 1,
    balanceDelta: completion.payout,
    stressDelta: -2,
    activity: "Свободен для нового заказа",
    deliveryCompleted: true,
    relationChanges: 1
  });
  const cleanDelivery = completion.lateMinutes === 0 && completion.condition >= 90;
  const badDelivery = completion.lateMinutes > 15 || completion.condition < 70;
  const summary = cleanDelivery
    ? `Игрок доставил заказ ${active.code} вовремя и без повреждений.`
    : badDelivery
      ? `Игрок доставил заказ ${active.code} с серьёзной проблемой.`
      : `Игрок завершил заказ ${active.code} с небольшими отклонениями.`;
  const people = recordPlayerAction(
    progressed.people,
    progressed.world.meta.seed,
    active.clientId,
    progressed.timestamp,
    summary,
    cleanDelivery
      ? { trust: 6, respect: 5, irritation: -2, debtToPlayer: 1, importance: 75, emotionalValue: 32 }
      : badDelivery
        ? { trust: -7, respect: -4, irritation: 12, importance: 82, emotionalValue: -44 }
        : { trust: 2, respect: 1, irritation: 2, importance: 50, emotionalValue: 8 }
  );
  const client = getPerson(people, active.clientId);
  const reaction = cleanDelivery
    ? `${active.client} подтвердил получение и сохранил твой контакт.`
    : badDelivery
      ? `${active.client} принял груз, но оставил претензию в MESHLINE.`
      : `${active.client} подтвердил получение без дополнительных требований.`;
  const supply = applyCourierSupplyDelivery(
    progressed.economy,
    progressed.life.food,
    active,
    completion.payout,
    completion.condition,
    completion.lateMinutes
  );
  const economicEvent = active.economicPurpose === "restock"
    ? createEvent(
      progressed,
      progressed.timestamp,
      "local",
      cleanDelivery ? "Поставка восстановила рабочий запас." : "Поставка принята с потерями.",
      `${locationNameForSession(progressed, active.dropoffLocationId)} · запас зависит от состояния груза и срока.`,
      cleanDelivery ? 2 : badDelivery ? 3 : 1
    )
    : null;
  return {
    ...progressed,
    people,
    economy: supply.state,
    life: { ...progressed.life, food: supply.food },
    world: { ...progressed.world, primaryContactId: active.clientId },
    primaryContact: client ? toKnownNpc(client, progressed.world.locations, progressed.timestamp) : progressed.primaryContact,
    jobs: { ...progressed.jobs, courier: completion.state },
    events: [
      ...(economicEvent ? [economicEvent] : []),
      createEvent(progressed, progressed.timestamp, "contact", reaction, client?.problem.detail, badDelivery ? 3 : cleanDelivery ? 2 : 1),
      ...progressed.events
    ].slice(0, 100)
  };
}


export function acceptPersonalRequest(session: GameSession, requestId: string): GameSession {
  const request = session.pressure.requests.find((item) => item.id === requestId);
  if (!request || request.status !== "open" || request.dueAt <= session.timestamp) return session;
  const person = getPerson(session.people, request.personId);
  const targetLocationId = person?.currentLocationId ?? request.targetLocationId;
  const acceptedPressure = acceptNpcRequestState({
    ...session.pressure,
    requests: session.pressure.requests.map((item) => item.id === requestId ? { ...item, targetLocationId } : item)
  }, requestId, session.timestamp);
  const people = recordPlayerAction(
    session.people,
    session.world.meta.seed,
    request.personId,
    session.timestamp,
    `Игрок согласился выполнить просьбу ${request.code}: ${request.title}.`,
    { trust: 1, respect: 1, importance: 42, emotionalValue: 6 }
  );
  const contact = getPerson(people, request.personId);
  return {
    ...session,
    pressure: acceptedPressure,
    people,
    world: { ...session.world, primaryContactId: request.personId },
    primaryContact: contact ? toKnownNpc(contact, session.world.locations, session.timestamp) : session.primaryContact,
    currentActivity: `Принята просьба ${request.code}`,
    events: [
      createEvent(session, session.timestamp, "contact", `${contact?.name ?? "Контакт"}: договорились.`, `${request.title} · срок ${new Date(request.dueAt).toISOString().slice(11, 16)}.`, 2),
      ...session.events
    ].slice(0, 100)
  };
}

export function declinePersonalRequest(session: GameSession, requestId: string): GameSession {
  const request = session.pressure.requests.find((item) => item.id === requestId);
  if (!request || (request.status !== "open" && request.status !== "accepted")) return session;
  const pressure = declineNpcRequestState(session.pressure, requestId);
  const people = recordPlayerAction(
    session.people,
    session.world.meta.seed,
    request.personId,
    session.timestamp,
    `Игрок отказался от просьбы ${request.code}: ${request.title}.`,
    { trust: -2, respect: -1, irritation: 3, importance: 48, emotionalValue: -14 }
  );
  const contact = getPerson(people, request.personId);
  return {
    ...session,
    pressure: trackPressureMetrics(pressure, { relationChanges: 1 }),
    people,
    primaryContact: contact ? toKnownNpc(contact, session.world.locations, session.timestamp) : session.primaryContact,
    events: [
      createEvent(session, session.timestamp, "contact", `${contact?.name ?? "Контакт"}: просьба отклонена.`, request.title, 1),
      ...session.events
    ].slice(0, 100)
  };
}

export function completePersonalRequest(session: GameSession, requestId: string): GameSession {
  const request = session.pressure.requests.find((item) => item.id === requestId);
  if (!request || request.status !== "accepted") return session;
  const person = getPerson(session.people, request.personId);
  if (person && person.currentLocationId !== request.targetLocationId) {
    const location = session.world.locations.find((item) => item.id === person.currentLocationId);
    return {
      ...session,
      pressure: {
        ...session.pressure,
        requests: session.pressure.requests.map((item) => item.id === request.id ? { ...item, targetLocationId: person.currentLocationId } : item)
      },
      events: [
        createEvent(session, session.timestamp, "contact", `${person.name} сменил место.`, `${request.code} · новая точка: ${location?.name ?? "UNKNOWN NODE"}.`, 2),
        ...session.events
      ].slice(0, 100)
    };
  }
  const completionAt = session.timestamp + request.durationMinutes * 60_000;
  const completion = completeNpcRequestState(
    session.pressure,
    requestId,
    completionAt,
    session.life.currentLocationId,
    session.player.balance
  );
  if (!completion) return session;
  const base = { ...session, pressure: completion.state };
  const progressed = progressLife(base, request.durationMinutes, {
    category: "contact",
    title: `Просьба ${request.code} выполнена.`,
    detail: `${request.title} · ${completion.balanceDelta >= 0 ? `получено ₵ ${completion.balanceDelta}` : `потрачено ₵ ${Math.abs(completion.balanceDelta)}`}`,
    importance: 2,
    balanceDelta: completion.balanceDelta,
    fatigueDelta: request.durationMinutes >= 40 ? 4 : 2,
    stressDelta: -1,
    requestsCompleted: 1,
    relationChanges: 1,
    activity: `Помощь: ${person?.name ?? request.code}`
  });
  const isLoan = request.type === "loan";
  const peopleBeforeMemory = isLoan
    ? {
      ...progressed.people,
      people: progressed.people.people.map((item) => item.id === request.personId ? { ...item, money: item.money + request.upfrontCost } : item)
    }
    : progressed.people;
  const people = recordPlayerAction(
    peopleBeforeMemory,
    progressed.world.meta.seed,
    request.personId,
    progressed.timestamp,
    `Игрок выполнил просьбу ${request.code}: ${request.title}.`,
    isLoan
      ? { trust: 8, respect: 3, debtToPlayer: request.upfrontCost, importance: 78, emotionalValue: 35 }
      : { trust: 5, respect: 5, irritation: -2, debtToPlayer: 1, importance: 70, emotionalValue: 28 }
  );
  const contact = getPerson(people, request.personId);
  const economyOutcome = applyRequestToEconomy(progressed.economy, progressed.life.food, request.targetLocationId, request.type);
  return {
    ...progressed,
    people,
    economy: economyOutcome.state,
    life: { ...progressed.life, food: economyOutcome.food },
    world: { ...progressed.world, primaryContactId: request.personId },
    primaryContact: contact ? toKnownNpc(contact, progressed.world.locations, progressed.timestamp) : progressed.primaryContact
  };
}

export function payPlayerObligation(session: GameSession, obligationId: string): GameSession {
  const originalObligation = session.pressure.obligations.find((item) => item.id === obligationId);
  const payment = payObligationState(session.pressure, obligationId, session.timestamp + 2 * 60_000, session.player.balance);
  if (!payment) return session;
  const obligation = payment.obligation;
  const base = { ...session, pressure: payment.state };
  const progressed = progressLife(base, 2, {
    category: "finance",
    title: `${obligation.code}: платёж проведён.`,
    detail: `${obligation.creditorName} · −₵ ${obligation.amount}`,
    importance: originalObligation?.status === "overdue" || originalObligation?.status === "defaulted" ? 2 : 1,
    balanceDelta: -obligation.amount,
    relationChanges: obligation.creditorPersonId ? 1 : 0,
    activity: "Финансовый терминал"
  });
  let next = progressed;
  if (obligation.type === "rent") {
    const paidUntil = Math.max(session.life.housing.paidUntil, progressed.timestamp) + 7 * 24 * 60 * 60_000;
    next = {
      ...progressed,
      life: { ...progressed.life, housing: { ...progressed.life.housing, paidUntil } },
      player: { ...progressed.player, housingDaysLeft: getHousingDaysLeft({ ...progressed.life.housing, paidUntil }, progressed.timestamp) }
    };
  }
  if (!obligation.creditorPersonId) return next;
  const people = recordPlayerAction(
    next.people,
    next.world.meta.seed,
    obligation.creditorPersonId,
    next.timestamp,
    `Игрок оплатил обязательство ${obligation.code}.`,
    { trust: 2, respect: 3, irritation: -3, importance: 62, emotionalValue: 18 }
  );
  const contact = getPerson(people, obligation.creditorPersonId);
  return {
    ...next,
    people,
    primaryContact: contact ? toKnownNpc(contact, next.world.locations, next.timestamp) : next.primaryContact
  };
}

export function requestRentExtension(session: GameSession): GameSession {
  const rent = session.pressure.obligations.find((item) => item.type === "rent" && item.status !== "paid");
  const manager = rent?.creditorPersonId ? getPerson(session.people, rent.creditorPersonId) : null;
  if (!rent || !manager) return session;
  const accepted = manager.trustToPlayer >= 12 && manager.irritationToPlayer < 65;
  if (!accepted) {
    return {
      ...session,
      events: [
        createEvent(session, session.timestamp, "contact", `${manager.name} отказал в отсрочке.`, "Управляющий требует оплатить аренду по текущему сроку.", 2),
        ...session.events
      ].slice(0, 100)
    };
  }
  const pressure = extendRentObligation(session.pressure, session.timestamp);
  if (!pressure) return session;
  const paidUntil = session.life.housing.paidUntil + 24 * 60 * 60_000;
  const people = recordPlayerAction(
    session.people,
    session.world.meta.seed,
    manager.id,
    session.timestamp,
    "Игрок попросил и получил однодневную отсрочку аренды.",
    { trust: -1, irritation: 4, playerDebt: 1, importance: 68, emotionalValue: -3 }
  );
  return {
    ...session,
    pressure,
    people,
    life: { ...session.life, housing: { ...session.life.housing, paidUntil } },
    player: { ...session.player, housingDaysLeft: getHousingDaysLeft({ ...session.life.housing, paidUntil }, session.timestamp) },
    world: { ...session.world, primaryContactId: manager.id },
    primaryContact: toKnownNpc(getPerson(people, manager.id) ?? manager, session.world.locations, session.timestamp),
    events: [
      createEvent(session, session.timestamp, "contact", `${manager.name} дал отсрочку на 24 часа.`, `Новый срок аренды: ${new Date(rent.dueAt + 24 * 60 * 60_000).toISOString().slice(5, 16).replace("T", " · ")}.`, 2),
      ...session.events
    ].slice(0, 100)
  };
}

export function requestEmergencyLoan(session: GameSession, personId: string): GameSession {
  const person = getPerson(session.people, personId);
  if (!person) return session;
  const existing = session.pressure.obligations.some((item) => item.type === "personal" && item.creditorPersonId === personId && item.status !== "paid");
  if (existing) return session;
  if (person.trustToPlayer < 25 || person.money < 180) {
    return {
      ...session,
      events: [
        createEvent(session, session.timestamp, "contact", `${person.name} не дал денег.`, "Свободных средств или доверия недостаточно.", 1),
        ...session.events
      ].slice(0, 100)
    };
  }
  const amount = Math.min(160, Math.max(100, Math.floor(person.money * 0.22)));
  const obligation = {
    id: createStableEntityId("obligation", `${session.world.meta.seed}:personal:${person.id}:${session.timestamp}`),
    code: `OBL-P${session.pressure.obligations.length + 1}`,
    type: "personal" as const,
    creditorName: person.name,
    creditorPersonId: person.id,
    amount,
    dueAt: session.timestamp + 3 * 24 * 60 * 60_000,
    status: "active" as const,
    consequence: "Личный долг изменит отношения и доступ к будущей помощи.",
    extensionCount: 0,
    lastNoticeStage: 0,
    paidAt: null
  };
  const base = {
    ...session,
    pressure: { ...session.pressure, obligations: [...session.pressure.obligations, obligation] },
    people: {
      ...session.people,
      people: session.people.people.map((item) => item.id === person.id ? { ...item, money: item.money - amount } : item)
    }
  };
  const progressed = progressLife(base, 6, {
    category: "finance",
    title: `${person.name} передал ₵ ${amount}.`,
    detail: `Личный долг ${obligation.code} · вернуть в течение трёх дней.`,
    balanceDelta: amount,
    trackBalance: false,
    relationChanges: 1,
    activity: "Личный финансовый перевод"
  });
  const people = recordPlayerAction(
    progressed.people,
    progressed.world.meta.seed,
    person.id,
    progressed.timestamp,
    `Игрок занял ₵ ${amount} до срока ${obligation.code}.`,
    { trust: 1, playerDebt: amount, importance: 76, emotionalValue: 8 }
  );
  return {
    ...progressed,
    people,
    world: { ...progressed.world, primaryContactId: person.id },
    primaryContact: toKnownNpc(getPerson(people, person.id) ?? person, progressed.world.locations, progressed.timestamp)
  };
}

export function buyFoodAtCurrentLocation(session: GameSession, productId: string): GameSession {
  const location = session.world.locations.find((item) => item.id === session.life.currentLocationId);
  if (!location || !isLocationOpen(location, session.timestamp)) return session;
  const product = getFoodProduct(productId);
  const business = getBusinessAtLocation(session.economy, location.id);
  const price = localPrice(product.price, business);
  if (!businessCanServe(business) || session.player.balance < price) return session;
  const purchase = purchaseFood(session.life.food, session.world.meta.seed, location.id, productId, 1, session.timestamp);
  if (!purchase) return session;
  const progressed = progressLife(session, 4, {
    category: "finance",
    title: `Куплено: ${product.name}.`,
    detail: `${location.name} · −₵ ${price} · индекс цены ${business?.priceIndex ?? 100}% · срок хранения ${product.shelfLifeHours} ч.`,
    balanceDelta: -price,
    activity: `Покупки: ${location.name}`
  });
  return {
    ...progressed,
    life: {
      ...progressed.life,
      food: purchase.state
    },
    economy: registerBusinessSale(progressed.economy, location.id, price)
  };
}

export function orderFoodToHome(session: GameSession, productId: string): GameSession {
  if (session.pressure.housingStatus !== "active") return session;
  const market = session.world.locations.find((location) => location.type === "market");
  if (!market) return session;
  const product = getFoodProduct(productId);
  const business = getBusinessAtLocation(session.economy, market.id);
  const deliveryFee = 14 + Math.max(0, Math.round((business?.priceIndex ?? 100) / 25) - 4);
  const productPrice = localPrice(product.price, business);
  const totalCost = productPrice + deliveryFee;
  if (!businessCanServe(business) || session.player.balance < totalCost) return session;
  const deliveryTimestamp = session.timestamp + 25 * 60_000;
  const purchase = purchaseFood(session.life.food, session.world.meta.seed, market.id, productId, 1, deliveryTimestamp);
  if (!purchase) return session;
  const progressed = progressLife(session, 25, {
    category: "finance",
    title: `Доставка получена: ${product.name}.`,
    detail: `${market.name} → ${session.world.locations.find((location) => location.id === session.life.housing.locationId)?.name ?? "HOME"} · товар ₵ ${productPrice} · доставка ₵ ${deliveryFee}`,
    balanceDelta: -totalCost,
    stressDelta: -1,
    activity: "Заказ продуктов через городскую сеть"
  });
  return {
    ...progressed,
    life: {
      ...progressed.life,
      food: purchase.state
    },
    economy: registerBusinessSale(progressed.economy, market.id, productPrice)
  };
}

export function eatFoodFromStorage(session: GameSession, productId: string): GameSession {
  const product = getFoodProduct(productId);
  const atHome = session.life.currentLocationId === session.life.housing.locationId;
  if (!canPrepare(product.requirement, session.life.food.appliances, atHome)) return session;
  const consumed = consumeFood(session.life.food, productId, session.timestamp);
  if (!consumed) return session;
  const progressed = progressLife(session, Math.max(1, product.preparationMinutes), {
    category: "health",
    title: `Съедено: ${product.name}.`,
    detail: `${product.code} · голод −${product.hungerRelief}${product.requirement !== "none" ? ` · подготовка ${product.preparationMinutes} мин.` : ""}`,
    healthDelta: product.healthDelta,
    fatigueDelta: product.fatigueDelta,
    stressDelta: product.stressDelta,
    hungerDelta: -product.hungerRelief,
    activity: atHome ? "Приём пищи дома" : "Приём пищи"
  });
  return {
    ...progressed,
    life: {
      ...progressed.life,
      food: {
        ...consumed.state,
        lastMealAt: progressed.timestamp
      }
    }
  };
}

export function discardSpoiled(session: GameSession): GameSession {
  const result = discardSpoiledFood(session.life.food, session.timestamp);
  if (!result.discarded) return session;
  return {
    ...session,
    life: { ...session.life, food: result.state },
    events: [
      createEvent(session, session.timestamp, "health", `Утилизировано испорченных порций: ${result.discarded}.`, "Домашний пищевой запас очищен.", 2),
      ...session.events
    ].slice(0, 100)
  };
}

export function sleepAtHome(session: GameSession, hours: number): GameSession {
  if (session.life.currentLocationId !== session.life.housing.locationId || session.pressure.housingStatus === "evicted") return session;
  const recovery = calculateSleepRecovery(session.life.housing, hours);
  const progressed = progressLife(session, hours * 60, {
    category: "personal",
    title: `Сон завершён: ${hours} ч.`,
    detail: `Качество жилья ${session.life.housing.sleepQuality}% · шум ${session.life.housing.noise}%`,
    importance: hours >= 7 ? 1 : 2,
    fatigueDelta: recovery.fatigueDelta,
    stressDelta: recovery.stressDelta,
    healthDelta: recovery.healthDelta,
    hungerDelta: 9,
    activity: "В жилом блоке",
    suppressTimeEvent: true
  });
  const pressure = closePressureDay(
    progressed.pressure,
    progressed.timestamp,
    hours * 60,
    progressed.player.balance,
    progressed.world.meta.seed
  );
  const summary = pressure.summaries[0];
  return {
    ...progressed,
    pressure,
    life: { ...progressed.life, lastSleepAt: progressed.timestamp },
    events: summary ? [
      createEvent(
        progressed,
        progressed.timestamp,
        "system",
        `DAY ${summary.dayIndex} CLOSED.`,
        `Заработано ₵ ${summary.earned} · потрачено ₵ ${summary.spent} · доставки ${summary.deliveries} · просьбы ${summary.requestsCompleted}/${summary.requestsMissed}.`,
        summary.requestsMissed > 0 ? 2 : 1
      ),
      ...progressed.events
    ].slice(0, 100) : progressed.events
  };
}
