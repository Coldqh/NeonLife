import { createStableEntityId } from "../core/ids/entityId";
import { SeededRandom } from "../core/random/seededRandom";

export interface KnownNpc {
  id: string;
  name: string;
  role: string;
  age: number;
  status: string;
  location: string;
  condition: string[];
  relations: Array<{ label: string; value: number }>;
  knownFacts: string[];
  lastContact: string;
  profileCode: string;
}

const FIRST_NAMES = ["SENA", "TAVI", "LIO", "VARA", "NEM", "ORIN"] as const;
const LAST_NAMES = ["ROTH", "CALDER", "MIREN", "SAYE", "HALDEN", "KELL"] as const;

export function createPrimaryContact(seed: string, location: string): KnownNpc {
  const rng = new SeededRandom(`${seed}:contact`);
  const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  const profileCode = `UL07-VX-${rng.integer(1000, 9999)}`;
  return {
    id: createStableEntityId("person", `${seed}:primary-contact`),
    name,
    role: "GRID MAINTENANCE TECHNICIAN",
    age: rng.integer(25, 32),
    status: "На ночной смене",
    location,
    condition: ["Усталость: повышена", "Стресс: умеренный", "Травмы: нет"],
    relations: [
      { label: "Доверие", value: rng.integer(48, 62) },
      { label: "Симпатия", value: rng.integer(58, 74) },
      { label: "Подозрение", value: rng.integer(12, 24) }
    ],
    knownFacts: [
      "оплачивает лечение матери",
      "работает без постоянного контракта",
      "знает сервисные маршруты Vectra Works",
      "избегает службы районной безопасности"
    ],
    lastContact: "17 OCT · 22:38",
    profileCode
  };
}

export const primaryContact = createPrimaryContact("NEON-LIFE-DEFAULT", "VECTRA SERVICE NODE");
