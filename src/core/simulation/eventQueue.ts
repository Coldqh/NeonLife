import type { WorldEvent } from "../events/types";
import { createStableEntityId } from "../ids/entityId";
import type { GameSession, ScheduledWorldEvent } from "../../world/state/types";

interface QueueResult {
  queue: ScheduledWorldEvent[];
  events: WorldEvent[];
}

function resolveScheduledEvent(session: GameSession, scheduled: ScheduledWorldEvent): WorldEvent {
  const seed = session.world.meta.seed;
  const common = {
    id: createStableEntityId("event", `${seed}:resolved:${scheduled.id}`),
    timestamp: scheduled.dueAt,
    importance: 2 as const
  };

  if (scheduled.type === "grid-restoration") {
    return {
      ...common,
      category: "local",
      title: "Распределительная линия переведена в аварийный режим.",
      detail: "Свет вернулся на транспортный узел. Жилые блоки подключаются по очереди.",
      importance: 3
    };
  }
  if (scheduled.type === "vacancy-expiry") {
    return {
      ...common,
      category: "work",
      title: `Ночная вакансия в ${String(scheduled.payload.location)} закрывается.`,
      detail: "После указанного времени заявка больше не будет доступна."
    };
  }
  if (scheduled.type === "rent-warning") {
    return {
      ...common,
      category: "finance",
      title: "До окончания оплаченного жилья осталось два дня.",
      detail: "Администрация HAB-STACK требует продление или освобождение капсулы.",
      importance: 3
    };
  }
  return {
    ...common,
    category: "local",
    title: "Районная безопасность сменила схему патрулирования.",
    detail: `Основная проверка перенесена к ${String(scheduled.payload.checkpoint)}.`
  };
}

export function processEventQueue(session: GameSession, nextTimestamp: number): QueueResult {
  const events: WorldEvent[] = [];
  const queue = session.eventQueue.map((scheduled) => {
    if (scheduled.status !== "queued" || scheduled.dueAt > nextTimestamp) return scheduled;
    events.push(resolveScheduledEvent(session, scheduled));
    return { ...scheduled, status: "resolved" as const };
  });
  return { queue, events };
}
