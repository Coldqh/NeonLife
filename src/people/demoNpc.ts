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
  const profileCode = `CT-${rng.integer(1000, 9999)}-${rng.integer(10, 99)}`;
  return {
    id: createStableEntityId("person", `${seed}:primary-contact`),
    name,
    role: "LOCAL ACQUAINTANCE",
    age: rng.integer(22, 34),
    status: "Занят своими делами",
    location,
    condition: ["Усталость: неизвестно", "Стресс: неизвестно", "Травмы: не замечены"],
    relations: [
      { label: "Доверие", value: rng.integer(28, 46) },
      { label: "Симпатия", value: rng.integer(34, 54) },
      { label: "Подозрение", value: rng.integer(14, 31) }
    ],
    knownFacts: [
      "живёт в том же районе",
      "работает по сменному графику",
      "не связан с активными заданиями игрока"
    ],
    lastContact: "17 OCT · 18:10",
    profileCode
  };
}

export const primaryContact = createPrimaryContact("NEON-LIFE-DEFAULT", "HAB-STACK 07");
