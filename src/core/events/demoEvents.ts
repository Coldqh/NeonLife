import { createStableEntityId } from "../ids/entityId";
import { INITIAL_GAME_TIMESTAMP } from "../time/gameTime";
import type { WorldEvent } from "./types";

const minute = 60_000;

export interface InitialEventContext {
  seed: string;
  districtName: string;
  districtCode: string;
  marketName: string;
  housingName: string;
}

export function createInitialEvents(context: InitialEventContext): WorldEvent[] {
  const makeId = (scope: string) => createStableEntityId("event", `${context.seed}:initial:${scope}`);
  return [
    {
      id: makeId("session-opened"),
      timestamp: INITIAL_GAME_TIMESTAMP,
      category: "system",
      title: "Личная городская сессия открыта.",
      detail: `${context.districtName} / ${context.districtCode}. Личная сессия подключена к симуляции города.`,
      importance: 1,
      pinned: true
    },
    {
      id: makeId("housing"),
      timestamp: INITIAL_GAME_TIMESTAMP - 5 * minute,
      category: "finance",
      title: `Жилой модуль ${context.housingName} оплачен на семь дней.`,
      detail: "Продление доступно через терминал владельца жилья.",
      importance: 2
    },
    {
      id: makeId("market"),
      timestamp: INITIAL_GAME_TIMESTAMP - 17 * minute,
      category: "local",
      title: `${context.marketName} открыл ночную торговую сессию.`,
      detail: "Ассортимент и остатки зависят от поставок района.",
      importance: 1
    },
    {
      id: makeId("courier-board"),
      timestamp: INITIAL_GAME_TIMESTAMP - 24 * minute,
      category: "work",
      title: "Городская курьерская биржа опубликовала новые заказы.",
      detail: "Доступны разовые доставки без постоянного контракта.",
      importance: 2
    },
    {
      id: makeId("condition"),
      timestamp: INITIAL_GAME_TIMESTAMP - 41 * minute,
      category: "health",
      title: "Состояние героя синхронизировано с медицинским профилем.",
      detail: "Усталость, стресс и голод будут влиять на работу и перемещение.",
      importance: 1
    }
  ];
}

export const initialEvents = createInitialEvents({
  seed: "NEON-LIFE-DEFAULT",
  districtName: "UNDERLINE",
  districtCode: "BLOCK 07",
  marketName: "UNDERLINE NIGHT MARKET",
  housingName: "HAB-STACK 07"
});
