import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { MetropolitanSectorState } from "../../simulation/spatial/types";
import type { LocalActorState, LocalBuildingPresenceState } from "../../simulation/localScene/types";
import type { PhysicalVehicleEntityState } from "../../simulation/vehicles/types";
import { formatGameDate, formatGameTime } from "../../core/time/gameTime";
import { getTravelOptions } from "../../gameplay/travel/travelSystem";
import { Icon, type IconName } from "../../ui/components/Icons";

export interface MobileQuickAction {
  id: string;
  title: string;
  code: string;
  duration: number;
  cost: number;
  location: string;
  risk: "LOW" | "MED" | "HIGH";
  result: string;
  targetLocationId?: string;
}

export interface MobilePlanItem {
  time: string;
  title: string;
  status: string;
  detail: string;
}

interface MobileExperienceProps {
  session: GameSession;
  actions: MobileQuickAction[];
  plans: MobilePlanItem[];
  onAction: (action: MobileQuickAction) => void;
  onTravel: (locationId: string) => void;
  onSelectPerson: (personId: string) => void;
  onOpenSettings: () => void;
  onAdvance: (minutes: number, source?: string) => void;
  onApproachBuilding: (buildingId: string) => void;
  onEnterBuilding: (buildingId: string, entrance?: "public" | "service") => void;
  onApproachVehicle: (vehicleId: string) => void;
  onEnterVehicle: (vehicleId: string) => void;
}

type MobileView = "home" | "profile" | "map" | "nearby" | "move";
type MapMode = "global" | "local";
type NearbyMode = "people" | "places" | "cars" | "events";
type NoticeTone = "neutral" | "good" | "warn";

interface NoticeState {
  text: string;
  tone: NoticeTone;
}

interface MapLayers {
  transit: boolean;
  traffic: boolean;
  districts: boolean;
}

const ASSET_BASE = `${import.meta.env.BASE_URL}ui/`;
const PERSON_ASSETS = ["npc-01.webp", "npc-02.webp", "npc-03.webp", "npc-04.webp"] as const;
const STREET_NAMES = [
  "Neon Ave",
  "Pulse St",
  "Flux Way",
  "Lumen Ct",
  "Echo St",
  "Rift Blvd",
  "Shadow Alley",
  "Glitch Rd"
] as const;
const PLACE_ICONS: Record<LocationState["type"], string> = {
  housing: "⌂",
  food: "☕",
  workshop: "⌁",
  transport: "▣",
  clinic: "✚",
  office: "◫",
  market: "◇",
  government: "◆",
  education: "◉"
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function asset(name: string): string {
  return `${ASSET_BASE}${name}`;
}

function personAssetById(personId: string): string {
  return asset(PERSON_ASSETS[hashText(personId) % PERSON_ASSETS.length]);
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString("ru-RU");
}

function currentActivity(session: GameSession): string {
  if (session.localScene.playerPosition.state === "vehicle") return "В машине";
  if (session.localScene.playerPosition.state === "in-transit") return "В пути";
  if (session.buildingAccess.player.level !== "street") return "Внутри здания";
  return session.currentActivity || "Изучает район";
}

function identityLabel(session: GameSession): string {
  const occupation = session.player.occupation.trim();
  const normalized = occupation.toUpperCase();
  if (!occupation || normalized === "UNEMPLOYED" || normalized.includes("COURIER")) {
    return "Независимый житель";
  }
  return occupation;
}

function districtName(session: GameSession, districtId = session.world.activeDistrictId): string {
  return session.world.districts.find((district) => district.id === districtId)?.name ?? session.player.district;
}

function actorActivityIcon(actor: LocalActorState): string {
  if (actor.activity === "commute") return "🚌";
  if (actor.activity === "work") return "🛠";
  if (actor.activity === "medical") return "✚";
  if (actor.activity === "school") return "▣";
  if (actor.activity === "home") return "⌂";
  return "◉";
}

function vehicleStateLabel(vehicle: PhysicalVehicleEntityState): string {
  if (vehicle.state === "parked") return "Припаркована";
  if (vehicle.state === "moving") return "В движении";
  if (vehicle.state === "occupied") return "Занята";
  if (vehicle.state === "service") return "На обслуживании";
  return "Неисправна";
}

function buildingUseLabel(building: LocalBuildingPresenceState): string {
  const labels: Record<string, string> = {
    residential: "Жилой дом",
    retail: "Магазин",
    office: "Офисы",
    industrial: "Промышленный объект",
    medical: "Медицина",
    education: "Учебное здание",
    transport: "Транспортный объект",
    hospitality: "Заведение",
    government: "Государственный объект",
    mixed: "Смешанное здание",
    utility: "Инфраструктура"
  };
  return labels[building.use] ?? building.use;
}

function Metric({
  icon,
  label,
  value,
  tone = "neutral",
  progress
}: {
  icon: string;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "danger";
  progress?: number;
}) {
  return (
    <div className={`nlm-metric nlm-tone-${tone}`}>
      <span className="nlm-metric__label"><i>{icon}</i>{label}</span>
      <strong>{value}</strong>
      {progress !== undefined ? <span className="nlm-meter"><i style={{ width: `${clamp(progress)}%` }} /></span> : null}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  action,
  onAction
}: {
  icon: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <header className="nlm-section-title">
      <h2><span>{icon}</span>{title}</h2>
      {action && onAction ? <button type="button" onClick={onAction}>{action}<b>›</b></button> : null}
    </header>
  );
}

function MobileHeader({
  session,
  title,
  subtitle,
  onSettings
}: {
  session: GameSession;
  title?: string;
  subtitle?: string;
  onSettings: () => void;
}) {
  return (
    <header className="nlm-header">
      <div className="nlm-header__brand">
        <strong>NEON <em>LIFE</em></strong>
        <span>⌖ {districtName(session)}</span>
      </div>
      <div className="nlm-header__status">
        <div><span>☁ {session.world.city.temperatureC}°C</span><button type="button" onClick={onSettings} aria-label="Открыть настройки">⚙</button></div>
        <span>{formatGameDate(session.timestamp)}, <em>{formatGameTime(session.timestamp)}</em></span>
        <strong>▣ ₵ {session.player.balance.toLocaleString("ru-RU")}</strong>
      </div>
      {title ? <div className="nlm-page-heading"><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div> : null}
    </header>
  );
}

function BottomNav({ view, onChange }: { view: MobileView; onChange: (view: MobileView) => void }) {
  const items: Array<{ id: MobileView; label: string; icon: IconName }> = [
    { id: "home", label: "Главная", icon: "home" },
    { id: "profile", label: "Профиль", icon: "people" },
    { id: "map", label: "Карта", icon: "city" },
    { id: "nearby", label: "Рядом", icon: "network" },
    { id: "move", label: "Путь", icon: "pin" }
  ];
  return (
    <nav className="nlm-bottom-nav" aria-label="Мобильная навигация">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={view === item.id ? "is-active" : ""}
          aria-current={view === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          <i><Icon name={item.icon} size={22} /></i>
          <span>{item.label}</span>
        </button>
      ))}
      <div className="nlm-home-indicator" />
    </nav>
  );
}

function EmptyState({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <div className="nlm-empty"><i>{icon}</i><strong>{title}</strong><span>{detail}</span></div>;
}

function HomeView({
  session,
  plans,
  actions,
  onAction,
  onTravel,
  onNavigate,
  onOpenMap,
  onSettings,
  notify
}: {
  session: GameSession;
  plans: MobilePlanItem[];
  actions: MobileQuickAction[];
  onAction: (action: MobileQuickAction) => void;
  onTravel: (locationId: string) => void;
  onNavigate: (view: MobileView) => void;
  onOpenMap: (mode: MapMode) => void;
  onSettings: () => void;
  notify: (text: string, tone?: NoticeTone) => void;
}) {
  const player = session.player;
  const activeCourier = session.jobs.courier.orders.find((order) => order.status === "accepted" || order.status === "in-transit");
  const activeRequest = session.pressure.requests.find((request) => request.status === "accepted");
  const activeCourierTargetId = activeCourier
    ? activeCourier.status === "accepted" ? activeCourier.pickupLocationId : activeCourier.dropoffLocationId
    : undefined;
  const objective = activeCourier
    ? {
        title: activeCourier.status === "accepted" ? `Забрать: ${activeCourier.cargoName}` : `Передать: ${activeCourier.cargoName}`,
        detail: activeCourier.requestNote,
        location: session.world.locations.find((item) => item.id === activeCourierTargetId)?.name ?? "Город",
        reward: activeCourier.payout,
        targetLocationId: activeCourierTargetId,
        action: undefined as MobileQuickAction | undefined
      }
    : activeRequest
      ? {
          title: activeRequest.title,
          detail: activeRequest.detail,
          location: session.world.locations.find((item) => item.id === activeRequest.targetLocationId)?.name ?? "Район",
          reward: activeRequest.reward,
          targetLocationId: activeRequest.targetLocationId,
          action: undefined as MobileQuickAction | undefined
        }
      : {
          title: actions[0]?.title ?? "Осмотреть район",
          detail: actions[0]?.result ?? "Изучи улицы, людей и возможности рядом.",
          location: actions[0]?.location ?? districtName(session),
          reward: 0,
          targetLocationId: actions[0]?.targetLocationId,
          action: actions[0]
        };
  const reputation = Math.round(
    session.people.people.reduce((sum, person) => sum + person.respectToPlayer, 0)
      / Math.max(1, session.people.people.length) * 25
  );
  const createdAt = Date.parse(session.world.meta.createdAt);
  const day = Number.isFinite(createdAt)
    ? Math.max(1, Math.floor((session.timestamp - createdAt) / 86_400_000) + 1)
    : 1;

  function runObjective(): void {
    if (objective.targetLocationId && objective.targetLocationId !== session.life.currentLocationId) {
      onTravel(objective.targetLocationId);
      notify(`Маршрут построен: ${objective.location}`, "good");
      return;
    }
    if (objective.action) {
      onAction(objective.action);
      notify(objective.action.result, "good");
      return;
    }
    onNavigate("nearby");
  }

  return (
    <div className="nlm-view nlm-home-view">
      <MobileHeader session={session} onSettings={onSettings} />

      <section className="nlm-card nlm-identity-card">
        <img className="nlm-player-photo" src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} />
        <div className="nlm-identity-card__body">
          <div className="nlm-identity-card__title">
            <div><h1>{player.name}</h1><span><i />{currentActivity(session)}</span></div>
            <div><small>Репутация</small><strong>★ {reputation}</strong><span>Город знает тебя</span></div>
          </div>
          <p>{identityLabel(session)}. Решения, связи и обязательства формируют твою жизнь.</p>
        </div>
        <div className="nlm-identity-stats">
          <Metric icon="▥" label="Возраст" value={`${player.age}`} />
          <Metric icon="♥" label="Здоровье" value={`${player.condition.health}%`} />
          <Metric icon="▦" label="Сектор" value={player.sector} />
          <Metric icon="◷" label="День" value={`${day}`} />
        </div>
      </section>

      <section className="nlm-card nlm-list-card">
        <SectionTitle icon="▣" title="Сегодня" action="Маршруты" onAction={() => onNavigate("move")} />
        <div className="nlm-agenda-list">
          {plans.slice(0, 3).map((item, index) => (
            <button type="button" key={`${item.title}-${index}`} onClick={() => onNavigate("move")}>
              <i>{index === 0 ? "👥" : index === 1 ? "⚡" : "⌖"}</i>
              <div><strong>{item.title}</strong><span>{item.detail}</span></div>
              <time>{item.time}</time><b>›</b>
            </button>
          ))}
          {!plans.length ? (
            <button type="button" onClick={() => onNavigate("nearby")}>
              <i>⌁</i><div><strong>Свободный график</strong><span>Выбери действие или изучи район.</span></div><time>Сейчас</time><b>›</b>
            </button>
          ) : null}
        </div>
      </section>

      <section className="nlm-card nlm-condition-card">
        <SectionTitle icon="♡" title="Состояние" />
        <div className="nlm-condition-grid">
          <Metric icon="♥" label="Здоровье" value={`${player.condition.health}%`} tone={player.condition.health > 65 ? "good" : "warn"} progress={player.condition.health} />
          <Metric icon="ϟ" label="Энергия" value={`${100 - player.condition.fatigue}%`} tone={player.condition.fatigue < 65 ? "warn" : "danger"} progress={100 - player.condition.fatigue} />
          <Metric icon="◉" label="Стресс" value={`${player.condition.stress}%`} tone={player.condition.stress < 45 ? "good" : "warn"} progress={player.condition.stress} />
          <Metric icon="◐" label="Голод" value={`${player.condition.hunger}%`} tone={player.condition.hunger < 45 ? "warn" : "danger"} progress={player.condition.hunger} />
        </div>
      </section>

      <section className="nlm-card nlm-objective-card">
        <SectionTitle icon="◉" title="Сейчас" action="Сменить" onAction={() => onNavigate("nearby")} />
        <div className="nlm-objective-card__body">
          <div className="nlm-objective-visual"><span>⌖</span><i /><b /></div>
          <div className="nlm-objective-copy">
            <h2>{objective.title}</h2>
            <span>⌖ {objective.location}</span>
            <p>{objective.detail}</p>
            <footer><strong>{objective.reward ? `₵ ${objective.reward}` : "Личная цель"}</strong><button type="button" onClick={runObjective}>Открыть ›</button></footer>
          </div>
        </div>
      </section>

      <section className="nlm-card nlm-quick-card">
        <SectionTitle icon="ϟ" title="Быстрый доступ" />
        <div className="nlm-quick-grid">
          <button type="button" onClick={() => onOpenMap("global")}><i>◎</i><strong>Глобальная</strong><span>{session.metropolitan.totals.sectors} секторов</span></button>
          <button type="button" onClick={() => onOpenMap("local")}><i>⌘</i><strong>Локальная</strong><span>Улицы сектора</span></button>
          <button type="button" onClick={() => onNavigate("nearby")}><i>◉</i><strong>Рядом</strong><span>Люди и места</span></button>
          <button type="button" onClick={() => onNavigate("profile")}><i>♙</i><strong>Профиль</strong><span>Состояние и связи</span></button>
        </div>
      </section>
    </div>
  );
}

function ProfileView({
  session,
  onSettings,
  onSelectPerson,
  notify
}: {
  session: GameSession;
  onSettings: () => void;
  onSelectPerson: (personId: string) => void;
  notify: (text: string, tone?: NoticeTone) => void;
}) {
  const player = session.player;
  const relations = [...session.people.people].sort((left, right) => right.trustToPlayer - left.trustToPlayer).slice(0, 3);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const selectedRelation = session.people.people.find((person) => person.id === selectedRelationId);
  const vehicle = session.vehicles.vehicles.find((item) => item.id === session.vehicles.player.ownedVehicleIds[0]);
  const activeObligations = session.pressure.obligations.filter((item) => item.status === "active" || item.status === "overdue").length;
  const activeRequests = session.pressure.requests.filter((item) => item.status === "accepted").length;
  const traits = [
    ["♥", "Форма", player.condition.health >= 80 ? "Здоровье в норме." : "Нужно восстановление."],
    ["ϟ", "Энергия", player.condition.fatigue < 55 ? "Запас сил высокий." : "Накопилась усталость."],
    ["♙", "Связи", `${session.people.people.length} известных людей.`],
    ["▣", "Обязательства", `${activeObligations + activeRequests} активных.`],
    ["◉", "Окружение", `${session.localScene.totals.visibleActors} людей видно рядом.`],
    ["▰", "Транспорт", `${session.vehicles.player.keyVehicleIds.length} доступных машин.`]
  ];
  const reputation = Math.round(
    session.people.people.reduce((sum, person) => sum + person.respectToPlayer, 0)
      / Math.max(1, session.people.people.length) * 25
  );

  function selectRelation(personId: string, name: string): void {
    setSelectedRelationId((current) => current === personId ? null : personId);
    onSelectPerson(personId);
    notify(`Открыт профиль: ${name}`, "good");
  }

  return (
    <div className="nlm-view nlm-profile-view">
      <MobileHeader session={session} title="Профиль" subtitle="Личность, состояние и место в городе." onSettings={onSettings} />
      <section className="nlm-card nlm-profile-hero">
        <img src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} />
        <div className="nlm-profile-hero__identity">
          <h2>{player.name}</h2>
          <strong>{identityLabel(session)}</strong>
          <span><i />{currentActivity(session)}</span>
          <p>{districtName(session)} · {player.sector}</p>
        </div>
        <div className="nlm-profile-hero__rep"><small>Репутация</small><strong>★ {reputation}</strong><span>Локальная</span></div>
        <div className="nlm-profile-summary">
          <Metric icon="▥" label="Возраст" value={`${player.age}`} />
          <Metric icon="★" label="Связи" value={`${session.people.people.length}`} />
          <Metric icon="▰" label="Авто" value={`${session.vehicles.player.ownedVehicleIds.length}`} />
          <Metric icon="▦" label="Жильё" value={`${player.housingDaysLeft} дн.`} />
        </div>
      </section>

      <section className="nlm-card nlm-traits-card">
        <SectionTitle icon="◉" title="Сводка профиля" />
        <div className="nlm-traits-grid">
          {traits.map(([icon, title, text]) => <article key={title}><i>{icon}</i><div><strong>{title}</strong><span>{text}</span></div></article>)}
        </div>
      </section>

      <section className="nlm-card nlm-condition-card">
        <SectionTitle icon="♡" title="Состояние" />
        <div className="nlm-condition-grid">
          <Metric icon="♥" label="Здоровье" value={`${player.condition.health}%`} tone="good" progress={player.condition.health} />
          <Metric icon="ϟ" label="Выносливость" value={`${100 - player.condition.fatigue}%`} tone="warn" progress={100 - player.condition.fatigue} />
          <Metric icon="◉" label="Стресс" value={`${player.condition.stress}%`} tone="good" progress={player.condition.stress} />
          <Metric icon="◐" label="Голод" value={`${player.condition.hunger}%`} tone="warn" progress={player.condition.hunger} />
        </div>
      </section>

      <section className="nlm-card nlm-access-card">
        <SectionTitle icon="▣" title="Инвентарь и доступ" />
        <div className="nlm-access-grid">
          <span><i>▯</i><strong>Телефон</strong><small>Сеть {session.world.city.networkStatus}</small></span>
          <span><i>⚿</i><strong>Ключи</strong><small>{session.vehicles.player.keyVehicleIds.length} транспорта</small></span>
          <span><i>▣</i><strong>Жильё</strong><small>{player.housingDaysLeft} дней</small></span>
          <span><i>▰</i><strong>Машина</strong><small>{vehicle?.modelName ?? "Нет"}</small></span>
        </div>
      </section>

      <section className="nlm-card nlm-connections-card">
        <SectionTitle icon="♙" title="Связи и обязательства" />
        {relations.map((person) => (
          <button type="button" className={selectedRelationId === person.id ? "is-selected" : ""} key={person.id} onClick={() => selectRelation(person.id, person.name)}>
            <img src={personAssetById(person.id)} alt={`Портрет ${person.name}`} />
            <div><strong>{person.name}</strong><span>{person.roleLabel}</span></div>
            <em className={person.trustToPlayer > 60 ? "is-good" : ""}>● {person.trustToPlayer > 60 ? "Доверяет" : "Знакомый"}</em>
            <small>{person.problem.title}</small><b>{selectedRelationId === person.id ? "⌃" : "›"}</b>
          </button>
        ))}
        {selectedRelation ? (
          <article className="nlm-connection-detail">
            <img src={personAssetById(selectedRelation.id)} alt={`Портрет ${selectedRelation.name}`} />
            <div>
              <header><div><h3>{selectedRelation.name}</h3><span>{selectedRelation.status}</span></div><button type="button" onClick={() => setSelectedRelationId(null)} aria-label="Закрыть профиль">×</button></header>
              <p>{selectedRelation.problem.detail}</p>
              <dl>
                <div><dt>Доверие</dt><dd>{selectedRelation.trustToPlayer}%</dd></div>
                <div><dt>Уважение</dt><dd>{selectedRelation.respectToPlayer}%</dd></div>
                <div><dt>Стресс</dt><dd>{selectedRelation.stress}%</dd></div>
              </dl>
              <small>{selectedRelation.knownFacts[0] ?? "Подробности пока неизвестны."}</small>
            </div>
          </article>
        ) : null}
      </section>
    </div>
  );
}

function drawGlobalMap(
  canvas: HTMLCanvasElement,
  session: GameSession,
  selectedId: string,
  layers: MapLayers
): void {
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
  canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(ratio, ratio);
  context.fillStyle = "#070c14";
  context.fillRect(0, 0, bounds.width, bounds.height);

  const padding = 14;
  const cellW = (bounds.width - padding * 2) / session.metropolitan.config.sectorsWide;
  const cellH = (bounds.height - padding * 2) / session.metropolitan.config.sectorsHigh;
  const districtIndex = new Map(session.world.districts.map((district, index) => [district.id, index]));
  const palette = ["#141d2b", "#111b25", "#171a27", "#151b24", "#121923", "#181923"];
  const sectorsByCoordinate = new Map<string, MetropolitanSectorState>();

  for (const sector of session.metropolitan.sectors) {
    sectorsByCoordinate.set(`${sector.xIndex}:${sector.yIndex}`, sector);
    const x = padding + sector.xIndex * cellW;
    const y = padding + sector.yIndex * cellH;
    const selected = sector.id === selectedId;
    const district = districtIndex.get(sector.districtId) ?? 0;
    context.fillStyle = selected ? "#ff354e" : sector.detailLevel === "active" ? "#27364a" : palette[district % palette.length];
    context.fillRect(x + 0.55, y + 0.55, Math.max(0.6, cellW - 1.1), Math.max(0.6, cellH - 1.1));
    if (layers.traffic && sector.trafficLoad > 75 && cellW > 3) {
      context.fillStyle = "rgba(255,172,52,.62)";
      context.fillRect(x + cellW * 0.3, y + cellH * 0.3, Math.max(1, cellW * 0.4), Math.max(1, cellH * 0.4));
    }
  }

  const nodeById = new Map(session.metropolitan.roadNodes.map((node) => [node.id, node]));
  context.lineCap = "round";
  for (const link of session.metropolitan.roadLinks) {
    if (link.class === "local") continue;
    const from = nodeById.get(link.fromNodeId);
    const to = nodeById.get(link.toNodeId);
    if (!from || !to) continue;
    context.beginPath();
    context.moveTo(
      padding + from.xM / session.metropolitan.config.widthM * (bounds.width - padding * 2),
      padding + from.yM / session.metropolitan.config.heightM * (bounds.height - padding * 2)
    );
    context.lineTo(
      padding + to.xM / session.metropolitan.config.widthM * (bounds.width - padding * 2),
      padding + to.yM / session.metropolitan.config.heightM * (bounds.height - padding * 2)
    );
    context.strokeStyle = link.class === "expressway" ? "rgba(185,202,226,.32)" : "rgba(126,149,180,.18)";
    context.lineWidth = link.class === "expressway" ? 1.25 : 0.7;
    context.stroke();
  }

  if (layers.districts) {
    context.beginPath();
    for (const sector of session.metropolitan.sectors) {
      const x = padding + sector.xIndex * cellW;
      const y = padding + sector.yIndex * cellH;
      const left = sectorsByCoordinate.get(`${sector.xIndex - 1}:${sector.yIndex}`);
      const top = sectorsByCoordinate.get(`${sector.xIndex}:${sector.yIndex - 1}`);
      if (!left || left.districtId !== sector.districtId) {
        context.moveTo(x, y);
        context.lineTo(x, y + cellH);
      }
      if (!top || top.districtId !== sector.districtId) {
        context.moveTo(x, y);
        context.lineTo(x + cellW, y);
      }
    }
    context.strokeStyle = "rgba(203,214,232,.46)";
    context.lineWidth = 0.85;
    context.stroke();
  }

  if (layers.transit) {
    for (const station of session.metropolitan.transitStations) {
      const x = padding + station.xM / session.metropolitan.config.widthM * (bounds.width - padding * 2);
      const y = padding + station.yM / session.metropolitan.config.heightM * (bounds.height - padding * 2);
      context.beginPath();
      context.arc(x, y, 1.55, 0, Math.PI * 2);
      context.fillStyle = "rgba(57,170,247,.9)";
      context.fill();
    }
  }

  const selected = session.metropolitan.sectors.find((sector) => sector.id === selectedId);
  if (selected) {
    const x = padding + selected.xIndex * cellW + cellW / 2;
    const y = padding + selected.yIndex * cellH + cellH / 2;
    context.beginPath();
    context.arc(x, y, Math.max(7, Math.min(cellW, cellH) * 2.4), 0, Math.PI * 2);
    context.strokeStyle = "rgba(255,53,78,.92)";
    context.lineWidth = 2;
    context.stroke();
  }
}

function GlobalMapCanvas({
  session,
  selectedId,
  layers,
  onSelect
}: {
  session: GameSession;
  selectedId: string;
  layers: MapLayers;
  onSelect: (sector: MetropolitanSectorState) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => drawGlobalMap(canvas, session, selectedId, layers);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [session, selectedId, layers]);

  function select(event: ReactMouseEvent<HTMLCanvasElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    const padding = 14;
    const cellW = (bounds.width - padding * 2) / session.metropolitan.config.sectorsWide;
    const cellH = (bounds.height - padding * 2) / session.metropolitan.config.sectorsHigh;
    const xIndex = Math.floor((event.clientX - bounds.left - padding) / cellW);
    const yIndex = Math.floor((event.clientY - bounds.top - padding) / cellH);
    const sector = session.metropolitan.sectors.find((item) => item.xIndex === xIndex && item.yIndex === yIndex);
    if (sector) onSelect(sector);
  }

  return <canvas className="nlm-global-canvas" ref={ref} onClick={select} aria-label="Глобальная карта города" />;
}

function localLayout(seed: string) {
  const hash = hashText(seed);
  return {
    x1: 27 + hash % 9,
    x2: 62 + (hash >> 4) % 9,
    y1: 27 + (hash >> 8) % 9,
    y2: 61 + (hash >> 12) % 9
  };
}

function LocalSectorMap({
  session,
  sector,
  onLocation
}: {
  session: GameSession;
  sector: MetropolitanSectorState;
  onLocation: (location: LocationState) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [showDetails, setShowDetails] = useState(true);
  const layout = localLayout(sector.seed);
  const buildings = session.urban.buildings.filter((item) => item.sectorId === sector.id).slice(0, 18);
  const position = session.localScene.playerPosition;
  const playerIsHere = sector.id === position.sectorId;
  const px = playerIsHere ? clamp((position.xM - sector.bounds.xM) / sector.bounds.widthM * 100, 5, 95) : 50;
  const py = playerIsHere ? clamp((position.yM - sector.bounds.yM) / sector.bounds.heightM * 100, 5, 95) : 50;
  const viewSize = 100 / zoom;
  const viewX = clamp(px - viewSize / 2, 0, 100 - viewSize);
  const viewY = clamp(py - viewSize / 2, 0, 100 - viewSize);
  useEffect(() => {
    setZoom(1);
    setShowDetails(true);
  }, [sector.id]);

  const fallback = [
    [4, 6, layout.x1 - 8, layout.y1 - 10],
    [layout.x1 + 4, 6, layout.x2 - layout.x1 - 8, layout.y1 - 10],
    [layout.x2 + 4, 6, 94 - layout.x2, layout.y1 - 10],
    [4, layout.y1 + 4, layout.x1 - 8, layout.y2 - layout.y1 - 8],
    [layout.x1 + 4, layout.y1 + 4, layout.x2 - layout.x1 - 8, layout.y2 - layout.y1 - 8],
    [layout.x2 + 4, layout.y1 + 4, 94 - layout.x2, layout.y2 - layout.y1 - 8],
    [4, layout.y2 + 4, layout.x1 - 8, 94 - layout.y2],
    [layout.x1 + 4, layout.y2 + 4, layout.x2 - layout.x1 - 8, 94 - layout.y2],
    [layout.x2 + 4, layout.y2 + 4, 94 - layout.x2, 94 - layout.y2]
  ];
  const locations = session.world.locations
    .filter((location) => session.metropolitan.locations.find((item) => item.locationId === location.id)?.sectorId === sector.id)
    .slice(0, 6);

  return (
    <div className="nlm-local-map">
      <svg viewBox={`${viewX} ${viewY} ${viewSize} ${viewSize}`} role="img" aria-label={`Улицы сектора ${sector.code}`}>
        <defs>
          <pattern id={`grid-${sector.id}`} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M4 0H0V4" fill="none" stroke="rgba(105,131,162,.08)" strokeWidth=".35" /></pattern>
          <filter id={`glow-${sector.id}`}><feGaussianBlur stdDeviation="1.4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width="100" height="100" fill={`url(#grid-${sector.id})`} />
        {(buildings.length ? buildings.map((building) => {
          const x = clamp((building.bounds.xM - sector.bounds.xM) / sector.bounds.widthM * 100, 3, 92);
          const y = clamp((building.bounds.yM - sector.bounds.yM) / sector.bounds.heightM * 100, 3, 92);
          const width = clamp(building.bounds.widthM / sector.bounds.widthM * 100, 4, 24);
          const height = clamp(building.bounds.heightM / sector.bounds.heightM * 100, 4, 24);
          return <rect key={building.id} x={x} y={y} width={width} height={height} rx="1.5" className="nlm-map-building" />;
        }) : fallback.map(([x, y, width, height], index) => <rect key={index} x={x} y={y} width={width} height={height} rx="1.5" className="nlm-map-building" />))}
        <path d={`M${layout.x1} 0V100M${layout.x2} 0V100M0 ${layout.y1}H100M0 ${layout.y2}H100`} className="nlm-map-road" />
        <path d={`M${layout.x1 - 1.2} 0V100M${layout.x1 + 1.2} 0V100M${layout.x2 - 1.2} 0V100M${layout.x2 + 1.2} 0V100M0 ${layout.y1 - 1.2}H100M0 ${layout.y1 + 1.2}H100M0 ${layout.y2 - 1.2}H100M0 ${layout.y2 + 1.2}H100`} className="nlm-map-curb" />
        {showDetails ? (
          <>
            <text x="50" y={layout.y1 - 2.2} textAnchor="middle">{STREET_NAMES[hashText(sector.seed) % STREET_NAMES.length]}</text>
            <text x="50" y={layout.y2 - 2.2} textAnchor="middle">{STREET_NAMES[(hashText(sector.seed) + 3) % STREET_NAMES.length]}</text>
            <text x={layout.x1 - 2.2} y="50" textAnchor="middle" transform={`rotate(-90 ${layout.x1 - 2.2} 50)`}>{STREET_NAMES[(hashText(sector.seed) + 1) % STREET_NAMES.length]}</text>
            <text x={layout.x2 - 2.2} y="50" textAnchor="middle" transform={`rotate(-90 ${layout.x2 - 2.2} 50)`}>{STREET_NAMES[(hashText(sector.seed) + 5) % STREET_NAMES.length]}</text>
          </>
        ) : null}
        {showDetails ? locations.map((location, index) => {
          const spatial = session.metropolitan.locations.find((item) => item.locationId === location.id);
          const x = spatial ? clamp((spatial.bounds.xM - sector.bounds.xM) / sector.bounds.widthM * 100, 8, 92) : [15, 80, 18, 78, 50, 34][index];
          const y = spatial ? clamp((spatial.bounds.yM - sector.bounds.yM) / sector.bounds.heightM * 100, 8, 92) : [15, 18, 75, 73, 30, 50][index];
          return (
            <g
              key={location.id}
              className={`nlm-map-poi nlm-map-poi--${location.type}`}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              onClick={() => onLocation(location)}
            >
              <circle r="4.3" /><text textAnchor="middle" y="1.7">{PLACE_ICONS[location.type]}</text>
            </g>
          );
        }) : null}
        {playerIsHere ? <g transform={`translate(${px} ${py})`} className="nlm-player-marker" filter={`url(#glow-${sector.id})`}><circle r="5.5" /><path d="M0-3.2 2.7 2.5 0 1.3-2.7 2.5z" /></g> : null}
      </svg>
      <div className="nlm-map-controls">
        <button type="button" aria-label="Приблизить" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>＋</button>
        <button type="button" aria-label="Отдалить" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))}>−</button>
        <button type="button" aria-label="Переключить подписи" className={showDetails ? "is-active" : ""} onClick={() => setShowDetails((value) => !value)}>▱</button>
      </div>
    </div>
  );
}

function MapView({
  session,
  mode,
  setMode,
  onTravel,
  onApproachBuilding,
  onSettings,
  notify
}: {
  session: GameSession;
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  onTravel: (locationId: string) => void;
  onApproachBuilding: (buildingId: string) => void;
  onSettings: () => void;
  notify: (text: string, tone?: NoticeTone) => void;
}) {
  const [selectedId, setSelectedId] = useState(session.metropolitan.streaming.focusSectorId);
  const [layers, setLayers] = useState<MapLayers>({ transit: true, traffic: true, districts: true });
  useEffect(() => {
    setSelectedId(session.metropolitan.streaming.focusSectorId);
  }, [session.metropolitan.streaming.focusSectorId]);

  const selected = session.metropolitan.sectors.find((sector) => sector.id === selectedId) ?? session.metropolitan.sectors[0];
  const district = session.world.districts.find((item) => item.id === selected.districtId);
  const spatialLocations = session.metropolitan.locations.filter((item) => item.sectorId === selected.id);
  const locations = spatialLocations
    .map((item) => session.world.locations.find((location) => location.id === item.locationId))
    .filter((location): location is LocationState => Boolean(location))
    .slice(0, 6);
  const destination = locations[0] ?? session.world.locations.find((location) => location.districtId === selected.districtId);
  const playerPosition = session.localScene.playerPosition;
  const localBuildings = selected.id === playerPosition.sectorId
    ? [...session.localScene.buildings].sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM).slice(0, 6)
    : [];

  function locationDistance(locationId: string): string {
    const spatial = spatialLocations.find((item) => item.locationId === locationId);
    if (!spatial || playerPosition.sectorId !== selected.id) return "в секторе";
    const centerX = spatial.bounds.xM + spatial.bounds.widthM / 2;
    const centerY = spatial.bounds.yM + spatial.bounds.heightM / 2;
    return `${Math.round(Math.hypot(centerX - playerPosition.xM, centerY - playerPosition.yM))} м`;
  }

  function travel(location: LocationState): void {
    onTravel(location.id);
    notify(`Перемещение: ${location.name}`, "good");
  }

  function selectSector(sector: MetropolitanSectorState): void {
    setSelectedId(sector.id);
    notify(`Выбран сектор ${sector.code}`);
  }

  return (
    <div className="nlm-view nlm-map-view">
      <MobileHeader session={session} onSettings={onSettings} />
      <div className="nlm-segmented">
        <button type="button" className={mode === "global" ? "is-active" : ""} onClick={() => setMode("global")}>Глобальная</button>
        <button type="button" className={mode === "local" ? "is-active" : ""} onClick={() => setMode("local")}>Локальная</button>
      </div>

      {mode === "global" ? (
        <>
          <header className="nlm-map-heading">
            <div><h1>Карта города</h1><p>{session.world.city.name} · вся городская сетка</p></div>
            <div><span><b>{session.world.districts.length}</b> районов</span><span><b>{session.metropolitan.totals.sectors}</b> секторов</span><span><b>{compact(session.metropolitan.totals.representedPopulation)}</b> жителей</span></div>
          </header>
          <section className="nlm-card nlm-map-canvas-card">
            <GlobalMapCanvas session={session} selectedId={selected.id} layers={layers} onSelect={selectSector} />
            <div className="nlm-map-legend">
              <button type="button" className={layers.transit ? "is-blue is-active" : "is-blue"} onClick={() => setLayers((value) => ({ ...value, transit: !value.transit }))}>▣ Транспорт</button>
              <button type="button" className={layers.traffic ? "is-amber is-active" : "is-amber"} onClick={() => setLayers((value) => ({ ...value, traffic: !value.traffic }))}>◇ Трафик</button>
              <button type="button" className={layers.districts ? "is-red is-active" : "is-red"} onClick={() => setLayers((value) => ({ ...value, districts: !value.districts }))}>▱ Районы</button>
            </div>
          </section>
          <section className="nlm-card nlm-sector-card">
            <header>
              <div><b>{selected.code.replace(/[^0-9]/g, "").slice(-3) || selected.code.slice(-3)}</b><span><strong>Сектор {selected.code}</strong><small>⌖ {district?.name ?? "Город"}</small><em>● {selected.detailLevel === "active" ? "Активный" : "Фоновый"}</em></span></div>
              {destination ? <button type="button" onClick={() => travel(destination)}>⌁ Маршрут</button> : null}
            </header>
            <div className="nlm-sector-stats">
              <Metric icon="♙" label="Жители" value={compact(selected.representedPopulation)} />
              <Metric icon="↗" label="Активность" value={selected.crowdLoad > 65 ? "Высокая" : selected.crowdLoad > 35 ? "Средняя" : "Низкая"} />
              <Metric icon="▰" label="Трафик" value={`${selected.trafficLoad}%`} tone={selected.trafficLoad > 75 ? "danger" : "neutral"} />
              <Metric icon="▦" label="Здания" value={compact(selected.buildingEstimate)} />
            </div>
          </section>
          <section className="nlm-card nlm-poi-list">
            <SectionTitle icon="⌖" title="Точки сектора" action="Локальная карта" onAction={() => setMode("local")} />
            {locations.map((location) => (
              <button type="button" key={location.id} onClick={() => travel(location)}>
                <i>{PLACE_ICONS[location.type]}</i><div><strong>{location.name}</strong><span>{location.type} · безопасность {location.security}%</span></div><small>{location.open ? "Открыто" : "Закрыто"}</small><b>›</b>
              </button>
            ))}
            {!locations.length ? <EmptyState icon="⌖" title="Крупных точек нет" detail="Открой локальную карту, чтобы увидеть улицы и здания." /> : null}
          </section>
        </>
      ) : (
        <>
          <header className="nlm-local-heading">
            <div><span>⌖</span><div><h1>{district?.name ?? "Город"}</h1><p>Сектор <em>{selected.code}</em> · {selected.landUse}</p></div></div>
            <button type="button" onClick={() => setMode("global")}>◎ Вся карта</button>
          </header>
          <section className="nlm-card nlm-local-map-card">
            <LocalSectorMap session={session} sector={selected} onLocation={travel} />
            <div className="nlm-local-legend"><span>⌂ Дом</span><span>▣ Станция</span><span>☕ Кафе</span><span>⌁ Сервис</span><span>✚ Клиника</span><span>♙ Встреча</span></div>
          </section>
          <section className="nlm-card nlm-poi-list">
            <SectionTitle icon="◉" title="Рядом в секторе" />
            {locations.map((location, index) => (
              <button type="button" key={location.id} onClick={() => travel(location)}>
                <i>{PLACE_ICONS[location.type]}</i><div><strong>{location.name}</strong><span>{STREET_NAMES[(hashText(location.id) + index) % STREET_NAMES.length]} {index + 2}</span></div><small>{locationDistance(location.id)}</small><b>›</b>
              </button>
            ))}
            {!locations.length ? localBuildings.map((building) => (
              <button type="button" key={building.buildingId} onClick={() => { onApproachBuilding(building.buildingId); notify(`Идёшь к ${building.addressCode}`, "good"); }}>
                <i>▦</i><div><strong>{building.addressCode}</strong><span>{buildingUseLabel(building)} · безопасность {building.security}%</span></div><small>{Math.round(building.distanceToPlayerM)} м</small><b>›</b>
              </button>
            )) : null}
            {!locations.length && !localBuildings.length ? <EmptyState icon="▦" title="Сектор не материализован" detail="Улицы стабильны. Физические объекты появятся при приближении." /> : null}
          </section>
        </>
      )}
    </div>
  );
}

interface NearbyViewProps {
  session: GameSession;
  onSelectPerson: (personId: string) => void;
  onApproachBuilding: (buildingId: string) => void;
  onEnterBuilding: (buildingId: string, entrance?: "public" | "service") => void;
  onApproachVehicle: (vehicleId: string) => void;
  onEnterVehicle: (vehicleId: string) => void;
  onTravel: (locationId: string) => void;
  onAdvance: (minutes: number, source?: string) => void;
  onSettings: () => void;
  notify: (text: string, tone?: NoticeTone) => void;
}

function NearbyView({
  session,
  onSelectPerson,
  onApproachBuilding,
  onEnterBuilding,
  onApproachVehicle,
  onEnterVehicle,
  onTravel,
  onAdvance,
  onSettings,
  notify
}: NearbyViewProps) {
  const [mode, setMode] = useState<NearbyMode>("people");
  const actors = useMemo(
    () => session.localScene.actors.filter((actor) => actor.visible).sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM),
    [session.localScene.actors]
  );
  const buildings = useMemo(
    () => [...session.localScene.buildings].sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM),
    [session.localScene.buildings]
  );
  const cars = useMemo(
    () => session.vehicles.vehicles.filter((vehicle) => vehicle.visible).sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM),
    [session.vehicles.vehicles]
  );
  const events = session.events.filter((event) => event.category === "local").slice(0, 12);
  const [selectedActorId, setSelectedActorId] = useState(actors[0]?.id ?? "");
  const [selectedBuildingId, setSelectedBuildingId] = useState(buildings[0]?.buildingId ?? "");
  const [selectedVehicleId, setSelectedVehicleId] = useState(cars[0]?.id ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actorDetailsOpen, setActorDetailsOpen] = useState(false);

  useEffect(() => {
    if (!actors.some((actor) => actor.id === selectedActorId)) setSelectedActorId(actors[0]?.id ?? "");
  }, [actors, selectedActorId]);
  useEffect(() => {
    if (!buildings.some((building) => building.buildingId === selectedBuildingId)) setSelectedBuildingId(buildings[0]?.buildingId ?? "");
  }, [buildings, selectedBuildingId]);
  useEffect(() => {
    if (!cars.some((vehicle) => vehicle.id === selectedVehicleId)) setSelectedVehicleId(cars[0]?.id ?? "");
  }, [cars, selectedVehicleId]);
  useEffect(() => {
    setSheetOpen(false);
    setActorDetailsOpen(false);
  }, [mode]);

  const selectedActor = actors.find((actor) => actor.id === selectedActorId);
  const selectedBuilding = buildings.find((building) => building.buildingId === selectedBuildingId);
  const selectedVehicle = cars.find((vehicle) => vehicle.id === selectedVehicleId);
  const buildingAccess = selectedBuilding
    ? session.buildingAccess.buildingEntries.find((entry) => entry.buildingId === selectedBuilding.buildingId)
    : undefined;

  const tabs: Array<{ id: NearbyMode; label: string; icon: string; count: number }> = [
    { id: "people", label: "Люди", icon: "♙", count: actors.length },
    { id: "places", label: "Места", icon: "▦", count: buildings.length },
    { id: "cars", label: "Машины", icon: "▰", count: cars.length },
    { id: "events", label: "События", icon: "▣", count: events.length }
  ];

  function chooseActor(actor: LocalActorState): void {
    setSelectedActorId(actor.id);
    setActorDetailsOpen(false);
    setSheetOpen(true);
  }

  function chooseBuilding(building: LocalBuildingPresenceState): void {
    setSelectedBuildingId(building.buildingId);
    setSheetOpen(true);
  }

  function chooseVehicle(vehicle: PhysicalVehicleEntityState): void {
    setSelectedVehicleId(vehicle.id);
    setSheetOpen(true);
  }

  function openActorProfile(actor: LocalActorState): void {
    setActorDetailsOpen((current) => !current);
    if (actor.activePersonId) onSelectPerson(actor.activePersonId);
    notify(actorDetailsOpen ? `Профиль ${actor.name} свёрнут` : `Профиль ${actor.name} раскрыт`, "good");
  }

  function observeActor(actor: LocalActorState): void {
    onAdvance(2, `Наблюдение: ${actor.name}`);
    notify(`Ты наблюдал за ${actor.name} две минуты`);
  }

  function travelToActorDestination(actor: LocalActorState): void {
    if (!actor.destinationLocationId) {
      notify("У персонажа нет доступной точки назначения", "warn");
      return;
    }
    onTravel(actor.destinationLocationId);
    notify(`Маршрут к цели ${actor.name} построен`, "good");
  }

  function approachBuilding(building: LocalBuildingPresenceState): void {
    onApproachBuilding(building.buildingId);
    notify(`Ты подошёл к ${building.addressCode}`, "good");
  }

  function enterBuilding(building: LocalBuildingPresenceState): void {
    onEnterBuilding(building.buildingId);
    notify(`Попытка входа: ${building.addressCode}`);
  }

  function approachVehicle(vehicle: PhysicalVehicleEntityState): void {
    onApproachVehicle(vehicle.id);
    notify(`Ты подошёл к ${vehicle.modelName}`, "good");
  }

  function enterVehicle(vehicle: PhysicalVehicleEntityState): void {
    onEnterVehicle(vehicle.id);
    notify(`Посадка: ${vehicle.modelName}`);
  }

  const sheet: ReactNode = sheetOpen ? (
    <section className="nlm-nearby-sheet" aria-label="Действия с выбранным объектом">
      <button type="button" className="nlm-sheet-close" onClick={() => setSheetOpen(false)} aria-label="Закрыть">×</button>
      <span className="nlm-sheet-grabber" />
      {mode === "people" && selectedActor ? (
        <>
          <div className="nlm-nearby-sheet__person">
            <img src={personAssetById(selectedActor.id)} alt={`Портрет ${selectedActor.name}`} />
            <div><h2>{selectedActor.name}</h2><strong>{selectedActor.roleLabel}</strong><span>{actorActivityIcon(selectedActor)} {selectedActor.activityLabel}</span><p><b>▥ {selectedActor.age}</b><b>♥ {selectedActor.health}</b><b className="is-good">● {selectedActor.knownToPlayer ? "Знаком" : "Не знаком"}</b></p></div>
            <aside><strong>{Math.round(selectedActor.distanceToPlayerM)} м</strong><small>{selectedActor.nearby ? "рядом" : "в секторе"}</small></aside>
          </div>
          {actorDetailsOpen ? (
            <div className="nlm-actor-facts">
              <span><small>Положение</small><strong>{selectedActor.position.state === "inside" ? "В здании" : selectedActor.position.state === "in-transit" ? "В пути" : "На улице"}</strong></span>
              <span><small>Доступность</small><strong>{selectedActor.interactable ? "Можно обратиться" : "Слишком далеко"}</strong></span>
              <span><small>Связь</small><strong>{selectedActor.knownToPlayer ? "Известный контакт" : "Незнакомец"}</strong></span>
            </div>
          ) : null}
          <div className="nlm-nearby-sheet__actions">
            <button type="button" className={actorDetailsOpen ? "is-active" : ""} onClick={() => openActorProfile(selectedActor)}>♙ {actorDetailsOpen ? "Скрыть" : "Профиль"}</button>
            <button type="button" onClick={() => observeActor(selectedActor)}>◉ Наблюдать</button>
            {selectedActor.destinationLocationId ? <button type="button" onClick={() => travelToActorDestination(selectedActor)}>⌁ К цели</button> : null}
          </div>
        </>
      ) : null}
      {mode === "places" && selectedBuilding ? (
        <>
          <div className="nlm-nearby-sheet__object">
            <span className="nlm-object-icon">▦</span>
            <div><h2>{selectedBuilding.addressCode}</h2><strong>{buildingUseLabel(selectedBuilding)}</strong><span>{selectedBuilding.occupiedActorCount} внутри · безопасность {selectedBuilding.security}%</span></div>
            <aside><strong>{Math.round(selectedBuilding.distanceToPlayerM)} м</strong><small>{buildingAccess?.publicReason ?? "Улица"}</small></aside>
          </div>
          <div className="nlm-nearby-sheet__actions">
            <button type="button" onClick={() => approachBuilding(selectedBuilding)}>⌖ Подойти</button>
            {selectedBuilding.distanceToPlayerM <= 12 && buildingAccess?.publicDecision !== "locked" && buildingAccess?.publicDecision !== "closed" && buildingAccess?.publicDecision !== "unavailable" ? (
              <button type="button" onClick={() => enterBuilding(selectedBuilding)}>▣ Войти</button>
            ) : null}
            {selectedBuilding.distanceToPlayerM <= 12 && (buildingAccess?.publicDecision === "locked" || buildingAccess?.publicDecision === "closed" || buildingAccess?.publicDecision === "unavailable") ? (
              <span className="nlm-action-unavailable">{buildingAccess.publicReason}</span>
            ) : null}
          </div>
        </>
      ) : null}
      {mode === "cars" && selectedVehicle ? (
        <>
          <div className="nlm-nearby-sheet__object">
            <img src={asset("vehicle-01.webp")} alt={selectedVehicle.modelName} />
            <div><h2>{selectedVehicle.modelName}</h2><strong>{selectedVehicle.plate}</strong><span>{vehicleStateLabel(selectedVehicle)} · топливо {Math.round(selectedVehicle.fuelL / selectedVehicle.fuelCapacityL * 100)}%</span></div>
            <aside><strong>{Math.round(selectedVehicle.distanceToPlayerM)} м</strong><small>{selectedVehicle.locked ? "Закрыта" : "Доступна"}</small></aside>
          </div>
          <div className="nlm-nearby-sheet__actions">
            <button type="button" onClick={() => approachVehicle(selectedVehicle)}>⌖ Подойти</button>
            {selectedVehicle.playerCanEnter && selectedVehicle.distanceToPlayerM <= 12 ? <button type="button" onClick={() => enterVehicle(selectedVehicle)}>▰ Сесть</button> : null}
            {!selectedVehicle.playerCanEnter && selectedVehicle.distanceToPlayerM <= 12 ? <span className="nlm-action-unavailable">Нет доступа</span> : null}
          </div>
        </>
      ) : null}
    </section>
  ) : null;

  return (
    <div className="nlm-view nlm-nearby-view">
      <MobileHeader session={session} title="Рядом" subtitle={`${districtName(session)} · физические объекты активного сектора`} onSettings={onSettings} />
      <div className="nlm-nearby-tabs">
        {tabs.map((tab) => <button type="button" key={tab.id} className={mode === tab.id ? "is-active" : ""} onClick={() => setMode(tab.id)}><i>{tab.icon}</i><span>{tab.label}</span><b>{tab.count}</b></button>)}
      </div>

      {mode === "people" ? (
        <div className="nlm-nearby-list">
          {actors.slice(0, 12).map((actor) => (
            <button type="button" className={selectedActor?.id === actor.id ? "is-selected" : ""} onClick={() => chooseActor(actor)} key={actor.id}>
              <img src={personAssetById(actor.id)} alt={`Портрет ${actor.name}`} />
              <span className="nlm-online-dot" />
              <div><strong>{actor.name}</strong><small>{actor.roleLabel}</small><em>{actorActivityIcon(actor)} {actor.activityLabel}</em></div>
              <aside><strong>{Math.round(actor.distanceToPlayerM)} м</strong><small>{actor.nearby ? "рядом" : "в секторе"}</small><b>›</b></aside>
            </button>
          ))}
          {!actors.length ? <EmptyState icon="♙" title="Никого не видно" detail="Подожди или перейди в другой сектор." /> : null}
        </div>
      ) : null}

      {mode === "places" ? (
        <div className="nlm-nearby-list">
          {buildings.slice(0, 12).map((building) => (
            <button type="button" className={selectedBuilding?.buildingId === building.buildingId ? "is-selected" : ""} key={building.buildingId} onClick={() => chooseBuilding(building)}>
              <span className="nlm-place-tile">{building.use === "medical" ? "✚" : building.use === "retail" ? "◇" : building.use === "transport" ? "▣" : "▦"}</span>
              <div><strong>{building.addressCode}</strong><small>{buildingUseLabel(building)}</small><em>{building.publicEntrances} входа · безопасность {building.security}%</em></div>
              <aside><strong>{Math.round(building.distanceToPlayerM)} м</strong><small>{building.occupiedActorCount} внутри</small><b>›</b></aside>
            </button>
          ))}
          {!buildings.length ? <EmptyState icon="▦" title="Здания не материализованы" detail="Перейди в активный сектор." /> : null}
        </div>
      ) : null}

      {mode === "cars" ? (
        <div className="nlm-nearby-list">
          {cars.slice(0, 12).map((vehicle) => (
            <button type="button" className={selectedVehicle?.id === vehicle.id ? "is-selected" : ""} key={vehicle.id} onClick={() => chooseVehicle(vehicle)}>
              <img src={asset("vehicle-01.webp")} alt={vehicle.modelName} />
              <div><strong>{vehicle.modelName}</strong><small>{vehicle.vehicleClass} · {vehicleStateLabel(vehicle)}</small><em>▰ {vehicle.plate} · топливо {Math.round(vehicle.fuelL / vehicle.fuelCapacityL * 100)}%</em></div>
              <aside><strong>{Math.round(vehicle.distanceToPlayerM)} м</strong><small>{vehicle.locked ? "Закрыта" : "Доступна"}</small><b>›</b></aside>
            </button>
          ))}
          {!cars.length ? <EmptyState icon="▰" title="Машин не видно" detail="Осмотрись в соседнем квартале." /> : null}
        </div>
      ) : null}

      {mode === "events" ? (
        <div className="nlm-events-list">
          {events.map((event) => <article key={event.id}><i>◉</i><div><strong>{event.title}</strong><span>{event.detail}</span></div><time>{formatGameTime(event.timestamp)}</time></article>)}
          {!events.length ? <EmptyState icon="▣" title="Событий нет" detail="Локальная лента пока спокойна." /> : null}
        </div>
      ) : null}

      {sheet}
    </div>
  );
}

function MoveView({
  session,
  onTravel,
  onAdvance,
  onSettings,
  notify
}: {
  session: GameSession;
  onTravel: (locationId: string) => void;
  onAdvance: (minutes: number, source?: string) => void;
  onSettings: () => void;
  notify: (text: string, tone?: NoticeTone) => void;
}) {
  const routes = getTravelOptions(session).filter((route) => route.location.id !== session.life.currentLocationId).slice(0, 12);
  const current = session.world.locations.find((location) => location.id === session.life.currentLocationId);

  function travel(locationId: string, name: string): void {
    onTravel(locationId);
    notify(`Отправление: ${name}`, "good");
  }

  function wait(minutes: number): void {
    onAdvance(minutes, "Ожидание");
    notify(`Прошло ${minutes} минут`);
  }

  return (
    <div className="nlm-view nlm-move-view">
      <MobileHeader session={session} title="Перемещение" subtitle="Маршруты, стоимость и время в пути." onSettings={onSettings} />
      <section className="nlm-card nlm-current-location"><span>⌖</span><div><small>Сейчас</small><h2>{current?.name ?? session.player.sector}</h2><p>{districtName(session)}</p></div><strong>{session.localScene.playerPosition.state}</strong></section>
      <section className="nlm-card nlm-route-list">
        <SectionTitle icon="⌁" title="Доступные маршруты" />
        {routes.map((route) => (
          <button type="button" key={route.location.id} onClick={() => travel(route.location.id, route.location.name)}>
            <i>{route.mode === "walk" ? "♙" : route.mode === "metro" ? "▣" : route.mode === "bus" ? "▰" : "◇"}</i>
            <div><strong>{route.location.name}</strong><span>{route.mode} · {route.districtName}</span></div>
            <aside><strong>{route.durationMinutes} мин</strong><small>{route.cost ? `₵ ${route.cost}` : "Бесплатно"}</small><b>›</b></aside>
          </button>
        ))}
        {!routes.length ? <EmptyState icon="⌁" title="Маршрутов нет" detail="Текущее положение не позволяет начать поездку." /> : null}
      </section>
      <section className="nlm-card nlm-time-actions"><SectionTitle icon="◷" title="Пропустить время" /><div><button type="button" onClick={() => wait(15)}>15 мин</button><button type="button" onClick={() => wait(60)}>1 час</button><button type="button" onClick={() => wait(240)}>4 часа</button></div></section>
    </div>
  );
}

export function MobileExperience(props: MobileExperienceProps) {
  const [view, setView] = useState<MobileView>("home");
  const [mapMode, setMapMode] = useState<MapMode>("global");
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const noticeTimer = useRef<number | null>(null);

  function notify(text: string, tone: NoticeTone = "neutral"): void {
    setNotice({ text, tone });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2400);
  }

  function changeView(nextView: MobileView): void {
    setView(nextView);
  }

  function openMap(mode: MapMode): void {
    setMapMode(mode);
    setView("map");
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [view, mapMode]);

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  return (
    <div className="nlm-app">
      <main className="nlm-scroll-area" ref={scrollRef}>
        {view === "home" ? <HomeView session={props.session} plans={props.plans} actions={props.actions} onAction={props.onAction} onTravel={props.onTravel} onNavigate={changeView} onOpenMap={openMap} onSettings={props.onOpenSettings} notify={notify} /> : null}
        {view === "profile" ? <ProfileView session={props.session} onSettings={props.onOpenSettings} onSelectPerson={props.onSelectPerson} notify={notify} /> : null}
        {view === "map" ? <MapView session={props.session} mode={mapMode} setMode={setMapMode} onTravel={props.onTravel} onApproachBuilding={props.onApproachBuilding} onSettings={props.onOpenSettings} notify={notify} /> : null}
        {view === "nearby" ? <NearbyView session={props.session} onSelectPerson={props.onSelectPerson} onApproachBuilding={props.onApproachBuilding} onEnterBuilding={props.onEnterBuilding} onApproachVehicle={props.onApproachVehicle} onEnterVehicle={props.onEnterVehicle} onTravel={props.onTravel} onAdvance={props.onAdvance} onSettings={props.onOpenSettings} notify={notify} /> : null}
        {view === "move" ? <MoveView session={props.session} onTravel={props.onTravel} onAdvance={props.onAdvance} onSettings={props.onOpenSettings} notify={notify} /> : null}
      </main>
      <BottomNav view={view} onChange={changeView} />
      {notice ? <div className={`nlm-toast nlm-toast--${notice.tone}`} role="status" aria-live="polite">{notice.text}</div> : null}
    </div>
  );
}
