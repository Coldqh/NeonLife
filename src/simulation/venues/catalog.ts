import { createStableEntityId } from "../../core/ids/entityId";
import type { VenueCategory, VenueState } from "../urban/types";
import type { VenueOfferEffects, VenueOfferKind, VenueOfferState } from "./types";

interface VenueOfferTemplate {
  code: string;
  name: string;
  description: string;
  kind: VenueOfferKind;
  productId?: string;
  price: number;
  stock: number;
  durationMinutes: number;
  effects?: VenueOfferEffects;
}

const TEMPLATES: Record<VenueCategory, VenueOfferTemplate[]> = {
  convenience: [
    { code: "K9", name: "KERNEL-9 BRICK", description: "Дешёвый герметичный паёк.", kind: "food-goods", productId: "kernel-9-brick", price: 14, stock: 36, durationMinutes: 3 },
    { code: "MRW", name: "MORROW ALGAE CHIPS", description: "Солёный дорожный перекус.", kind: "food-goods", productId: "morrow-algae-chips", price: 11, stock: 42, durationMinutes: 2 },
    { code: "C12", name: "PULSERUSH C-12", description: "Сильный стимулятор в банке.", kind: "food-goods", productId: "pulserush-c12", price: 18, stock: 30, durationMinutes: 2 }
  ],
  food: [
    { code: "STEW", name: "DOCKYARD STEW №04", description: "Горячая порция с культивированным белком.", kind: "meal", productId: "dockyard-stew-04", price: 34, stock: 24, durationMinutes: 12, effects: { hungerDelta: -48, fatigueDelta: -4, stressDelta: -5, healthDelta: 1 } },
    { code: "NOODLE", name: "BLUEROOT NOODLES", description: "Лапша с пряным белковым соусом.", kind: "meal", productId: "blueroot-noodles", price: 26, stock: 30, durationMinutes: 9, effects: { hungerDelta: -38, fatigueDelta: -2, stressDelta: -3 } },
    { code: "C12", name: "PULSERUSH C-12", description: "Холодный стимулятор.", kind: "meal", productId: "pulserush-c12", price: 18, stock: 36, durationMinutes: 3, effects: { hungerDelta: -4, fatigueDelta: -18, stressDelta: 5, healthDelta: -1 } }
  ],
  bar: [
    { code: "HOUSE", name: "HOUSE SYNTH", description: "Синтетический коктейль заведения.", kind: "entertainment", price: 28, stock: 40, durationMinutes: 18, effects: { stressDelta: -7, fatigueDelta: 2, healthDelta: -1 } },
    { code: "BOOTH", name: "PRIVATE BOOTH", description: "Полчаса в отдельной кабинке.", kind: "entertainment", price: 55, stock: 8, durationMinutes: 30, effects: { stressDelta: -11, fatigueDelta: 3 } },
    { code: "SNACK", name: "MORROW BAR SNACK", description: "Водорослевый снек к напиткам.", kind: "meal", productId: "morrow-algae-chips", price: 16, stock: 26, durationMinutes: 4, effects: { hungerDelta: -13, stressDelta: -2 } }
  ],
  pharmacy: [
    { code: "RECOVERY", name: "SABLE RECOVERY PACK", description: "Клиническое восстановительное питание.", kind: "food-goods", productId: "sable-recovery-pack", price: 67, stock: 18, durationMinutes: 4 },
    { code: "FIRSTAID", name: "FIRST-AID PROCEDURE", description: "Обработка мелких повреждений на месте.", kind: "medical", price: 45, stock: 22, durationMinutes: 15, effects: { healthDelta: 5, stressDelta: -2 } }
  ],
  clinic: [
    { code: "CHECK", name: "PRIMARY CHECKUP", description: "Осмотр и базовая диагностика.", kind: "medical", price: 45, stock: 40, durationMinutes: 25, effects: { healthDelta: 5, fatigueDelta: -2, stressDelta: -3 } },
    { code: "STAB", name: "STABILIZATION", description: "Срочная стабилизация состояния.", kind: "medical", price: 120, stock: 16, durationMinutes: 75, effects: { healthDelta: 18, fatigueDelta: -8, stressDelta: -7 } }
  ],
  repair: [
    { code: "QUICK", name: "QUICK VEHICLE SERVICE", description: "Диагностика и мелкий ремонт.", kind: "vehicle-service", price: 95, stock: 12, durationMinutes: 45, effects: { vehicleConditionDelta: 12, vehicleFuelDelta: 4 } },
    { code: "FULL", name: "FULL VEHICLE SERVICE", description: "Полный технический цикл.", kind: "vehicle-service", price: 240, stock: 6, durationMinutes: 120, effects: { vehicleConditionDelta: 32, vehicleFuelDelta: 12 } }
  ],
  cyberware: [
    { code: "SCAN", name: "IMPLANT DIAGNOSTICS", description: "Проверка имплантов и нервных интерфейсов.", kind: "cyberware", price: 90, stock: 18, durationMinutes: 35, effects: { healthDelta: 2, stressDelta: -4 } },
    { code: "TUNE", name: "NEURAL RECALIBRATION", description: "Настройка существующего импланта.", kind: "cyberware", price: 180, stock: 8, durationMinutes: 70, effects: { healthDelta: 4, fatigueDelta: -5, stressDelta: -6 } }
  ],
  clothing: [
    { code: "STREET", name: "STREET FIT", description: "Базовый комплект городской одежды.", kind: "apparel", price: 85, stock: 16, durationMinutes: 18, effects: { stressDelta: -3 } },
    { code: "ARMOR", name: "REINFORCED JACKET", description: "Усиленная куртка с защитными вставками.", kind: "apparel", price: 210, stock: 8, durationMinutes: 22, effects: { stressDelta: -2 } }
  ],
  entertainment: [
    { code: "ARCADE", name: "ARCADE SESSION", description: "Сорок минут в игровом зале.", kind: "entertainment", price: 32, stock: 30, durationMinutes: 40, effects: { stressDelta: -10, fatigueDelta: 3 } },
    { code: "SHOW", name: "LIVE SHOW ENTRY", description: "Вход на вечернее представление.", kind: "entertainment", price: 70, stock: 20, durationMinutes: 90, effects: { stressDelta: -15, fatigueDelta: 6 } }
  ],
  hotel: [
    { code: "CAPSULE", name: "SLEEP CAPSULE · 6H", description: "Шесть часов в дешёвой капсуле.", kind: "lodging", price: 48, stock: 18, durationMinutes: 360, effects: { fatigueDelta: -38, stressDelta: -7, healthDelta: 2, hungerDelta: 8 } },
    { code: "ROOM", name: "PRIVATE ROOM · 8H", description: "Восемь часов в отдельной комнате.", kind: "lodging", price: 110, stock: 8, durationMinutes: 480, effects: { fatigueDelta: -58, stressDelta: -13, healthDelta: 4, hungerDelta: 10 } }
  ],
  "office-service": [
    { code: "DOC", name: "DOCUMENT VERIFICATION", description: "Проверка и заверение городских документов.", kind: "office-service", price: 35, stock: 30, durationMinutes: 20, effects: { stressDelta: -2 } },
    { code: "TERM", name: "SECURE TERMINAL ACCESS", description: "Час доступа к защищённому терминалу.", kind: "office-service", price: 60, stock: 16, durationMinutes: 60, effects: { stressDelta: -2, fatigueDelta: 2 } }
  ],
  market: [
    { code: "NOODLE", name: "BLUEROOT NOODLES", description: "Упаковка лапши для дома.", kind: "food-goods", productId: "blueroot-noodles", price: 26, stock: 40, durationMinutes: 3 },
    { code: "VANTA", name: "VANTA PROTEIN CUTS", description: "Культивированный белок для готовки.", kind: "food-goods", productId: "vanta-protein-cuts", price: 49, stock: 24, durationMinutes: 4 },
    { code: "FLESH", name: "GREY MARKET FLESHFRUIT", description: "Нелицензированный биопродукт.", kind: "food-goods", productId: "grey-fleshfruit", price: 23, stock: 22, durationMinutes: 3 }
  ]
};

function priceFor(venue: VenueState, basePrice: number): number {
  const tierMultiplier = 0.78 + venue.priceTier * 0.18;
  const qualityMultiplier = 0.82 + venue.quality / 250;
  return Math.max(4, Math.round(basePrice * tierMultiplier * qualityMultiplier));
}

export function createVenueOffers(venue: VenueState): VenueOfferState[] {
  return TEMPLATES[venue.category].map((template, index) => {
    const maxStock = Math.max(1, Math.round(template.stock * (0.55 + venue.stock / 100)));
    return {
      id: createStableEntityId("venue-offer", `${venue.id}:${template.code}`),
      venueId: venue.id,
      code: `${venue.code}/${template.code}`,
      name: template.name,
      description: template.description,
      kind: template.kind,
      productId: template.productId,
      basePrice: template.price,
      currentPrice: priceFor(venue, template.price),
      stock: maxStock,
      maxStock,
      durationMinutes: template.durationMinutes,
      effects: template.effects ?? {},
      active: true
    };
  });
}
