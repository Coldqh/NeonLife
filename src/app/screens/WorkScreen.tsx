import type { GameSession } from "../../world/state/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import {
  boxingRankLabel,
  EQUIPMENT_CATALOG,
  equipmentSlotLabel,
  getEquipment,
  getPlayerJob,
  PLAYER_JOBS,
  skillLabel,
  STREET_FIGHTS,
  TRAINING_ACTIONS
} from "../../gameplay/playerLoop/playerLoopSystem";
import type { EquipmentSlot, PlayerSkill } from "../../gameplay/playerLoop/types";
import { formatGameShortDateTime } from "../../core/time/gameTime";

function money(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

const SKILL_ORDER: PlayerSkill[] = ["strength", "endurance", "boxing", "shooting", "streetwise", "service", "technical", "medical"];
const SLOT_ORDER: EquipmentSlot[] = ["outfit", "armor", "weapon", "implant"];

export function WorkScreen({ session, onAction }: { session: GameSession; onAction: (action: LocalLifeAction) => void }) {
  const state = session.playerLoop;
  const activeJob = getPlayerJob(state);
  const canWork = Boolean(activeJob && session.player.condition.health >= 20 && session.player.condition.fatigue <= 92);

  return (
    <section className="screen work-screen">
      <header className="screen-heading work-heading">
        <div>
          <span>ОДНОКНОПОЧНЫЙ ЦИКЛ</span>
          <h1>Жизнь и развитие</h1>
          <p>Одна кнопка — время, результат, деньги и один прокачанный параметр.</p>
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
          <p>{activeJob?.description ?? "Выбери работу ниже. Собеседований, расписаний и отдельных задач больше нет."}</p>
        </div>
        {activeJob ? (
          <div className="simple-current-job__actions">
            <button type="button" className="work-primary" disabled={!canWork} onClick={() => onAction({ kind: "work-shift" })}>Отработать смену · {activeJob.durationMinutes / 60} ч. · ~₵ {activeJob.basePay}</button>
            <button type="button" className="work-secondary" onClick={() => onAction({ kind: "leave-job" })}>Уволиться</button>
          </div>
        ) : null}
      </section>

      <section className="work-skills" aria-label="Навыки игрока">
        {SKILL_ORDER.map((skill) => {
          const value = state.skills[skill];
          return <article key={skill}><span>{skillLabel(skill)}</span><strong>{value}</strong><i><b style={{ width: `${value}%` }} /></i></article>;
        })}
      </section>

      <section className="simple-section">
        <header><span>РАБОТА</span><h2>Выбрать профессию</h2><p>Каждая смена прокачивает только навык профессии.</p></header>
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
        <header><span>ТРЕНИРОВКИ</span><h2>Прокачать один параметр</h2><p>Никаких залов, тренеров и расписаний на первой версии.</p></header>
        <div className="simple-card-grid">
          {TRAINING_ACTIONS.map((training) => (
            <article key={training.id}>
              <div><span>{skillLabel(training.skill)} {state.skills[training.skill]}</span><h3>{training.title}</h3><p>{training.description}</p></div>
              <dl><div><dt>Время</dt><dd>{training.durationMinutes} мин.</dd></div><div><dt>Цена</dt><dd>₵ {training.cost}</dd></div><div><dt>Прирост</dt><dd>+{training.gainMin}–{training.gainMax}</dd></div></dl>
              <button type="button" disabled={session.player.balance < training.cost} onClick={() => onAction({ kind: "train", trainingId: training.id })}>Тренироваться</button>
            </article>
          ))}
        </div>
      </section>

      <section className="simple-section">
        <header><span>СНАРЯЖЕНИЕ</span><h2>Четыре слота</h2><p>Один предмет на слот. Без прочности, крафта и модификаций.</p></header>
        <div className="equipment-slots">
          {SLOT_ORDER.map((slot) => {
            const item = getEquipment(state.equipped[slot]);
            return <article key={slot}><span>{equipmentSlotLabel(slot)}</span><strong>{item?.name ?? "Пусто"}</strong><small>{item ? `Атака +${item.attack} · защита +${item.defense}` : "Бонусов нет"}</small>{item && slot !== "outfit" ? <button type="button" onClick={() => onAction({ kind: "unequip-item", slot })}>Снять</button> : null}</article>;
          })}
        </div>
        <div className="simple-card-grid">
          {EQUIPMENT_CATALOG.filter((item) => item.price > 0).map((item) => {
            const owned = state.ownedEquipmentIds.includes(item.id);
            const equipped = state.equipped[item.slot] === item.id;
            const requirementMet = !item.requiredSkill || state.skills[item.requiredSkill] >= (item.minimumSkill ?? 0);
            return (
              <article key={item.id} className={equipped ? "is-active" : ""}>
                <div><span>{equipmentSlotLabel(item.slot)}</span><h3>{item.name}</h3><p>{item.description}</p></div>
                <dl><div><dt>Атака</dt><dd>+{item.attack}</dd></div><div><dt>Защита</dt><dd>+{item.defense}</dd></div><div><dt>Цена</dt><dd>₵ {item.price}</dd></div></dl>
                {owned ? <button type="button" disabled={equipped} onClick={() => onAction({ kind: "equip-item", itemId: item.id })}>{equipped ? "Экипировано" : "Надеть"}</button> : <button type="button" disabled={session.player.balance < item.price || !requirementMet} onClick={() => onAction({ kind: "buy-equipment", itemId: item.id })}>{requirementMet ? "Купить" : `Нужен ${item.requiredSkill ? skillLabel(item.requiredSkill) : "навык"} ${item.minimumSkill}`}</button>}
              </article>
            );
          })}
        </div>
      </section>

      <section className="simple-section">
        <header><span>УЛИЧНЫЕ ДРАКИ</span><h2>Быстрый расчёт боя</h2><p>Пока бой решается одной кнопкой. Клеточная тактика будет отдельным следующим слоем.</p></header>
        <div className="simple-card-grid">
          {STREET_FIGHTS.map((fight) => (
            <article key={fight.id}>
              <div><span>Улица {state.skills.streetwise}/{fight.minimumStreetwise}</span><h3>{fight.title}</h3><p>{fight.description}</p></div>
              <dl><div><dt>Сила врага</dt><dd>{fight.opponentPower}</dd></div><div><dt>Награда</dt><dd>₵ {fight.reward}</dd></div><div><dt>Оружие</dt><dd>{fight.weaponRule === "unarmed" ? "кулаки" : fight.weaponRule === "melee" ? "без огнестрела" : "любое"}</dd></div></dl>
              <button type="button" disabled={state.skills.streetwise < fight.minimumStreetwise} onClick={() => onAction({ kind: "street-fight", fightId: fight.id })}>Начать драку</button>
            </article>
          ))}
        </div>
        <p className="simple-summary">Победы {state.streetFightWins} · поражения {state.streetFightLosses}</p>
      </section>

      <section className="simple-section boxing-card">
        <header><span>БОКС</span><h2>{boxingRankLabel(state.boxingRank)}</h2><p>Рейтинг {state.boxingRating} · победы {state.boxingWins} · поражения {state.boxingLosses}</p></header>
        <button type="button" className="work-primary" onClick={() => onAction({ kind: "boxing-fight" })}>Провести следующий бой</button>
      </section>

      <section className="simple-section">
        <header><span>ИСТОРИЯ</span><h2>Последние действия</h2></header>
        <div className="simple-history">
          {[...state.history].reverse().slice(0, 12).map((entry) => <article key={entry.id}><div><strong>{entry.title}</strong><span>{entry.detail}</span></div><small>{formatGameShortDateTime(entry.timestamp)}{entry.moneyDelta ? ` · ${entry.moneyDelta > 0 ? "+" : "−"}₵ ${Math.abs(entry.moneyDelta)}` : ""}</small></article>)}
        </div>
      </section>
    </section>
  );
}
