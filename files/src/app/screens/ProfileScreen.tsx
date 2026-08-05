import type { GameSession } from "../../world/state/types";
import { formatGameDateLong, formatGameShortDateTime } from "../../core/time/gameTime";
import { boxingRankLabel, equipmentSlotLabel, getEquipment, getPlayerJob, skillLabel } from "../../gameplay/playerLoop/playerLoopSystem";
import type { EquipmentSlot, PlayerSkill } from "../../gameplay/playerLoop/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { activeObligations, activeRequests } from "../../gameplay/pressure/pressureSystem";
import { Icon } from "../../ui/components/Icons";
import type { GameScreen } from "../shared/types";
import { asset, currentActivity, currentLocation, districtName, playerOccupation, vehicleStateLabel } from "../shared/presentation";

const DAY_MS = 86_400_000;
type ProfileRoute = "map" | "nearby" | "work";
const SKILL_ORDER: PlayerSkill[] = ["strength", "endurance", "boxing", "shooting", "streetwise", "service", "technical", "medical"];
const SLOT_ORDER: EquipmentSlot[] = ["outfit", "armor", "weapon", "implant"];

interface ProfilePriority {
  tone: "danger" | "warn" | "neutral" | "good";
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel: string;
  route: ProfileRoute;
  targetLocationId?: string;
}

function housingTypeLabel(type: GameSession["life"]["housing"]["type"]): string {
  if (type === "capsule") return "Капсула";
  if (type === "room") return "Комната";
  return "Квартира";
}

function livedDays(session: GameSession): number {
  const createdAt = new Date(session.world.meta.createdAt).getTime();
  return Number.isFinite(createdAt) ? Math.max(1, Math.floor((session.timestamp - createdAt) / DAY_MS) + 1) : 1;
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function credits(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

function meter(value: number, inverse = false): JSX.Element {
  const normalized = percent(value);
  const danger = inverse ? normalized >= 75 : normalized <= 35;
  const warn = inverse ? normalized >= 55 : normalized <= 55;
  return <i className={danger ? "is-danger" : warn ? "is-warning" : "is-good"}><b style={{ width: `${normalized}%` }} /></i>;
}

function minutesUntil(timestamp: number, target: number): number {
  return Math.floor((target - timestamp) / 60_000);
}

function timeLeftLabel(timestamp: number, target: number): string {
  const minutes = minutesUntil(timestamp, target);
  if (minutes < 0) return `просрочено на ${Math.ceil(Math.abs(minutes) / 60)} ч.`;
  if (minutes < 60) return `${Math.max(0, minutes)} мин.`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} ч. ${minutes % 60} мин.`;
  return `${Math.floor(minutes / (24 * 60))} дн.`;
}

function priorityFor(session: GameSession): ProfilePriority {
  const condition = session.player.condition;
  const obligation = activeObligations(session.pressure)[0];
  const job = getPlayerJob(session.playerLoop);
  const employment = session.playerLoop.employment;

  if (condition.health <= 35) return { tone: "danger", eyebrow: "Здоровье", title: "Нужна медицинская помощь", detail: `Состояние ${percent(condition.health)}%. Найди открытую клинику.`, actionLabel: "Места рядом", route: "nearby" };
  if (condition.hunger >= 78) return { tone: "danger", eyebrow: "Голод", title: "Нужно поесть", detail: `Голод ${percent(condition.hunger)}%. Проверь еду в сумке или торговые точки.`, actionLabel: "Открыть действия", route: "nearby" };
  if (condition.fatigue >= 82) return { tone: "warn", eyebrow: "Усталость", title: "Нужно добраться до сна", detail: `Усталость ${percent(condition.fatigue)}%. Ошибки и риски уже растут.`, actionLabel: "Маршрут домой", route: "map", targetLocationId: session.life.housing.locationId };
  if (obligation && minutesUntil(session.timestamp, obligation.dueAt) <= 24 * 60) return { tone: obligation.status === "overdue" || obligation.status === "defaulted" ? "danger" : "warn", eyebrow: "Платёж", title: `${obligation.creditorName}: ₵ ${credits(obligation.amount)}`, detail: `${obligation.code} · ${timeLeftLabel(session.timestamp, obligation.dueAt)} · ${obligation.consequence}`, actionLabel: "Домашний терминал", route: "map", targetLocationId: session.life.housing.locationId };
  if (!job || !employment) return { tone: "neutral", eyebrow: "Доход", title: "Постоянной работы нет", detail: "Вакансии находятся внутри конкретных заведений города.", actionLabel: "Открыть работу", route: "work" };
  return { tone: "good", eyebrow: "Работа", title: job.title, detail: `Работодатель: ${employment.employerName}. Смена доступна только на месте.`, actionLabel: "Открыть работу", route: "work" };
}

export function ProfileScreen({ session, onOpen, onRouteTo, onAction }: { session: GameSession; onOpen: (screen: GameScreen) => void; onRouteTo: (locationId: string) => void; onAction: (action: LocalLifeAction) => void }) {
  const player = session.player;
  const position = session.localScene.playerPosition;
  const place = currentLocation(session);
  const building = position.buildingId ? session.urban.buildings.find((item) => item.id === position.buildingId) : undefined;
  const currentUnit = position.unitId ? session.urban.units.find((item) => item.id === position.unitId) : undefined;
  const currentVehicle = position.state === "vehicle" ? session.vehicles.vehicles.find((item) => item.id === session.vehicles.player.currentVehicleId) : undefined;
  const homeLocation = session.world.locations.find((item) => item.id === session.life.housing.locationId);
  const homeBuilding = session.urban.buildings.find((item) => item.anchorLocationId === homeLocation?.id);
  const playerHousehold = session.population.households.find((household) => household.memberIds.includes(player.id));
  const homeAddress = session.urban.householdAddresses.find((address) => address.householdId === playerHousehold?.id);
  const homeUnit = session.urban.units.find((item) => item.id === homeAddress?.unitId);
  const vehicle = session.vehicles.vehicles.find((item) => session.vehicles.player.ownedVehicleIds.includes(item.id));
  const job = getPlayerJob(session.playerLoop);
  const employment = session.playerLoop.employment;
  const warrants = session.playerCrime.warrants.filter((item) => item.status !== "closed" && item.status !== "arrested");
  const priority = priorityFor(session);
  const obligations = activeObligations(session.pressure);
  const requests = activeRequests(session.pressure);
  const latestEvents = session.events.filter((event) => event.importance >= 2).slice().sort((left, right) => right.timestamp - left.timestamp).slice(0, 5);
  const completedRequests = session.pressure.summaries.reduce((sum, item) => sum + item.requestsCompleted, 0) + session.pressure.currentDay.requestsCompleted;
  const firstRequest = requests[0];
  const firstRequestPerson = firstRequest ? session.people.people.find((person) => person.id === firstRequest.personId) : undefined;
  const firstRequestTargetId = firstRequestPerson?.currentLocationId ?? firstRequest?.targetLocationId;
  const requestPersonNearby = firstRequest ? session.localScene.actors.some((actor) => actor.activePersonId === firstRequest.personId && actor.interactable) : false;
  const positionTitle = currentVehicle?.modelName ?? building?.addressCode ?? place?.name ?? districtName(session);
  const positionDetail = currentVehicle ? `${currentVehicle.plate} · ${session.vehicles.player.seat === "driver" ? "за рулём" : "пассажир"}` : currentUnit ? `Помещение ${currentUnit.unitNumber} · этаж ${position.floor ?? currentUnit.floor}` : building ? `Этаж ${position.floor ?? 1}` : "На улице";
  const metrics = [["Здоровье", player.condition.health, false], ["Голод", player.condition.hunger, true], ["Усталость", player.condition.fatigue, true], ["Стресс", player.condition.stress, true]] as const;
  const historyStats = [
    { value: livedDays(session), label: "дней прожито" },
    { value: credits(session.playerLoop.totalEarned), label: "кредитов заработано" },
    { value: session.playerLoop.shiftsWorked, label: "смен завершено" },
    { value: completedRequests, label: "просьб выполнено" }
  ];

  return (
    <section className="screen profile-screen" aria-labelledby="profile-title">
      <header className="profile-heading"><div><span>ЛИЧНОЕ ДОСЬЕ</span><h1 id="profile-title">Профиль</h1><p>Текущее состояние и последствия решений.</p></div></header>

      <div className="profile-overview">
        <article className="profile-hero">
          <div className="profile-portrait"><img src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} /><span aria-hidden="true" /></div>
          <div className="profile-identity"><span>{playerOccupation(session)}</span><h2>{player.name}</h2><p>{player.age} лет · {player.origin}</p><strong>{currentActivity(session)}</strong></div>
          <div className="profile-wallet"><span>Баланс</span><strong>₵ {credits(player.balance)}</strong><small>{districtName(session)} · {session.world.city.name}</small></div>
          <div className="profile-location"><span>Текущее место</span><strong>{positionTitle}</strong><p>{positionDetail}</p></div>
        </article>

        <section className={`life-priority life-priority--${priority.tone}`}>
          <div className="life-priority__icon"><Icon name={priority.tone === "danger" || priority.tone === "warn" ? "alert" : "action"} size={25} /></div>
          <div><span>{priority.eyebrow}</span><h2>{priority.title}</h2><p>{priority.detail}</p></div>
          <button type="button" onClick={() => priority.targetLocationId ? onRouteTo(priority.targetLocationId) : onOpen(priority.route)}>{priority.actionLabel}<Icon name="chevron" size={17} /></button>
        </section>

        <section className="profile-vitals" aria-label="Состояние персонажа">{metrics.map(([label, value, inverse]) => <article key={label}><span>{label}</span><strong>{percent(value)}%</strong>{meter(value, inverse)}</article>)}</section>

        <section className="profile-section profile-characteristics">
          <header><div><span>ХАРАКТЕРИСТИКИ</span><h2>Навыки персонажа</h2></div><strong>{Math.round(SKILL_ORDER.reduce((sum, skill) => sum + session.playerLoop.skills[skill], 0) / SKILL_ORDER.length)}</strong></header>
          <div className="profile-skill-grid">
            {SKILL_ORDER.map((skill) => {
              const value = session.playerLoop.skills[skill];
              return <article key={skill}><span>{skillLabel(skill)}</span><strong>{value}</strong><i><b style={{ width: `${value}%` }} /></i></article>;
            })}
          </div>
        </section>

        <section className="profile-section profile-equipment">
          <header><div><span>СНАРЯЖЕНИЕ</span><h2>Инвентарь и экипировка</h2></div><strong>{session.playerLoop.ownedEquipmentIds.length}</strong></header>
          <div className="equipment-slots">
            {SLOT_ORDER.map((slot) => {
              const item = getEquipment(session.playerLoop.equipped[slot]);
              return <article key={slot}><span>{equipmentSlotLabel(slot)}</span><strong>{item?.name ?? "Пусто"}</strong><small>{item ? `Атака +${item.attack} · защита +${item.defense}` : "Бонусов нет"}</small>{item && slot !== "outfit" ? <button type="button" onClick={() => onAction({ kind: "unequip-item", slot })}>Снять</button> : null}</article>;
            })}
          </div>
          <div className="profile-owned-equipment">
            {session.playerLoop.ownedEquipmentIds.map((itemId) => {
              const item = getEquipment(itemId);
              if (!item) return null;
              const equipped = session.playerLoop.equipped[item.slot] === item.id;
              return <article key={item.id}><div><span>{equipmentSlotLabel(item.slot)}</span><strong>{item.name}</strong><small>{item.description}</small></div><button type="button" disabled={equipped} onClick={() => onAction({ kind: "equip-item", itemId: item.id })}>{equipped ? "Экипировано" : "Надеть"}</button></article>;
            })}
          </div>
          <p className="profile-equipment__hint">Новые предметы покупаются только в магазинах одежды, имплантов и оружия на карте.</p>
        </section>

        <div className="profile-grid">
          <section className="profile-section"><header><div><span>ТЕКУЩАЯ ЖИЗНЬ</span><h2>Статус</h2></div><button type="button" className="profile-section__link" onClick={() => onOpen("work")}>Работа</button></header><div className="profile-facts">
            <article><span>Профессия</span><strong>{job?.title ?? "Безработный"}</strong><p>{job && employment ? `${employment.employerName} · ~₵ ${credits(job.basePay)} · смен ${employment.shiftsWorked}` : "Вакансии находятся в заведениях города"}</p></article>
            <article><span>Бокс</span><strong>{boxingRankLabel(session.playerLoop.boxingRank)}</strong><p>Рейтинг {session.playerLoop.boxingRating} · {session.playerLoop.boxingWins}-{session.playerLoop.boxingLosses}</p></article>
            <article><span>Правовой риск</span><strong>{warrants.length ? `${warrants.length} активн.` : "Розыска нет"}</strong><p>Розыск {percent(session.playerCrime.heat)}% · преступлений {session.playerCrime.totals.crimesCommitted}</p></article>
            <article><span>Основной контакт</span><strong>{session.primaryContact?.name ?? "Не установлен"}</strong><p>{session.primaryContact?.role ?? "Связь не сформирована"}</p></article>
          </div></section>

          <section className="profile-section"><header><div><span>СОБСТВЕННОСТЬ</span><h2>Имущество</h2></div></header><div className="property-list">
            <article><i aria-hidden="true">⌂</i><div><strong>{homeBuilding?.addressCode ?? homeLocation?.name ?? "Жильё не назначено"}</strong><span>{housingTypeLabel(session.life.housing.type)}{homeUnit ? ` · ${homeUnit.unitNumber}` : ""}</span></div><em className={player.housingDaysLeft <= 2 ? "is-danger" : ""}>{player.housingDaysLeft > 0 ? `${player.housingDaysLeft} дн.` : "Просрочено"}</em></article>
            <article><i aria-hidden="true">◇</i><div><strong>{vehicle?.modelName ?? "Личной машины нет"}</strong><span>{vehicle ? `${vehicle.plate} · ${vehicleStateLabel(vehicle)}` : "Транспорт не зарегистрирован"}</span></div><em>{vehicle ? `${percent(vehicle.condition)}%` : "—"}</em></article>
          </div></section>
        </div>

        <div className="profile-pressure-grid">
          <section className="life-panel"><header><div><span>СРОКИ</span><h2>Обязательства</h2></div><strong>{obligations.length}</strong></header><div className="life-list">{obligations.slice(0, 4).map((obligation) => <article key={obligation.id} className={obligation.status !== "active" ? "is-danger" : ""}><div><strong>{obligation.creditorName}</strong><span>{obligation.code} · {timeLeftLabel(session.timestamp, obligation.dueAt)}</span></div><em>₵ {credits(obligation.amount)}</em></article>)}{!obligations.length ? <p>Активных платежей нет.</p> : null}</div>{obligations.length ? <button type="button" onClick={() => homeLocation ? onRouteTo(homeLocation.id) : onOpen("map")}>Домашний терминал</button> : null}</section>
          <section className="life-panel"><header><div><span>ЛЮДИ</span><h2>Просьбы</h2></div><strong>{requests.length}</strong></header><div className="life-list">{requests.slice(0, 4).map((request) => <article key={request.id}><div><strong>{request.title}</strong><span>{request.code} · {timeLeftLabel(session.timestamp, request.dueAt)} · {request.status === "accepted" ? "принято" : "ожидает ответа"}</span></div><em>₵ {credits(request.reward)}</em></article>)}{!requests.length ? <p>Никто ничего не ждёт.</p> : null}</div>{firstRequest ? <button type="button" onClick={() => requestPersonNearby ? onOpen("nearby") : firstRequestTargetId && onRouteTo(firstRequestTargetId)}>{requestPersonNearby ? "Открыть человека рядом" : "Маршрут к просьбе"}</button> : null}</section>
        </div>

        <section className="profile-section profile-events"><header><div><span>ПОСЛЕДСТВИЯ</span><h2>Что изменилось</h2></div></header><div className="life-list">{latestEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{formatGameShortDateTime(event.timestamp)} · {event.detail}</span></div></article>)}{!latestEvents.length ? <p>Значимых событий пока нет.</p> : null}</div></section>

        <section className="profile-section profile-biography"><header><div><span>БИОГРАФИЯ</span><h2>Личная история</h2></div><strong>{session.playerLoop.biography.length}</strong></header><div className="life-list">{[...session.playerLoop.biography].reverse().slice(0, 12).map((entry) => <article key={entry.id}><div><strong>{entry.title}</strong><span>{formatGameShortDateTime(entry.timestamp)}{entry.locationName ? ` · ${entry.locationName}` : ""} · {entry.detail}</span></div></article>)}{!session.playerLoop.biography.length ? <p>Значимых личных событий пока нет.</p> : null}</div></section>

        <section className="profile-section"><header><div><span>ИСТОРИЯ МИРА</span><h2>След</h2></div></header><div className="profile-history">{historyStats.map((metric) => <article key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div><p className="profile-created">Мир создан {formatGameDateLong(new Date(session.world.meta.createdAt).getTime())}</p></section>
      </div>
    </section>
  );
}
