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

export const miraKoval: KnownNpc = {
  id: "npc-mira-koval",
  name: "MIRA KOVAL",
  role: "DRONE TECHNICIAN",
  age: 29,
  status: "На смене",
  location: "Orbis Repair Hub",
  condition: ["Усталость: повышена", "Стресс: высокий", "Травмы: нет"],
  relations: [
    { label: "Доверие", value: 58 },
    { label: "Симпатия", value: 74 },
    { label: "Подозрение", value: 18 }
  ],
  knownFacts: [
    "содержит младшего брата",
    "задолжала клинике ₵ 3,760",
    "ищет дополнительный доход",
    "не доверяет Novacore"
  ],
  lastContact: "17 OCT · 22:38",
  profileCode: "LC04-ORB-7719"
};
