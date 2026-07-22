import type { CitySituation } from "../../gameplay/situations/types";
import { Icon } from "./Icons";

interface SituationGateProps {
  situation: CitySituation | null;
  personName?: string;
  locationName?: string;
  balance: number;
  onResolve: (choiceId: string) => void;
}

export function SituationGate({
  situation,
  personName,
  locationName,
  balance,
  onResolve
}: SituationGateProps) {
  if (!situation) return null;

  return (
    <div className="situation-gate" role="dialog" aria-modal="true" aria-labelledby="situation-title">
      <section className={`situation-card situation-card--${situation.type}`}>
        <header className="situation-card__header">
          <div className="situation-card__signal">
            <Icon name="alert" size={22} />
          </div>
          <div>
            <span>DECISION REQUIRED / {situation.type.toUpperCase()}</span>
            <h2 id="situation-title">{situation.title}</h2>
            <small>{locationName ?? "CURRENT LOCATION"}{personName ? ` · ${personName}` : ""}</small>
          </div>
          <div className="situation-card__pause">
            <Icon name="clock" size={16} />
            <span>TIME PAUSED</span>
          </div>
        </header>

        <div className="situation-card__body">
          <p>{situation.prompt}</p>
          <div className="situation-context">
            {situation.context.map((line) => <span key={line}>{line}</span>)}
          </div>
        </div>

        <div className="situation-choices">
          {situation.choices.map((choice) => {
            const disabled = (choice.requiredBalance ?? 0) > balance;
            return (
              <button
                type="button"
                key={choice.id}
                className="situation-choice"
                disabled={disabled}
                onClick={() => onResolve(choice.id)}
              >
                <span className="situation-choice__head">
                  <strong>{choice.label}</strong>
                  <i>{choice.timeMinutes} MIN</i>
                </span>
                <span>{choice.detail}</span>
                <small>{disabled ? `Нужно ₵ ${choice.requiredBalance}` : choice.consequence}</small>
                <div>
                  {choice.cost ? <b>−₵ {choice.cost}</b> : null}
                  {choice.payout ? <b>+₵ {choice.payout}</b> : null}
                  <em>SELECT <Icon name="chevron" size={14} /></em>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
