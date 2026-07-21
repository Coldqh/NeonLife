import { useEffect, useMemo, useState } from "react";
import { NeonShell } from "./layout/NeonShell";
import { initialEvents } from "../core/events/demoEvents";
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
import { initialPlayer, type PlayerState } from "../gameplay/player/demoPlayer";
import { miraKoval } from "../people/demoNpc";
import { defaultUiSettings, type UiSettings } from "../ui/theme/settings";
import { Icon, type IconName } from "../ui/components/Icons";
import { Meter } from "../ui/components/Meter";
import { Portrait } from "../ui/components/Portrait";
import { SystemPanel } from "../ui/components/SystemPanel";
import { WindowFrame } from "../ui/components/WindowFrame";

const UI_SETTINGS_KEY = "neon-life/ui-settings/v1";
const SESSION_KEY = "neon-life/demo-session/v1";

type NavId = "life" | "city" | "people" | "work" | "network" | "inventory" | "health" | "home" | "messages" | "archive";
type WindowId = "profile" | "mira" | "messages" | "vacancy" | "local" | "journal" | "settings" | "diagnostics";
type MobileLifeTab = "now" | "plan" | "feed" | "log";

interface DemoSession {
  timestamp: number;
  player: PlayerState;
  events: WorldEvent[];
  currentActivity: string;
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
}

const navItems: Array<{ id: NavId; label: string; icon: IconName; badge?: string }> = [
  { id: "life", label: "LIFE", icon: "life" },
  { id: "city", label: "CITY", icon: "city" },
  { id: "people", label: "PEOPLE", icon: "people", badge: "4" },
  { id: "work", label: "WORK", icon: "work", badge: "2" },
  { id: "network", label: "NETWORK", icon: "network" },
  { id: "inventory", label: "INVENTORY", icon: "inventory" },
  { id: "health", label: "HEALTH", icon: "health", badge: "!" },
  { id: "home", label: "HOME", icon: "home" },
  { id: "messages", label: "MESSAGES", icon: "messages", badge: "3" },
  { id: "archive", label: "ARCHIVE", icon: "archive" }
];

const quickActions: ActionDefinition[] = [
  {
    id: "travel-orbis",
    title: "Ехать в Orbis Repair Hub",
    code: "MOVE/TRANSIT",
    duration: 35,
    cost: 12,
    location: "INDUSTRIAL BELT / ORBIS HUB",
    risk: "MED",
    category: "personal",
    result: "Ты добрался до Orbis Repair Hub. Мира оставила пропуск на сервисной стойке.",
    activityAfter: "У входа в Orbis Repair Hub",
    fatigueDelta: 3,
    stressDelta: 1,
    hungerDelta: 2
  },
  {
    id: "reply-mira",
    title: "Ответить Мире",
    code: "COMMS/CONTACT",
    duration: 5,
    cost: 0,
    location: "LOWER CITY / REMOTE",
    risk: "LOW",
    category: "contact",
    result: "Мира подтвердила встречу в 23:20 и попросила не заходить через главный вход.",
    activityAfter: "Ожидание у станции",
    stressDelta: -2
  },
  {
    id: "buy-meal",
    title: "Купить горячую еду",
    code: "LIFE/SUPPLY",
    duration: 20,
    cost: 28,
    location: "SECTOR 04 / NIGHT CANTEEN",
    risk: "LOW",
    category: "health",
    result: "Голод снижен. Качество еды низкое, но состояние стабилизировалось.",
    activityAfter: "Возвращение к станции",
    fatigueDelta: -2,
    hungerDelta: -24
  },
  {
    id: "scan-vacancies",
    title: "Проверить ночные вакансии",
    code: "WORK/SEARCH",
    duration: 30,
    cost: 0,
    location: "CITYLINK / EMPLOYMENT NODE",
    risk: "LOW",
    category: "work",
    result: "Найдены две вакансии: помощник техника и ночной сортировщик грузов.",
    activityAfter: "Просмотр городской сети",
    fatigueDelta: 1,
    stressDelta: 1
  }
];

const plans = [
  { time: "22:55", title: "Ответить Мире", status: "urgent", detail: "Окно связи закроется через 19 минут" },
  { time: "23:20", title: "Встреча у Orbis Hub", status: "planned", detail: "Сервисный вход · нужен транспорт" },
  { time: "00:10", title: "Собеседование на ночную смену", status: "planned", detail: "Оплата ₵ 188 · 6 часов" },
  { time: "06:30", title: "Вернуться в капсулу", status: "open", detail: "Жильё оплачено ещё на 7 дней" }
];

const windowLabels: Record<WindowId, string> = {
  profile: "KAIN VALE",
  mira: "MIRA KOVAL",
  messages: "MESSAGES",
  vacancy: "VACANCY",
  local: "LOCAL CHANNEL",
  journal: "EVENT LOG",
  settings: "SYSTEM SETTINGS",
  diagnostics: "DIAGNOSTICS"
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

let eventSequence = 0;

function createEventId(): string {
  eventSequence += 1;
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `evt-${Date.now()}-${eventSequence}`;
}

export default function App() {
  const [settings, setSettings] = useState<UiSettings>(() => readLocal(UI_SETTINGS_KEY, defaultUiSettings));
  const [session, setSession] = useState<DemoSession>(() =>
    readLocal<DemoSession>(SESSION_KEY, {
      timestamp: INITIAL_GAME_TIMESTAMP,
      player: initialPlayer,
      events: initialEvents,
      currentActivity: "Ожидание у станции Sector 04"
    })
  );
  const [activeNav, setActiveNav] = useState<NavId>("life");
  const [journalFilter, setJournalFilter] = useState<EventCategory | "all">("all");
  const [openWindows, setOpenWindows] = useState<WindowId[]>([]);
  const [activeWindow, setActiveWindow] = useState<WindowId | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  useEffect(() => writeLocal(UI_SETTINGS_KEY, settings), [settings]);
  useEffect(() => writeLocal(SESSION_KEY, session), [session]);

  const filteredEvents = useMemo(
    () => session.events.filter((event) => journalFilter === "all" || event.category === journalFilter),
    [session.events, journalFilter]
  );

  const rootClass = [
    settings.scanlines ? "has-scanlines" : "",
    settings.reducedMotion ? "reduce-motion" : "",
    settings.compactMode ? "compact-mode" : "",
    settings.highContrast ? "high-contrast" : ""
  ].filter(Boolean).join(" ");

  function addEvent(event: Omit<WorldEvent, "id">): void {
    setSession((current) => ({
      ...current,
      events: [{ ...event, id: createEventId() }, ...current.events].slice(0, 80)
    }));
  }

  function advance(minutes: number, source = "Ручное продвижение времени"): void {
    setSession((current) => {
      const nextTimestamp = advanceGameTime(current.timestamp, minutes);
      return {
        ...current,
        timestamp: nextTimestamp,
        player: {
          ...current.player,
          condition: {
            ...current.player.condition,
            fatigue: clamp(current.player.condition.fatigue + Math.max(1, Math.round(minutes / 90))),
            hunger: clamp(current.player.condition.hunger + Math.max(1, Math.round(minutes / 120)))
          }
        },
        events: minutes >= 60
          ? ([{
              id: createEventId(),
              timestamp: nextTimestamp,
              category: "system",
              title: `${source}: +${minutes} мин.`,
              importance: 1
            } satisfies WorldEvent, ...current.events].slice(0, 80))
          : current.events
      };
    });
  }

  function executeAction(action: ActionDefinition): void {
    setSession((current) => {
      const nextTimestamp = advanceGameTime(current.timestamp, action.duration);
      const nextPlayer: PlayerState = {
        ...current.player,
        balance: current.player.balance - action.cost,
        condition: {
          ...current.player.condition,
          fatigue: clamp(current.player.condition.fatigue + (action.fatigueDelta ?? 0)),
          stress: clamp(current.player.condition.stress + (action.stressDelta ?? 0)),
          hunger: clamp(current.player.condition.hunger + (action.hungerDelta ?? 0))
        }
      };

      const actionEvent: WorldEvent = {
        id: createEventId(),
        timestamp: nextTimestamp,
        category: action.category,
        title: action.result,
        detail: `${action.location} · ${action.duration} мин.${action.cost ? ` · −₵ ${action.cost}` : ""}`,
        importance: action.risk === "HIGH" ? 3 : action.risk === "MED" ? 2 : 1
      };

      return {
        ...current,
        timestamp: nextTimestamp,
        player: nextPlayer,
        currentActivity: action.activityAfter,
        events: [actionEvent, ...current.events].slice(0, 80)
      };
    });
    setActionSheetOpen(false);
  }

  function openWindow(id: WindowId): void {
    setOpenWindows((current) => current.includes(id) ? current : [...current, id]);
    setActiveWindow(id);
  }

  function closeWindow(id: WindowId): void {
    setOpenWindows((current) => current.filter((windowId) => windowId !== id));
    setActiveWindow((current) => current === id ? null : current);
  }

  function resetDemo(): void {
    const fresh: DemoSession = {
      timestamp: INITIAL_GAME_TIMESTAMP,
      player: initialPlayer,
      events: initialEvents,
      currentActivity: "Ожидание у станции Sector 04"
    };
    setSession(fresh);
    writeLocal(SESSION_KEY, fresh);
    addEvent({
      timestamp: INITIAL_GAME_TIMESTAMP,
      category: "system",
      title: "Демонстрационная сессия восстановлена.",
      importance: 1
    });
  }

  const topbar = (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => setActiveNav("life")}>
        <span className="brand__mark">N/L</span>
        <span className="brand__text">
          <strong>NEON/LINK</strong>
          <small>OS 3.7 // SEVEN DAYS BELOW</small>
        </span>
      </button>

      <div className="topbar__status topbar__status--time">
        <Icon name="clock" />
        <span>
          <strong>{formatGameTime(session.timestamp)}</strong>
          <small>{formatGameDate(session.timestamp)} · DAY {getDayNumber(session.timestamp)}/7</small>
        </span>
      </div>
      <div className="topbar__status topbar__status--location">
        <span className="status-dot status-dot--cyan" />
        <span>
          <strong>{session.player.district}</strong>
          <small>{session.player.sector} · ACID RAIN 11°C</small>
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
          <strong>NET: STABLE</strong>
          <small>LC04 NODE / 84%</small>
        </span>
      </div>
      <button type="button" className="alert-button" onClick={() => openWindow("messages")}>
        <Icon name="alert" />
        <span>3</span>
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
        <strong>NL-7DB-0441</strong>
        <small>SIM v0.2.0</small>
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
      <button type="button" className={activeNav === "people" ? "is-active" : ""} onClick={() => setActiveNav("people")}>
        <Icon name="people" /><span>PEOPLE</span>
      </button>
      <button type="button" onClick={() => openWindow("settings")}>
        <Icon name="settings" /><span>SYSTEM</span>
      </button>
    </nav>
  );

  const context = (
    <aside className={`context-panel ${contextOpen ? "is-open" : ""}`}>
      <header className="context-panel__header">
        <div>
          <span>CONTEXT / PERSON</span>
          <h2>MIRA KOVAL</h2>
        </div>
        <button type="button" className="icon-button context-panel__mobile-close" onClick={() => setContextOpen(false)} aria-label="Закрыть">
          <Icon name="close" />
        </button>
      </header>
      <Portrait kind="mira" label="Стилизованный профиль Миры Коваль" />
      <div className="context-id-line">
        <span>PROFILE {miraKoval.profileCode}</span>
        <span className="status-chip status-chip--online">ACTIVE</span>
      </div>
      <div className="context-block">
        <small>STATUS</small>
        <strong>{miraKoval.status}</strong>
        <span>{miraKoval.location}</span>
      </div>
      <div className="context-block">
        <small>RELATION</small>
        {miraKoval.relations.map((relation) => (
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
          {miraKoval.knownFacts.slice(0, 3).map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
      </div>
      <div className="context-actions">
        <button type="button" className="button button--primary" onClick={() => openWindow("messages")}>Открыть канал</button>
        <button type="button" className="button button--ghost" onClick={() => openWindow("mira")}>Полное досье</button>
      </div>
    </aside>
  );

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
    />
  ) : (
    <ModulePreview activeNav={activeNav} onReturn={() => setActiveNav("life")} onOpenWindow={openWindow} />
  );

  const windowDock = openWindows.length ? (
    <div className="window-dock">
      {openWindows.map((id) => (
        <button type="button" key={id} className={activeWindow === id ? "is-active" : ""} onClick={() => setActiveWindow(id)}>
          <span>{windowLabels[id]}</span>
          <i onClick={(event) => { event.stopPropagation(); closeWindow(id); }}><Icon name="close" size={13} /></i>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={rootClass}>
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
            onReset={resetDemo}
            session={session}
            journalFilter={journalFilter}
            setJournalFilter={setJournalFilter}
          />
        </WindowFrame>
      ) : null}

      {actionSheetOpen ? (
        <div className="action-sheet-backdrop" onClick={() => setActionSheetOpen(false)}>
          <section className="action-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-grabber" />
            <header>
              <div>
                <span>ACTION/LOCAL</span>
                <h2>Доступные действия</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setActionSheetOpen(false)}><Icon name="close" /></button>
            </header>
            <div className="action-sheet__list">
              {quickActions.map((action) => (
                <ActionCard action={action} onAction={executeAction} key={action.id} compact />
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

interface LifeWorkspaceProps {
  session: DemoSession;
  filteredEvents: WorldEvent[];
  journalFilter: EventCategory | "all";
  setJournalFilter: (filter: EventCategory | "all") => void;
  onAdvance: (minutes: number, source?: string) => void;
  onAction: (action: ActionDefinition) => void;
  onOpenWindow: (id: WindowId) => void;
  onOpenContext: () => void;
  onOpenActions: () => void;
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
  onOpenActions
}: LifeWorkspaceProps) {
  const { player } = session;

  return (
    <div className="life-screen">
      <header className="screen-heading">
        <div>
          <span className="screen-heading__path">SYSTEM / LIFE / ACTIVE SESSION</span>
          <h1>ТЕКУЩАЯ ЖИЗНЬ</h1>
          <p>{formatGameDateTime(session.timestamp)} · {player.district} · доступ к городской сети ограничен</p>
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
      />

      <div className="life-grid life-grid--desktop">
        <SystemPanel title="KAIN VALE" code="CITIZEN/PROFILE" className="hero-panel" action={<span className="status-chip">ONLINE</span>}>
          <div className="hero-summary">
            <Portrait kind="player" label="Стилизованный профиль Каина Вейла" />
            <div className="hero-summary__identity">
              <span>AGE {player.age} · {player.occupation}</span>
              <strong>{player.origin}</strong>
              <small>ID LC04-19-8841 · CLEARANCE 0</small>
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
              <p>На главной улице нет света. До встречи с Мирой 39 минут.</p>
            </div>
          </div>
          <div className="activity-meta">
            <div><span>LOCATION</span><strong>LOWER CITY / SECTOR 04</strong></div>
            <div><span>EXPOSURE</span><strong className="warning-text">MEDIUM</strong></div>
            <div><span>NEXT STOP</span><strong>ORBIS REPAIR HUB</strong></div>
          </div>
          <div className="activity-controls">
            <button type="button" className="button button--primary" onClick={() => onAction(quickActions[0])}>Начать поездку · 35 мин</button>
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
            {quickActions.map((action) => <ActionCard action={action} onAction={onAction} key={action.id} />)}
          </div>
        </SystemPanel>

        <SystemPanel title="ЛОКАЛЬНЫЙ КАНАЛ" code="CITY/FEED" className="feed-panel">
          <div className="feed-map">
            <div className="feed-map__grid" />
            <span className="map-node map-node--player" style={{ left: "31%", top: "58%" }}>YOU</span>
            <span className="map-node map-node--contact" style={{ left: "73%", top: "36%" }}>MIRA</span>
            <span className="map-node map-node--alert" style={{ left: "52%", top: "72%" }}>POLICE</span>
            <div className="route-line" />
          </div>
          <div className="feed-list">
            <div><span>22:41</span><p>Аварийное отключение линии LC-04. Освещение восстановят не раньше 01:30.</p></div>
            <div><span>22:34</span><p>У станции замечена усиленная полицейская группа. Проверяют документы.</p></div>
            <div><span>22:09</span><p>Night Canteen снизила цену на остатки смены до ₵ 28.</p></div>
          </div>
        </SystemPanel>

        <SystemPanel
          title="ЖУРНАЛ СОБЫТИЙ"
          code="WORLD/EVENT LOG"
          className="journal-panel"
          action={
            <select value={journalFilter} onChange={(event) => setJournalFilter(event.target.value as EventCategory | "all")}>
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
            <Portrait kind="mira" label="Мира Коваль" />
            <span>
              <strong>MIRA KOVAL</strong>
              <small>DRONE TECHNICIAN · ORBIS HUB</small>
              <em>Ответила 3 минуты назад</em>
            </span>
            <Icon name="chevron" />
          </button>
          <button type="button" className="contact-card contact-card--muted" onClick={() => onOpenWindow("messages")}>
            <div className="contact-card__initial">JN</div>
            <span>
              <strong>JONAS NERI</strong>
              <small>CAPSULE BLOCK MANAGER</small>
              <em>Последний контакт вчера</em>
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
  onOpenActions
}: MobileLifeWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<MobileLifeTab>("now");
  const { player } = session;
  const visibleEvents = filteredEvents.slice(0, 4);

  return (
    <section className="mobile-life" aria-label="Мобильный экран жизни">
      <div className="mobile-life__identity-row">
        <button type="button" className="mobile-identity" onClick={() => onOpenWindow("profile")}>
          <Portrait kind="player" label="Каин Вейл" />
          <span>
            <strong>KAIN VALE</strong>
            <small>{player.occupation} · {player.sector}</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <div className="mobile-wallet">
          <strong>₵ {player.balance.toLocaleString("ru-RU")}</strong>
          <small>HOME {player.housingDaysLeft}D</small>
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
          <span>LC / SECTOR 04</span>
          <span className="warning-text">EXPOSURE MED</span>
          <span>39 MIN LEFT</span>
        </div>
        <div className="mobile-current-action__buttons">
          <button type="button" className="button button--primary" onClick={() => onAction(quickActions[0])}>Ехать · 35 мин</button>
          <button type="button" className="button button--ghost" onClick={() => onAdvance(15, "Ожидание")}>Ждать 15</button>
        </div>
      </section>

      <nav className="mobile-subnav" aria-label="Разделы экрана жизни">
        {([
          ["now", "СЕЙЧАС"],
          ["plan", "ПЛАН"],
          ["feed", "РАЙОН"],
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
              {quickActions.slice(0, 3).map((action) => (
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
              <Portrait kind="mira" label="Мира Коваль" />
              <span><strong>MIRA KOVAL</strong><small>Ответила 3 минуты назад</small></span>
              <span className="status-chip status-chip--online">1 NEW</span>
            </button>
          </div>
        ) : null}

        {activeTab === "plan" ? (
          <div className="mobile-plan-list">
            {plans.map((item) => (
              <button type="button" className={`mobile-plan-row mobile-plan-row--${item.status}`} key={`${item.time}-${item.title}`} onClick={() => item.title.includes("собеседование") ? onOpenWindow("vacancy") : undefined}>
                <time>{item.time}</time>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <i />
              </button>
            ))}
          </div>
        ) : null}

        {activeTab === "feed" ? (
          <div className="mobile-feed">
            <button type="button" className="mobile-map-button" onClick={() => onOpenWindow("local")}>
              <span><strong>SECTOR 04</strong><small>Схема, маршруты и узлы</small></span>
              <span className="status-chip">OPEN MAP</span>
            </button>
            <MobileFeedRow time="22:41" text="Отключена линия LC-04. Свет вернут после 01:30." />
            <MobileFeedRow time="22:34" text="У станции полиция проверяет документы." warning />
            <MobileFeedRow time="22:09" text="Night Canteen: горячая еда за ₵ 28." />
          </div>
        ) : null}

        {activeTab === "log" ? (
          <div className="mobile-log">
            <div className="mobile-log__filter">
              <select value={journalFilter} onChange={(event) => setJournalFilter(event.target.value as EventCategory | "all")}>
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

function ModulePreview({ activeNav, onReturn, onOpenWindow }: { activeNav: NavId; onReturn: () => void; onOpenWindow: (id: WindowId) => void }) {
  const item = navItems.find((nav) => nav.id === activeNav) ?? navItems[0];
  return (
    <div className="module-preview">
      <span className="module-preview__code">MODULE/{item.label}/PREVIEW</span>
      <Icon name={item.icon} size={56} />
      <h1>{item.label}</h1>
      <p>Модуль подключён к общей оболочке, но не входит в первый вертикальный срез. Сейчас активна жизненная система SEVEN DAYS BELOW.</p>
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
  setJournalFilter
}: {
  id: WindowId;
  settings: UiSettings;
  setSettings: (settings: UiSettings) => void;
  onAction: (action: ActionDefinition) => void;
  onReset: () => void;
  session: DemoSession;
  journalFilter: EventCategory | "all";
  setJournalFilter: (filter: EventCategory | "all") => void;
}) {

  if (id === "profile") {
    const { player } = session;
    return (
      <div className="profile-window">
        <div className="profile-window__head">
          <Portrait kind="player" label="Каин Вейл" />
          <div>
            <span>CITIZEN LC04-19-8841</span>
            <h3>KAIN VALE</h3>
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

  if (id === "mira") {
    return (
      <div className="dossier-window">
        <div className="dossier-window__identity">
          <Portrait kind="mira" label="Мира Коваль" />
          <div>
            <span>PROFILE {miraKoval.profileCode}</span>
            <h3>{miraKoval.name}</h3>
            <p>{miraKoval.role} · AGE {miraKoval.age}</p>
            <strong>{miraKoval.status} · {miraKoval.location}</strong>
          </div>
        </div>
        <div className="window-columns">
          <section>
            <h4>KNOWN CONDITION</h4>
            <ul>{miraKoval.condition.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section>
            <h4>KNOWN FACTS</h4>
            <ul>{miraKoval.knownFacts.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        </div>
        <section className="memory-record">
          <span>LAST CONTACT / {miraKoval.lastContact}</span>
          <p>«Я могу провести тебя внутрь, но только через сервисный вход. После 23:20. Не опаздывай.»</p>
          <small>Достоверность записи: 100% · Источник: прямое сообщение</small>
        </section>
      </div>
    );
  }

  if (id === "messages") {
    return (
      <div className="messages-window">
        <aside>
          <button type="button" className="is-active"><strong>MIRA KOVAL</strong><span>3 мин</span><small>Я оставлю пропуск...</small></button>
          <button type="button"><strong>JONAS NERI</strong><span>1 день</span><small>Оплата за капсулу...</small></button>
          <button type="button"><strong>CITY EMPLOYMENT</strong><span>2 дня</span><small>Профиль подтверждён</small></button>
        </aside>
        <section>
          <header><strong>MIRA KOVAL</strong><span>ENCRYPTION: BASIC</span></header>
          <div className="message-bubble message-bubble--incoming">Я оставлю пропуск на сервисной стойке. Главный вход не используй.</div>
          <div className="message-bubble message-bubble--outgoing">Во сколько быть?</div>
          <div className="message-bubble message-bubble--incoming">После 23:20. И не тащи за собой патруль.</div>
          <button type="button" className="button button--primary" onClick={() => onAction(quickActions[1])}>Подтвердить встречу · 5 мин</button>
        </section>
      </div>
    );
  }

  if (id === "vacancy") {
    return (
      <div className="vacancy-window">
        <span className="vacancy-window__company">ORBIS REPAIR HUB / STAFF NODE</span>
        <h3>Помощник техника · ночная смена</h3>
        <div className="vacancy-grid">
          <div><span>Смена</span><strong>23:30–05:30</strong></div>
          <div><span>Оплата</span><strong>₵ 188</strong></div>
          <div><span>Район</span><strong>INDUSTRIAL BELT</strong></div>
          <div><span>Риск</span><strong className="warning-text">MEDIUM</strong></div>
        </div>
        <h4>ТРЕБОВАНИЯ</h4>
        <ul>
          <li>Базовое обращение с инструментами</li>
          <li>Физическая форма не ниже 40%</li>
          <li>Временный пропуск или поручитель сотрудника</li>
        </ul>
        <h4>ВОЗМОЖНЫЕ СОБЫТИЯ СМЕНЫ</h4>
        <p>Диагностика дронов, сортировка деталей, конфликт с мастером смены, аварийный ремонт, проверка службы безопасности.</p>
        <button type="button" className="button button--primary" onClick={() => onAction(quickActions[0])}>Ехать на собеседование · 35 мин</button>
      </div>
    );
  }


  if (id === "local") {
    return (
      <div className="local-window">
        <div className="feed-map local-window__map">
          <div className="feed-map__grid" />
          <span className="map-node map-node--player" style={{ left: "31%", top: "58%" }}>YOU</span>
          <span className="map-node map-node--contact" style={{ left: "73%", top: "36%" }}>MIRA</span>
          <span className="map-node map-node--alert" style={{ left: "52%", top: "72%" }}>POLICE</span>
          <div className="route-line" />
        </div>
        <div className="local-window__stats">
          <div><span>SECURITY</span><strong className="warning-text">LOW</strong></div>
          <div><span>LIGHTING</span><strong>OFFLINE</strong></div>
          <div><span>TRANSIT</span><strong>DELAYED</strong></div>
        </div>
        <div className="local-window__feed">
          <MobileFeedRow time="22:41" text="Отключена линия LC-04. Свет вернут после 01:30." />
          <MobileFeedRow time="22:34" text="У станции полиция проверяет документы." warning />
          <MobileFeedRow time="22:09" text="Night Canteen продаёт остатки смены за ₵ 28." />
        </div>
      </div>
    );
  }

  if (id === "journal") {
    const visible = session.events.filter((event) => journalFilter === "all" || event.category === journalFilter);
    return (
      <div className="journal-window">
        <select value={journalFilter} onChange={(event) => setJournalFilter(event.target.value as EventCategory | "all")}>
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
        <div className="settings-danger-zone">
          <div><strong>DEMO SESSION</strong><span>Сбросить время, состояние героя и журнал к старту.</span></div>
          <button type="button" className="button button--danger" onClick={onReset}>Сбросить демо</button>
        </div>
      </div>
    );
  }

  return (
    <div className="diagnostics-window">
      <div className="diagnostic-row"><span>UI SHELL</span><strong>ONLINE</strong><i>100%</i></div>
      <div className="diagnostic-row"><span>LOCAL STORAGE</span><strong>ONLINE</strong><i>100%</i></div>
      <div className="diagnostic-row"><span>PWA CACHE</span><strong>ARMED</strong><i>85%</i></div>
      <div className="diagnostic-row"><span>WORLD SIMULATION</span><strong>VERTICAL SLICE</strong><i>22%</i></div>
      <div className="diagnostic-row diagnostic-row--warning"><span>INDEXED DB</span><strong>NOT CONNECTED</strong><i>0%</i></div>
      <pre>{`NEON/LINK DIAGNOSTIC\nBUILD: 0.2.0\nWORLD: NL-7DB-0441\nACTIVE ENTITIES: 2\nQUEUED EVENTS: 5\nSTATUS: STABLE`}</pre>
    </div>
  );
}

function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-toggle">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  );
}
