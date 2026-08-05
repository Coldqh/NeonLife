import type { GameSession } from "../../world/state/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { getPlayerJob, PLAYER_JOBS, skillLabel } from "../../gameplay/playerLoop/playerLoopSystem";
import { formatGameShortDateTime } from "../../core/time/gameTime";

function money(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

export function WorkScreen({ session, onAction }: { session: GameSession; onAction: (action: LocalLifeAction) => void }) {
  const state = session.playerLoop;
  const activeJob = getPlayerJob(state);
  const canWork = Boolean(activeJob && session.player.condition.health >= 20 && session.player.condition.fatigue <= 92);
  const workHistory = state.history.filter((entry) => entry.category === "work").slice().reverse().slice(0, 10);

  return (
    <section className="screen work-screen" aria-labelledby="work-title">
      <header className="screen-heading work-heading">
        <div>
          <span>ЗАРАБОТОК</span>
          <h1 id="work-title">Работа</h1>
          <p>Выбор профессии и одна кнопка смены. Остальные системы находятся в мире и профиле.</p>
        </div>
        <div className="work-heading__income">
          <span>ЗАРАБОТАНО</span>
          <strong>₵ {money(state.totalEarned)}</strong>
          <small>{state.shiftsWorked} смен</small>
        </div>
      </header>

      <section className="simple-current-job">
        <div>
          <span>ТЕКУЩАЯ РАБОТА</span>
          <h2>{activeJob?.title ?? "Безработный"}</h2>
          <p>{activeJob?.description ?? "Выбери доступную профессию ниже."}</p>
        </div>
        {activeJob ? (
          <div className="simple-current-job__actions">
            <button type="button" className="work-primary" disabled={!canWork} onClick={() => onAction({ kind: "work-shift" })}>
              Отработать смену · {activeJob.durationMinutes / 60} ч. · ~₵ {activeJob.basePay}
            </button>
            <button type="button" className="work-secondary" onClick={() => onAction({ kind: "leave-job" })}>Уволиться</button>
          </div>
        ) : null}
      </section>

      <section className="simple-section">
        <header><span>ВАКАНСИИ</span><h2>Выбрать профессию</h2><p>Смена прокачивает только профильный навык.</p></header>
        <div className="simple-card-grid">
          {PLAYER_JOBS.map((job) => {
            const skill = state.skills[job.skill];
            const ready = skill >= job.minimumSkill;
            const active = state.activeJobId === job.id;
            return (
              <article key={job.id} className={active ? "is-active" : ""}>
                <div><span>{skillLabel(job.skill)} {skill}/{job.minimumSkill}</span><h3>{job.title}</h3><p>{job.description}</p></div>
                <dl><div><dt>Смена</dt><dd>{job.durationMinutes / 60} ч.</dd></div><div><dt>База</dt><dd>₵ {job.basePay}</dd></div><div><dt>Усталость</dt><dd>+{job.fatigue}</dd></div></dl>
                <button type="button" disabled={!ready || active} onClick={() => onAction({ kind: "select-job", jobId: job.id })}>{active ? "Выбрано" : ready ? "Устроиться" : `Нужен ${skillLabel(job.skill)} ${job.minimumSkill}`}</button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="simple-section">
        <header><span>ИСТОРИЯ</span><h2>Последние смены</h2></header>
        <div className="simple-history">
          {workHistory.map((entry) => <article key={entry.id}><div><strong>{entry.title}</strong><span>{entry.detail}</span></div><small>{formatGameShortDateTime(entry.timestamp)}{entry.moneyDelta ? ` · ${entry.moneyDelta > 0 ? "+" : "−"}₵ ${Math.abs(entry.moneyDelta)}` : ""}</small></article>)}
          {!workHistory.length ? <p>Рабочих событий пока нет.</p> : null}
        </div>
      </section>
    </section>
  );
}
