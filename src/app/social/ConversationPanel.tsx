import type { GameSession } from "../../world/state/types";
import type { ConversationAction, SocialIdentityState } from "../../simulation/social/types";
import { getPerson } from "../../people/network/humanNetwork";
import { personPortrait } from "../shared/presentation";

const temperamentLabel: Record<SocialIdentityState["temperament"], string> = {
  reserved: "закрытый", direct: "прямой", warm: "дружелюбный", cynical: "циничный", nervous: "нервный", aggressive: "агрессивный"
};

export function ConversationPanel({ session, onAction, onClose }: {
  session: GameSession;
  onAction: (action: ConversationAction) => void;
  onClose: () => void;
}) {
  const conversation = session.social.activeConversation;
  const person = conversation ? getPerson(session.people, conversation.personId) : null;
  if (!conversation || !person) return null;
  const identity = session.social.identities.find((item) => item.personId === person.id);
  const knowledge = session.social.knowledge.filter((item) => item.holderPersonId === person.id);
  const hasIncident = knowledge.some((item) => item.subject === "incident");
  const hasPlace = knowledge.some((item) => item.subject === "place");
  const relation = person.relations.map((link) => ({ link, person: getPerson(session.people, link.personId) })).find((item) => item.person);

  return (
    <div className="conversation-overlay" data-no-swipe>
      <section className="conversation-panel" aria-label={`Разговор с ${person.name}`}>
        <header>
          <img src={personPortrait(person.id)} alt="" />
          <div><span>РАЗГОВОР · {conversation.mood.toUpperCase()}</span><h2>{person.name}</h2><p>{person.roleLabel} · {identity ? temperamentLabel[identity.temperament] : "неизвестен"}</p></div>
          <button type="button" onClick={onClose} aria-label="Закончить разговор">×</button>
        </header>

        <div className="conversation-relations">
          <div><span>Доверие</span><i><b style={{ width: `${person.trustToPlayer}%` }} /></i><strong>{Math.round(person.trustToPlayer)}</strong></div>
          <div><span>Уважение</span><i><b style={{ width: `${person.respectToPlayer}%` }} /></i><strong>{Math.round(person.respectToPlayer)}</strong></div>
          <div><span>Раздражение</span><i><b style={{ width: `${person.irritationToPlayer}%` }} /></i><strong>{Math.round(person.irritationToPlayer)}</strong></div>
        </div>

        <div className="conversation-transcript" aria-live="polite">
          {conversation.transcript.map((line) => (
            <article key={line.id} className={`conversation-line conversation-line--${line.speaker} conversation-line--${line.tone}`}>
              <span>{line.speaker === "player" ? "ВЫ" : person.name}</span><p>{line.text}</p>
            </article>
          ))}
        </div>

        <div className="conversation-actions">
          {hasIncident ? <button type="button" onClick={() => onAction("ask-incident")}><span>Спросить о происшествии</span><small>Только то, что видел или слышал</small></button> : null}
          {hasPlace ? <button type="button" onClick={() => onAction("ask-place")}><span>Спросить о месте</span><small>Дом, работа или текущая точка</small></button> : null}
          {relation?.person ? <button type="button" onClick={() => onAction("ask-person")}><span>Спросить о {relation.person.name}</span><small>{relation.link.kind}</small></button> : null}
          <button type="button" onClick={() => onAction("ask-help")}><span>Попросить помощь</span><small>{person.trustToPlayer >= 35 ? "Может согласиться" : "Доверия мало"}</small></button>
          <button type="button" disabled={session.player.balance < 25} onClick={() => onAction("offer-money")}><span>Передать ₵ 25</span><small>Реальный перевод</small></button>
          <button type="button" onClick={() => onAction("lie")}><span>Соврать</span><small>Может проверить позже</small></button>
          <button type="button" className="is-danger" onClick={() => onAction("threaten")}><span>Угрожать</span><small>Запомнит и передаст другим</small></button>
          <button type="button" className="is-muted" onClick={onClose}><span>Закончить разговор</span></button>
        </div>
      </section>
    </div>
  );
}
