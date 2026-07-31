import type { GameSession } from "../../world/state/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { formatGameShortDateTime } from "../../core/time/gameTime";

const CRIME_LABELS = {
  shoplifting: "Кража товара",
  "register-robbery": "Ограбление кассы",
  "vehicle-theft": "Угон автомобиля",
  assault: "Нападение"
} as const;

const timeLabel = formatGameShortDateTime;

function responseLabel(status: GameSession["playerCrime"]["policeResponses"][number]["status"]): string {
  if (status === "dispatched") return "Вызван";
  if (status === "en-route") return "Едет";
  if (status === "on-scene") return "На месте";
  if (status === "searching") return "Ищет подозреваемого";
  return "Завершён";
}

export function CrimeScreen({ session, onAction }: { session: GameSession; onAction: (action: LocalLifeAction) => void }) {
  const state = session.playerCrime;
  const activeWarrants = state.warrants.filter((item) => item.status === "identified" || item.status === "unknown-suspect");
  const activeResponses = state.policeResponses.filter((item) => item.status !== "resolved");
  const property = state.stolenProperty.filter((item) => !item.confiscatedAt && !item.disposedAt);
  const custody = state.custody?.status === "detained" ? state.custody : null;

  return (
    <div className="crime-screen">
      <header className="crime-screen__hero">
        <div><span>ГОРОДСКОЙ РОЗЫСК</span><h1>Криминал</h1><p>Свидетели, камеры, доказательства, патрули и территории банд.</p></div>
        <div className={`crime-heat crime-heat--${state.heat >= 70 ? "high" : state.heat >= 35 ? "medium" : "low"}`}><strong>{Math.round(state.heat)}</strong><span>уровень розыска</span></div>
      </header>

      {custody ? (
        <section className="crime-custody">
          <div><span>ЗАДЕРЖАН</span><h2>{custody.reason}</h2><p>Освобождение: {timeLabel(custody.releaseAt)} · штраф ₵ {custody.fine} · изъято предметов {custody.confiscatedPropertyIds.length}</p></div>
          <div><button type="button" disabled={session.player.balance < custody.fine} onClick={() => onAction({ kind: "resolve-custody", method: "pay" })}>Оплатить штраф</button><button type="button" onClick={() => onAction({ kind: "resolve-custody", method: "serve" })}>Отбыть задержание</button></div>
        </section>
      ) : null}

      <section className="crime-stats">
        <article><span>Преступления</span><strong>{state.totals.crimesCommitted}</strong></article>
        <article><span>Активные дела</span><strong>{activeWarrants.length}</strong></article>
        <article><span>Улики</span><strong>{state.evidence.length}</strong></article>
        <article><span>Украдено</span><strong>₵ {state.totals.stolenCredits}</strong></article>
        <article><span>Задержания</span><strong>{state.totals.arrests}</strong></article>
        <article><span>Патрули</span><strong>{activeResponses.length}</strong></article>
      </section>

      <div className="crime-grid">
        <section className="crime-panel">
          <header><div><span>ОРИЕНТИРОВКИ</span><h2>Активный розыск</h2></div><strong>{activeWarrants.length}</strong></header>
          <div className="crime-list">
            {activeWarrants.map((warrant) => {
              const district = session.world.districts.find((item) => item.id === warrant.districtId);
              return <article key={warrant.id}><div><strong>{warrant.status === "identified" ? "Личность установлена" : "Неизвестный подозреваемый"}</strong><span>{district?.name ?? "Район"} · {warrant.scope === "city" ? "городской" : "районный"} розыск</span><small>{warrant.charges.map((kind) => CRIME_LABELS[kind]).join(" · ")}</small></div><b>{Math.round(warrant.identityConfidence)}%<small>опознание</small></b></article>;
            })}
            {!activeWarrants.length ? <p>Активных ориентировок нет.</p> : null}
          </div>
        </section>

        <section className="crime-panel">
          <header><div><span>DSB</span><h2>Полицейские ответы</h2></div><strong>{activeResponses.length}</strong></header>
          <div className="crime-list">
            {activeResponses.map((response) => {
              const incident = state.incidents.find((item) => item.id === response.incidentId);
              return <article key={response.id}><div><strong>{response.unitCode}</strong><span>{responseLabel(response.status)} · {incident ? CRIME_LABELS[incident.kind] : "дело"}</span><small>Прибытие {timeLabel(response.arrivesAt)}</small></div><b>{Math.round(Math.hypot(response.targetX - response.currentX, response.targetY - response.currentY))} м<small>до места</small></b></article>;
            })}
            {!activeResponses.length ? <p>Активных вызовов нет.</p> : null}
          </div>
        </section>

        <section className="crime-panel crime-panel--wide">
          <header><div><span>ХРОНОЛОГИЯ</span><h2>Преступления игрока</h2></div><strong>{state.incidents.length}</strong></header>
          <div className="crime-list crime-list--incidents">
            {state.incidents.slice(0, 16).map((incident) => {
              const evidence = state.evidence.filter((item) => item.incidentId === incident.id);
              return <article key={incident.id}><i className={`crime-kind crime-kind--${incident.kind}`}>!</i><div><strong>{CRIME_LABELS[incident.kind]}</strong><span>{incident.status} · {timeLabel(incident.occurredAt)}</span><small>{incident.success ? `Успех · ценность ₵ ${incident.stolenValue}` : "Попытка сорвалась"} · свидетели {incident.witnessActorIds.length} · улики {evidence.length}</small></div><b>{incident.heat}<small>опасность</small></b></article>;
            })}
            {!state.incidents.length ? <p>Игрок пока не совершал зарегистрированных преступлений.</p> : null}
          </div>
        </section>

        <section className="crime-panel">
          <header><div><span>ИЗЪЯТИЕ</span><h2>Краденое имущество</h2></div><strong>{property.length}</strong></header>
          <div className="crime-list">
            {property.map((item) => <article key={item.id}><div><strong>{item.name}</strong><span>₵ {item.value} · количество {item.quantity}</span><small>Сила улики {item.evidenceStrength}% · получено {timeLabel(item.acquiredAt)}</small></div></article>)}
            {!property.length ? <p>Краденых вещей при игроке нет.</p> : null}
          </div>
        </section>

        <section className="crime-panel">
          <header><div><span>УЛИЧНАЯ ВЛАСТЬ</span><h2>Банды</h2></div><strong>{state.gangs.length}</strong></header>
          <div className="crime-list">
            {state.gangs.map((gang) => {
              const district = session.world.districts.find((item) => item.id === gang.homeDistrictId);
              return <article key={gang.id}><div><strong>{gang.name}</strong><span>{district?.name ?? "Город"} · {gang.activeMembers} участников</span><small>Точек под контролем {gang.controlledVenueIds.length} · касса ₵ {Math.round(gang.cash)}</small></div><b>{Math.round(gang.influence)}%<small>влияние</small></b></article>;
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
