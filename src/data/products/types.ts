export type ProductCategory =
  | "food"
  | "drink"
  | "medicine"
  | "vehicle-part"
  | "tool"
  | "apparel"
  | "armor"
  | "electronics"
  | "cyberware"
  | "household"
  | "fuel"
  | "contraband"
  | "raw-material";

export type ProductUnit = "piece" | "package" | "bottle" | "can" | "liter" | "kilogram" | "dose" | "set" | "cartridge" | "roll";
export type ProductQualityGrade = "street" | "standard" | "premium" | "medical" | "industrial" | "military";
export type ProductLegality = "legal" | "licensed" | "restricted" | "illegal";
export type ProductStorageCondition = "ambient" | "dry" | "chilled" | "frozen" | "sterile" | "shielded" | "hazardous";

export interface ProductEffects {
  hungerDelta?: number;
  healthDelta?: number;
  fatigueDelta?: number;
  stressDelta?: number;
  protection?: number;
  technicalBonus?: number;
  medicalBonus?: number;
  serviceBonus?: number;
}

export interface ProductDefinition {
  id: string;
  sku: string;
  name: string;
  brand: string;
  manufacturer: string;
  category: ProductCategory;
  unit: ProductUnit;
  massGrams: number;
  volumeMl: number;
  basePrice: number;
  quality: ProductQualityGrade;
  legality: ProductLegality;
  shelfLifeHours: number | null;
  storage: ProductStorageCondition[];
  stackLimit: number;
  description: string;
  materials: string[];
  tags: string[];
  effects?: ProductEffects;
  legacyResource?: "food-units" | "medical-units" | "parts-units" | "document-units" | "mixed-units" | "biomass-feedstock" | "chemical-feedstock" | "alloy-feedstock" | "electronic-components" | "data-substrate" | "packaging-units";
}
