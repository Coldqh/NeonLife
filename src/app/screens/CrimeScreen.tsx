import type { GameSession } from "../../world/state/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { formatGameShortDateTime } from "../../core/time/gameTime";
import type { CrimeEvidenceKind, GangFactionState, PlayerCrimeIncidentState } from "../../simulation/crime/playerCrimeTypes";

const CRIME_LABELS = {
  shoplifting: "Кража товара",
  "register-robbery": "Ограбление кассы",
  "vehicle-theft": "Угон автомобиля",
  assault: "Нападение"
} as const;

const EVIDENCE_LABELS: Record<CrimeEvidenceKind, string> = {
  camera: "камеры",
  witness: "свидетели",
  "stolen-property": "краденое при себе",
  "vehicle-plate": "ориентировка на машину",
  blood: "следы борьбы",
  transaction: "денежный след"
};

function responseLabel(status: GameSession["playerCrime"]["policeResponses"][number]["status"]): string {
  if (status === "dispatched") return "вызван";
  if (status === "en-route") return "едет";
  if (status === "on-scene") return "на месте";
  if (status === "searching") return "прочёсывает район";
  return "завершён";
}

function incidentStatus(incident: PlayerCrimeIncidentState): string {
  if (incident.status === "unreported") return incident.reportSource === "none" ? "никто не сообщил" : "сообщение ещё не поступило";
  if (incident.status === "reported") return "дело зарегистрировано";
  if (incident.status === "responding") return "полиция реагирует";
  if (incident.status === "investigating") return "идёт расследование";
  return "дело закрыто";
}

function riskLabel(value: number): string {
  if (value >= 75) return "критический";
  if (value >= 50) return "высокий";
  if (value >= 25) return "заметный";
  return "низкий";
}

function influenceLabel(value: number): string {
  if (value >= 75) return "доминирует";
  if (value >= 50) return "сильное присутствие";
  if (value >= 25) return "локальное присутствие";
  return "слабые следы";
}

function memberEstimate(gang: GangFactionState): string {
  if (gang.knownIntel >= 75) return `${gang.activeMembers} участников`;
  if (gang.knownIntel >= 50) {
    const lower = Math.max(1, Math.floor(gang.activeMembers / 10) * 10);
    return `примерно ${lower}–${lower + 20} участников`;
  }
  return "состав неизвестен";
}

function gangName(gang: GangFactionState): string {
  return gang.knownIntel >= 24 ? gang.name : "Неизвестная группировка";
}

function knownRiskText(incident: PlayerCrimeIncidentState): string {
  const labels = incident.playerAwareEvidenceKinds.map((kind) => EVIDENCE_LABELS[kind]);
  if (!labels.length && incident.reportSource === "none") return "явных свидетелей и тревоги не было";
  if (!labels.length) return "источник сообщения неизвестен";
  return labels.join(" · ");
}

function custodyPanel(session: GameSession, onAction: (action: LocalLifeAction) => void): JSX.Element | null {
  const custody = session.playerCrime.custody;
  if (!custody || custody.status !== "detained") return null;
  if (custody.phase === "stopped") {
    return (
      <section className="crime-custody crime-custody--stopped">
        <div><span>ПОЛИЦЕЙСКАЯ ОСТАНОВКА</span><h2>Требуют пройти обыск</h2><p>{custody.reason}. До решения дела штраф и срок не окончательны.</p></div>
        <div className="crime-custody__actions">
          <button type="button" onClick={() => onAction({ kind: "resolve-custody", method: "submit-search" })}>Подчиниться обыску</button>
          <button type="button" className="is-risky" onClick={() => onAction({ kind: "resolve-custody", method: "resist-search" })}>Сопротивляться</button>
          <button type="button" className="is-danger" disabled={custody.escapeAttempted} onClick={() => onAction({ kind: "resolve-custody", method: "attempt-escape" })}>Попытаться сбежать</button>
        </div>
      </section>
    );
  }
  if (custody.phase === "searched") {
    return (
      <section className="crime-custody crime-custody--searched">
        <div><span>ОБЫСК ЗАВЕРШЁН</span><h2>{custody.searchOutcome ?? "Материалы переданы дежурному"}</h2><p>Следующий этап — разбор дела. После него можно оплатить штраф или отбыть назначенный срок.</p></div>
        <div className="crime-custody__actions"><button type="button" onClick={() => onAction({ kind: "resolve-custody", method: "proceed-hearing" })}>Перейти к разбору дела</button></div>
      </section>
    );
  }
  return (
    <section className="crime-custody crime-custody--hearing">
      <div><span>РЕШЕНИЕ ПО ДЕЛУ</span><h2>Штраф ₵ {custody.fine} или {custody.sentenceHours} ч. под стражей</h2><p>Освобождение после отбытия срока: {formatGameShortDateTime(custody.releaseAt)}. Изъято предметов: {custody.confiscatedPropertyIds.length}.</p></div>
      <div className="crime-custody__actions">
        <button type="button" disabled={session.player.balance < custody.fine} onClick={() => onAction({ kind: "resolve-custody", method: "pay" })}>Оплатить штраф</button>
        <button type="button" onClick={() => onAction({ kind: "resolve-custody", method: "serve" })}>Отбыть срок</button>
      </div>
    </section>
  );
}

export function CrimeScreen({ session, onAction }: { session: GameSession; onAction: (action: LocalLifeAction) => void }) {
  const state = session.playerCrime;
  const position = session.localScene.playerPosition;
  const sector = session.metropolitan.sectors.find((item) => item.id === position.sectorId);
  const district = session.world.districts.find((item) => item.id === sector?.districtId);
  const law = session.government.districts.find((item) => item.districtId === sector?.districtId);
  const identifiedWarrants = state.warrants.filter((item) => item.status === "identified");
  const visibleResponses = state.policeResponses.filter((item) => item.status !== "resolved" && item.sectorId === position.sectorId);
  const property = state.stolenProperty.filter((item) => !item.confiscatedAt && !item.disposedAt);
  const knownGangs = state.gangs.filter((gang) => gang.knownIntel >= 12).sort((left, right) => right.knownIntel - left.knownIntel);
  const knownTraceKinds = new Set(state.incidents.flatMap((incident) => incident.playerAwareEvidenceKinds));
  const incidents = state.incidents.slice().sort((left, right) => right.occurredAt - left.occurredAt).slice(0, 18);

  return (
    <section className="crime-screen" aria-labelledby="crime-title">
      <header className="crime-screen__hero">
        <div><span>РИСК И ПОСЛЕДСТВИЯ</span><h1 id="crime-title">Криминал</h1><p>Только то, что персонаж видел, знает или может оценить по происходящему вокруг.</p></div>
        <div className={`crime-heat crime-heat--${state.heat >= 70 ? "high" : state.heat >= 35 ? "medium" : "low"}`}><strong>{Math.round(state.heat)}</strong><span>{riskLabel(state.heat)} риск</span></div>
      </header>

      {custodyPanel(session, onAction)}

      <section className="crime-district">
        <div><span>ТЕКУЩИЙ РАЙОН</span><strong>{district?.name ?? "Неизвестный район"}</strong><small>Публичная обстановка, а не внутренние данные полиции</small></div>
        <article><span>Патрули</span><strong>{riskLabel(law?.patrolCoverage ?? district?.securityLevel ?? 0)}</strong></article>
        <article><span>Готовность полиции</span><strong>{riskLabel(law?.policeReadiness ?? district?.securityLevel ?? 0)}</strong></article>
        <article><span>Уличное влияние</span><strong>{influenceLabel(district?.gangInfluence ?? 0)}</strong></article>
      </section>

      <section className="crime-stats" aria-label="Криминальная сводка игрока">
        <article><span>Совершено</span><strong>{state.totals.crimesCommitted}</strong></article>
        <article><span>Известный розыск</span><strong>{identifiedWarrants.length}</strong></article>
        <article><span>Известные следы</span><strong>{knownTraceKinds.size}</strong></article>
        <article><span>Краденое при себе</span><strong>{property.length}</strong></article>
        <article><span>Задержания</span><strong>{state.totals.arrests}</strong></article>
        <article><span>Патрули рядом</span><strong>{visibleResponses.length}</strong></article>
      </section>

      <div className="crime-grid">
        <section className="crime-panel">
          <header><div><span>ИЗВЕСТНЫЕ ОРИЕНТИРОВКИ</span><h2>Розыск игрока</h2></div><strong>{identifiedWarrants.length}</strong></header>
          <div className="crime-list">
            {identifiedWarrants.map((warrant) => {
              const warrantDistrict = session.world.districts.find((item) => item.id === warrant.districtId);
              return (
                <article key={warrant.id}>
                  <div><strong>{warrant.scope === "city" ? "Городская ориентировка" : "Розыск в районе"}</strong><span>{warrantDistrict?.name ?? "Район"}</span><small>{warrant.charges.map((kind) => CRIME_LABELS[kind]).join(" · ")}</small></div>
                  <b>{riskLabel(warrant.heat)}<small>давление</small></b>
                </article>
              );
            })}
            {!identifiedWarrants.length ? <p>Персонаж не знает об активной ориентировке на своё имя.</p> : null}
          </div>
        </section>

        <section className="crime-panel">
          <header><div><span>В ПОЛЕ ЗРЕНИЯ</span><h2>Полиция рядом</h2></div><strong>{visibleResponses.length}</strong></header>
          <div className="crime-list">
            {visibleResponses.map((response) => {
              const incident = state.incidents.find((item) => item.id === response.incidentId);
              const distance = Math.round(Math.hypot(response.currentX - position.xM, response.currentY - position.yM));
              return <article key={response.id}><div><strong>{response.unitCode}</strong><span>{responseLabel(response.status)}{incident ? ` · ${CRIME_LABELS[incident.kind]}` : ""}</span><small>{distance <= 120 ? "слышно или видно поблизости" : "в пределах сектора"}</small></div><b>{distance} м<small>от игрока</small></b></article>;
            })}
            {!visibleResponses.length ? <p>В текущем секторе активных полицейских ответов не видно.</p> : null}
          </div>
        </section>

        <section className="crime-panel crime-panel--wide">
          <header><div><span>ЛИЧНАЯ ХРОНОЛОГИЯ</span><h2>Совершённые действия</h2></div><strong>{state.incidents.length}</strong></header>
          <div className="crime-list crime-list--incidents">
            {incidents.map((incident) => (
              <article key={incident.id}>
                <i className={`crime-kind crime-kind--${incident.kind}`}>!</i>
                <div><strong>{CRIME_LABELS[incident.kind]}</strong><span>{incidentStatus(incident)} · {formatGameShortDateTime(incident.occurredAt)}</span><small>{incident.success ? `получено ценностей на ₵ ${incident.stolenValue}` : "попытка сорвалась"} · заметные риски: {knownRiskText(incident)}</small></div>
                <b>{riskLabel(incident.heat)}<small>риск эпизода</small></b>
              </article>
            ))}
            {!incidents.length ? <p>Персонаж ещё не совершал преступлений.</p> : null}
          </div>
        </section>

        <section className="crime-panel">
          <header><div><span>ПРИ СЕБЕ</span><h2>Краденое имущество</h2></div><strong>{property.length}</strong></header>
          <div className="crime-list">
            {property.map((item) => <article key={item.id}><div><strong>{item.name}</strong><span>₵ {item.value} · количество {item.quantity}</span><small>Может связать игрока с происшествием при обыске.</small></div></article>)}
            {!property.length ? <p>Краденых вещей при персонаже нет.</p> : null}
          </div>
        </section>

        <section className="crime-panel">
          <header><div><span>УЛИЧНЫЕ СВЕДЕНИЯ</span><h2>Группировки</h2></div><strong>{knownGangs.length}</strong></header>
          <div className="crime-list crime-list--gangs">
            {knownGangs.map((gang) => {
              const home = session.world.districts.find((item) => item.id === gang.homeDistrictId);
              const rival = gang.warWithGangId ? state.gangs.find((item) => item.id === gang.warWithGangId) : undefined;
              return (
                <article key={gang.id}>
                  <div><strong>{gangName(gang)}</strong><span>{home?.name ?? "Город"} · {influenceLabel(gang.influence)}</span><small>{memberEstimate(gang)}{gang.knownIntel >= 60 ? ` · операций ${gang.activeOperations}` : ""}{gang.conflictIntensity >= 48 ? ` · конфликт с ${rival ? gangName(rival) : "конкурентами"}` : ""}{gang.knownIntel >= 68 && gang.conflictLosses > 0 ? ` · потери ${gang.conflictLosses}` : ""}</small></div>
                  <b>{Math.round(gang.knownIntel)}%<small>известно</small></b>
                </article>
              );
            })}
            {!knownGangs.length ? <p>Надёжных сведений о местных группировках нет.</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
