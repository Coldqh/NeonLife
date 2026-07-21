export type FoodCategory = "ration" | "meal" | "drink" | "medical" | "ingredient";
export type PreparationRequirement = "none" | "heater" | "hot-water" | "kitchen-module" | "food-printer";

export interface FoodProduct {
  id: string;
  name: string;
  code: string;
  maker: string;
  category: FoodCategory;
  price: number;
  massGrams: number;
  hungerRelief: number;
  healthDelta: number;
  fatigueDelta: number;
  stressDelta: number;
  shelfLifeHours: number;
  preparationMinutes: number;
  requirement: PreparationRequirement;
  quality: "street" | "standard" | "premium" | "medical";
  description: string;
  origin: string;
  tags: string[];
}

export const FOOD_CATALOG: readonly FoodProduct[] = [
  {
    id: "kernel-9-brick",
    name: "KERNEL-9 NUTRIENT BRICK",
    code: "K9/BRICK",
    maker: "KERNEL CIVIC FOODS",
    category: "ration",
    price: 14,
    massGrams: 180,
    hungerRelief: 24,
    healthDelta: -1,
    fatigueDelta: 0,
    stressDelta: 2,
    shelfLifeHours: 720,
    preparationMinutes: 1,
    requirement: "none",
    quality: "street",
    description: "Плотный серый брикет с солёной оболочкой. Выдаётся на дешёвых сменах и продаётся в транспортных автоматах.",
    origin: "Белковая масса, водорослевый крахмал, минеральный комплекс K-9.",
    tags: ["LONG LIFE", "WORK RATION", "NO HEAT"]
  },
  {
    id: "blueroot-noodles",
    name: "BLUEROOT NOODLES",
    code: "BR/N-22",
    maker: "MIREVA CULTURES",
    category: "meal",
    price: 26,
    massGrams: 310,
    hungerRelief: 38,
    healthDelta: 0,
    fatigueDelta: -2,
    stressDelta: -3,
    shelfLifeHours: 168,
    preparationMinutes: 8,
    requirement: "hot-water",
    quality: "standard",
    description: "Лапша из синего корневого мицелия. Пакет нагревается от горячей воды и раскрывает пряный белковый соус.",
    origin: "Вертикальные грибные фермы промышленного кольца.",
    tags: ["HOT WATER", "MYCELIUM", "2 PORTIONS"]
  },
  {
    id: "hexa-meal-cartridge",
    name: "HEXA MEAL CARTRIDGE",
    code: "HX/MEAL-4",
    maker: "HEXA DOMESTIC",
    category: "meal",
    price: 42,
    massGrams: 260,
    hungerRelief: 44,
    healthDelta: 2,
    fatigueDelta: -3,
    stressDelta: -4,
    shelfLifeHours: 360,
    preparationMinutes: 6,
    requirement: "food-printer",
    quality: "premium",
    description: "Пищевой картридж с адаптивной текстурой. Домашний принтер собирает горячее блюдо под медицинский профиль владельца.",
    origin: "Лицензионные субстраты HEXA и синтезированные ароматические матрицы.",
    tags: ["FOOD PRINTER", "PROFILED", "LICENSED"]
  },
  {
    id: "dockyard-stew-04",
    name: "DOCKYARD STEW №04",
    code: "DY/STEW-04",
    maker: "NIGHT KITCHEN UNION",
    category: "meal",
    price: 34,
    massGrams: 420,
    hungerRelief: 48,
    healthDelta: 1,
    fatigueDelta: -4,
    stressDelta: -5,
    shelfLifeHours: 4,
    preparationMinutes: 2,
    requirement: "none",
    quality: "standard",
    description: "Горячая густая смесь из культивированного белка, корнеплодов и дешёвого масла. Продаётся только свежей.",
    origin: "Ночные кухни грузовых кварталов.",
    tags: ["HOT MEAL", "SHORT LIFE", "STREET LICENSE"]
  },
  {
    id: "vanta-protein-cuts",
    name: "VANTA PROTEIN CUTS",
    code: "VN/CUT-8",
    maker: "VANTA BIOFAB",
    category: "ingredient",
    price: 49,
    massGrams: 380,
    hungerRelief: 46,
    healthDelta: 3,
    fatigueDelta: -2,
    stressDelta: -2,
    shelfLifeHours: 72,
    preparationMinutes: 14,
    requirement: "kitchen-module",
    quality: "premium",
    description: "Тонкие пластины культивированного мышечного белка. Требуют нормальной жарочной поверхности и фильтрованной воды.",
    origin: "Лабораторные мясные кассеты VANTA, линия 8.",
    tags: ["BIOFAB", "COOKING", "HIGH PROTEIN"]
  },
  {
    id: "morrow-algae-chips",
    name: "MORROW ALGAE CHIPS",
    code: "MRW/CHIP",
    maker: "MORROW TIDAL",
    category: "ration",
    price: 11,
    massGrams: 95,
    hungerRelief: 13,
    healthDelta: 0,
    fatigueDelta: 0,
    stressDelta: -2,
    shelfLifeHours: 1440,
    preparationMinutes: 0,
    requirement: "none",
    quality: "street",
    description: "Хрустящие листы тёмных водорослей с металлическим послевкусием. Дешёвый перекус для дороги.",
    origin: "Закрытые соляные бассейны внешнего периметра.",
    tags: ["SNACK", "LONG LIFE", "SALTY"]
  },
  {
    id: "pulserush-c12",
    name: "PULSERUSH C-12",
    code: "PR/C12",
    maker: "PULSE INDUSTRIES",
    category: "drink",
    price: 18,
    massGrams: 330,
    hungerRelief: 4,
    healthDelta: -1,
    fatigueDelta: -18,
    stressDelta: 5,
    shelfLifeHours: 2160,
    preparationMinutes: 0,
    requirement: "none",
    quality: "street",
    description: "Сильный стимулятор с кислым вкусом. Быстро снимает усталость, повышает стресс и ухудшает последующий сон.",
    origin: "Синтетический кофеин C-12, электролиты, нейроароматизатор.",
    tags: ["STIMULANT", "SLEEP PENALTY", "SEALED"]
  },
  {
    id: "sable-recovery-pack",
    name: "SABLE RECOVERY PACK",
    code: "SB/RX-3",
    maker: "SABLE CLINICAL",
    category: "medical",
    price: 67,
    massGrams: 290,
    hungerRelief: 30,
    healthDelta: 7,
    fatigueDelta: -5,
    stressDelta: -3,
    shelfLifeHours: 480,
    preparationMinutes: 4,
    requirement: "heater",
    quality: "medical",
    description: "Стерильный пакет восстановительного питания. Продаётся клиниками и требует короткого нагрева.",
    origin: "Клинические белки, электролиты, регенеративные микроэлементы.",
    tags: ["MEDICAL", "HEATER", "CONTROLLED SALE"]
  },
  {
    id: "grey-fleshfruit",
    name: "GREY MARKET FLESHFRUIT",
    code: "GM/FLESH",
    maker: "UNREGISTERED",
    category: "ingredient",
    price: 23,
    massGrams: 240,
    hungerRelief: 35,
    healthDelta: -4,
    fatigueDelta: -1,
    stressDelta: -5,
    shelfLifeHours: 30,
    preparationMinutes: 3,
    requirement: "none",
    quality: "street",
    description: "Мягкий биопродукт без маркировки. Сладкий запах скрывает происхождение ткани и качество питательной среды.",
    origin: "Неизвестная подпольная биоферма.",
    tags: ["UNLICENSED", "BIOLOGICAL", "RISK"]
  }
] as const;

export function getFoodProduct(productId: string): FoodProduct {
  const product = FOOD_CATALOG.find((item) => item.id === productId);
  if (!product) throw new Error(`Unknown food product: ${productId}`);
  return product;
}
