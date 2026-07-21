import { createStableEntityId } from "../ids/entityId";
import { INITIAL_GAME_TIMESTAMP } from "../time/gameTime";
import type { WorldEvent } from "./types";

const minute = 60_000;

export interface InitialEventContext {
  seed: string;
  districtName: string;
  districtCode: string;
  contactName: string;
  companyName: string;
}

export function createInitialEvents(context: InitialEventContext): WorldEvent[] {
  const makeId = (scope: string) => createStableEntityId("event", `${context.seed}:initial:${scope}`);
  return [
    {
      id: makeId("grid-failure"),
      timestamp: INITIAL_GAME_TIMESTAMP,
      category: "local",
      title: `Освещение в ${context.districtCode} отключено после аварии.`,
      detail: "Городская сеть подтверждает повреждение распределительной линии.",
      importance: 2,
      pinned: true
    },
    {
      id: makeId("checkpoint"),
      timestamp: INITIAL_GAME_TIMESTAMP - 7 * minute,
      category: "local",
      title: "У транспортного узла усилена проверка документов.",
      detail: "Районная безопасность перекрыла центральный выход.",
      importance: 3
    },
    {
      id: makeId("canteen"),
      timestamp: INITIAL_GAME_TIMESTAMP - 32 * minute,
      category: "local",
      title: "Ночная столовая снизила цену на остатки смены.",
      detail: "Горячая еда доступна за ₵ 28 до закрытия кухни.",
      importance: 1
    },
    {
      id: makeId("contact"),
      timestamp: INITIAL_GAME_TIMESTAMP - 3 * minute,
      category: "contact",
      title: `${context.contactName} ответил на сообщение.`,
      detail: `Временный пропуск в ${context.companyName} будет доступен после 23:20.`,
      importance: 3
    },
    {
      id: makeId("daily-cost"),
      timestamp: INITIAL_GAME_TIMESTAMP - 26 * minute,
      category: "finance",
      title: "Списано ₵ 42 за транспорт и питание.",
      importance: 1
    },
    {
      id: makeId("vacancy"),
      timestamp: INITIAL_GAME_TIMESTAMP - 45 * minute,
      category: "work",
      title: `${context.companyName} опубликовал ночную вакансию.`,
      detail: "Помощник техника · 23:30–05:30 · оплата ₵ 188.",
      importance: 3
    },
    {
      id: makeId("fatigue"),
      timestamp: INITIAL_GAME_TIMESTAMP - 70 * minute,
      category: "health",
      title: "Усталость достигла повышенного значения.",
      detail: "После 02:00 точность сложных действий начнёт снижаться.",
      importance: 2
    }
  ];
}

export const initialEvents = createInitialEvents({
  seed: "NEON-LIFE-DEFAULT",
  districtName: "UNDERLINE",
  districtCode: "BLOCK 07",
  contactName: "SENA ROTH",
  companyName: "VECTRA SERVICE NODE"
});
