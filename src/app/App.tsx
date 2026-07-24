import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useVersionGuard, type VersionGuardController } from "./providers/useVersionGuard";
import { useWorldSave, type WorldSaveController } from "./providers/useWorldSave";
import type { GameSession } from "../world/state/types";
import { NeonShell } from "./layout/NeonShell";
import { MobileExperience } from "./mobile/MobileExperience";
import type { EventCategory, WorldEvent } from "../core/events/types";
import {
  advanceGameTime,
  formatGameDate,
  formatGameDateTime,
  formatGameTime,
  getDayNumber,
  INITIAL_GAME_TIMESTAMP
} from "../core/time/gameTime";
import { readLocal, writeLocal } from "../core/storage/localStore";
import { processEventQueue } from "../core/simulation/eventQueue";
import type { SaveSlotId } from "../core/saves/types";
import { createStableEntityId } from "../core/ids/entityId";
import { APP_VERSION } from "../core/version/versionService";
import { defaultUiSettings, type UiSettings } from "../ui/theme/settings";
import { FOOD_CATALOG, getFoodProduct } from "../data/products/foodCatalog";
import { canPrepare, getFoodFreshness, getFreshFoodUnits } from "../gameplay/food/foodSystem";
import { getTravelOptions, isLocationOpen } from "../gameplay/travel/travelSystem";
import { businessCanServe, getBusinessAtLocation, localPrice } from "../gameplay/economy/localEconomy";
import type { BusinessState } from "../gameplay/economy/types";
import {
  acceptCourierOrder,
  acceptPersonalRequest,
  buyFoodAtCurrentLocation,
  deliverCourierOrder,
  declinePersonalRequest,
  discardSpoiled,
  eatFoodFromStorage,
  orderFoodToHome,
  payPlayerObligation,
  pickupCourierOrder,
  progressLife,
  requestEmergencyLoan,
  requestRentExtension,
  completePersonalRequest,
  sleepAtHome,
  travelToLocation,
  approachLocalBuilding,
  enterLocalBuilding,
  leaveLocalBuilding,
  moveInsideBuilding,
  enterBuildingUnit,
  leaveBuildingUnit,
  enterInteriorRoom,
  leaveInteriorRoom,
  approachPhysicalVehicle,
  enterPhysicalVehicle,
  leavePhysicalVehicle,
  drivePhysicalVehicleToLocation,
  servicePhysicalVehicle,
  inspectPhysicalVehicleForTheft,
  forceOpenPhysicalVehicle,
  hotwirePhysicalVehicle,
  stealPhysicalVehicleContents,
  replateStolenPhysicalVehicle,
  disposeStolenPhysicalVehicle,
  boardTransitVehicle,
  takeTransitSeat,
  standInTransit,
  yieldTransitSeat,
  rideTransitToNextStop,
  interactWithTransitPassenger,
  usePhoneInTransit,
  alightTransitVehicle,
  skipTransitJourney
} from "../gameplay/life/lifeSimulation";
import { Icon, type IconName } from "../ui/components/Icons";
import { PressureWorkspace } from "./workspaces/PressureWorkspace";
import { PopulationWorkspace } from "./workspaces/PopulationWorkspace";
import { activeObligations, activeRequests, committedAmount } from "../gameplay/pressure/pressureSystem";
import { getActiveCourierOrder, type CourierOrder } from "../gameplay/jobs/courier/courierSystem";
import { getPerson, toKnownNpc } from "../people/network/humanNetwork";
import type { PersonState } from "../people/network/types";
import type { LocalActorState } from "../simulation/localScene/types";
import { estimatePhysicalVehicleTravel, getPhysicalVehicle } from "../simulation/vehicles/physicalVehicleSystem";
import { getVehicleCrimeInspection, getVehicleWantedState } from "../simulation/crime/vehicleCrimeSystem";
import { getTransitBoardingVehicle, getTransitLegMinutes, getTransitRoute, getTransitStop, getTransitVehicle } from "../simulation/transit/transitOperationsSystem";
import type { TransitPhoneActivity, TransitPriorityNeed } from "../simulation/transit/types";
import { Meter } from "../ui/components/Meter";
import { Portrait } from "../ui/components/Portrait";
import { SystemPanel } from "../ui/components/SystemPanel";
import { WindowFrame } from "../ui/components/WindowFrame";
import { VersionGate } from "../ui/components/VersionGate";
import {
  advanceDistrictPulse,
  createInitialDistrictPulse,
  districtSecurityLabel,
  powerGridLabel,
  type DistrictPulseState
} from "../world/city/districtPulse";

const UI_SETTINGS_KEY = "neon-life/ui-settings/v1";

type NavId = "life" | "city" | "people" | "work" | "network" | "inventory" | "health" | "home" | "messages" | "archive";
type WindowId = "profile" | "contact" | "messages" | "courier" | "pressure" | "local" | "journal" | "food" | "places" | "home" | "settings" | "diagnostics";
type MobileLifeTab = "now" | "plan" | "food" | "log";

interface BuildingAccessActions {
  onApproach: (buildingId: string) => void;
  onEnter: (buildingId: string, entrance?: "public" | "service") => void;
  onLeave: () => void;
  onMoveFloor: (floor: number, method: "stairs" | "elevator") => void;
  onEnterUnit: (unitId: string) => void;
  onLeaveUnit: () => void;
  onEnterRoom: (roomId: string) => void;
  onLeaveRoom: () => void;
}

interface PhysicalVehicleActions {
  onApproach: (vehicleId: string) => void;
  onEnter: (vehicleId: string) => void;
  onLeave: () => void;
  onDrive: (locationId: string) => void;
  onService: (vehicleId: string) => void;
  onInspect: (vehicleId: string) => void;
  onBreakIn: (vehicleId: string) => void;
  onHotwire: (vehicleId: string) => void;
  onLoot: (vehicleId: string) => void;
  onReplate: (vehicleId: string) => void;
  onDispose: (vehicleId: string, method: "strip" | "fence") => void;
}

interface TransitActions {
  onBoard: () => void;
  onTakeSeat: (seatId: string) => void;
  onStand: () => void;
  onYield: (passengerId: string) => void;
  onAdvance: () => void;
  onInteract: (passengerId: string) => void;
  onPhone: (activity: TransitPhoneActivity) => void;
  onAlight: () => void;
  onSkip: () => void;
}

interface ActionDefinition {
  id: string;
  title: string;
  code: string;
  duration: number;
  cost: number;
  location: string;
  risk: "LOW" | "MED" | "HIGH";
  category: EventCategory;
  result: string;
  activityAfter: string;
  fatigueDelta?: number;
  stressDelta?: number;
  hungerDelta?: number;
  healthDelta?: number;
  targetLocationId?: string;
}

const navItems: Array<{ id: NavId; label: string; icon: IconName; badge?: string }> = [
  { id: "life", label: "LIFE", icon: "life" },
  { id: "city", label: "CITY", icon: "city" },
  { id: "people", label: "PEOPLE", icon: "people" },
  { id: "work", label: "WORK", icon: "work" },
  { id: "network", label: "PRESSURE", icon: "network" },
  { id: "inventory", label: "INVENTORY", icon: "inventory" },
  { id: "health", label: "HEALTH", icon: "health" },
  { id: "home", label: "HOME", icon: "home" },
  { id: "messages", label: "MESSAGES", icon: "messages" },
  { id: "archive", label: "ARCHIVE", icon: "archive" }
];

function createQuickActions(session: GameSession): ActionDefinition[] {
  const currentLocation = session.world.locations.find((location) => location.id === session.life.currentLocationId);
  const market = session.world.locations.find((location) => location.type === "market");
  const courierHub = session.world.locations.find((location) => location.name.includes("MESHLINE"));
  const housing = session.world.locations.find((location) => location.id === session.life.housing.locationId);
  const options: ActionDefinition[] = [];

  const routes = getTravelOptions(session);
  for (const target of [courierHub, market, housing]) {
    if (!target || target.id === currentLocation?.id) continue;
    const route = routes.find((item) => item.location.id === target.id);
    if (!route) continue;
    const district = session.world.districts.find((item) => item.id === target.districtId);
    const isHome = target.id === housing?.id;
    options.push({
      id: `travel-${target.id}`,
      title: isHome ? "Вернуться домой" : `Ехать: ${target.name}`,
      code: isHome ? "MOVE/HOME" : "MOVE/CITY",
      duration: route.durationMinutes,
      cost: route.cost,
      location: `${district?.name ?? "CITY"} / ${target.name}`,
      risk: district && district.securityLevel < 40 ? "MED" : "LOW",
      category: "personal",
      result: `Ты прибыл в ${target.name}.`,
      activityAfter: `На месте: ${target.name}`,
      fatigueDelta: 1,
      hungerDelta: 1,
      targetLocationId: target.id
    });
  }

  options.push({
    id: "wait-local",
    title: "Осмотреться и подождать",
    code: "LIFE/WAIT",
    duration: 15,
    cost: 0,
    location: currentLocation?.name ?? session.player.district,
    risk: "LOW",
    category: "personal",
    result: "Прошло пятнадцать минут.",
    activityAfter: currentLocation ? `На месте: ${currentLocation.name}` : "Ожидание",
    stressDelta: -1
  });

  return options.slice(0, 4);
}

function createPlans(session: GameSession) {
  const active = getActiveCourierOrder(session.jobs.courier);
  const foodUnits = getFreshFoodUnits(session.life.food, session.timestamp);
  const obligations = activeObligations(session.pressure);
  const requests = activeRequests(session.pressure);
  const items: Array<{ time: string; title: string; status: string; detail: string }> = [];
  if (active) {
    items.push({
      time: formatGameTime(active.deadlineAt),
      title: `Доставка ${active.code}`,
      status: active.deadlineAt < session.timestamp + 30 * 60_000 ? "urgent" : "planned",
      detail: active.status === "accepted" ? "Сначала забрать груз" : `Груз ${active.condition}% · завершить до срока`
    });
  }
  if (obligations[0]) {
    items.push({
      time: formatGameTime(obligations[0].dueAt),
      title: `${obligations[0].code} · ₵ ${obligations[0].amount}`,
      status: obligations[0].dueAt < session.timestamp + 24 * 60 * 60_000 ? "urgent" : "planned",
      detail: obligations[0].creditorName
    });
  }
  if (requests[0]) {
    const person = getPerson(session.people, requests[0].personId);
    items.push({
      time: formatGameTime(requests[0].dueAt),
      title: requests[0].title,
      status: requests[0].dueAt < session.timestamp + 3 * 60 * 60_000 ? "urgent" : "open",
      detail: `${person?.name ?? "Контакт"} · ${requests[0].status === "accepted" ? "принято" : "ожидает ответа"}`
    });
  }
  const urgentBusiness = [...session.economy.businesses]
    .filter((business) => business.status !== "stable")
    .sort((left, right) => left.stock - right.stock)[0];
  if (urgentBusiness) {
    const location = session.world.locations.find((item) => item.id === urgentBusiness.locationId);
    items.push({
      time: "—",
      title: `${location?.name ?? "Рабочая точка"}: ${urgentBusiness.status.toUpperCase()}`,
      status: urgentBusiness.status === "closed" || urgentBusiness.status === "restricted" ? "urgent" : "open",
      detail: `Запас ${urgentBusiness.stock}% · цены ${urgentBusiness.priceIndex}%`
    });
  }
  items.push({
    time: "—",
    title: "Домашний запас",
    status: foodUnits <= 2 ? "urgent" : "open",
    detail: `${foodUnits} свежих порций`
  });
  return items.slice(0, 4);
}


const windowLabels: Record<WindowId, string> = {
  profile: "CITIZEN PROFILE",
  contact: "CONTACT RECORD",
  messages: "MESSAGES",
  courier: "COURIER EXCHANGE",
  pressure: "PRESSURE WEEK",
  local: "LOCAL CHANNEL",
  journal: "EVENT LOG",
  food: "FOOD STORAGE / SUPPLY",
  places: "CITY ROUTES",
  home: "HOUSING UNIT",
  settings: "SYSTEM SETTINGS",
  diagnostics: "DIAGNOSTICS"
};

export default function App() {
  const [settings, setSettings] = useState<UiSettings>(() => readLocal(UI_SETTINGS_KEY, defaultUiSettings));
  const saveController = useWorldSave();
  const { session, setSession } = saveController;
  const versionGuard = useVersionGuard();
  const [activeNav, setActiveNav] = useState<NavId>("life");
  const [journalFilter, setJournalFilter] = useState<EventCategory | "all">("all");
  const [openWindows, setOpenWindows] = useState<WindowId[]>([]);
  const [activeWindow, setActiveWindow] = useState<WindowId | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  useEffect(() => writeLocal(UI_SETTINGS_KEY, settings), [settings]);

  const filteredEvents = useMemo(
    () => session ? session.events.filter((event) => journalFilter === "all" || event.category === journalFilter) : [],
    [session, journalFilter]
  );
  const quickActions = useMemo(() => session ? createQuickActions(session) : [], [session]);
  const plans = useMemo(() => session ? createPlans(session) : [], [session]);

  const rootClass = [
    settings.scanlines ? "has-scanlines" : "",
    settings.reducedMotion ? "reduce-motion" : "",
    settings.compactMode ? "compact-mode" : "",
    settings.highContrast ? "high-contrast" : ""
  ].filter(Boolean).join(" ");

  function advance(minutes: number, source = "Ручное продвижение времени"): void {
    setSession((current) => progressLife(current, minutes, {
      category: minutes >= 60 ? "system" : undefined,
      title: minutes >= 60 ? `${source}: +${minutes} мин.` : undefined,
      activity: source
    }));
  }

  function executeAction(action: ActionDefinition): void {
    if (action.targetLocationId) {
      travel(action.targetLocationId);
      return;
    }
    setSession((current) => progressLife(current, action.duration, {
      category: action.category,
      title: action.result,
      detail: `${action.location} · ${action.duration} мин.${action.cost ? ` · −₵ ${action.cost}` : ""}`,
      importance: action.risk === "HIGH" ? 3 : action.risk === "MED" ? 2 : 1,
      balanceDelta: -action.cost,
      fatigueDelta: action.fatigueDelta,
      stressDelta: action.stressDelta,
      hungerDelta: action.hungerDelta,
      healthDelta: action.healthDelta,
      activity: action.activityAfter,
      targetLocationId: action.targetLocationId
    }));
    setActionSheetOpen(false);
  }

  function travel(locationId: string): void {
    setSession((current) => travelToLocation(current, locationId));
    setActionSheetOpen(false);
  }

  function approachBuilding(buildingId: string): void {
    setSession((current) => approachLocalBuilding(current, buildingId));
  }

  function enterBuilding(buildingId: string, entrance: "public" | "service" = "public"): void {
    setSession((current) => enterLocalBuilding(current, buildingId, entrance));
  }

  function leaveBuilding(): void {
    setSession((current) => leaveLocalBuilding(current));
  }

  function moveFloor(floor: number, method: "stairs" | "elevator"): void {
    setSession((current) => moveInsideBuilding(current, floor, method));
  }

  function enterUnit(unitId: string): void {
    setSession((current) => enterBuildingUnit(current, unitId));
  }

  function leaveUnit(): void {
    setSession((current) => leaveBuildingUnit(current));
  }

  function enterRoom(roomId: string): void {
    setSession((current) => enterInteriorRoom(current, roomId));
  }

  function leaveRoom(): void {
    setSession((current) => leaveInteriorRoom(current));
  }

  function approachVehicle(vehicleId: string): void {
    setSession((current) => approachPhysicalVehicle(current, vehicleId));
  }

  function enterVehicle(vehicleId: string): void {
    setSession((current) => enterPhysicalVehicle(current, vehicleId));
  }

  function leaveVehicle(): void {
    setSession((current) => leavePhysicalVehicle(current));
  }

  function driveVehicle(locationId: string): void {
    setSession((current) => drivePhysicalVehicleToLocation(current, locationId));
  }

  function serviceVehicle(vehicleId: string): void {
    setSession((current) => servicePhysicalVehicle(current, vehicleId));
  }

  function inspectVehicle(vehicleId: string): void {
    setSession((current) => inspectPhysicalVehicleForTheft(current, vehicleId));
  }

  function breakIntoVehicle(vehicleId: string): void {
    setSession((current) => forceOpenPhysicalVehicle(current, vehicleId));
  }

  function hotwireVehicle(vehicleId: string): void {
    setSession((current) => hotwirePhysicalVehicle(current, vehicleId));
  }

  function lootVehicle(vehicleId: string): void {
    setSession((current) => stealPhysicalVehicleContents(current, vehicleId));
  }

  function replateVehicle(vehicleId: string): void {
    setSession((current) => replateStolenPhysicalVehicle(current, vehicleId));
  }

  function disposeVehicle(vehicleId: string, method: "strip" | "fence"): void {
    setSession((current) => disposeStolenPhysicalVehicle(current, vehicleId, method));
  }

  function boardTransit(): void {
    setSession((current) => boardTransitVehicle(current));
  }

  function takeSeat(seatId: string): void {
    setSession((current) => takeTransitSeat(current, seatId));
  }

  function standTransit(): void {
    setSession((current) => standInTransit(current));
  }

  function yieldSeat(passengerId: string): void {
    setSession((current) => yieldTransitSeat(current, passengerId));
  }

  function advanceTransit(): void {
    setSession((current) => rideTransitToNextStop(current));
  }

  function interactTransit(passengerId: string): void {
    setSession((current) => interactWithTransitPassenger(current, passengerId));
  }

  function useTransitPhone(activity: TransitPhoneActivity): void {
    setSession((current) => usePhoneInTransit(current, activity));
  }

  function alightTransit(): void {
    setSession((current) => alightTransitVehicle(current));
  }

  function skipTransit(): void {
    setSession((current) => skipTransitJourney(current));
  }

  function buyFood(productId: string): void {
    setSession((current) => buyFoodAtCurrentLocation(current, productId));
  }

  function eatFood(productId: string): void {
    setSession((current) => eatFoodFromStorage(current, productId));
  }

  function discardFood(): void {
    setSession((current) => discardSpoiled(current));
  }

  function orderFood(productId: string): void {
    setSession((current) => orderFoodToHome(current, productId));
  }

  function sleep(hours: number): void {
    setSession((current) => sleepAtHome(current, hours));
  }

  function acceptDelivery(orderId: string): void {
    setSession((current) => acceptCourierOrder(current, orderId));
  }

  function pickupDelivery(): void {
    setSession((current) => pickupCourierOrder(current));
  }

  function deliverDelivery(): void {
    setSession((current) => deliverCourierOrder(current));
  }

  function acceptRequest(requestId: string): void {
    setSession((current) => acceptPersonalRequest(current, requestId));
  }

  function declineRequest(requestId: string): void {
    setSession((current) => declinePersonalRequest(current, requestId));
  }

  function completeRequest(requestId: string): void {
    setSession((current) => completePersonalRequest(current, requestId));
  }

  function payObligation(obligationId: string): void {
    setSession((current) => payPlayerObligation(current, obligationId));
  }

  function extendRent(): void {
    setSession((current) => requestRentExtension(current));
  }

  function borrowFrom(personId: string): void {
    setSession((current) => requestEmergencyLoan(current, personId));
  }

  function selectPerson(personId: string): void {
    setSession((current) => {
      const person = getPerson(current.people, personId);
      if (!person) return current;
      return {
        ...current,
        people: { ...current.people, selectedPersonId: personId },
        world: { ...current.world, primaryContactId: personId },
        primaryContact: toKnownNpc(person, current.world.locations, current.timestamp)
      };
    });
    setContextOpen(true);
  }

  function openWindow(id: WindowId): void {
    setOpenWindows((current) => current.includes(id) ? current : [...current, id]);
    setActiveWindow(id);
  }

  function closeWindow(id: WindowId): void {
    setOpenWindows((current) => current.filter((windowId) => windowId !== id));
    setActiveWindow((current) => current === id ? null : current);
  }

  function resetWorld(): void {
    void saveController.createNewWorld();
  }


  if (!session) {
    return (
      <div className="boot-screen">
        <div className="boot-screen__mark">N/L</div>
        <strong>{saveController.status === "error" ? "SAVE SYSTEM ERROR" : "INITIALIZING WORLD STATE"}</strong>
        <span>{saveController.error ?? "INDEXEDDB / MIGRATIONS / WORLD SEED"}</span>
        <VersionGate guard={versionGuard} />
      </div>
    );
  }

  const currentLocation = session.world.locations.find((location) => location.id === session.life.currentLocationId);

  const topbar = (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => setActiveNav("life")}>
        <span className="brand__mark">N/L</span>
        <span className="brand__text">
          <strong>NEON/LINK</strong>
          <small>OS {APP_VERSION} // CITY SANDBOX</small>
        </span>
      </button>

      <div className="topbar__status topbar__status--time">
        <Icon name="clock" />
        <span>
          <strong>{formatGameTime(session.timestamp)}</strong>
          <small>{formatGameDate(session.timestamp)} · DAY {getDayNumber(session.timestamp)}</small>
        </span>
      </div>
      <div className="topbar__status topbar__status--location">
        <span className="status-dot status-dot--cyan" />
        <span>
          <strong>{session.player.district}</strong>
          <small>{currentLocation?.name ?? session.player.sector} · {session.world.city.weather} {session.world.city.temperatureC}°C</small>
        </span>
      </div>
      <div className="topbar__status topbar__status--money">
        <Icon name="wallet" />
        <span>
          <strong>₵ {session.player.balance.toLocaleString("ru-RU")}</strong>
          <small>HOUSING: {session.player.housingDaysLeft} DAYS</small>
        </span>
      </div>
      <div className="topbar__status topbar__status--network">
        <Icon name="signal" />
        <span>
          <strong>NET: {session.world.city.networkStatus.toUpperCase()}</strong>
          <small>{session.world.city.code} / 84%</small>
        </span>
      </div>
      <button type="button" className="alert-button" onClick={() => openWindow("messages")}>
        <Icon name="alert" />
        <span>0</span>
      </button>
      <button type="button" className="icon-button topbar__settings" onClick={() => openWindow("settings")} aria-label="Настройки">
        <Icon name="settings" />
      </button>
    </header>
  );

  const sidebar = (
    <aside className="sidebar">
      <nav className="sidebar__nav" aria-label="Главная навигация">
        {navItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`nav-item ${activeNav === item.id ? "is-active" : ""}`}
            onClick={() => setActiveNav(item.id)}
          >
            <span className="nav-item__icon"><Icon name={item.icon} /></span>
            <span className="nav-item__label">{item.label}</span>
            {item.badge ? <span className="nav-item__badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>
      <div className="sidebar__footer">
        <span>WORLD</span>
        <strong>{session.world.meta.worldId.slice(-12).toUpperCase()}</strong>
        <small>SIM v{APP_VERSION}</small>
      </div>
    </aside>
  );

  const mobileNav = (
    <nav className="mobile-nav" aria-label="Мобильная навигация">
      <button type="button" className={activeNav === "life" ? "is-active" : ""} onClick={() => setActiveNav("life")}>
        <Icon name="life" /><span>LIFE</span>
      </button>
      <button type="button" className={activeNav === "city" ? "is-active" : ""} onClick={() => setActiveNav("city")}>
        <Icon name="city" /><span>CITY</span>
      </button>
      <button type="button" className="mobile-nav__action" onClick={() => setActionSheetOpen(true)}>
        <Icon name="action" size={23} /><span>ACTION</span>
      </button>
      <button type="button" className={activeNav === "work" ? "is-active" : ""} onClick={() => setActiveNav("work")}>
        <Icon name="work" /><span>WORK</span>
      </button>
      <button type="button" onClick={() => openWindow("settings")}>
        <Icon name="settings" /><span>SYSTEM</span>
      </button>
    </nav>
  );

  const contact = session.primaryContact;
  const context = (
    <aside className={`context-panel ${contextOpen ? "is-open" : ""}`}>
      <header className="context-panel__header">
        <div>
          <span>CONTEXT / PERSON</span>
          <h2>{contact.name}</h2>
        </div>
        <button type="button" className="icon-button context-panel__mobile-close" onClick={() => setContextOpen(false)} aria-label="Закрыть">
          <Icon name="close" />
        </button>
      </header>
      <Portrait kind="contact" label={`Профиль ${contact.name}`} />
      <div className="context-id-line">
        <span>PROFILE {contact.profileCode}</span>
        <span className="status-chip status-chip--online">ACTIVE</span>
      </div>
      <div className="context-block">
        <small>STATUS</small>
        <strong>{contact.status}</strong>
        <span>{contact.location}</span>
      </div>
      <div className="context-block">
        <small>RELATION</small>
        {contact.relations.map((relation) => (
          <div className="relation-row" key={relation.label}>
            <span>{relation.label}</span>
            <div><i style={{ width: `${relation.value}%` }} /></div>
            <strong>{relation.value}</strong>
          </div>
        ))}
      </div>
      <div className="context-block">
        <small>KNOWN FACTS</small>
        <ul className="fact-list">
          {contact.knownFacts.slice(0, 3).map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
      </div>
      <div className="context-actions">
        <button type="button" className="button button--primary" onClick={() => openWindow("messages")}>Открыть канал</button>
        <button type="button" className="button button--ghost" onClick={() => openWindow("contact")}>Полное досье</button>
      </div>
    </aside>
  );

  const buildingActions: BuildingAccessActions = {
    onApproach: approachBuilding,
    onEnter: enterBuilding,
    onLeave: leaveBuilding,
    onMoveFloor: moveFloor,
    onEnterUnit: enterUnit,
    onLeaveUnit: leaveUnit,
    onEnterRoom: enterRoom,
    onLeaveRoom: leaveRoom
  };

  const vehicleActions: PhysicalVehicleActions = {
    onApproach: approachVehicle,
    onEnter: enterVehicle,
    onLeave: leaveVehicle,
    onDrive: driveVehicle,
    onService: serviceVehicle,
    onInspect: inspectVehicle,
    onBreakIn: breakIntoVehicle,
    onHotwire: hotwireVehicle,
    onLoot: lootVehicle,
    onReplate: replateVehicle,
    onDispose: disposeVehicle
  };

  const transitActions: TransitActions = {
    onBoard: boardTransit,
    onTakeSeat: takeSeat,
    onStand: standTransit,
    onYield: yieldSeat,
    onAdvance: advanceTransit,
    onInteract: interactTransit,
    onPhone: useTransitPhone,
    onAlight: alightTransit,
    onSkip: skipTransit
  };

  const workspace = activeNav === "life" ? (
    <LifeWorkspace
      session={session}
      filteredEvents={filteredEvents}
      journalFilter={journalFilter}
      setJournalFilter={setJournalFilter}
      onAdvance={advance}
      onAction={executeAction}
      onOpenWindow={openWindow}
      onOpenContext={() => setContextOpen(true)}
      onOpenActions={() => setActionSheetOpen(true)}
      onEatFood={eatFood}
      actions={quickActions}
      plans={plans}
    />
  ) : activeNav === "city" ? (
    <PlacesWorkspace session={session} onTravel={travel} onOpenWindow={openWindow} buildingActions={buildingActions} vehicleActions={vehicleActions} transitActions={transitActions} />
  ) : activeNav === "people" ? (
    <PeopleWorkspace session={session} onSelect={selectPerson} />
  ) : activeNav === "work" ? (
    <CourierWorkspace session={session} onAccept={acceptDelivery} onPickup={pickupDelivery} onDeliver={deliverDelivery} onTravel={travel} />
  ) : activeNav === "network" ? (
    <PressureWorkspace
      session={session}
      onAcceptRequest={acceptRequest}
      onDeclineRequest={declineRequest}
      onCompleteRequest={completeRequest}
      onTravel={travel}
      onPayObligation={payObligation}
      onRequestExtension={extendRent}
      onBorrow={borrowFrom}
    />
  ) : activeNav === "inventory" ? (
    <FoodWorkspace session={session} onEat={eatFood} onOpenWindow={openWindow} />
  ) : activeNav === "home" ? (
    <HomeWorkspace session={session} onSleep={sleep} onOpenWindow={openWindow} onTravel={travel} />
  ) : (
    <ModulePreview activeNav={activeNav} onReturn={() => setActiveNav("life")} onOpenWindow={openWindow} />
  );

  const windowDock = openWindows.length ? (
    <div className="window-dock">
      {openWindows.map((id) => (
        <button type="button" key={id} className={activeWindow === id ? "is-active" : ""} onClick={() => setActiveWindow(id)}>
          <span>{windowLabels[id]}</span>
          <i onClick={(event: ReactMouseEvent<HTMLElement>) => { event.stopPropagation(); closeWindow(id); }}><Icon name="close" size={13} /></i>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={rootClass}>
      <MobileExperience
        session={session}
        actions={quickActions}
        plans={plans}
        onAction={(action) => executeAction(action as ActionDefinition)}
        onTravel={travel}
        onSelectPerson={selectPerson}
        onOpenSettings={() => openWindow("settings")}
        onAdvance={advance}
        onApproachBuilding={approachBuilding}
        onEnterBuilding={enterBuilding}
        onApproachVehicle={approachVehicle}
        onEnterVehicle={enterVehicle}
      />
      <NeonShell
        className={activeWindow ? "has-active-window" : ""}
        topbar={topbar}
        sidebar={sidebar}
        workspace={workspace}
        context={context}
        mobileNav={mobileNav}
        windowDock={windowDock}
      />

      {activeWindow ? (
        <WindowFrame
          title={windowLabels[activeWindow]}
          code={`WINDOW/${activeWindow.toUpperCase()}`}
          onClose={() => closeWindow(activeWindow)}
        >
          <WindowContent
            id={activeWindow}
            settings={settings}
            setSettings={setSettings}
            onAction={executeAction}
            onReset={resetWorld}
            session={session}
            journalFilter={journalFilter}
            setJournalFilter={setJournalFilter}
            versionGuard={versionGuard}
            saveController={saveController}
            actions={quickActions}
            onTravel={travel}
            onBuyFood={buyFood}
            onEatFood={eatFood}
            onDiscardFood={discardFood}
            onOrderFood={orderFood}
            onSleep={sleep}
            onAcceptDelivery={acceptDelivery}
            onPickupDelivery={pickupDelivery}
            onDeliverDelivery={deliverDelivery}
            onAcceptRequest={acceptRequest}
            onDeclineRequest={declineRequest}
            onCompleteRequest={completeRequest}
            onPayObligation={payObligation}
            onRequestExtension={extendRent}
            onBorrow={borrowFrom}
            onOpenWindow={openWindow}
            buildingActions={buildingActions}
            vehicleActions={vehicleActions}
            transitActions={transitActions}
          />
        </WindowFrame>
      ) : null}

      {actionSheetOpen ? (
        <div className="action-sheet-backdrop" onClick={() => setActionSheetOpen(false)}>
          <section className="action-sheet" onClick={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}>
            <div className="sheet-grabber" />
            <header>
              <div>
                <span>ACTION/LOCAL</span>
                <h2>Доступные действия</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setActionSheetOpen(false)}><Icon name="close" /></button>
            </header>
            <button type="button" className="action-sheet__pressure" onClick={() => { setActionSheetOpen(false); openWindow("pressure"); }}>
              <span><strong>PRESSURE WEEK</strong><small>₵ {committedAmount(session.pressure)} committed · {activeRequests(session.pressure).length} requests</small></span>
              <Icon name="chevron" size={16} />
            </button>
            <div className="action-sheet__shortcuts">
              <button type="button" onClick={() => { setActionSheetOpen(false); setActiveNav("work"); }}><Icon name="work" /><span><strong>РАБОТА</strong><small>{session.jobs.courier.orders.filter((order) => order.status === "available").length} заказов</small></span></button>
              <button type="button" onClick={() => { setActionSheetOpen(false); openWindow("food"); }}><Icon name="inventory" /><span><strong>ЕДА</strong><small>{getFreshFoodUnits(session.life.food, session.timestamp)} порций</small></span></button>
              <button type="button" onClick={() => { setActionSheetOpen(false); setActiveNav("people"); }}><Icon name="people" /><span><strong>ЛЮДИ</strong><small>{session.localScene.totals.visibleActors} видно</small></span></button>
              <button type="button" onClick={() => { setActionSheetOpen(false); openWindow("home"); }}><Icon name="home" /><span><strong>ДОМ</strong><small>{session.player.housingDaysLeft} дней</small></span></button>
            </div>
            <div className="action-sheet__list">
              {quickActions.map((action) => (
                <ActionCard action={action} onAction={executeAction} key={action.id} compact />
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <VersionGate guard={versionGuard} />
    </div>
  );
}

interface LifeWorkspaceProps {
  session: GameSession;
  filteredEvents: WorldEvent[];
  journalFilter: EventCategory | "all";
  setJournalFilter: (filter: EventCategory | "all") => void;
  onAdvance: (minutes: number, source?: string) => void;
  onAction: (action: ActionDefinition) => void;
  onOpenWindow: (id: WindowId) => void;
  onOpenContext: () => void;
  onOpenActions: () => void;
  onEatFood: (productId: string) => void;
  actions: ActionDefinition[];
  plans: ReturnType<typeof createPlans>;
}

function LifeWorkspace({
  session,
  filteredEvents,
  journalFilter,
  setJournalFilter,
  onAdvance,
  onAction,
  onOpenWindow,
  onOpenContext,
  onOpenActions,
  onEatFood,
  actions,
  plans
}: LifeWorkspaceProps) {
  const { player } = session;
  const primaryAction = actions[0];
  const localEvents = session.events.filter((event) => event.category === "local").slice(0, 3);

  return (
    <div className="life-screen">
      <header className="screen-heading">
        <div>
          <span className="screen-heading__path">SYSTEM / LIFE / ACTIVE SESSION</span>
          <h1>ТЕКУЩАЯ ЖИЗНЬ</h1>
          <p>{formatGameDateTime(session.timestamp)} · {player.district} · городская сессия активна</p>
        </div>
        <div className="screen-heading__controls">
          <button type="button" onClick={() => onAdvance(15)}>+15 MIN</button>
          <button type="button" onClick={() => onAdvance(60)}>+1 HOUR</button>
          <button type="button" onClick={() => onAdvance(240)}>+4 HOURS</button>
        </div>
      </header>

      <MobileLifeWorkspace
        session={session}
        filteredEvents={filteredEvents}
        journalFilter={journalFilter}
        setJournalFilter={setJournalFilter}
        onAdvance={onAdvance}
        onAction={onAction}
        onOpenWindow={onOpenWindow}
        onOpenContext={onOpenContext}
        onOpenActions={onOpenActions}
        onEatFood={onEatFood}
        actions={actions}
        plans={plans}
      />

      <div className="life-grid life-grid--desktop">
        <SystemPanel title={player.name} code="CITIZEN/PROFILE" className="hero-panel" action={<span className="status-chip">ONLINE</span>}>
          <div className="hero-summary">
            <Portrait kind="player" label={`Профиль ${player.name}`} />
            <div className="hero-summary__identity">
              <span>AGE {player.age} · {player.occupation}</span>
              <strong>{player.origin}</strong>
              <small>ID {player.id.slice(-8).toUpperCase()} · CLEARANCE 0</small>
              <button type="button" className="text-link" onClick={() => onOpenWindow("profile")}>Открыть полную запись <Icon name="chevron" size={14} /></button>
            </div>
          </div>
          <div className="hero-facts">
            <div><span>Баланс</span><strong>₵ {player.balance.toLocaleString("ru-RU")}</strong></div>
            <div><span>Жильё</span><strong>{player.housingDaysLeft} дней</strong></div>
            <div><span>Медзащита</span><strong>LIMITED</strong></div>
          </div>
          <div className="meter-grid">
            <Meter label="Здоровье" value={player.condition.health} hint="Состояние стабильное" />
            <Meter label="Усталость" value={player.condition.fatigue} invert hint="Повышенная" />
            <Meter label="Стресс" value={player.condition.stress} invert hint="Контролируемый" />
            <Meter label="Голод" value={player.condition.hunger} invert hint="Пока не критично" />
          </div>
        </SystemPanel>

        <SystemPanel title="ТЕКУЩЕЕ ДЕЙСТВИЕ" code="ACTION/ACTIVE" className="activity-panel" tone="warning">
          <div className="activity-display">
            <div className="activity-display__pulse"><Icon name="clock" size={28} /></div>
            <div>
              <span>STATUS / WAITING</span>
              <h3>{session.currentActivity}</h3>
              <p>Свободное время. Выбери локальное действие или открой рабочую биржу.</p>
            </div>
          </div>
          <div className="activity-meta">
            <div><span>LOCATION</span><strong>{player.district} / {player.sector}</strong></div>
            <div><span>EXPOSURE</span><strong className="warning-text">MEDIUM</strong></div>
            <div><span>WORK</span><strong>{session.jobs.courier.activeOrderId ? "ACTIVE DELIVERY" : "NO CONTRACT"}</strong></div>
          </div>
          <div className="activity-controls">
            {primaryAction ? <button type="button" className="button button--primary" onClick={() => onAction(primaryAction)}>{primaryAction.title} · {primaryAction.duration} мин</button> : <button type="button" className="button button--primary" onClick={() => onOpenWindow("places")}>Открыть маршруты</button>}
            <button type="button" className="button button--ghost" onClick={() => onAdvance(15, "Ожидание")}>Ждать 15 минут</button>
          </div>
        </SystemPanel>

        <SystemPanel title="ПЛАН" code="SCHEDULE/NIGHT" className="plan-panel" action={<span className="panel-counter">4 ITEMS</span>}>
          <div className="timeline">
            {plans.map((item) => (
              <div className={`timeline__item timeline__item--${item.status}`} key={`${item.time}-${item.title}`}>
                <time>{item.time}</time>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <i />
              </div>
            ))}
          </div>
        </SystemPanel>

        <SystemPanel title="ВОЗМОЖНОСТИ РЯДОМ" code="LOCAL/OPPORTUNITIES" className="opportunities-panel" action={<span className="panel-counter">4 FOUND</span>}>
          <div className="opportunity-list">
            {actions.map((action) => <ActionCard action={action} onAction={onAction} key={action.id} />)}
          </div>
        </SystemPanel>

        <SystemPanel title="ЛОКАЛЬНЫЙ КАНАЛ" code="CITY/FEED" className="feed-panel">
          <div className="feed-map">
            <div className="feed-map__grid" />
            <span className="map-node map-node--player" style={{ left: "31%", top: "58%" }}>YOU</span>
            <span className="map-node map-node--contact" style={{ left: "73%", top: "36%" }}>{session.primaryContact.name.split(" ")[0]}</span>
            <span className="map-node map-node--alert" style={{ left: "52%", top: "72%" }}>POLICE</span>
            <div className="route-line" />
          </div>
          <div className="feed-list">
            <DistrictPulseStrip state={session.district} />
            {localEvents.map((event) => (
              <div key={event.id}>
                <span>{formatGameTime(event.timestamp)}</span>
                <p>{event.title}</p>
              </div>
            ))}
          </div>
        </SystemPanel>

        <SystemPanel
          title="ЖУРНАЛ СОБЫТИЙ"
          code="WORLD/EVENT LOG"
          className="journal-panel"
          action={
            <select value={journalFilter} onChange={(event: ChangeEvent<HTMLSelectElement>) => setJournalFilter(event.target.value as EventCategory | "all")}>
              <option value="all">ALL</option>
              <option value="personal">PERSONAL</option>
              <option value="contact">CONTACT</option>
              <option value="work">WORK</option>
              <option value="finance">FINANCE</option>
              <option value="health">HEALTH</option>
              <option value="local">LOCAL</option>
              <option value="system">SYSTEM</option>
            </select>
          }
        >
          <div className="event-log">
            {filteredEvents.map((event) => (
              <article className={`event-row event-row--${event.category}`} key={event.id}>
                <time>{formatGameTime(event.timestamp)}</time>
                <span className="event-row__category">{event.category.toUpperCase()}</span>
                <div>
                  <strong>{event.title}</strong>
                  {event.detail ? <p>{event.detail}</p> : null}
                </div>
                {event.pinned ? <Icon name="pin" size={15} /> : null}
              </article>
            ))}
          </div>
        </SystemPanel>

        <SystemPanel title="КОНТАКТЫ" code="SOCIAL/ACTIVE" className="contacts-panel">
          <button type="button" className="contact-card" onClick={onOpenContext}>
            <Portrait kind="contact" label={session.primaryContact.name} />
            <span>
              <strong>{session.primaryContact.name}</strong>
              <small>{session.primaryContact.role} · {session.primaryContact.location}</small>
              <em>Последний контакт: {session.primaryContact.lastContact}</em>
            </span>
            <Icon name="chevron" />
          </button>
          <button type="button" className="contact-card contact-card--muted" onClick={() => onOpenWindow("messages")}>
            <div className="contact-card__initial">SYS</div>
            <span>
              <strong>HOUSING NODE</strong>
              <small>{session.life.housing.type.toUpperCase()} / RENT NODE</small>
              <em>Системный канал жилья</em>
            </span>
            <Icon name="chevron" />
          </button>
        </SystemPanel>
      </div>
    </div>
  );
}


interface MobileLifeWorkspaceProps extends LifeWorkspaceProps {
  filteredEvents: WorldEvent[];
}

function MobileLifeWorkspace({
  session,
  filteredEvents,
  journalFilter,
  setJournalFilter,
  onAdvance,
  onAction,
  onOpenWindow,
  onOpenContext,
  onOpenActions,
  onEatFood,
  actions,
  plans
}: MobileLifeWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<MobileLifeTab>("now");
  const { player } = session;
  const primaryAction = actions[0];
  const visibleEvents = filteredEvents.slice(0, 4);
  return (
    <section className="mobile-life" aria-label="Мобильный экран жизни">
      <div className="mobile-life__identity-row">
        <button type="button" className="mobile-identity" onClick={() => onOpenWindow("profile")}>
          <Portrait kind="player" label={player.name} />
          <span>
            <strong>{player.name}</strong>
            <small>{player.occupation} · {player.sector}</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <div className="mobile-wallet">
          <strong>₵ {player.balance.toLocaleString("ru-RU")}</strong>
          <small>HOME {player.housingDaysLeft}D · FOOD {getFreshFoodUnits(session.life.food, session.timestamp)}</small>
        </div>
      </div>

      <div className="mobile-vitals" aria-label="Состояние героя">
        <MobileVital label="HP" value={player.condition.health} />
        <MobileVital label="FAT" value={player.condition.fatigue} danger />
        <MobileVital label="STR" value={player.condition.stress} danger />
        <MobileVital label="FOOD" value={player.condition.hunger} danger />
      </div>

      <section className="mobile-current-action">
        <header>
          <span><i /> WAITING</span>
          <time>{formatGameTime(session.timestamp)}</time>
        </header>
        <h2>{session.currentActivity}</h2>
        <div className="mobile-current-action__meta">
          <span>{player.district} / {player.sector}</span>
          <span className="warning-text">EXPOSURE MED</span>
          <span>{session.jobs.courier.activeOrderId ? "JOB ACTIVE" : "FREE"}</span>
        </div>
        <div className="mobile-current-action__buttons">
          {primaryAction ? <button type="button" className="button button--primary" onClick={() => onAction(primaryAction)}>{primaryAction.title} · {primaryAction.duration}</button> : <button type="button" className="button button--primary" onClick={() => onOpenWindow("places")}>МАРШРУТЫ</button>}
          <button type="button" className="button button--ghost" onClick={() => onAdvance(15, "Ожидание")}>Ждать 15</button>
        </div>
      </section>

      <nav className="mobile-subnav" aria-label="Разделы экрана жизни">
        {([
          ["now", "СЕЙЧАС"],
          ["plan", "ПЛАН"],
          ["food", "ЕДА"],
          ["log", "ЖУРНАЛ"]
        ] as Array<[MobileLifeTab, string]>).map(([id, label]) => (
          <button type="button" key={id} className={activeTab === id ? "is-active" : ""} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="mobile-tab-panel">
        {activeTab === "now" ? (
          <div className="mobile-now">
            <div className="mobile-section-heading">
              <span>LOCAL / AVAILABLE</span>
              <button type="button" onClick={onOpenActions}>ВСЕ 4</button>
            </div>
            <div className="mobile-action-list">
              {actions.slice(0, 3).map((action) => (
                <button type="button" className="mobile-action-row" key={action.id} onClick={() => onAction(action)}>
                  <span className={`risk-dot risk-dot--${action.risk.toLowerCase()}`} />
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.duration} MIN · {action.cost ? `₵ ${action.cost}` : "FREE"}</small>
                  </span>
                  <Icon name="chevron" size={15} />
                </button>
              ))}
            </div>
            <button type="button" className="mobile-contact-row" onClick={onOpenContext}>
              <Portrait kind="contact" label={session.primaryContact.name} />
              <span><strong>{session.primaryContact.name}</strong><small>Известный контакт района</small></span>
              <span className="status-chip">KNOWN</span>
            </button>
          </div>
        ) : null}

        {activeTab === "plan" ? (
          <div className="mobile-plan-list">
            <button type="button" className="mobile-pressure-summary" onClick={() => onOpenWindow("pressure")}>
              <span><strong>PRESSURE WEEK</strong><small>₵ {committedAmount(session.pressure)} committed · {activeRequests(session.pressure).length} requests</small></span>
              <Icon name="chevron" size={15} />
            </button>
            {plans.map((item) => (
              <button type="button" className={`mobile-plan-row mobile-plan-row--${item.status}`} key={`${item.time}-${item.title}`}>
                <time>{item.time}</time>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <i />
              </button>
            ))}
          </div>
        ) : null}

        {activeTab === "food" ? (
          <div className="mobile-food">
            <div className="mobile-section-heading">
              <span>HOME STORAGE / {getFreshFoodUnits(session.life.food, session.timestamp)} FRESH</span>
              <button type="button" onClick={() => onOpenWindow("food")}>FULL</button>
            </div>
            <div className="mobile-food-list">
              {session.life.food.storage.slice(0, 3).map((stack) => {
                const product = getFoodProduct(stack.productId);
                const freshness = getFoodFreshness(stack, session.timestamp);
                const atHome = session.life.currentLocationId === session.life.housing.locationId;
                const ready = freshness !== "spoiled" && canPrepare(product.requirement, session.life.food.appliances, atHome);
                return (
                  <div className={`mobile-food-row mobile-food-row--${freshness}`} key={stack.id}>
                    <span className="food-code">{product.code}</span>
                    <span><strong>{product.name}</strong><small>×{stack.quantity} · {freshness.toUpperCase()}</small></span>
                    <button type="button" disabled={!ready} onClick={() => onEatFood(product.id)}>EAT</button>
                  </div>
                );
              })}
            </div>
            <div className="mobile-food-actions">
              <button type="button" onClick={() => onOpenWindow("places")}>НАЙТИ МАГАЗИН</button>
              <button type="button" onClick={() => onOpenWindow("food")}>ОТКРЫТЬ ЗАПАС</button>
            </div>
          </div>
        ) : null}

        {activeTab === "log" ? (
          <div className="mobile-log">
            <div className="mobile-log__filter">
              <select value={journalFilter} onChange={(event: ChangeEvent<HTMLSelectElement>) => setJournalFilter(event.target.value as EventCategory | "all")}>
                <option value="all">ALL EVENTS</option>
                <option value="personal">PERSONAL</option>
                <option value="contact">CONTACT</option>
                <option value="work">WORK</option>
                <option value="finance">FINANCE</option>
                <option value="health">HEALTH</option>
                <option value="local">LOCAL</option>
                <option value="system">SYSTEM</option>
              </select>
              <button type="button" onClick={() => onOpenWindow("journal")}>FULL LOG</button>
            </div>
            {visibleEvents.map((event) => (
              <article className={`mobile-event mobile-event--${event.category}`} key={event.id}>
                <time>{formatGameTime(event.timestamp)}</time>
                <span>{event.category.toUpperCase()}</span>
                <strong>{event.title}</strong>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MobileVital({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  const critical = danger ? value >= 70 : value <= 35;
  return (
    <div className={`mobile-vital ${critical ? "is-critical" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <i><b style={{ width: `${value}%` }} /></i>
    </div>
  );
}

function DistrictPulseStrip({ state, compact = false }: { state: DistrictPulseState; compact?: boolean }) {
  return (
    <div className={`district-pulse ${compact ? "district-pulse--compact" : ""}`}>
      <div><span>SEC</span><strong>{state.security}</strong><small>{districtSecurityLabel(state.security)}</small></div>
      <div><span>GRID</span><strong>{powerGridLabel(state.powerGrid)}</strong><small>POWER</small></div>
      <div><span>POLICE</span><strong>{state.policePresence}</strong><small>PRESENCE</small></div>
      <div><span>GANG</span><strong>{state.gangPressure}</strong><small>PRESSURE</small></div>
      <div><span>TRANSIT</span><strong>+{state.transitDelayMinutes}</strong><small>MIN</small></div>
    </div>
  );
}

function MobileFeedRow({ time, text, warning = false }: { time: string; text: string; warning?: boolean }) {
  return (
    <div className={`mobile-feed-row ${warning ? "is-warning" : ""}`}>
      <time>{time}</time>
      <p>{text}</p>
    </div>
  );
}

function ActionCard({ action, onAction, compact = false }: { action: ActionDefinition; onAction: (action: ActionDefinition) => void; compact?: boolean }) {
  return (
    <button type="button" className={`action-card ${compact ? "action-card--compact" : ""}`} onClick={() => onAction(action)}>
      <span className="action-card__code">{action.code}</span>
      <strong>{action.title}</strong>
      <small>{action.location}</small>
      <div>
        <span>{action.duration} MIN</span>
        <span>{action.cost ? `₵ ${action.cost}` : "FREE"}</span>
        <span className={`risk risk--${action.risk.toLowerCase()}`}>RISK {action.risk}</span>
      </div>
      <Icon name="chevron" />
    </button>
  );
}


function PlacesWorkspace({ session, onTravel, onOpenWindow, buildingActions, vehicleActions, transitActions }: { session: GameSession; onTravel: (locationId: string) => void; onOpenWindow: (id: WindowId) => void; buildingActions: BuildingAccessActions; vehicleActions: PhysicalVehicleActions; transitActions: TransitActions }) {
  const [tab, setTab] = useState<"routes" | "transit" | "vehicles" | "buildings" | "economy" | "population">(session.transit.player.journey ? "transit" : "routes");
  const current = session.world.locations.find((location) => location.id === session.life.currentLocationId);
  const options = getTravelOptions(session);
  const strained = session.economy.businesses.filter((business) => business.status === "strained").length;
  const critical = session.economy.businesses.filter((business) => business.status === "restricted" || business.status === "closed").length;
  const averagePrice = session.economy.businesses.length
    ? Math.round(session.economy.businesses.reduce((total, business) => total + business.priceIndex, 0) / session.economy.businesses.length)
    : 100;

  return (
    <div className="life-module life-module--places city-workspace">
      <header className="module-heading city-heading">
        <div><span>CITY / LOCAL FEEDBACK</span><h1>ГОРОД</h1><p>{current?.name ?? "UNKNOWN"} · маршруты и состояние рабочих точек</p></div>
        <div className="city-economy-stats">
          <div><span>PRICE</span><strong>{averagePrice}%</strong></div>
          <div><span>STRAIN</span><strong>{strained}</strong></div>
          <div><span>CRITICAL</span><strong className={critical ? "warning-text" : ""}>{critical}</strong></div>
        </div>
      </header>

      <nav className="terminal-tabs city-tabs" aria-label="Разделы города">
        <button type="button" className={tab === "routes" ? "is-active" : ""} onClick={() => setTab("routes")}>МАРШРУТЫ</button>
        <button type="button" className={tab === "transit" ? "is-active" : ""} onClick={() => setTab("transit")}>ТРАНЗИТ{session.transit.player.journey ? " · ACTIVE" : ""}</button>
        <button type="button" className={tab === "vehicles" ? "is-active" : ""} onClick={() => setTab("vehicles")}>МАШИНЫ</button>
        <button type="button" className={tab === "buildings" ? "is-active" : ""} onClick={() => setTab("buildings")}>ЗДАНИЯ</button>
        <button type="button" className={tab === "economy" ? "is-active" : ""} onClick={() => setTab("economy")}>ЭКОНОМИКА</button>
        <button type="button" className={tab === "population" ? "is-active" : ""} onClick={() => setTab("population")}>НАСЕЛЕНИЕ</button>
        <button type="button" onClick={() => onOpenWindow("local")}>РАЙОН</button>
      </nav>

      {tab === "routes" ? (
        <>
          <section className="current-location-card">
            <div className="location-sigil">YOU</div>
            <div><span>CURRENT LOCATION</span><strong>{current?.name ?? "UNKNOWN LOCATION"}</strong><small>{current?.code} · SECURITY {current?.security ?? 0}%</small></div>
            <span className="status-chip status-chip--online">ON SITE</span>
          </section>
          <div className="route-list">
            {options.map((option) => {
              const openByTime = isLocationOpen(option.location, session.timestamp + option.durationMinutes * 60_000);
              const business = getBusinessAtLocation(session.economy, option.location.id);
              const operational = businessCanServe(business);
              return (
                <article className={`route-card ${business ? `route-card--${business.status}` : ""}`} key={option.location.id}>
                  <div className="route-card__code">{option.location.code}</div>
                  <div className="route-card__body">
                    <span>{option.districtName}</span>
                    <strong>{option.location.name}</strong>
                    <small>{option.location.type.toUpperCase()} · SECURITY {option.location.security}%</small>
                  </div>
                  <div className="route-card__meta">
                    <span>{option.durationMinutes} MIN</span>
                    <span>₵ {option.cost}</span>
                    {business ? <span className={`business-state business-state--${business.status}`}>{business.status.toUpperCase()} · ₵{business.priceIndex}%</span> : <span className={openByTime ? "ok-text" : "warning-text"}>{openByTime ? "OPEN" : "CLOSED"}</span>}
                  </div>
                  <button type="button" disabled={session.player.balance < option.cost || session.localScene.playerPosition.state === "vehicle" || Boolean(session.transit.player.journey)} onClick={() => { onTravel(option.location.id); if (option.mode === "bus" || option.mode === "metro") setTab("transit"); }}>{option.mode === "bus" || option.mode === "metro" ? "К ОСТАНОВКЕ" : !openByTime || !operational ? "GO / LIMITED" : "GO"}</button>
                </article>
              );
            })}
          </div>
        </>
      ) : tab === "transit" ? (
        <TransitOperationsWorkspace session={session} actions={transitActions} />
      ) : tab === "vehicles" ? (
        <PhysicalVehiclesWorkspace session={session} actions={vehicleActions} />
      ) : tab === "buildings" ? (
        <BuildingAccessWorkspace session={session} actions={buildingActions} />
      ) : tab === "economy" ? (
        <div className="economy-business-list">
          {session.economy.businesses
            .slice()
            .sort((left, right) => businessStatusRank(right.status) - businessStatusRank(left.status) || left.stock - right.stock)
            .map((business) => (
              <BusinessEconomyCard
                key={business.id}
                business={business}
                location={session.world.locations.find((location) => location.id === business.locationId)}
                workers={session.people.people.filter((person) => person.workLocationId === business.locationId)}
                current={current?.id === business.locationId}
                onTravel={onTravel}
              />
            ))}
        </div>
      ) : (
        <PopulationWorkspace session={session} />
      )}
    </div>
  );
}


function transitServiceLabel(status: GameSession["transit"]["routes"][number]["status"]): string {
  if (status === "operational") return "ON TIME";
  if (status === "delayed") return "DELAYED";
  if (status === "crowded") return "CROWDED";
  return "SUSPENDED";
}

function transitPriorityLabel(priority: TransitPriorityNeed): string {
  if (priority === "elderly") return "ПОЖИЛОЙ";
  if (priority === "injured") return "ТРАВМА";
  if (priority === "disabled") return "ИНВАЛИДНОСТЬ";
  if (priority === "carrying-child") return "С РЕБЁНКОМ";
  return "ОБЫЧНЫЙ";
}

function TransitOperationsWorkspace({ session, actions }: { session: GameSession; actions: TransitActions }) {
  const transit = session.transit;
  const journey = transit.player.journey;
  const segment = journey?.segments[journey.activeSegmentIndex];
  const route = getTransitRoute(transit, segment?.routeId);
  const currentStop = getTransitStop(transit, journey?.currentStopId);
  const nextStop = getTransitStop(transit, journey?.nextStopId);
  const destination = journey ? session.world.locations.find((item) => item.id === journey.destinationLocationId) : undefined;
  const boardingVehicle = journey?.phase === "waiting" ? getTransitBoardingVehicle(transit) : null;
  const vehicle = getTransitVehicle(transit, journey?.vehicleId) ?? boardingVehicle;
  const cabin = transit.cabin;
  const freeSeats = cabin?.seats.filter((seat) => seat.occupiedBy === null) ?? [];
  const standingPriority = cabin?.passengers.filter((passenger) => passenger.standing && passenger.priorityNeed !== "none") ?? [];
  const legMinutes = getTransitLegMinutes(transit);

  if (!journey) {
    return (
      <div className="transit-operations-workspace">
        <section className="transit-summary-grid">
          <div><span>STOPS</span><strong>{transit.totals.stops}</strong><small>bus and rail nodes</small></div>
          <div><span>ROUTES</span><strong>{transit.totals.routes}</strong><small>{transit.totals.delayedRoutes} delayed · {transit.totals.crowdedRoutes} crowded</small></div>
          <div><span>VEHICLES</span><strong>{transit.totals.activeVehicles}</strong><small>{transit.totals.representedPassengers.toLocaleString("ru-RU")} passengers</small></div>
          <div><span>PLAYER</span><strong>{transit.player.completedTrips}</strong><small>{transit.player.productivePhoneMinutes} productive minutes</small></div>
        </section>
        <section className="transit-route-directory">
          <header><span>LIVE TRANSIT OPERATIONS</span><strong>SELECT DESTINATION IN ROUTES</strong></header>
          {transit.routes.slice().sort((left, right) => left.mode.localeCompare(right.mode) || left.code.localeCompare(right.code)).slice(0, 18).map((item) => (
            <article key={item.id} className={`transit-route-card transit-route-card--${item.status}`}>
              <div><span>{item.code}</span><strong>{item.name}</strong><small>{item.mode.toUpperCase()} · {item.stopIds.length} stops · every {item.headwayMinutes} min</small></div>
              <div><span>₵ {item.fare}</span><strong>{item.crowdingPercent}%</strong><small>CROWDING</small></div>
              <div><span>{item.activeVehicles}/{item.scheduledVehicles}</span><strong>{item.averageDelayMinutes} MIN</strong><small>{transitServiceLabel(item.status)}</small></div>
            </article>
          ))}
        </section>
      </div>
    );
  }

  if (journey.phase === "waiting") {
    return (
      <div className="transit-operations-workspace">
        <section className="transit-waiting-card">
          <span className="transit-phase">WAITING / {journey.activeSegmentIndex + 1} OF {journey.segments.length}</span>
          <h2>{currentStop?.name ?? "TRANSIT STOP"}</h2>
          <p>{route?.code} · {route?.name} · до {getTransitStop(transit, segment?.destinationStopId)?.name ?? destination?.name}</p>
          <div className="transit-waiting-metrics">
            <div><span>VEHICLE</span><strong>{boardingVehicle?.fleetNumber ?? "SEARCH"}</strong><small>{boardingVehicle?.crew.name ?? "оператор назначается"}</small></div>
            <div><span>FARE</span><strong>₵ {segment?.fare ?? 0}</strong><small>{journey.farePaid ? `paid ₵ ${journey.farePaid}` : "not paid"}</small></div>
            <div><span>SERVICE</span><strong>{route ? transitServiceLabel(route.status) : "UNKNOWN"}</strong><small>delay {route?.averageDelayMinutes ?? 0} min</small></div>
            <div><span>DESTINATION</span><strong>{destination?.code ?? "NODE"}</strong><small>{destination?.name}</small></div>
          </div>
          <div className="transit-primary-actions">
            <button type="button" className="button button--primary" disabled={!boardingVehicle || session.player.balance < (segment?.fare ?? 0)} onClick={actions.onBoard}>СЕСТЬ В {boardingVehicle?.fleetNumber ?? "ТРАНСПОРТ"}</button>
            <button type="button" className="button button--ghost" onClick={actions.onSkip}>ПРОПУСТИТЬ ВСЮ ПОЕЗДКУ</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="transit-operations-workspace">
      <section className={`transit-cabin-header transit-cabin-header--${journey.phase}`}>
        <div>
          <span>{journey.phase === "arrived" ? "ARRIVED" : `${route?.mode.toUpperCase()} / ONBOARD`}</span>
          <h2>{vehicle?.fleetNumber ?? "TRANSIT"} · {route?.code}</h2>
          <p>{currentStop?.name ?? "CURRENT STOP"}{nextStop ? ` → ${nextStop.name}` : ` · ${destination?.name ?? "DESTINATION"}`}</p>
        </div>
        <div className="transit-cabin-status">
          <strong>{cabin?.totalPassengerCount ?? vehicle?.occupancy ?? 0}</strong>
          <span>PASSENGERS</span>
          <small>{cabin?.crowdingPercent ?? route?.crowdingPercent ?? 0}% crowding · driver {vehicle?.crew.name ?? "unknown"}</small>
        </div>
      </section>

      {journey.phase === "arrived" ? (
        <section className="transit-arrival-card">
          <h3>{destination?.name ?? "DESTINATION"}</h3>
          <p>Рейс прибыл. Можно выйти или промотать завершение.</p>
          <button type="button" className="button button--primary" onClick={actions.onAlight}>ВЫЙТИ ИЗ ТРАНСПОРТА</button>
        </section>
      ) : (
        <>
          <section className="transit-seat-section">
            <header>
              <div><span>SALON / SEATS</span><strong>{journey.seatId ? "ТЫ СИДИШЬ" : "ТЫ СТОИШЬ"}</strong></div>
              {journey.seatId ? <button type="button" onClick={actions.onStand}>ВСТАТЬ</button> : <small>{freeSeats.length} свободно</small>}
            </header>
            <div className="transit-seat-map">
              {cabin?.seats.map((seat) => (
                <button
                  type="button"
                  key={seat.id}
                  className={`${seat.kind === "priority" ? "is-priority" : ""} ${seat.occupiedBy ? "is-occupied" : "is-free"} ${seat.occupiedBy === "player" ? "is-player" : ""}`}
                  disabled={seat.occupiedBy !== null || Boolean(journey.seatId)}
                  onClick={() => actions.onTakeSeat(seat.id)}
                >
                  <span>{seat.index + 1}</span>
                  <small>{seat.occupiedBy === "player" ? "YOU" : seat.occupiedBy ? "BUSY" : seat.kind === "priority" ? "PRIORITY" : "FREE"}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="transit-phone-actions">
            <header><span>PHONE / USE THIS LEG</span><strong>{legMinutes} MIN TO NEXT STOP</strong></header>
            <div>
              <button type="button" onClick={() => actions.onPhone("messages")}><strong>СООБЩЕНИЯ</strong><small>снизить стресс</small></button>
              <button type="button" onClick={() => actions.onPhone("job-board")}><strong>РАБОТА</strong><small>обновить заказы</small></button>
              <button type="button" onClick={() => actions.onPhone("study")}><strong>УЧЁБА</strong><small>получить знания</small></button>
              <button type="button" onClick={() => actions.onPhone("city-feed")}><strong>ГОРОД</strong><small>лента и маршрут</small></button>
            </div>
          </section>

          <section className="transit-passenger-section">
            <header><span>PASSENGERS IN THIS CAR</span><strong>{cabin?.passengers.length ?? 0} MATERIALIZED</strong></header>
            {cabin?.lastInteraction ? <div className="transit-last-interaction">{cabin.lastInteraction}</div> : null}
            <div className="transit-passenger-list">
              {cabin?.passengers.slice(0, 14).map((passenger) => (
                <article key={passenger.id} className={`${passenger.standing ? "is-standing" : "is-seated"} ${passenger.priorityNeed !== "none" ? "is-priority" : ""}`}>
                  <div><strong>{passenger.name}</strong><small>{passenger.roleLabel} · AGE {passenger.age}</small></div>
                  <div><span>{passenger.standing ? "STANDING" : `SEAT ${cabin.seats.find((seat) => seat.id === passenger.seatId)?.index !== undefined ? (cabin.seats.find((seat) => seat.id === passenger.seatId)?.index ?? 0) + 1 : ""}`}</span><small>{transitPriorityLabel(passenger.priorityNeed)} · {passenger.mood.toUpperCase()}</small></div>
                  <div>
                    {journey.seatId && passenger.standing && passenger.priorityNeed !== "none" ? <button type="button" onClick={() => actions.onYield(passenger.id)}>УСТУПИТЬ</button> : null}
                    <button type="button" onClick={() => actions.onInteract(passenger.id)}>ЗАГОВОРИТЬ</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="transit-ride-actions">
            <button type="button" className="button button--primary" onClick={actions.onAdvance}>ЕХАТЬ ДО СЛЕДУЮЩЕЙ · {legMinutes} MIN</button>
            <button type="button" className="button button--ghost" onClick={actions.onSkip}>ПРОПУСТИТЬ ПОЕЗДКУ</button>
          </div>
          {standingPriority.length && journey.seatId ? <div className="transit-priority-notice">Рядом стоит пассажир, которому нужно место: {standingPriority[0].name}.</div> : null}
        </>
      )}
    </div>
  );
}


function physicalVehicleStateLabel(state: GameSession["vehicles"]["vehicles"][number]["state"]): string {
  if (state === "parked") return "PARKED";
  if (state === "moving") return "MOVING";
  if (state === "occupied") return "OCCUPIED";
  if (state === "service") return "ON DUTY";
  return "DISABLED";
}

function PhysicalVehiclesWorkspace({ session, actions }: { session: GameSession; actions: PhysicalVehicleActions }) {
  const playerControl = session.vehicles.player;
  const currentVehicle = getPhysicalVehicle(session.vehicles, playerControl.currentVehicleId);
  const currentLocation = session.world.locations.find((location) => location.id === session.life.currentLocationId);
  const ownedIds = new Set(playerControl.ownedVehicleIds);
  const visibleVehicles = session.vehicles.vehicles
    .filter((vehicle) => vehicle.visible || ownedIds.has(vehicle.id) || vehicle.id === currentVehicle?.id)
    .sort((left, right) => Number(right.id === currentVehicle?.id) - Number(left.id === currentVehicle?.id) || Number(ownedIds.has(right.id)) - Number(ownedIds.has(left.id)) || left.distanceToPlayerM - right.distanceToPlayerM)
    .slice(0, 42);
  const destinations = currentVehicle && playerControl.seat === "driver"
    ? session.world.locations
        .filter((location) => location.id !== session.life.currentLocationId)
        .map((location) => ({
          location,
          estimate: estimatePhysicalVehicleTravel(
            session.vehicles,
            { metropolitan: session.metropolitan, mobility: session.mobility },
            currentVehicle.id,
            session.life.currentLocationId,
            location.id
          )
        }))
        .filter((item): item is { location: GameSession["world"]["locations"][number]; estimate: NonNullable<typeof item.estimate> } => Boolean(item.estimate))
        .sort((left, right) => left.estimate.durationMinutes - right.estimate.durationMinutes)
    : [];

  return (
    <div className="physical-vehicles-workspace">
      <section className="vehicle-summary-grid">
        <div><span>LOCAL VEHICLES</span><strong>{session.vehicles.totals.focusSectorVehicles}</strong><small>{session.vehicles.totals.visibleVehicles} visible · {session.vehicles.totals.nearbyVehicles} nearby</small></div>
        <div><span>PARKING</span><strong>{session.vehicles.totals.occupiedParkingSpaces}</strong><small>{session.vehicles.totals.parkingNodes} physical nodes</small></div>
        <div><span>PLAYER VEHICLE</span><strong>{currentVehicle?.plate ?? playerControl.ownedVehicleIds.length}</strong><small>{currentVehicle ? `${playerControl.seat?.toUpperCase()} · ${currentVehicle.modelName}` : "owned vehicles"}</small></div>
        <div><span>DRIVEN</span><strong>{playerControl.distanceDrivenKm.toFixed(1)} KM</strong><small>{playerControl.tripsCompleted} trips · {playerControl.fuelConsumedL.toFixed(1)} L</small></div>
        <div><span>CRIME HEAT</span><strong>{Math.round(session.vehicleCrime.playerHeat)}%</strong><small>{session.vehicleCrime.stolenVehicleIds.length} stolen · {session.vehicleCrime.totals.casesOpened} cases</small></div>
      </section>

      {currentVehicle ? (
        <section className="current-vehicle-card">
          <header>
            <div><span>YOU ARE IN VEHICLE</span><strong>{currentVehicle.modelName}</strong><small>{currentVehicle.plate} · {playerControl.seat?.toUpperCase()} · condition {Math.round(currentVehicle.condition)}%</small></div>
            <button type="button" className="button--danger" onClick={actions.onLeave}>ВЫЙТИ</button>
          </header>
          <div className="current-vehicle-metrics">
            <div><span>FUEL</span><strong>{currentVehicle.fuelL}/{currentVehicle.fuelCapacityL} L</strong><i><b style={{ width: `${currentVehicle.fuelL / currentVehicle.fuelCapacityL * 100}%` }} /></i></div>
            <div><span>CONDITION</span><strong>{Math.round(currentVehicle.condition)}%</strong><i><b style={{ width: `${currentVehicle.condition}%` }} /></i></div>
            <div><span>ODOMETER</span><strong>{Math.round(currentVehicle.odometerKm).toLocaleString("ru-RU")} KM</strong><small>{currentVehicle.consumptionLPer100Km} L / 100 KM</small></div>
          </div>
          {getVehicleWantedState(session.vehicleCrime, currentVehicle.id) ? (
            <div className="vehicle-crime-panel">
              <strong>{currentVehicle.legalStatus.toUpperCase()}</strong>
              <span>HEAT {getVehicleWantedState(session.vehicleCrime, currentVehicle.id)?.heat ?? 0}% · original plate {currentVehicle.originalPlate}</span>
              {currentLocation?.type === "workshop" ? <button type="button" onClick={() => actions.onReplate(currentVehicle.id)}>СМЕНИТЬ НОМЕРА</button> : null}
            </div>
          ) : null}
          {playerControl.seat === "driver" ? (
            <div className="vehicle-destination-list">
              {destinations.map(({ location, estimate }) => {
                const enoughFuel = currentVehicle.fuelL >= estimate.fuelUsedL;
                return (
                  <article key={location.id}>
                    <div><span>{location.code}</span><strong>{location.name}</strong><small>{estimate.durationMinutes} min · {Math.round(estimate.distanceM / 100) / 10} km · traffic {estimate.congestionPercent}%</small></div>
                    <div><span>{estimate.averageSpeedKph} KM/H</span><strong>−{estimate.fuelUsedL} L</strong></div>
                    <button type="button" disabled={!enoughFuel || currentVehicle.condition < 18} onClick={() => actions.onDrive(location.id)}>{enoughFuel ? "ЕХАТЬ" : "НЕТ ТОПЛИВА"}</button>
                  </article>
                );
              })}
            </div>
          ) : <div className="empty-terminal">Пассажирское место. Управление машиной недоступно.</div>}
        </section>
      ) : (
        <section className="vehicle-presence-list">
          <header><span>ACTIVE SECTOR / PHYSICAL VEHICLES</span><strong>{visibleVehicles.length} RECORDS</strong></header>
          {visibleVehicles.map((vehicle) => {
            const owned = ownedIds.has(vehicle.id);
            const inspection = getVehicleCrimeInspection(session.vehicleCrime, vehicle.id);
            const wanted = getVehicleWantedState(session.vehicleCrime, vehicle.id);
            const closeEnough = vehicle.distanceToPlayerM <= 6;
            const canApproach = session.localScene.playerPosition.state === "outside" && vehicle.visible && vehicle.state !== "moving";
            const canEnter = session.localScene.playerPosition.state === "outside" && closeEnough && (vehicle.access === "owned" || vehicle.access === "authorized" || (!vehicle.locked && vehicle.access === "public")) && vehicle.state !== "moving" && vehicle.state !== "disabled";
            const canService = currentLocation?.type === "workshop" && closeEnough && owned;
            const canCrimeService = currentLocation?.type === "workshop" && closeEnough && Boolean(wanted);
            return (
              <article key={vehicle.id} className={`${owned ? "is-owned" : ""} ${closeEnough ? "is-near" : ""}`}>
                <div className="vehicle-presence-list__identity">
                  <span>{vehicle.plate}</span>
                  <strong>{vehicle.modelName}</strong>
                  <small>{vehicle.vehicleClass.toUpperCase()} · {physicalVehicleStateLabel(vehicle.state)} · {vehicle.distanceToPlayerM === Number.MAX_SAFE_INTEGER ? "OFF SECTOR" : `${Math.round(vehicle.distanceToPlayerM)} m`}</small>
                </div>
                <div className="vehicle-presence-list__metrics">
                  <span className={vehicle.condition < 30 ? "warning-text" : ""}>COND {Math.round(vehicle.condition)}%</span>
                  <span>FUEL {vehicle.fuelL}/{vehicle.fuelCapacityL} L</span>
                  <small>{owned ? "PLAYER OWNED · KEY AVAILABLE" : `${vehicle.access.toUpperCase()} · ${vehicle.locked ? "LOCKED" : "UNLOCKED"} · ${vehicle.legalStatus.toUpperCase()}`}</small>
                  {inspection ? <small>LOCK {inspection.lockDifficulty}% · IGN {inspection.ignitionDifficulty}% · ALARM {inspection.alarmRisk}% · CAM {inspection.cameraRisk}%</small> : null}
                  {wanted ? <small className="warning-text">WANTED {wanted.heat}% · EVIDENCE {wanted.evidence}%</small> : null}
                </div>
                <div className="vehicle-presence-list__actions">
                  {!closeEnough && canApproach ? <button type="button" onClick={() => actions.onApproach(vehicle.id)}>ПОДОЙТИ</button> : null}
                  {canEnter ? <button type="button" className="button--primary" onClick={() => actions.onEnter(vehicle.id)}>СЕСТЬ</button> : null}
                  {canService ? <button type="button" onClick={() => actions.onService(vehicle.id)}>СЕРВИС</button> : null}
                  {closeEnough && !owned && vehicle.state !== "moving" && !inspection ? <button type="button" onClick={() => actions.onInspect(vehicle.id)}>ОСМОТРЕТЬ</button> : null}
                  {closeEnough && !owned && vehicle.locked && inspection ? <button type="button" className="button--danger" onClick={() => actions.onBreakIn(vehicle.id)}>ВСКРЫТЬ</button> : null}
                  {closeEnough && !owned && !vehicle.locked && inspection && !vehicle.hotwired ? <button type="button" className="button--danger" onClick={() => actions.onHotwire(vehicle.id)}>ЗАВЕСТИ</button> : null}
                  {closeEnough && !vehicle.locked && vehicle.cabinLootCredits > 0 ? <button type="button" onClick={() => actions.onLoot(vehicle.id)}>ОБЫСКАТЬ</button> : null}
                  {canCrimeService ? <button type="button" onClick={() => actions.onReplate(vehicle.id)}>НОМЕРА</button> : null}
                  {canCrimeService ? <button type="button" className="button--danger" onClick={() => actions.onDispose(vehicle.id, "strip")}>РАЗОБРАТЬ</button> : null}
                  {canCrimeService ? <button type="button" className="button--danger" onClick={() => actions.onDispose(vehicle.id, "fence")}>ПРОДАТЬ</button> : null}
                  {!canEnter && closeEnough && !canService && owned ? <button type="button" disabled>{vehicle.state === "disabled" ? "НЕИСПРАВНА" : "НЕТ ДОСТУПА"}</button> : null}
                </div>
              </article>
            );
          })}
          {!visibleVehicles.length ? <div className="empty-terminal">Рядом нет материализованных машин. Войди на улицу или смени сектор.</div> : null}
        </section>
      )}
    </div>
  );
}

function accessDecisionLabel(decision: GameSession["buildingAccess"]["buildingEntries"][number]["publicDecision"]): string {
  if (decision === "authorized") return "ACCESS";
  if (decision === "open") return "OPEN";
  if (decision === "closed") return "CLOSED";
  if (decision === "locked") return "LOCKED";
  return "NO ENTRY";
}

function BuildingAccessWorkspace({ session, actions }: { session: GameSession; actions: BuildingAccessActions }) {
  const access = session.buildingAccess;
  const position = session.localScene.playerPosition;
  const activeBuilding = position.buildingId ? session.urban.buildings.find((item) => item.id === position.buildingId) : undefined;
  const currentFloor = position.floor ?? 1;
  const currentUnit = position.unitId ? session.urban.units.find((item) => item.id === position.unitId) : undefined;
  const currentRoom = position.roomId ? access.rooms.find((item) => item.roomId === position.roomId) : undefined;
  const floorUnits = access.units.filter((unit) => unit.floor === currentFloor).slice(0, 30);
  const visibleFloors = access.floors.filter((floor, index, array) => Math.abs(floor.floor - currentFloor) <= 5 || index === 0 || index === array.length - 1);

  return (
    <div className="building-access-workspace">
      <section className="building-access-summary">
        <div><span>POSITION</span><strong>{activeBuilding?.addressCode ?? "STREET"}</strong><small>{access.player.level.toUpperCase()} · FLOOR {position.floor ?? "—"}</small></div>
        <div><span>LOCAL BUILDINGS</span><strong>{access.totals.localBuildings}</strong><small>{access.totals.openEntrances} open · {access.totals.authorizedEntrances} authorized</small></div>
        <div><span>ACCESS</span><strong>{access.totals.lockedEntrances} LOCKED</strong><small>{access.totals.deniedAttempts} denied attempts</small></div>
        <div><span>VISITED</span><strong>{access.visitedBuildingIds.length}</strong><small>{access.visitedUnitIds.length} units · {access.totals.doorsOpened} doors opened</small></div>
      </section>

      {access.player.level === "street" ? (
        <section className="building-entry-list">
          <header><span>ACTIVE SECTOR / BUILDINGS</span><strong>PHYSICAL ENTRANCES</strong></header>
          {access.buildingEntries.slice(0, 40).map((entry) => {
            const building = session.urban.buildings.find((item) => item.id === entry.buildingId);
            const closeEnough = entry.distanceToPlayerM <= 20;
            const publicAvailable = entry.publicDecision === "open" || entry.publicDecision === "authorized";
            const serviceAvailable = entry.serviceDecision === "open" || entry.serviceDecision === "authorized";
            return (
              <article key={entry.buildingId} className={closeEnough ? "is-near" : ""}>
                <div className="building-entry-list__identity">
                  <span>{entry.addressCode}</span>
                  <strong>{entry.use.toUpperCase()}</strong>
                  <small>{building?.floors ?? 0} floors · security {building?.security ?? 0}% · {Math.round(entry.distanceToPlayerM)} m</small>
                </div>
                <div className="building-entry-list__doors">
                  <span className={publicAvailable ? "ok-text" : "warning-text"}>MAIN {accessDecisionLabel(entry.publicDecision)}</span>
                  <small>{entry.publicReason}</small>
                  <span className={serviceAvailable ? "ok-text" : "warning-text"}>SERVICE {accessDecisionLabel(entry.serviceDecision)}</span>
                  <small>{entry.serviceReason}</small>
                </div>
                <div className="building-entry-list__actions">
                  {!closeEnough ? <button type="button" onClick={() => actions.onApproach(entry.buildingId)}>ПОДОЙТИ</button> : null}
                  {closeEnough && publicAvailable ? <button type="button" className="button--primary" onClick={() => actions.onEnter(entry.buildingId, "public")}>ВОЙТИ</button> : null}
                  {closeEnough && !publicAvailable && serviceAvailable ? <button type="button" onClick={() => actions.onEnter(entry.buildingId, "service")}>СЛУЖЕБНЫЙ</button> : null}
                  {closeEnough && !publicAvailable && !serviceAvailable ? <button type="button" disabled>ЗАКРЫТО</button> : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="building-interior-layout">
          <section className="building-interior-current">
            <header>
              <div><span>INSIDE BUILDING</span><strong>{activeBuilding?.addressCode ?? "UNKNOWN"}</strong><small>{activeBuilding?.use.toUpperCase()} · floor {currentFloor} · {access.player.level.toUpperCase()}</small></div>
              <button type="button" className="button--danger" onClick={actions.onLeave}>ВЫЙТИ НА УЛИЦУ</button>
            </header>
            <div className="building-access-breadcrumbs">
              <span>{activeBuilding?.addressCode}</span>
              <b>F{currentFloor}</b>
              {currentUnit ? <span>UNIT {currentUnit.unitNumber}</span> : null}
              {currentRoom ? <span>{currentRoom.kind.toUpperCase()}</span> : null}
            </div>
            {position.roomId ? <button type="button" onClick={actions.onLeaveRoom}>ВЫЙТИ ИЗ КОМНАТЫ</button> : null}
            {!position.roomId && position.unitId ? <button type="button" onClick={actions.onLeaveUnit}>ВЫЙТИ В КОРИДОР</button> : null}
          </section>

          {!position.unitId ? (
            <section className="building-floor-controls">
              <header><span>VERTICAL ACCESS</span><strong>{activeBuilding?.elevatorCount ?? 0} LIFTS · {activeBuilding?.stairwellCount ?? 0} STAIRS</strong></header>
              <div>
                {visibleFloors.map((floor) => (
                  <article key={floor.floor} className={floor.floor === currentFloor ? "is-current" : ""}>
                    <div><span>{floor.label}</span><strong>{floor.unitIds.length} UNITS</strong><small>{floor.occupiedActorCount} actors · {floor.accessible ? "accessible" : "blocked"}</small></div>
                    {floor.floor !== currentFloor ? (
                      <div>
                        {floor.stairsAvailable ? <button type="button" disabled={!floor.accessible} onClick={() => actions.onMoveFloor(floor.floor, "stairs")}>ЛЕСТНИЦА</button> : null}
                        {floor.elevatorAvailable ? <button type="button" disabled={!floor.accessible} onClick={() => actions.onMoveFloor(floor.floor, "elevator")}>ЛИФТ</button> : null}
                      </div>
                    ) : <strong>YOU ARE HERE</strong>}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {!position.unitId ? (
            <section className="building-unit-list">
              <header><span>FLOOR {currentFloor}</span><strong>DOORS & UNITS</strong></header>
              {floorUnits.map((unit) => (
                <article key={unit.unitId}>
                  <div><span>{unit.unitNumber}</span><strong>{unit.use.toUpperCase()}</strong><small>{unit.occupied ? `${unit.residentCount} residents` : "vacant"} · security {unit.security}%</small></div>
                  <div><span className={unit.decision === "open" || unit.decision === "authorized" ? "ok-text" : "warning-text"}>{accessDecisionLabel(unit.decision)}</span><small>{unit.reason}</small></div>
                  <button type="button" disabled={unit.decision !== "open" && unit.decision !== "authorized"} onClick={() => actions.onEnterUnit(unit.unitId)}>ВОЙТИ</button>
                </article>
              ))}
              {!floorUnits.length ? <div className="empty-terminal">На этом этаже нет материализованных помещений.</div> : null}
            </section>
          ) : (
            <section className="building-room-list">
              <header><span>UNIT {currentUnit?.unitNumber ?? "UNKNOWN"}</span><strong>ROOMS</strong></header>
              {access.rooms.map((room) => (
                <article key={room.roomId} className={room.playerInside ? "is-current" : ""}>
                  <div><span>{room.kind.toUpperCase()}</span><strong>{room.occupiedActorCount} ACTORS</strong><small>{room.playerInside ? "YOU ARE HERE" : "door open"}</small></div>
                  {!position.roomId ? <button type="button" onClick={() => actions.onEnterRoom(room.roomId)}>ВОЙТИ</button> : null}
                </article>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function businessStatusRank(status: BusinessState["status"]): number {
  if (status === "closed") return 4;
  if (status === "restricted") return 3;
  if (status === "strained") return 2;
  return 1;
}

function BusinessEconomyCard({ business, location, workers, current, onTravel }: { business: BusinessState; location: GameSession["world"]["locations"][number] | undefined; workers: PersonState[]; current: boolean; onTravel: (locationId: string) => void }) {
  return (
    <article className={`economy-business economy-business--${business.status}`}>
      <header>
        <div><span>{location?.code ?? business.id.slice(-8)}</span><strong>{location?.name ?? "UNKNOWN BUSINESS"}</strong><small>{business.kind.toUpperCase()} · {workers.length} KNOWN WORKERS</small></div>
        <em>{business.status.toUpperCase()}</em>
      </header>
      <div className="economy-business__metrics">
        <div><span>STOCK</span><strong>{business.stock}%</strong><i><b style={{ width: `${business.stock}%` }} /></i></div>
        <div><span>STAFF</span><strong>{business.staffing}%</strong><i><b style={{ width: `${business.staffing}%` }} /></i></div>
        <div><span>DEMAND</span><strong>{business.demand}%</strong><i><b style={{ width: `${business.demand}%` }} /></i></div>
      </div>
      <footer>
        <span>PRICE INDEX <strong className={business.priceIndex > 125 ? "warning-text" : ""}>{business.priceIndex}%</strong></span>
        <span>CASH <strong>₵ {Math.max(0, business.cash).toLocaleString("ru-RU")}</strong></span>
        <button type="button" disabled={current || !location} onClick={() => location && onTravel(location.id)}>{current ? "YOU ARE HERE" : "GO"}</button>
      </footer>
    </article>
  );
}

function PeopleWorkspace({ session, onSelect }: { session: GameSession; onSelect: (personId: string) => void }) {
  const [tab, setTab] = useState<"nearby" | "all" | "memory">("nearby");
  const currentLocation = session.world.locations.find((location) => location.id === session.life.currentLocationId);
  const visibleSceneActors = session.localScene.actors.filter((actor) => actor.visible);
  const nearby = visibleSceneActors.flatMap((actor) => {
    const person = actor.activePersonId ? getPerson(session.people, actor.activePersonId) : null;
    return person ? [person] : [];
  });
  const unknownNearby = visibleSceneActors.filter((actor) => !actor.activePersonId);
  const selected = getPerson(session.people, session.world.primaryContactId)
    ?? getPerson(session.people, session.people.selectedPersonId);
  const memories = session.people.people
    .flatMap((person) => person.memories.map((memory) => ({ person, memory })))
    .sort((left, right) => right.memory.timestamp - left.memory.timestamp)
    .slice(0, 18);
  const visiblePeople = tab === "nearby" ? nearby : session.people.people;
  const locationName = (id: string) => session.world.locations.find((location) => location.id === id)?.name ?? "UNKNOWN NODE";

  return (
    <div className="people-workspace">
      <header className="module-heading people-heading">
        <div>
          <span>PEOPLE / HUMAN NETWORK</span>
          <h1>ЛЮДИ ГОРОДА</h1>
          <p>{currentLocation?.name ?? "UNKNOWN"} · постоянные жители, расписания и память</p>
        </div>
        <div className="people-stats">
          <div><span>KNOWN</span><strong>{session.people.people.length}</strong></div>
          <div><span>VISIBLE</span><strong>{session.localScene.totals.visibleActors}</strong></div>
          <div><span>MEMORY</span><strong>{session.people.people.reduce((sum, person) => sum + person.memories.length, 0)}</strong></div>
        </div>
      </header>

      <nav className="terminal-tabs people-tabs" aria-label="Разделы человеческой сети">
        <button type="button" className={tab === "nearby" ? "is-active" : ""} onClick={() => setTab("nearby")}>РЯДОМ · {session.localScene.totals.visibleActors}</button>
        <button type="button" className={tab === "all" ? "is-active" : ""} onClick={() => setTab("all")}>ВСЕ · {session.people.people.length}</button>
        <button type="button" className={tab === "memory" ? "is-active" : ""} onClick={() => setTab("memory")}>ПАМЯТЬ · {memories.length}</button>
      </nav>

      {tab !== "memory" ? (
        <div className="people-list">
          {visiblePeople.map((person) => (
            <PersonNetworkCard
              key={person.id}
              person={person}
              location={locationName(person.currentLocationId)}
              selected={selected?.id === person.id}
              onSelect={onSelect}
            />
          ))}
          {tab === "nearby" ? unknownNearby.map((actor) => <LocalActorCard key={actor.id} actor={actor} />) : null}
          {tab === "nearby" && !visibleSceneActors.length ? <div className="empty-terminal">В прямой видимости никого нет. Физические актёры продолжают двигаться по сектору, зданиям и маршрутам.</div> : null}
          {tab === "all" && !visiblePeople.length ? <div className="empty-terminal">Постоянная человеческая сеть пуста.</div> : null}
        </div>
      ) : (
        <div className="people-memory-list">
          {memories.map(({ person, memory }) => (
            <button type="button" key={memory.id} onClick={() => onSelect(person.id)}>
              <time>{formatGameDateTime(memory.timestamp)}</time>
              <span><strong>{person.name}</strong><small>{memory.summary}</small></span>
              <em className={memory.emotionalValue < 0 ? "is-negative" : memory.emotionalValue > 0 ? "is-positive" : ""}>{memory.emotionalValue > 0 ? "+" : ""}{memory.emotionalValue}</em>
            </button>
          ))}
          {!memories.length ? <div className="empty-terminal">Общих воспоминаний пока нет. Люди запомнят конкретные поступки игрока.</div> : null}
        </div>
      )}
    </div>
  );
}

function LocalActorCard({ actor }: { actor: LocalActorState }) {
  return (
    <article className="people-card people-card--local">
      <div className="people-card__identity">
        <span className="people-card__code">LOCAL-{actor.residentId.slice(-4).toUpperCase()}</span>
        <strong>{actor.name}</strong>
        <small>{actor.roleLabel} · AGE {actor.age}</small>
      </div>
      <div className="people-card__status">
        <span>{actor.activityLabel}</span>
        <small>{actor.position.state.toUpperCase()} · {Math.round(actor.distanceToPlayerM)} M</small>
      </div>
      <div className="people-card__problem">
        <span>PHYSICAL ACTOR</span>
        <strong>{actor.health.toUpperCase()}</strong>
        <small>{actor.position.buildingId ? `BUILDING ${actor.position.buildingId.slice(-6).toUpperCase()}` : "STREET / TRANSIT"}</small>
      </div>
      <div className="people-card__relation">
        <span>{actor.interactable ? "IN REACH" : "VISIBLE"}</span>
        <span>W {actor.representedWeight.toLocaleString("ru-RU")}</span>
      </div>
    </article>
  );
}

function PersonNetworkCard({ person, location, selected, onSelect }: { person: PersonState; location: string; selected: boolean; onSelect: (personId: string) => void }) {
  return (
    <button type="button" className={`people-card ${selected ? "is-selected" : ""}`} onClick={() => onSelect(person.id)}>
      <div className="people-card__identity">
        <span className="people-card__code">{person.profileCode}</span>
        <strong>{person.name}</strong>
        <small>{person.roleLabel} · AGE {person.age}</small>
      </div>
      <div className="people-card__status">
        <span>{person.status}</span>
        <small>{location}</small>
      </div>
      <div className="people-card__problem">
        <span>PRESSURE {person.problem.severity}%</span>
        <strong>{person.problem.title}</strong>
        <i><b style={{ width: `${person.problem.severity}%` }} /></i>
      </div>
      <div className="people-card__relation">
        <span>T {person.trustToPlayer}</span>
        <span>R {person.respectToPlayer}</span>
        <span className={person.irritationToPlayer >= 35 ? "warning-text" : ""}>I {person.irritationToPlayer}</span>
        <span>M {person.memories.length}</span>
      </div>
      <Icon name="chevron" size={16} />
    </button>
  );
}

function FoodWorkspace({ session, onEat, onOpenWindow }: { session: GameSession; onEat: (productId: string) => void; onOpenWindow: (id: WindowId) => void }) {
  const fresh = getFreshFoodUnits(session.life.food, session.timestamp);
  const spoiled = session.life.food.storage.reduce((total, stack) => total + (getFoodFreshness(stack, session.timestamp) === "spoiled" ? stack.quantity : 0), 0);
  return (
    <div className="life-module life-module--food">
      <header className="module-heading">
        <div><span>LIFE / PHYSICAL SUPPLY</span><h1>ПРОДУКТЫ</h1><p>Отдельные предметы, сроки хранения и условия приготовления.</p></div>
        <button type="button" className="button button--primary" onClick={() => onOpenWindow("food")}>Открыть терминал</button>
      </header>
      <div className="food-summary-grid">
        <div><span>FRESH PORTIONS</span><strong>{fresh}</strong><small>доступно сейчас</small></div>
        <div><span>SPOILED</span><strong className={spoiled ? "warning-text" : ""}>{spoiled}</strong><small>требуют утилизации</small></div>
        <div><span>LAST MEAL</span><strong>{session.life.food.lastMealProductId ? getFoodProduct(session.life.food.lastMealProductId).code : "NONE"}</strong><small>{session.life.food.lastMealAt ? formatGameTime(session.life.food.lastMealAt) : "нет записи"}</small></div>
        <div><span>STORAGE</span><strong>{session.life.food.storage.reduce((sum, stack) => sum + stack.quantity, 0)}/{session.life.housing.storageCapacity}</strong><small>домашний модуль</small></div>
      </div>
      <div className="food-shelf-grid">
        {session.life.food.storage.map((stack) => {
          const product = getFoodProduct(stack.productId);
          const freshness = getFoodFreshness(stack, session.timestamp);
          const atHome = session.life.currentLocationId === session.life.housing.locationId;
          const ready = freshness !== "spoiled" && canPrepare(product.requirement, session.life.food.appliances, atHome);
          return (
            <article className={`food-shelf-card food-shelf-card--${freshness}`} key={stack.id}>
              <span className="food-code">{product.code}</span>
              <strong>{product.name}</strong>
              <p>{product.description}</p>
              <div><span>×{stack.quantity}</span><span>{freshness.toUpperCase()}</span><span>−{product.hungerRelief} FOOD</span></div>
              <button type="button" disabled={!ready} onClick={() => onEat(product.id)}>{ready ? "Съесть" : product.requirement === "none" ? "Испорчено" : `Нужно: ${product.requirement}`}</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function HomeWorkspace({ session, onSleep, onOpenWindow, onTravel }: { session: GameSession; onSleep: (hours: number) => void; onOpenWindow: (id: WindowId) => void; onTravel: (locationId: string) => void }) {
  const housingLocation = session.world.locations.find((location) => location.id === session.life.housing.locationId);
  const atHome = session.life.currentLocationId === session.life.housing.locationId;
  return (
    <div className="life-module life-module--home">
      <header className="module-heading"><div><span>HOME / HABITATION NODE</span><h1>{housingLocation?.name ?? "HOUSING"}</h1><p>{session.player.housingDaysLeft} дней оплачено · ₵ {session.life.housing.rentPerWeek} в неделю</p></div><span className={`status-chip ${session.pressure.housingStatus === "active" ? "status-chip--online" : ""}`}>{session.pressure.housingStatus.toUpperCase()}</span></header>
      <div className="housing-grid">
        <section className="housing-card housing-card--main"><span>CAPSULE UNIT</span><strong>{housingLocation?.code}</strong><div><b>SLEEP {session.life.housing.sleepQuality}%</b><b>NOISE {session.life.housing.noise}%</b><b>SEC {session.life.housing.security}%</b></div><p>Узкая капсула, персональный шкаф, нагреватель и доступ к горячей воде. Кухонного модуля и пищевого принтера нет.</p></section>
        <section className="housing-card"><span>APPLIANCES</span><ul><li className="is-active">HEATER</li><li className="is-active">HOT WATER</li><li>KITCHEN MODULE</li><li>FOOD PRINTER</li></ul></section>
        <section className="housing-card"><span>FOOD STORAGE</span><strong>{getFreshFoodUnits(session.life.food, session.timestamp)} порций</strong><button type="button" onClick={() => onOpenWindow("food")}>Открыть запас</button><button type="button" onClick={() => onOpenWindow("pressure")}>Платежи и аренда</button></section>
      </div>
      <div className="sleep-control">
        <div><span>REST CYCLE</span><strong>Усталость {session.player.condition.fatigue}%</strong><small>Шум жилья снизит качество восстановления.</small></div>
        {atHome && session.pressure.housingStatus !== "evicted" ? <><button type="button" onClick={() => onSleep(6)}>Спать 6 ч</button><button type="button" className="button--primary" onClick={() => onSleep(8)}>Спать 8 ч</button></> : session.pressure.housingStatus === "evicted" ? <button type="button" className="button--danger" onClick={() => onOpenWindow("pressure")}>Восстановить доступ</button> : <button type="button" className="button--primary" onClick={() => onTravel(session.life.housing.locationId)}>Вернуться домой</button>}
      </div>
    </div>
  );
}

function FoodTerminal({ session, onBuy, onEat, onDiscard, onOrder, onOpenPlaces }: { session: GameSession; onBuy: (productId: string) => void; onEat: (productId: string) => void; onDiscard: () => void; onOrder: (productId: string) => void; onOpenPlaces: () => void }) {
  const [tab, setTab] = useState<"storage" | "store" | "delivery">("storage");
  const current = session.world.locations.find((location) => location.id === session.life.currentLocationId);
  const localStock = current ? session.life.food.shopStocks[current.id] : undefined;
  const market = session.world.locations.find((location) => location.type === "market");
  const deliveryStock = market ? session.life.food.shopStocks[market.id] : undefined;
  const currentBusiness = current ? getBusinessAtLocation(session.economy, current.id) : null;
  const marketBusiness = market ? getBusinessAtLocation(session.economy, market.id) : null;
  const atHome = session.life.currentLocationId === session.life.housing.locationId;
  const spoiled = session.life.food.storage.some((stack) => getFoodFreshness(stack, session.timestamp) === "spoiled");
  const renderProduct = (productId: string, stock: number, mode: "buy" | "order") => {
    const product = getFoodProduct(productId);
    const business = mode === "buy" ? currentBusiness : marketBusiness;
    const price = localPrice(product.price, business);
    const deliveryFee = 14 + Math.max(0, Math.round((business?.priceIndex ?? 100) / 25) - 4);
    const total = mode === "order" ? price + deliveryFee : price;
    const serviceAvailable = businessCanServe(business);
    return (
      <article className={`supply-product ${business ? `supply-product--${business.status}` : ""}`} key={`${mode}-${product.id}`}>
        <div className="supply-product__mark"><span>{product.code}</span><i>{product.category.toUpperCase()}</i></div>
        <div className="supply-product__body"><span>{product.maker}</span><strong>{product.name}</strong><p>{product.description}</p><div>{product.tags.map((tag) => <i key={tag}>{tag}</i>)}</div></div>
        <div className="supply-product__stats"><span>FOOD −{product.hungerRelief}</span><span>PREP {product.preparationMinutes}M</span><span>LIFE {product.shelfLifeHours}H</span><span>STOCK {stock}</span><span>INDEX {business?.priceIndex ?? 100}%</span></div>
        <button type="button" disabled={!serviceAvailable || stock <= 0 || session.player.balance < total || (mode === "buy" && (!current || !isLocationOpen(current, session.timestamp)))} onClick={() => mode === "buy" ? onBuy(product.id) : onOrder(product.id)}>{!serviceAvailable ? "SERVICE CLOSED" : mode === "buy" ? `КУПИТЬ ₵ ${price}` : `ДОСТАВИТЬ ₵ ${total}`}</button>
      </article>
    );
  };
  return (
    <div className="food-terminal">
      <nav className="terminal-tabs"><button type="button" className={tab === "storage" ? "is-active" : ""} onClick={() => setTab("storage")}>ЗАПАС</button><button type="button" className={tab === "store" ? "is-active" : ""} onClick={() => setTab("store")}>МАГАЗИН</button><button type="button" className={tab === "delivery" ? "is-active" : ""} onClick={() => setTab("delivery")}>ДОСТАВКА</button></nav>
      {tab === "storage" ? <div className="storage-list">
        <header><div><span>HOME STORAGE</span><strong>{getFreshFoodUnits(session.life.food, session.timestamp)} свежих порций</strong></div><button type="button" disabled={!spoiled} onClick={onDiscard}>Утилизировать испорченное</button></header>
        {session.life.food.storage.map((stack) => {
          const product = getFoodProduct(stack.productId); const freshness = getFoodFreshness(stack, session.timestamp); const ready = freshness !== "spoiled" && canPrepare(product.requirement, session.life.food.appliances, atHome);
          return <article className={`storage-row storage-row--${freshness}`} key={stack.id}><span className="food-code">{product.code}</span><div><strong>{product.name}</strong><small>{product.maker} · ×{stack.quantity}</small></div><div><span>{freshness.toUpperCase()}</span><small>{product.requirement.toUpperCase()}</small></div><button type="button" disabled={!ready} onClick={() => onEat(product.id)}>{ready ? "EAT" : freshness === "spoiled" ? "SPOILED" : "HOME PREP"}</button></article>;
        })}
      </div> : null}
      {tab === "store" ? <div className="supply-list"><header className="supply-location"><div><span>LOCAL RETAIL</span><strong>{current?.name ?? "UNKNOWN"}</strong><small>{currentBusiness ? `${currentBusiness.status.toUpperCase()} · PRICE ${currentBusiness.priceIndex}% · STOCK ${currentBusiness.stock}%` : current && isLocationOpen(current, session.timestamp) ? "OPEN NOW" : "NO ACTIVE RETAIL"}</small></div>{!localStock ? <button type="button" onClick={onOpenPlaces}>Найти магазин</button> : null}</header>{localStock ? Object.entries(localStock).map(([productId, stock]) => renderProduct(productId, stock, "buy")) : <div className="empty-terminal">На текущей локации нет продуктового терминала.</div>}</div> : null}
      {tab === "delivery" ? <div className="supply-list"><header className="supply-location"><div><span>CITY DELIVERY</span><strong>{market?.name ?? "MARKET OFFLINE"}</strong><small>{marketBusiness ? `${marketBusiness.status.toUpperCase()} · PRICE ${marketBusiness.priceIndex}% · STOCK ${marketBusiness.stock}%` : "Доставка в домашний пищевой шкаф · 25 минут"}</small></div></header>{deliveryStock ? Object.entries(deliveryStock).map(([productId, stock]) => renderProduct(productId, stock, "order")) : null}</div> : null}
    </div>
  );
}

function courierMinutesLeft(order: CourierOrder, timestamp: number): number {
  return Math.ceil((order.deadlineAt - timestamp) / 60_000);
}

function CourierWorkspace({
  session,
  onAccept,
  onPickup,
  onDeliver,
  onTravel
}: {
  session: GameSession;
  onAccept: (orderId: string) => void;
  onPickup: () => void;
  onDeliver: () => void;
  onTravel: (locationId: string) => void;
}) {
  const state = session.jobs.courier;
  const active = getActiveCourierOrder(state);
  const available = state.orders.filter((order) => order.status === "available");
  const locationName = (id: string) => session.world.locations.find((location) => location.id === id)?.name ?? "UNKNOWN NODE";
  const atPickup = active?.pickupLocationId === session.life.currentLocationId;
  const atDropoff = active?.dropoffLocationId === session.life.currentLocationId;
  const activeClient = active ? getPerson(session.people, active.clientId) : null;
  const activeBusiness = active?.businessId ? session.economy.businesses.find((business) => business.id === active.businessId) : null;
  const clientMoved = Boolean(active && activeClient && activeClient.currentLocationId !== active.dropoffLocationId);

  return (
    <div className="courier-workspace">
      <header className="screen-heading courier-heading">
        <div>
          <span className="screen-heading__path">WORK / MESHLINE / OPEN EXCHANGE</span>
          <h1>КУРЬЕРСКАЯ БИРЖА</h1>
          <p>Разовые городские заказы без постоянного контракта.</p>
        </div>
        <div className="courier-stats">
          <div><span>RATING</span><strong>{state.rating}</strong></div>
          <div><span>DONE</span><strong>{state.completedDeliveries}</strong></div>
          <div><span>EARNED</span><strong>₵ {state.totalEarnings}</strong></div>
        </div>
      </header>

      {active ? (
        <section className={`courier-active courier-active--${active.risk}`}>
          <header>
            <div><span>ACTIVE DELIVERY</span><h2>{active.code}</h2></div>
            <div className="courier-active__badges"><span className={`status-chip risk-${active.risk}`}>{active.status.toUpperCase()}</span><span className={`status-chip ${active.economicPurpose === "restock" ? "status-chip--warning" : ""}`}>{active.economicPurpose === "restock" ? "SUPPLY" : "PERSONAL"}</span></div>
          </header>
          <button type="button" className="courier-client-line" onClick={() => onTravel(active.dropoffLocationId)}>
            <span><strong>{active.client}</strong><small>{active.requestNote}</small></span>
            <em>{getPerson(session.people, active.clientId)?.status ?? "CLIENT STATUS UNKNOWN"}</em>
          </button>
          <div className="courier-route-line">
            <div className={active.status !== "accepted" ? "is-complete" : ""}><span>PICKUP</span><strong>{locationName(active.pickupLocationId)}</strong></div>
            <i><Icon name="chevron" /></i>
            <div><span>DROP</span><strong>{locationName(active.dropoffLocationId)}</strong></div>
          </div>
          <div className="courier-active__grid">
            <div><span>CARGO</span><strong>{active.cargoName}</strong></div>
            <div><span>WEIGHT</span><strong>{active.weightKg} KG</strong></div>
            <div><span>CONDITION</span><strong>{active.condition}%</strong></div>
            <div><span>DEADLINE</span><strong className={courierMinutesLeft(active, session.timestamp) < 25 ? "warning-text" : ""}>{courierMinutesLeft(active, session.timestamp)} MIN</strong></div>
            <div><span>PAYOUT</span><strong>₵ {active.payout}</strong></div>
            <div><span>{activeBusiness ? "BUSINESS" : "LEGALITY"}</span><strong>{activeBusiness ? `${activeBusiness.status.toUpperCase()} / STOCK ${activeBusiness.stock}%` : active.legality.toUpperCase()}</strong></div>
          </div>
          <div className="courier-active__actions">
            {active.status === "accepted" && atPickup ? <button type="button" className="button button--primary" onClick={onPickup}>ЗАБРАТЬ ГРУЗ · 6 MIN</button> : null}
            {active.status === "accepted" && !atPickup ? <button type="button" className="button button--primary" onClick={() => onTravel(active.pickupLocationId)}>ЕХАТЬ К ПОЛУЧЕНИЮ</button> : null}
            {active.status === "in-transit" && atDropoff ? <button type="button" className="button button--primary" onClick={onDeliver}>{clientMoved ? "КЛИЕНТ УШЁЛ · УТОЧНИТЬ" : "ПЕРЕДАТЬ ГРУЗ · 5 MIN"}</button> : null}
            {active.status === "in-transit" && !atDropoff ? <button type="button" className="button button--primary" onClick={() => onTravel(active.dropoffLocationId)}>ЕХАТЬ К КЛИЕНТУ</button> : null}
          </div>
        </section>
      ) : (
        <section className="courier-idle">
          <Icon name="work" size={34} />
          <div><strong>АКТИВНОГО ЗАКАЗА НЕТ</strong><span>Выбери одну доставку с биржи. Одновременно можно вести только один груз.</span></div>
        </section>
      )}

      <section className="courier-board">
        <header><div><span>LIVE BOARD</span><strong>{available.length} AVAILABLE</strong></div><small>Обновление {formatGameTime(state.boardRefreshAt)}</small></header>
        <div className="courier-order-list">
          {available.map((order) => (
            <article className={`courier-order courier-order--${order.risk}`} key={order.id}>
              <header><div><span>{order.code} · {order.economicPurpose === "restock" ? "SUPPLY" : "PERSONAL"}</span><strong>{order.client}</strong></div><em>{order.risk.toUpperCase()}</em></header>
              <div className="courier-order__route"><span>{locationName(order.pickupLocationId)}</span><Icon name="chevron" size={14} /><span>{locationName(order.dropoffLocationId)}</span></div>
              <div className="courier-order__meta"><span>{order.weightKg} KG</span><span>{courierMinutesLeft(order, session.timestamp)} MIN</span><span>₵ {order.payout}</span><span>{order.businessId ? `STOCK ${session.economy.businesses.find((business) => business.id === order.businessId)?.stock ?? "?"}%` : order.legality.toUpperCase()}</span></div>
              <p>{order.requestNote}</p>
              <small className="courier-order__cargo">{order.cargoName}</small>
              <button type="button" disabled={Boolean(active) || order.weightKg > state.cargoCapacityKg} onClick={() => onAccept(order.id)}>ПРИНЯТЬ ЗАКАЗ</button>
            </article>
          ))}
          {!available.length ? <div className="empty-terminal">Новых заказов нет. Биржа обновится автоматически.</div> : null}
        </div>
      </section>
    </div>
  );
}

function ModulePreview({ activeNav, onReturn, onOpenWindow }: { activeNav: NavId; onReturn: () => void; onOpenWindow: (id: WindowId) => void }) {
  const item = navItems.find((nav) => nav.id === activeNav) ?? navItems[0];
  return (
    <div className="module-preview">
      <span className="module-preview__code">MODULE/{item.label}/PREVIEW</span>
      <Icon name={item.icon} size={56} />
      <h1>{item.label}</h1>
      <p>Модуль подключён к общей городской оболочке и будет расширен через общие системы мира.</p>
      <div>
        <button type="button" className="button button--primary" onClick={onReturn}>Вернуться в LIFE</button>
        <button type="button" className="button button--ghost" onClick={() => onOpenWindow("diagnostics")}>Проверить систему</button>
      </div>
    </div>
  );
}

function WindowContent({
  id,
  settings,
  setSettings,
  onAction,
  onReset,
  session,
  journalFilter,
  setJournalFilter,
  versionGuard,
  saveController,
  actions,
  onTravel,
  onBuyFood,
  onEatFood,
  onDiscardFood,
  onOrderFood,
  onSleep,
  onAcceptDelivery,
  onPickupDelivery,
  onDeliverDelivery,
  onAcceptRequest,
  onDeclineRequest,
  onCompleteRequest,
  onPayObligation,
  onRequestExtension,
  onBorrow,
  onOpenWindow,
  buildingActions,
  vehicleActions,
  transitActions
}: {
  id: WindowId;
  settings: UiSettings;
  setSettings: (settings: UiSettings) => void;
  onAction: (action: ActionDefinition) => void;
  onReset: () => void;
  session: GameSession;
  journalFilter: EventCategory | "all";
  setJournalFilter: (filter: EventCategory | "all") => void;
  versionGuard: VersionGuardController;
  saveController: WorldSaveController;
  actions: ActionDefinition[];
  onTravel: (locationId: string) => void;
  onBuyFood: (productId: string) => void;
  onEatFood: (productId: string) => void;
  onDiscardFood: () => void;
  onOrderFood: (productId: string) => void;
  onSleep: (hours: number) => void;
  onAcceptDelivery: (orderId: string) => void;
  onPickupDelivery: () => void;
  onDeliverDelivery: () => void;
  onAcceptRequest: (requestId: string) => void;
  onDeclineRequest: (requestId: string) => void;
  onCompleteRequest: (requestId: string) => void;
  onPayObligation: (obligationId: string) => void;
  onRequestExtension: () => void;
  onBorrow: (personId: string) => void;
  onOpenWindow: (id: WindowId) => void;
  buildingActions: BuildingAccessActions;
  vehicleActions: PhysicalVehicleActions;
  transitActions: TransitActions;
}) {

  if (id === "profile") {
    const { player } = session;
    return (
      <div className="profile-window">
        <div className="profile-window__head">
          <Portrait kind="player" label={player.name} />
          <div>
            <span>CITIZEN {player.id.slice(-8).toUpperCase()}</span>
            <h3>{player.name}</h3>
            <p>AGE {player.age} · {player.occupation}</p>
            <strong>{player.origin}</strong>
          </div>
        </div>
        <div className="profile-window__resources">
          <div><span>BALANCE</span><strong>₵ {player.balance.toLocaleString("ru-RU")}</strong></div>
          <div><span>HOUSING</span><strong>{player.housingDaysLeft} DAYS</strong></div>
          <div><span>MEDICAL</span><strong>LIMITED</strong></div>
        </div>
        <div className="profile-window__meters">
          <Meter label="Здоровье" value={player.condition.health} />
          <Meter label="Усталость" value={player.condition.fatigue} invert />
          <Meter label="Стресс" value={player.condition.stress} invert />
          <Meter label="Голод" value={player.condition.hunger} invert />
        </div>
      </div>
    );
  }

  if (id === "contact") {
    const contact = session.primaryContact;
    const person = getPerson(session.people, contact.id);
    return (
      <div className="dossier-window">
        <div className="dossier-window__identity">
          <Portrait kind="contact" label={contact.name} />
          <div>
            <span>PROFILE {contact.profileCode}</span>
            <h3>{contact.name}</h3>
            <p>{contact.role} · AGE {contact.age}</p>
            <strong>{contact.status} · {contact.location}</strong>
          </div>
        </div>
        <div className="window-columns">
          <section>
            <h4>KNOWN CONDITION</h4>
            <ul>{contact.condition.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section>
            <h4>KNOWN FACTS</h4>
            <ul>{contact.knownFacts.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        </div>
        {person ? (
          <>
            <section className="person-pressure-record">
              <div><span>CURRENT PRESSURE</span><strong>{person.problem.title}</strong><small>{person.problem.detail}</small></div>
              <em>{person.problem.severity}%</em>
            </section>
            <section className="person-schedule-record">
              <h4>DAILY SCHEDULE</h4>
              <div>{person.schedule.map((block) => <span key={`${block.startHour}-${block.activity}`}>{String(block.startHour).padStart(2, "0")}:00 · {block.activity.toUpperCase()}</span>)}</div>
            </section>
            <section className="memory-record">
              <span>MEMORY / {person.memories.length} RECORDS</span>
              {person.memories.slice(0, 5).map((memory) => <p key={memory.id}>{formatGameDateTime(memory.timestamp)} · {memory.summary}</p>)}
              {!person.memories.length ? <p>Общих событий пока нет.</p> : null}
              <small>Доверие {person.trustToPlayer} · уважение {person.respectToPlayer} · раздражение {person.irritationToPlayer}</small>
            </section>
          </>
        ) : (
          <section className="memory-record">
            <span>LAST CONTACT / {contact.lastContact}</span>
            <p>Детальная запись человека пока не материализована.</p>
          </section>
        )}
      </div>
    );
  }

  if (id === "messages") {
    const contact = session.primaryContact;
    return (
      <div className="messages-window messages-window--empty">
        <aside>
          <button type="button" className="is-active"><strong>{contact.name}</strong><span>сегодня</span><small>Бытовой контакт</small></button>
          <button type="button"><strong>HOUSING NODE</strong><span>система</span><small>Жильё оплачено</small></button>
          <button type="button"><strong>MESHLINE</strong><span>система</span><small>Новые заказы на бирже</small></button>
        </aside>
        <section>
          <header><strong>INBOX</strong><span>NO ACTIVE STORY THREAD</span></header>
          <div className="empty-terminal">Новых личных сообщений нет. Каналы организаций будут обновляться по событиям мира.</div>
        </section>
      </div>
    );
  }

  if (id === "pressure") {
    return (
      <PressureWorkspace
        session={session}
        onAcceptRequest={onAcceptRequest}
        onDeclineRequest={onDeclineRequest}
        onCompleteRequest={onCompleteRequest}
        onTravel={onTravel}
        onPayObligation={onPayObligation}
        onRequestExtension={onRequestExtension}
        onBorrow={onBorrow}
      />
    );
  }

  if (id === "courier") {
    return <CourierWorkspace session={session} onAccept={onAcceptDelivery} onPickup={onPickupDelivery} onDeliver={onDeliverDelivery} onTravel={onTravel} />;
  }

  if (id === "food") {
    return <FoodTerminal session={session} onBuy={onBuyFood} onEat={onEatFood} onDiscard={onDiscardFood} onOrder={onOrderFood} onOpenPlaces={() => onOpenWindow("places")} />;
  }

  if (id === "places") {
    return <PlacesWorkspace session={session} onTravel={onTravel} onOpenWindow={onOpenWindow} buildingActions={buildingActions} vehicleActions={vehicleActions} transitActions={transitActions} />;
  }

  if (id === "home") {
    return <HomeWorkspace session={session} onSleep={onSleep} onOpenWindow={onOpenWindow} onTravel={onTravel} />;
  }

  if (id === "local") {
    return (
      <div className="local-window">
        <div className="feed-map local-window__map">
          <div className="feed-map__grid" />
          <span className="map-node map-node--player" style={{ left: "31%", top: "58%" }}>YOU</span>
          <span className="map-node map-node--contact" style={{ left: "73%", top: "36%" }}>{session.primaryContact.name.split(" ")[0]}</span>
          <span className="map-node map-node--alert" style={{ left: "52%", top: "72%" }}>POLICE</span>
          <div className="route-line" />
        </div>
        <DistrictPulseStrip state={session.district} />
        <div className="local-window__stats">
          <div><span>SECURITY</span><strong className="warning-text">{districtSecurityLabel(session.district.security)}</strong></div>
          <div><span>POWER GRID</span><strong>{powerGridLabel(session.district.powerGrid)}</strong></div>
          <div><span>TRANSIT</span><strong>+{session.district.transitDelayMinutes} MIN</strong></div>
        </div>
        <div className="local-window__feed">
          {session.events.filter((event) => event.category === "local").slice(0, 6).map((event) => (
            <MobileFeedRow
              key={event.id}
              time={formatGameTime(event.timestamp)}
              text={event.detail ? `${event.title} ${event.detail}` : event.title}
              warning={event.importance >= 3}
            />
          ))}
        </div>
      </div>
    );
  }

  if (id === "journal") {
    const visible = session.events.filter((event) => journalFilter === "all" || event.category === journalFilter);
    return (
      <div className="journal-window">
        <select value={journalFilter} onChange={(event: ChangeEvent<HTMLSelectElement>) => setJournalFilter(event.target.value as EventCategory | "all")}>
          <option value="all">ALL EVENTS</option>
          <option value="personal">PERSONAL</option>
          <option value="contact">CONTACT</option>
          <option value="work">WORK</option>
          <option value="finance">FINANCE</option>
          <option value="health">HEALTH</option>
          <option value="local">LOCAL</option>
          <option value="system">SYSTEM</option>
        </select>
        <div className="event-log">
          {visible.map((event) => (
            <article className={`event-row event-row--${event.category}`} key={event.id}>
              <time>{formatGameTime(event.timestamp)}</time>
              <span className="event-row__category">{event.category.toUpperCase()}</span>
              <div><strong>{event.title}</strong>{event.detail ? <p>{event.detail}</p> : null}</div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (id === "settings") {
    return (
      <div className="settings-window">
        <SettingToggle label="SCANLINES" detail="Лёгкий эффект дисплея поверх интерфейса." checked={settings.scanlines} onChange={(value) => setSettings({ ...settings, scanlines: value })} />
        <SettingToggle label="REDUCED MOTION" detail="Отключает сканирование, мигание и переходы." checked={settings.reducedMotion} onChange={(value) => setSettings({ ...settings, reducedMotion: value })} />
        <SettingToggle label="COMPACT MODE" detail="Уменьшает отступы и плотнее размещает данные." checked={settings.compactMode} onChange={(value) => setSettings({ ...settings, compactMode: value })} />
        <SettingToggle label="HIGH CONTRAST" detail="Усиливает границы, текст и сигнальные состояния." checked={settings.highContrast} onChange={(value) => setSettings({ ...settings, highContrast: value })} />

        <section className="save-slots">
          <header>
            <div><span>INDEXEDDB / WORLD SLOTS</span><strong>СОХРАНЕНИЯ</strong></div>
            <button type="button" className="button button--ghost" onClick={() => void saveController.saveNow()} disabled={saveController.status === "saving"}>
              {saveController.status === "saving" ? "SAVING..." : "SAVE NOW"}
            </button>
          </header>
          <div className="save-slots__list">
            {saveController.summaries.map((summary) => {
              const active = saveController.activeSlotId === summary.slotId;
              return (
                <article className={`save-slot ${active ? "is-active" : ""}`} key={summary.slotId}>
                  <div>
                    <span>{summary.slotId.toUpperCase()} {active ? "· ACTIVE" : ""}</span>
                    <strong>{summary.exists ? `${summary.playerName} / ${summary.cityName}` : "EMPTY SLOT"}</strong>
                    <small>{summary.updatedAt ? new Date(summary.updatedAt).toLocaleString("ru-RU") : "Нет сохранения"}</small>
                  </div>
                  <div className="save-slot__actions">
                    <button type="button" onClick={() => void saveController.switchSlot(summary.slotId as SaveSlotId)}>{summary.exists ? "LOAD" : "CREATE"}</button>
                    <button type="button" onClick={() => void saveController.createNewWorld(summary.slotId as SaveSlotId)}>NEW</button>
                    {summary.exists && !active ? <button type="button" onClick={() => void saveController.deleteSlot(summary.slotId as SaveSlotId)}>DELETE</button> : null}
                  </div>
                </article>
              );
            })}
          </div>
          <footer>
            <span>AUTOSAVE: {saveController.status.toUpperCase()}</span>
            <span>RECOVERY RECORDS: {saveController.recoveryCount}</span>
          </footer>
        </section>

        <div className="settings-version-card">
          <div>
            <span>APPLICATION VERSION</span>
            <strong>LOCAL v{versionGuard.localVersion}</strong>
            <small>REMOTE {versionGuard.remoteVersion ? `v${versionGuard.remoteVersion}` : "NOT CHECKED"} · {versionGuard.status.toUpperCase()}</small>
          </div>
          <button type="button" className="button button--ghost" onClick={() => void versionGuard.checkNow()} disabled={versionGuard.status === "checking"}>
            {versionGuard.status === "checking" ? "CHECKING..." : "CHECK UPDATE"}
          </button>
        </div>
        <div className="settings-danger-zone">
          <div><strong>ACTIVE WORLD</strong><span>Создать новый город и заменить активный слот.</span></div>
          <button type="button" className="button button--danger" onClick={onReset}>Новый мир</button>
        </div>
      </div>
    );
  }

  return (
    <div className="diagnostics-window">
      <div className="diagnostic-row"><span>UI SHELL</span><strong>ONLINE</strong><i>100%</i></div>
      <div className="diagnostic-row"><span>VERSION GUARD</span><strong>{versionGuard.status.toUpperCase()}</strong><i>{versionGuard.remoteVersion === versionGuard.localVersion ? "100%" : "CHECK"}</i></div>
      <div className="diagnostic-row"><span>PWA CACHE</span><strong>NETWORK FIRST</strong><i>100%</i></div>
      <div className="diagnostic-row"><span>WORLD PULSE</span><strong>ACTIVE</strong><i>{session.district.pulseCount}</i></div>
      <div className="diagnostic-row"><span>LOCAL ECONOMY</span><strong>{session.economy.businesses.some((business) => business.status === "closed") ? "DISRUPTED" : "ACTIVE"}</strong><i>{session.economy.businesses.filter((business) => business.status !== "stable").length}</i></div>
      <div className="diagnostic-row"><span>INDEXED DB</span><strong>{saveController.status === "error" ? "ERROR" : "CONNECTED"}</strong><i>{saveController.summaries.filter((slot) => slot.exists).length}/3</i></div>
      <pre>{`NEON/LINK DIAGNOSTIC\nBUILD: ${APP_VERSION}\nREMOTE: ${versionGuard.remoteVersion ?? "UNKNOWN"}\nWORLD: ${session.world.meta.worldId}\nDISTRICT PULSES: ${session.district.pulseCount}\nLOCAL EVENTS: ${session.events.filter((event) => event.category === "local").length}\nSAVE SLOT: ${saveController.activeSlotId}
SAVE STATUS: ${saveController.status.toUpperCase()}
RECOVERY: ${saveController.recoveryCount}
STATUS: ${versionGuard.status.toUpperCase()}`}</pre>
    </div>
  );
}

function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-toggle">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)} />
      <i />
    </label>
  );
}
