import { INITIAL_GAME_TIMESTAMP } from "../time/gameTime";
import type { WorldEvent } from "./types";

const minute = 60_000;

export const initialEvents: WorldEvent[] = [
  {
    id: "evt-lighting-failure",
    timestamp: INITIAL_GAME_TIMESTAMP,
    category: "local",
    title: "Освещение в Sector 04 отключено после аварии.",
    detail: "Транспортная служба обещает восстановить линию до 01:30.",
    importance: 2,
    pinned: true
  },
  {
    id: "evt-mira-message",
    timestamp: INITIAL_GAME_TIMESTAMP - 3 * minute,
    category: "contact",
    title: "Мира Коваль ответила на сообщение.",
    detail: "Она может провести тебя внутрь Orbis Repair Hub после 23:20.",
    importance: 3
  },
  {
    id: "evt-daily-cost",
    timestamp: INITIAL_GAME_TIMESTAMP - 26 * minute,
    category: "finance",
    title: "Списано ₵ 42 за транспорт и питание.",
    importance: 1
  },
  {
    id: "evt-night-vacancy",
    timestamp: INITIAL_GAME_TIMESTAMP - 45 * minute,
    category: "work",
    title: "Orbis Repair Hub опубликовал ночную вакансию.",
    detail: "Помощник техника · 23:30–05:30 · оплата ₵ 188.",
    importance: 3
  },
  {
    id: "evt-fatigue",
    timestamp: INITIAL_GAME_TIMESTAMP - 70 * minute,
    category: "health",
    title: "Усталость достигла повышенного значения.",
    detail: "После 02:00 точность сложных действий начнёт снижаться.",
    importance: 2
  }
];
