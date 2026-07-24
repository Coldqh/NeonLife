import type { EntityId } from "../../core/ids/entityId";

export type VehicleCrimeActionKind = "inspect" | "break-in" | "hotwire" | "cabin-theft" | "replate" | "strip" | "fence";
export type VehicleCrimeIncidentStatus = "observed" | "pending-report" | "reported" | "investigating" | "closed";
export type VehicleWantedStatus = "unreported" | "wanted" | "replated" | "stripped" | "fenced" | "recovered";
export type VehicleWitnessObservation = "tampering" | "forced-entry" | "alarm" | "driver-departure" | "plate-change" | "vehicle-strip";

export interface VehicleCrimeInspectionState {
  vehicleId: EntityId;
  inspectedAt: number;
  lockDifficulty: number;
  ignitionDifficulty: number;
  alarmRisk: number;
  cameraRisk: number;
  witnessRisk: number;
  estimatedFenceValue: number;
  cabinLootValue: number;
}

export interface VehicleWitnessReportState {
  id: EntityId;
  incidentId: EntityId;
  witnessActorId: EntityId;
  residentId?: EntityId;
  name: string;
  observation: VehicleWitnessObservation;
  confidence: number;
  recognizedPlayer: boolean;
  sawPlate: boolean;
  reported: boolean;
  reportDueAt: number;
  reportedAt?: number;
}

export interface VehicleCrimeIncidentState {
  id: EntityId;
  vehicleId: EntityId;
  districtId: EntityId;
  sectorId: EntityId;
  action: VehicleCrimeActionKind;
  status: VehicleCrimeIncidentStatus;
  occurredAt: number;
  success: boolean;
  alarmTriggered: boolean;
  ownerEntityId?: EntityId;
  originalPlate: string;
  observedPlate: string;
  evidence: number;
  heat: number;
  witnessReportIds: EntityId[];
  cameraObservationIds: EntityId[];
  ownerReportDueAt?: number;
  reportedAt?: number;
  caseId?: EntityId;
}

export interface WantedVehicleState {
  vehicleId: EntityId;
  incidentId: EntityId;
  originalPlate: string;
  currentPlate: string;
  status: VehicleWantedStatus;
  heat: number;
  evidence: number;
  reportedAt?: number;
  caseId?: EntityId;
  lastSeenDistrictId?: EntityId;
  lastSeenAt?: number;
}


export interface VehicleInsuranceClaimState {
  id: EntityId;
  vehicleId: EntityId;
  incidentId: EntityId;
  ownerResidentId: EntityId;
  insurerEntityId: EntityId;
  amount: number;
  status: "filed" | "paid" | "denied";
  filedAt: number;
  paidAt?: number;
}

export interface VehicleFenceOfferState {
  id: EntityId;
  vehicleId: EntityId;
  kind: "replate" | "strip" | "fence";
  amount: number;
  risk: number;
  available: boolean;
  createdAt: number;
}

export interface VehicleCrimeTotalsState {
  inspections: number;
  breakInAttempts: number;
  forcedEntries: number;
  hotwireAttempts: number;
  vehiclesStolen: number;
  alarmsTriggered: number;
  witnessReports: number;
  cameraCaptures: number;
  casesOpened: number;
  vehiclesReplated: number;
  vehiclesStripped: number;
  vehiclesFenced: number;
  cabinLootTaken: number;
  creditsEarned: number;
  insuranceClaimsPaid: number;
  insuranceCreditsPaid: number;
}

export interface VehicleCrimeState {
  version: 1;
  inspections: VehicleCrimeInspectionState[];
  incidents: VehicleCrimeIncidentState[];
  witnessReports: VehicleWitnessReportState[];
  wantedVehicles: WantedVehicleState[];
  fenceOffers: VehicleFenceOfferState[];
  insuranceClaims: VehicleInsuranceClaimState[];
  stolenVehicleIds: EntityId[];
  playerHeat: number;
  totals: VehicleCrimeTotalsState;
  lastUpdatedAt: number;
}

export interface VehicleCrimeActionResult {
  state: VehicleCrimeState;
  success: boolean;
  alarmTriggered: boolean;
  evidence: number;
  heat: number;
  incidentId?: EntityId;
  witnessCount: number;
  cameraCount: number;
  ownerReportDueAt?: number;
  detail: string;
}
