import type { GameSession } from "../../world/state/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { getPlayerJob, skillLabel } from "../../gameplay/playerLoop/playerLoopSystem";
import { formatGameShortDateTime } from "../../core/time/gameTime";

function money(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

export function WorkScreen({
  session,
  onAction,
  onOpenVenue,
  onRouteTo
}: {
  session: GameSession;
  onAction: (action: LocalLifeAction) => void;
  onOpenVenue: (venueId: string) => void;
  onRouteTo: (locationId: string) => void;
}) {
  const state = session.playerLoop;
  const employment = state.employment;
  const activeJob = getPlayerJob(state);
  const workplace = employment ? session.urban.venues.find((venue) => venue.id === employment.venueId) : undefined;
  const workplaceBuilding = workplace ? session.urban.buildings.find((building) => building.id === workplace.buildingId) : undefined;
  const manager = employment?.managerPersonId ? session.people.people.find((person) => person.id === employment.managerPersonId) : undefined;
  const workHistory = state.history.filter((entry) => entry.category === "work").slice().reverse().slice(0, 12);

  return (
    <section className="screen work-screen" aria-labelledby="work-title">
      <header className="screen-heading work-heading">
        <div>
          <span>ЗАРАБОТОК</span>
          <h1 id="work-title">Работа</h1>
          <p>Здесь хранится контракт. Устройство и смена доступны только внутри конкретного заведения.</p>
        </div>
        <div className="work-heading__income">
          <span>ЗАРАБОТАНО</span>
          <strong>₵ {money(state.totalEarned)}</strong>
          <small>{state.shiftsWorked} смен</small>
        </div>
      </header>

      {activeJob && employment ? (
        <section className="simple-current-job">
          <div>
            <span>ТЕКУЩАЯ РАБОТА</span>
            <h2>{activeJob.title}</h2>
            <p>{employment.employerName}{workplaceBuilding ? ` · ${workplaceBuilding.addressCode}` : ""}</p>
            <small>{skillLabel(activeJob.skill)} {state.skills[activeJob.skill]} · база ₵ {activeJob.basePay} · смен здесь {employment.shiftsWorked}</small>
            {manager ? <small>Управляющий: {manager.name} · доверие {Math.round(manager.trustToPlayer)} · уважение {Math.round(manager.respectToPlayer)}</small> : null}
          </div>
          <div className="simple-current-job__actions">
            <button type="button" className="work-primary" onClick={() => onOpenVenue(employment.venueId)}>Показать работу на карте</button>
            <button type="button" className="work-secondary" onClick={() => onAction({ kind: "leave-job" })}>Уволиться</button>
          </div>
        </section>
      ) : (
        <section className="simple-current-job">
          <div>
            <span>БЕЗРАБОТНЫЙ</span>
            <h2>Постоянной работы нет</h2>
            <p>Ищи открытые магазины, клиники, мастерские, бары, залы и сервисные точки. Вакансия появляется внутри работодателя.</p>
          </div>
          <div className="simple-current-job__actions">
            <button type="button" className="work-primary" onClick={() => onRouteTo(session.life.housing.locationId)}>Начать с района дома</button>
          </div>
        </section>
      )}

      <section className="simple-section">
        <header><span>ПРАВИЛА</span><h2>Физическая работа</h2><p>Контракт принадлежит заведению, а не глобальному меню.</p></header>
        <div className="simple-card-grid work-rules">
          <article><div><span>1</span><h3>Найди работодателя</h3><p>Открой карту, доберись до заведения и войди внутрь.</p></div></article>
          <article><div><span>2</span><h3>Устройся на месте</h3><p>Вакансии зависят от типа бизнеса и твоего профильного навыка.</p></div></article>
          <article><div><span>3</span><h3>Отработай смену</h3><p>Одна кнопка двигает время, выдаёт зарплату и прокачивает один навык.</p></div></article>
        </div>
      </section>

      <section className="simple-section">
        <header><span>ИСТОРИЯ</span><h2>Рабочая биография</h2></header>
        <div className="simple-history">
          {workHistory.map((entry) => <article key={entry.id}><div><strong>{entry.title}</strong><span>{entry.detail}</span></div><small>{formatGameShortDateTime(entry.timestamp)}{entry.locationName ? ` · ${entry.locationName}` : ""}{entry.moneyDelta ? ` · ${entry.moneyDelta > 0 ? "+" : "−"}₵ ${Math.abs(entry.moneyDelta)}` : ""}</small></article>)}
          {!workHistory.length ? <p>Рабочих событий пока нет.</p> : null}
        </div>
      </section>
    </section>
  );
}
