import { FOOD_CATALOG } from "./foodCatalog";
import type { ProductCategory, ProductDefinition, ProductLegality, ProductQualityGrade, ProductStorageCondition, ProductUnit } from "./types";

type Row = [id: string, sku: string, name: string, brand: string, category: ProductCategory, unit: ProductUnit, mass: number, volume: number, price: number, quality: ProductQualityGrade, legality: ProductLegality, shelf: number | null, storage: ProductStorageCondition[], materials: string[], tags: string[], legacyResource?: ProductDefinition["legacyResource"]];

function row([id, sku, name, brand, category, unit, massGrams, volumeMl, basePrice, quality, legality, shelfLifeHours, storage, materials, tags, legacyResource]: Row): ProductDefinition {
  return { id, sku, name, brand, manufacturer: brand, category, unit, massGrams, volumeMl, basePrice, quality, legality, shelfLifeHours, storage, stackLimit: unit === "liter" || unit === "kilogram" ? 50 : 100, description: `${name}. Серийный товар ${brand}.`, materials, tags, legacyResource };
}

const FOOD_PRODUCTS: ProductDefinition[] = FOOD_CATALOG.map((item) => ({
  id: item.id,
  sku: item.code,
  name: item.name,
  brand: item.maker,
  manufacturer: item.maker,
  category: item.category === "drink" ? "drink" : item.category === "medical" ? "medicine" : "food",
  unit: item.category === "drink" ? "can" : "package",
  massGrams: item.massGrams,
  volumeMl: item.category === "drink" ? item.massGrams : Math.round(item.massGrams * .9),
  basePrice: item.price,
  quality: item.quality,
  legality: item.tags.includes("UNLICENSED") ? "illegal" : item.tags.includes("CONTROLLED SALE") ? "restricted" : "legal",
  shelfLifeHours: item.shelfLifeHours,
  storage: item.shelfLifeHours <= 72 ? ["chilled"] : ["ambient", "dry"],
  stackLimit: 60,
  description: item.description,
  materials: item.origin.split(",").map((value) => value.trim()),
  tags: [...item.tags],
  effects: { hungerDelta: -item.hungerRelief, healthDelta: item.healthDelta, fatigueDelta: item.fatigueDelta, stressDelta: item.stressDelta },
  legacyResource: item.category === "medical" ? "medical-units" : "food-units"
}));

const EXTRA_ROWS: Row[] = [
  ["civic-water-500", "CW/W500", "CIVIC FILTERED WATER 500", "CIVIC WATER", "drink", "bottle", 520, 500, 6, "standard", "legal", 8760, ["ambient"], ["filtered water", "polymer bottle"], ["WATER"], "food-units"],
  ["mireva-mycoprotein-bar", "MV/MB12", "MIREVA MYCOPROTEIN BAR", "MIREVA CULTURES", "food", "package", 95, 80, 13, "standard", "legal", 1440, ["dry"], ["mycelium protein", "starch"], ["PROTEIN"], "food-units"],
  ["redline-coffee-gel", "RL/CG4", "REDLINE COFFEE GEL", "REDLINE NUTRITION", "food", "package", 75, 65, 17, "street", "legal", 2160, ["ambient"], ["caffeine gel", "sugar"], ["STIMULANT"], "food-units"],
  ["tidal-kelp-rice", "TD/KR8", "TIDAL KELP RICE", "MORROW TIDAL", "food", "package", 340, 300, 22, "standard", "legal", 240, ["dry"], ["kelp grain", "mineral salt"], ["MEAL"], "food-units"],
  ["vanta-cultured-mince", "VN/MINCE", "VANTA CULTURED MINCE", "VANTA BIOFAB", "food", "package", 450, 400, 54, "premium", "legal", 96, ["chilled"], ["cultured muscle", "nutrient gel"], ["COOKING"], "food-units"],
  ["kernel-family-ration", "K9/FAM", "KERNEL FAMILY RATION", "KERNEL CIVIC FOODS", "food", "package", 1200, 1050, 63, "street", "legal", 1080, ["dry"], ["protein mass", "starch", "vitamins"], ["FAMILY"], "food-units"],
  ["night-kitchen-broth", "NK/BROTH", "NIGHT KITCHEN BROTH", "NIGHT KITCHEN UNION", "food", "package", 480, 430, 29, "standard", "legal", 12, ["chilled"], ["cultured protein", "root stock"], ["FRESH"], "food-units"],
  ["hexa-breakfast-cartridge", "HX/BF2", "HEXA BREAKFAST CARTRIDGE", "HEXA DOMESTIC", "food", "cartridge", 240, 220, 39, "premium", "licensed", 480, ["dry"], ["food substrate", "flavor matrix"], ["FOOD PRINTER"], "food-units"],
  ["pulse-electrolyte-9", "PL/E9", "PULSE ELECTROLYTE 9", "PULSE INDUSTRIES", "drink", "bottle", 540, 500, 14, "standard", "legal", 2880, ["ambient"], ["water", "electrolytes"], ["SPORT"], "food-units"],
  ["sable-clinical-shake", "SB/CS6", "SABLE CLINICAL SHAKE", "SABLE CLINICAL", "drink", "bottle", 360, 330, 48, "medical", "restricted", 360, ["chilled", "sterile"], ["clinical protein", "electrolytes"], ["RECOVERY"], "medical-units"],
  ["morrow-salt-crackers", "MRW/SC", "MORROW SALT CRACKERS", "MORROW TIDAL", "food", "package", 120, 100, 9, "street", "legal", 1800, ["dry"], ["algae flour", "salt"], ["SNACK"], "food-units"],
  ["crown-cocoa-synth", "CR/COCO", "CROWN COCOA SYNTH", "CROWN FOODS", "drink", "can", 350, 330, 24, "premium", "legal", 1440, ["ambient"], ["cocoa matrix", "milk protein"], ["PREMIUM"], "food-units"],
  ["dockworker-lunch-pack", "DW/LP7", "DOCKWORKER LUNCH PACK", "MESHLINE CATERING", "food", "package", 620, 560, 31, "standard", "legal", 120, ["chilled"], ["protein cuts", "grain", "sauce"], ["WORK RATION"], "food-units"],
  ["biofruit-cube", "BF/CUBE", "BIOFRUIT CUBE", "MIREVA CULTURES", "food", "package", 180, 160, 16, "standard", "legal", 96, ["chilled"], ["fruit tissue", "pectin"], ["FRESH"], "food-units"],
  ["synth-spirit-350", "SS/350", "HOUSE SYNTH SPIRIT", "AFTERSHIFT DISTILLING", "drink", "bottle", 380, 350, 28, "street", "restricted", 8760, ["ambient"], ["synthetic alcohol", "flavor concentrate"], ["ALCOHOL"], "food-units"],
  ["black-ice-cola", "BI/COLA", "BLACK ICE COLA", "STATIC BEVERAGES", "drink", "can", 350, 330, 12, "street", "legal", 2160, ["ambient"], ["carbonated water", "sweetener"], ["SODA"], "food-units"],

  ["medpatch-basic", "MED/PB1", "MEDPATCH BASIC", "CIVIC MED", "medicine", "dose", 18, 8, 22, "medical", "legal", 2160, ["sterile"], ["antiseptic mesh", "analgesic"], ["FIRST AID"], "medical-units"],
  ["sable-antibiotic-7", "SB/AB7", "SABLE ANTIBIOTIC 7", "SABLE CLINICAL", "medicine", "dose", 12, 5, 46, "medical", "licensed", 4320, ["sterile", "dry"], ["antibiotic compound"], ["PRESCRIPTION"], "medical-units"],
  ["pulse-analgesic", "PL/AN4", "PULSE ANALGESIC", "PULSE MEDICAL", "medicine", "package", 28, 12, 18, "standard", "legal", 2880, ["dry"], ["analgesic tablets"], ["PAIN"], "medical-units"],
  ["civic-antiseptic", "CM/AS2", "CIVIC ANTISEPTIC", "CIVIC MED", "medicine", "bottle", 140, 120, 15, "standard", "legal", 3600, ["ambient"], ["antiseptic solution"], ["STERILE"], "medical-units"],
  ["neurocalm-5", "NC/5", "NEUROCALM 5", "AURELIAN PHARMA", "medicine", "dose", 8, 4, 61, "medical", "restricted", 2160, ["shielded", "dry"], ["neural suppressant"], ["CONTROLLED"], "medical-units"],
  ["respira-filter-dose", "RF/D1", "RESPIRA FILTER DOSE", "CMU RESPIRATORY", "medicine", "cartridge", 35, 20, 39, "medical", "licensed", 2880, ["sterile"], ["bronchodilator", "filter media"], ["RESPIRATORY"], "medical-units"],
  ["trauma-coagulant", "TR/COAG", "TRAUMA COAGULANT", "CMU TRAUMA", "medicine", "dose", 20, 10, 88, "medical", "restricted", 1440, ["sterile", "chilled"], ["synthetic coagulant"], ["EMERGENCY"], "medical-units"],
  ["implant-rejection-kit", "IR/KIT", "IMPLANT REJECTION KIT", "SABLE CLINICAL", "medicine", "set", 220, 180, 240, "medical", "restricted", 960, ["chilled", "sterile"], ["immunosuppressant", "diagnostic strip"], ["CYBERWARE"], "medical-units"],
  ["stimulant-detox-pack", "SD/PACK", "STIMULANT DETOX PACK", "CIVIC RECOVERY", "medicine", "set", 180, 150, 74, "medical", "licensed", 1800, ["dry"], ["electrolytes", "neural stabilizer"], ["DETOX"], "medical-units"],
  ["dermal-sealant", "DS/8", "DERMAL SEALANT 8", "CMU TRAUMA", "medicine", "cartridge", 55, 35, 53, "medical", "licensed", 2160, ["sterile"], ["bioadhesive", "antiseptic"], ["WOUND"], "medical-units"],

  ["vectra-brake-module", "VT/BR4", "VECTRA BRAKE MODULE", "VECTRA MOTORS", "vehicle-part", "piece", 3200, 2400, 180, "industrial", "legal", null, ["dry"], ["alloy", "ceramic", "sensor"], ["VEHICLE"], "parts-units"],
  ["meshline-nav-sensor", "ML/NS2", "MESHLINE NAV SENSOR", "MESHLINE", "vehicle-part", "piece", 420, 260, 145, "industrial", "licensed", null, ["shielded"], ["electronics", "optics"], ["VEHICLE"], "parts-units"],
  ["torque-drive-belt", "TQ/DB9", "TORQUE DRIVE BELT", "TORQUE WORKS", "vehicle-part", "piece", 760, 620, 62, "standard", "legal", null, ["dry"], ["polymer fiber", "alloy"], ["VEHICLE"], "parts-units"],
  ["civic-fuel-filter", "CF/F3", "CIVIC FUEL FILTER", "CIVIC AUTO", "vehicle-part", "piece", 340, 250, 31, "standard", "legal", null, ["dry"], ["filter mesh", "polymer"], ["VEHICLE"], "parts-units"],
  ["microfab-bearing-set", "MF/BS8", "MICROFAB BEARING SET", "VECTRA MICROFAB", "vehicle-part", "set", 950, 700, 89, "industrial", "legal", null, ["dry"], ["alloy bearings", "lubricant"], ["MACHINE"], "parts-units"],
  ["field-wrench-set", "FW/SET", "FIELD WRENCH SET", "TORQUE WORKS", "tool", "set", 2800, 2200, 120, "industrial", "legal", null, ["dry"], ["tool steel", "polymer grips"], ["REPAIR"], "parts-units"],
  ["diagnostic-probe", "DP/6", "DIAGNOSTIC PROBE 6", "AURELIAN TOOLS", "tool", "piece", 610, 380, 210, "premium", "licensed", null, ["shielded"], ["electronics", "alloy"], ["DIAGNOSTIC"], "parts-units"],
  ["micro-solder-kit", "MS/KIT", "MICRO SOLDER KIT", "CUTWIRE TOOLS", "tool", "set", 480, 360, 76, "standard", "legal", null, ["dry"], ["solder", "heater", "tips"], ["ELECTRONICS"], "parts-units"],
  ["service-seal-pack", "SS/P12", "SERVICE SEAL PACK", "VECTRA SERVICE", "vehicle-part", "package", 220, 180, 28, "standard", "legal", null, ["dry"], ["rubber seals", "gaskets"], ["REPAIR"], "parts-units"],
  ["industrial-lubricant", "IL/L1", "INDUSTRIAL LUBRICANT", "NORTHLINE CHEM", "tool", "liter", 960, 1000, 34, "industrial", "restricted", 8760, ["hazardous"], ["synthetic lubricant"], ["CHEMICAL"], "parts-units"],

  ["street-fit-set", "VOID/SF", "VOID STREET FIT", "VOID THREAD", "apparel", "set", 1400, 4200, 85, "standard", "legal", null, ["dry"], ["synthetic textile", "fasteners"], ["CLOTHING"], "mixed-units"],
  ["reinforced-jacket", "VOID/RJ", "REINFORCED JACKET", "VOID THREAD", "armor", "piece", 2600, 5200, 210, "industrial", "legal", null, ["dry"], ["aramid weave", "impact plates"], ["PROTECTION"], "mixed-units"],
  ["civic-work-boots", "CW/B7", "CIVIC WORK BOOTS", "CIVIC WORKWEAR", "apparel", "set", 1800, 3400, 72, "standard", "legal", null, ["dry"], ["rubber", "synthetic leather"], ["WORK"], "mixed-units"],
  ["meshline-rain-shell", "ML/RS", "MESHLINE RAIN SHELL", "MESHLINE", "apparel", "piece", 900, 2800, 96, "standard", "legal", null, ["dry"], ["sealed textile", "filter membrane"], ["RAIN"], "mixed-units"],
  ["clinic-sterile-scrubs", "CMU/SCR", "CMU STERILE SCRUBS", "CMU MEDICAL", "apparel", "set", 620, 1800, 58, "medical", "licensed", null, ["sterile"], ["sterile textile"], ["MEDICAL"], "mixed-units"],
  ["lowlight-clubwear", "LL/CW", "LOWLIGHT CLUBWEAR", "LOWLIGHT", "apparel", "set", 760, 2200, 130, "premium", "legal", null, ["dry"], ["smart textile", "light fiber"], ["NIGHT"], "mixed-units"],
  ["civic-respirator", "CR/R2", "CIVIC RESPIRATOR R2", "CIVIC SAFETY", "armor", "piece", 680, 1200, 118, "industrial", "legal", null, ["dry"], ["filter media", "polymer shell"], ["POLLUTION"], "mixed-units"],
  ["security-plate-vest", "SP/V4", "SECURITY PLATE VEST", "REDLINE SECURITY", "armor", "piece", 5200, 7600, 460, "military", "restricted", null, ["dry"], ["ceramic plates", "aramid"], ["ARMOR"], "mixed-units"],
  ["brass-knuckles", "UL/BK1", "BRASS KNUCKLES", "UNDERLINE", "weapon", "piece", 420, 240, 180, "street", "restricted", null, ["dry"], ["steel alloy", "grip wrap"], ["MELEE", "WEAPON"], "mixed-units"],
  ["combat-knife", "RL/CK7", "COMBAT KNIFE", "REDLINE SECURITY", "weapon", "piece", 620, 360, 460, "military", "restricted", null, ["dry"], ["tool steel", "polymer grip"], ["MELEE", "WEAPON"], "mixed-units"],
  ["cheap-pistol", "CW/P9", "CUTWIRE P9", "CUTWIRE", "weapon", "piece", 980, 760, 1450, "street", "illegal", null, ["dry"], ["alloy frame", "polymer grip", "firing assembly"], ["FIREARM", "WEAPON", "CONTRABAND"], "mixed-units"],

  ["civic-comm-slate", "CC/S2", "CIVIC COMM SLATE S2", "CIVIC DATA", "electronics", "piece", 380, 210, 120, "standard", "legal", null, ["shielded"], ["electronics", "glass", "battery"], ["COMM"], "mixed-units"],
  ["aurelian-data-key", "AD/K7", "AURELIAN DATA KEY K7", "AURELIAN", "electronics", "piece", 45, 18, 95, "premium", "licensed", null, ["shielded"], ["secure memory", "alloy shell"], ["DATA"], "document-units"],
  ["meshline-route-terminal", "ML/RT", "MESHLINE ROUTE TERMINAL", "MESHLINE", "electronics", "piece", 1100, 700, 330, "industrial", "licensed", null, ["shielded"], ["display", "radio", "processor"], ["LOGISTICS"], "document-units"],
  ["hexa-food-printer-core", "HX/FPC", "HEXA FOOD PRINTER CORE", "HEXA DOMESTIC", "electronics", "piece", 4300, 6000, 620, "premium", "licensed", null, ["dry"], ["heater", "actuators", "controller"], ["APPLIANCE"], "mixed-units"],
  ["cutwire-signal-jammer", "CW/JM", "CUTWIRE SIGNAL JAMMER", "CUTWIRE", "electronics", "piece", 780, 420, 410, "street", "illegal", null, ["shielded"], ["radio module", "battery"], ["CONTRABAND"], "mixed-units"],
  ["pulse-health-monitor", "PH/M3", "PULSE HEALTH MONITOR", "PULSE MEDICAL", "electronics", "piece", 160, 90, 88, "medical", "licensed", null, ["sterile", "shielded"], ["sensor", "battery"], ["MEDICAL"], "document-units"],
  ["home-grid-battery", "HG/B4", "HOME GRID BATTERY B4", "HEXA DOMESTIC", "electronics", "piece", 6800, 5200, 290, "industrial", "legal", null, ["dry"], ["battery cells", "controller"], ["POWER"], "mixed-units"],

  ["vectra-lift-spine-r2", "VT/LSR2", "VECTRA LIFT-ASSIST SPINE R2", "VECTRA", "cyberware", "set", 4200, 3600, 1850, "industrial", "licensed", null, ["sterile", "shielded"], ["alloy spine", "actuators", "neural bus"], ["IMPLANT"], "medical-units"],
  ["cmu-cardiac-regulator-c7", "CMU/CR7", "CMU CARDIAC REGULATOR C7", "CMU MEDICAL", "cyberware", "piece", 240, 120, 3400, "medical", "licensed", null, ["sterile", "shielded"], ["biopolymer", "controller"], ["IMPLANT"], "medical-units"],
  ["aurelian-ocular-array-a3", "AU/OA3", "AURELIAN OCULAR ARRAY A3", "AURELIAN", "cyberware", "set", 180, 100, 2600, "premium", "licensed", null, ["sterile", "shielded"], ["optics", "neural interface"], ["IMPLANT"], "medical-units"],
  ["meshline-navlink-n4", "ML/N4", "MESHLINE NAVLINK N4", "MESHLINE", "cyberware", "piece", 95, 55, 1150, "industrial", "licensed", null, ["sterile", "shielded"], ["radio", "neural interface"], ["IMPLANT"], "medical-units"],
  ["aurelian-cortex-relay-ax", "AU/CRAX", "AURELIAN CORTEX RELAY AX", "AURELIAN", "cyberware", "piece", 130, 80, 5800, "premium", "restricted", null, ["sterile", "shielded"], ["neural processor", "bioelectrodes"], ["IMPLANT"], "medical-units"],
  ["vectra-gripdrive-g5", "VT/G5", "VECTRA GRIPDRIVE PAIR G5", "VECTRA", "cyberware", "set", 1600, 1300, 2100, "industrial", "licensed", null, ["sterile", "dry"], ["actuators", "neural contacts"], ["IMPLANT"], "medical-units"],
  ["cmu-dermal-seal-d2", "CMU/DS2", "CMU DERMAL SEAL D2", "CMU MEDICAL", "cyberware", "set", 620, 450, 1700, "medical", "licensed", null, ["sterile"], ["dermal mesh", "bioadhesive"], ["IMPLANT"], "medical-units"],
  ["cutwire-overclock-node", "CW/OCN", "CUTWIRE OVERCLOCK NODE", "CUTWIRE", "cyberware", "piece", 80, 45, 900, "street", "illegal", null, ["shielded"], ["processor", "unlicensed neural leads"], ["IMPLANT", "CONTRABAND"], "medical-units"],

  ["hexa-cleaning-pack", "HX/CLN", "HEXA CLEANING PACK", "HEXA DOMESTIC", "household", "package", 950, 850, 26, "standard", "legal", 2880, ["dry"], ["detergent", "filter cloth"], ["HOME"], "mixed-units"],
  ["civic-bedding-roll", "CB/R1", "CIVIC BEDDING ROLL", "CIVIC HOUSING", "household", "roll", 3400, 8200, 48, "street", "legal", null, ["dry"], ["synthetic fiber", "foam"], ["HOME"], "mixed-units"],
  ["water-filter-cartridge", "WF/C6", "WATER FILTER CARTRIDGE", "CIVIC WATER", "household", "cartridge", 740, 480, 39, "standard", "legal", null, ["dry"], ["carbon filter", "membrane"], ["WATER"], "mixed-units"],
  ["apartment-tool-kit", "AT/K2", "APARTMENT TOOL KIT", "HEXA DOMESTIC", "household", "set", 2300, 1900, 84, "standard", "legal", null, ["dry"], ["tools", "fasteners", "sealant"], ["HOME"], "parts-units"],

  ["civic-synthetic-fuel", "CF/S95", "CIVIC SYNTHETIC FUEL", "CIVIC ENERGY", "fuel", "liter", 820, 1000, 3, "industrial", "restricted", 8760, ["hazardous"], ["synthetic hydrocarbon"], ["FUEL"], "mixed-units"],
  ["vectra-premium-fuel", "VF/P98", "VECTRA PREMIUM FUEL", "VECTRA ENERGY", "fuel", "liter", 810, 1000, 5, "premium", "restricted", 8760, ["hazardous"], ["refined synthetic fuel"], ["FUEL"], "mixed-units"],
  ["meshline-cell-charge", "ML/CHG", "MESHLINE CELL CHARGE", "MESHLINE", "fuel", "cartridge", 1800, 1200, 42, "industrial", "licensed", null, ["shielded", "hazardous"], ["battery electrolyte", "power cell"], ["ENERGY"], "mixed-units"],

  ["forged-civic-id", "FG/ID", "FORGED CIVIC ID", "UNDERLINE", "contraband", "piece", 20, 5, 260, "street", "illegal", null, ["shielded"], ["data substrate", "forged credential"], ["IDENTITY"], "document-units"],
  ["unregistered-stim-vial", "US/V9", "UNREGISTERED STIM VIAL", "UNDERLINE", "contraband", "dose", 18, 10, 95, "street", "illegal", 720, ["chilled"], ["stimulant compound"], ["DRUG"], "medical-units"],
  ["scrubbed-vehicle-plate", "SV/PLT", "SCRUBBED VEHICLE PLATE", "CUTWIRE", "contraband", "set", 820, 620, 180, "street", "illegal", null, ["dry"], ["alloy plate", "forged transponder"], ["VEHICLE"], "parts-units"],

  ["biofeed-slurry", "RAW/BIO", "BIOFEED SLURRY", "NORTHLINE IMPORT", "raw-material", "kilogram", 1000, 900, 2, "industrial", "licensed", 360, ["chilled", "hazardous"], ["biomass feedstock"], ["RAW"], "biomass-feedstock"],
  ["clinical-chemical-feed", "RAW/CHEM", "CLINICAL CHEMICAL FEED", "NORTHLINE IMPORT", "raw-material", "liter", 1100, 1000, 4, "industrial", "restricted", 1440, ["hazardous"], ["chemical feedstock"], ["RAW"], "chemical-feedstock"],
  ["alloy-billet", "RAW/ALLOY", "ALLOY BILLET", "NORTHLINE IMPORT", "raw-material", "kilogram", 1000, 380, 3, "industrial", "legal", null, ["dry"], ["alloy feedstock"], ["RAW"], "alloy-feedstock"],
  ["logic-component-tray", "RAW/LOGIC", "LOGIC COMPONENT TRAY", "AURELIAN COMPONENTS", "raw-material", "package", 420, 260, 7, "industrial", "licensed", null, ["shielded"], ["electronic components"], ["RAW"], "electronic-components"],
  ["secure-data-substrate", "RAW/DATA", "SECURE DATA SUBSTRATE", "AURELIAN", "raw-material", "roll", 600, 450, 5, "industrial", "licensed", null, ["shielded", "dry"], ["data substrate"], ["RAW"], "data-substrate"],
  ["packaging-film-roll", "RAW/PACK", "PACKAGING FILM ROLL", "NORTHLINE PACKAGING", "raw-material", "roll", 1200, 1600, 1, "industrial", "legal", null, ["dry"], ["packaging polymer"], ["RAW"], "packaging-units"]
];

export const PRODUCT_CATALOG: readonly ProductDefinition[] = [...FOOD_PRODUCTS, ...EXTRA_ROWS.map(row)];
export const PRODUCT_CATALOG_VERSION = 1;

export function getProduct(productId: string): ProductDefinition {
  const product = PRODUCT_CATALOG.find((item) => item.id === productId);
  if (!product) throw new Error(`Unknown product: ${productId}`);
  return product;
}

export function productForLegacyResource(resource: NonNullable<ProductDefinition["legacyResource"]>, scope = ""): ProductDefinition {
  const scoped = scope.toLowerCase();
  const preferred = resource === "food-units" && (scoped.includes("nutrient") || scoped.includes("mireva") || scoped.includes("culture")) ? "blueroot-noodles"
    : resource === "food-units" && scoped.includes("kitchen") ? "dockyard-stew-04"
    : resource === "medical-units" && scoped.includes("reagent") ? "medpatch-basic"
    : resource === "parts-units" && scoped.includes("microfab") ? "microfab-bearing-set"
    : resource === "document-units" ? "aurelian-data-key"
    : resource === "mixed-units" ? "hexa-cleaning-pack"
    : undefined;
  return PRODUCT_CATALOG.find((item) => item.id === preferred)
    ?? PRODUCT_CATALOG.find((item) => item.legacyResource === resource)
    ?? PRODUCT_CATALOG[0];
}
