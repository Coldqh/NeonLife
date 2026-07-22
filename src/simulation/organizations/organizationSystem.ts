import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BusinessState } from "../../gameplay/economy/types";
import type { OrganizationState } from "../../world/state/types";
import type { InfrastructureNetworkState } from "../infrastructure/types";
import type { KernelTransactionDraft } from "../kernel/types";
import type { BackgroundResident, EmploymentRecord } from "../population/types";
import type { ProductionFacilityState, ProductionSupplyContract } from "../production/types";
import type {
  OrganizationActorState,
  OrganizationAdvanceResult,
  OrganizationAgreementKind,
  OrganizationAgreementState,
  OrganizationDecisionState,
  OrganizationDecisionType,
  OrganizationEcosystemInput,
  OrganizationEcosystemState,
  OrganizationEcosystemTotals,
  OrganizationGovernance,
  OrganizationHealth,
  OrganizationLeadershipState,
  OrganizationMetricsState,
  OrganizationNotice,
  OrganizationRelationState,
  OrganizationRelationStatus,
  OrganizationStrategy,
  OrganizationWeeklySnapshot
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
const MAX_DECISIONS = 240;
const MAX_HISTORY = 80;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[], fallback = 0): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function governanceFor(organization: OrganizationState): OrganizationGovernance {
  if (organization.type === "corporation") return "board";
  if (organization.type === "government" || organization.type === "police" || organization.type === "transport") return "bureau";
  if (organization.type === "medical") return "union";
  if (organization.type === "gang") return "cell";
  if (organization.name.includes("CO-OP")) return "cooperative";
  return "executive";
}

function defaultRisk(organization: OrganizationState): number {
  if (organization.type === "gang") return 86;
  if (organization.type === "corporation") return 64;
  if (organization.type === "company") return 58;
  if (organization.type === "police") return 38;
  if (organization.type === "medical" || organization.type === "transport") return 30;
  return 44;
}

function defaultLegalPreference(organization: OrganizationState): number {
  if (organization.type === "gang") return 8;
  if (organization.type === "company") return 68;
  if (organization.type === "corporation") return 74;
  return 90;
}

function leadershipScore(resident: BackgroundResident, employment?: EmploymentRecord): number {
  const skills = resident.skills;
  const administration = skills?.administration ?? resident.skillLevel;
  const security = skills?.security ?? resident.skillLevel * 0.7;
  const technical = skills?.technical ?? resident.skillLevel * 0.8;
  const performance = employment?.performance ?? 50;
  return Math.round(administration * 0.48 + security * 0.16 + technical * 0.12 + performance * 0.24);
}

function eligibleLeaders(input: OrganizationEcosystemInput, organizationId: string): Array<{ resident: BackgroundResident; employment: EmploymentRecord; score: number }> {
  const residentById = new Map(input.population.residents.map((resident) => [resident.id, resident]));
  return input.population.employments
    .filter((employment) => employment.organizationId === organizationId && employment.status !== "unemployed")
    .map((employment) => ({ resident: residentById.get(employment.residentId), employment }))
    .filter((entry): entry is { resident: BackgroundResident; employment: EmploymentRecord } => Boolean(entry.resident))
    .filter((entry) => entry.resident.lifeStage === "working-age" && entry.resident.health !== "disabled")
    .map((entry) => ({ ...entry, score: leadershipScore(entry.resident, entry.employment) }))
    .sort((left, right) => right.score - left.score || left.resident.id.localeCompare(right.resident.id));
}

function createLeadership(input: OrganizationEcosystemInput, organizationId: string, dayIndex: number): OrganizationLeadershipState {
  const candidates = eligibleLeaders(input, organizationId);
  return {
    leaderResidentId: candidates[0]?.resident.id ?? null,
    managementResidentIds: candidates.slice(1, 4).map((entry) => entry.resident.id),
    leadershipScore: candidates[0]?.score ?? 25,
    continuity: candidates.length ? 72 : 28,
    appointedDay: dayIndex,
    changes: 0
  };
}

function ownedBusinesses(input: OrganizationEcosystemInput, organizationId: string): BusinessState[] {
  return input.economy.businesses.filter((business) => business.organizationId === organizationId);
}

function ownedFacilities(input: OrganizationEcosystemInput, organizationId: string): ProductionFacilityState[] {
  return input.production.facilities.filter((facility) => facility.ownerEntityId === organizationId);
}

function ownedNetworks(input: OrganizationEcosystemInput, organizationId: string): InfrastructureNetworkState[] {
  return input.infrastructure.networks.filter((network) => network.providerEntityId === organizationId);
}

function contractOrganizations(input: OrganizationEcosystemInput, contract: ProductionSupplyContract): { source?: string; target?: string } {
  const source = input.production.facilities.find((facility) => facility.id === contract.sourceFacilityId)?.ownerEntityId;
  const target = contract.targetFacilityId
    ? input.production.facilities.find((facility) => facility.id === contract.targetFacilityId)?.ownerEntityId
    : input.economy.businesses.find((business) => business.id === contract.targetBusinessId)?.organizationId;
  return { source, target };
}

function metricsFor(input: OrganizationEcosystemInput, organization: OrganizationState, baselineTreasury: number): OrganizationMetricsState {
  const businesses = ownedBusinesses(input, organization.id);
  const facilities = ownedFacilities(input, organization.id);
  const networks = ownedNetworks(input, organization.id);
  const housing = input.population.housing.filter((unit) => unit.ownerOrganizationId === organization.id);
  const employments = input.population.employments.filter((employment) => employment.organizationId === organization.id && employment.status !== "unemployed");
  const activeWorkers = employments.filter((employment) => employment.status === "active").length;
  const staffGap = businesses.reduce((sum, business) => sum + Math.max(0, business.targetStaff - employments.filter((employment) => employment.locationId === business.locationId && employment.status !== "unemployed").length), 0);
  const linkedContracts = input.production.contracts.filter((contract) => {
    const parties = contractOrganizations(input, contract);
    return parties.source === organization.id || parties.target === organization.id;
  });
  const assetValue = input.kernel.assets.filter((asset) => asset.ownerEntityId === organization.id).reduce((sum, asset) => sum + asset.valuation, 0);
  const operatingProfit = businesses.reduce((sum, business) => sum + business.rollingProfit, 0);
  const serviceReliability = mean([
    ...networks.map((network) => network.averageServiceLevel),
    ...businesses.map((business) => business.infrastructureServiceLevel)
  ], 72);
  const productionReliability = mean(facilities.map((facility) => (facility.condition + facility.infrastructureLevel + facility.staffing) / 3), 72);
  const totalBusinessCash = input.economy.businesses.reduce((sum, business) => sum + Math.max(0, business.cash), 0);
  const ownBusinessCash = businesses.reduce((sum, business) => sum + Math.max(0, business.cash), 0);
  return {
    treasury: organization.budget,
    baselineTreasury,
    assetValue,
    operatingProfit,
    ownedBusinesses: businesses.length,
    ownedFacilities: facilities.length,
    ownedNetworks: networks.length,
    ownedHousing: housing.length,
    simulatedWorkers: employments.length,
    activeWorkers,
    staffGap,
    supplyBreaches: linkedContracts.reduce((sum, contract) => sum + contract.breachCount, 0),
    serviceReliability: Math.round(serviceReliability),
    productionReliability: Math.round(productionReliability),
    marketShare: totalBusinessCash > 0 ? Math.round(ownBusinessCash / totalBusinessCash * 100) : 0
  };
}

function healthFor(metrics: OrganizationMetricsState): OrganizationHealth {
  const liquidity = metrics.baselineTreasury > 0 ? metrics.treasury / metrics.baselineTreasury : 1;
  if (metrics.treasury <= 0 && metrics.assetValue <= 0) return "dormant";
  if (liquidity < 0.18 || metrics.serviceReliability < 22 || metrics.productionReliability < 22) return "distressed";
  if (liquidity < 0.52 || metrics.serviceReliability < 48 || metrics.productionReliability < 48 || metrics.supplyBreaches >= 8) return "strained";
  if (liquidity > 0.8 && (metrics.ownedBusinesses + metrics.ownedFacilities + metrics.ownedNetworks) > 0 && metrics.operatingProfit >= 0 && metrics.serviceReliability >= 68 && metrics.productionReliability >= 66 && metrics.supplyBreaches <= 1) return "expanding";
  return "stable";
}

function strategyFor(organization: OrganizationState, metrics: OrganizationMetricsState, health: OrganizationHealth): OrganizationStrategy {
  if (organization.type === "gang") return metrics.supplyBreaches > 2 ? "territorial-network" : metrics.treasury > metrics.baselineTreasury * 0.6 ? "market-capture" : "consolidation";
  if (metrics.serviceReliability < 55 && metrics.ownedNetworks > 0) return "service-restoration";
  if (metrics.supplyBreaches >= 3 || metrics.productionReliability < 52) return "supply-security";
  if (health === "distressed") return "consolidation";
  if (metrics.operatingProfit < -120 || health === "strained") return "cost-control";
  if (health === "expanding" && metrics.staffGap <= 3) return "expansion";
  if (metrics.staffGap >= 2 || (metrics.simulatedWorkers > 0 && metrics.activeWorkers / metrics.simulatedWorkers < 0.74)) return "workforce-retention";
  if (health === "expanding") return "expansion";
  return "reserve-building";
}

function baseInfluence(input: OrganizationEcosystemInput, organization: OrganizationState): Record<string, number> {
  const result: Record<string, number> = {};
  for (const district of input.districts) {
    const ownedLocations = input.locations.filter((location) => location.districtId === district.id && location.organizationId === organization.id).length;
    const typeBase = organization.type === "gang" ? district.gangInfluence : organization.type === "police" || organization.type === "government" ? district.governmentInfluence : district.corporateInfluence;
    result[district.id] = clamp(Math.round(typeBase * 0.55 + ownedLocations * 13 + organization.reputation * 0.2));
  }
  return result;
}

function createActor(input: OrganizationEcosystemInput, organization: OrganizationState, dayIndex: number, weekIndex: number): OrganizationActorState {
  const baselineTreasury = Math.max(1, organization.budget);
  const metrics = metricsFor(input, organization, baselineTreasury);
  const health = healthFor(metrics);
  return {
    organizationId: organization.id,
    governance: governanceFor(organization),
    health,
    strategy: strategyFor(organization, metrics, health),
    riskTolerance: defaultRisk(organization),
    reserveTarget: Math.round(baselineTreasury * (organization.type === "corporation" ? 0.24 : organization.type === "gang" ? 0.12 : 0.18)),
    wagePosition: organization.type === "corporation" ? 118 : organization.type === "government" || organization.type === "medical" ? 104 : organization.type === "gang" ? 82 : 100,
    legalPreference: defaultLegalPreference(organization),
    leadership: createLeadership(input, organization.id, dayIndex),
    metrics,
    influenceByDistrict: baseInfluence(input, organization),
    lastDecisionWeek: weekIndex - 1,
    lastUpdatedAt: input.timestamp
  };
}

function relationStatus(trust: number, rivalry: number, dependency: number): OrganizationRelationStatus {
  if (trust <= 18 && rivalry >= 68) return "hostile";
  if (rivalry >= 62) return "rival";
  if (trust >= 64 && dependency >= 24) return "partner";
  if (dependency >= 52) return "dependent";
  return "neutral";
}

function pairKey(left: string, right: string): [string, string] {
  return left < right ? [left, right] : [right, left];
}

function dependencyBetween(input: OrganizationEcosystemInput, leftId: string, rightId: string): number {
  const links = input.production.contracts.filter((contract) => {
    const parties = contractOrganizations(input, contract);
    return (parties.source === leftId && parties.target === rightId) || (parties.source === rightId && parties.target === leftId);
  });
  const utility = input.infrastructure.networks.some((network) => network.providerEntityId === leftId || network.providerEntityId === rightId) ? 8 : 0;
  return clamp(links.length * 14 + utility);
}

function rivalryBetween(left: OrganizationState, right: OrganizationState): number {
  if ((left.type === "police" && right.type === "gang") || (right.type === "police" && left.type === "gang")) return 92;
  if (left.type === "gang" || right.type === "gang") return left.type === right.type ? 76 : 42;
  if (left.type === right.type) return 58;
  if ((left.type === "corporation" || left.type === "company") && (right.type === "corporation" || right.type === "company")) return 46;
  return 18;
}

function createRelations(input: OrganizationEcosystemInput): OrganizationRelationState[] {
  const relations: OrganizationRelationState[] = [];
  for (let leftIndex = 0; leftIndex < input.organizations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < input.organizations.length; rightIndex += 1) {
      const left = input.organizations[leftIndex];
      const right = input.organizations[rightIndex];
      const [source, target] = pairKey(left.id, right.id);
      const dependency = dependencyBetween(input, left.id, right.id);
      const rivalry = rivalryBetween(left, right);
      const trust = clamp(52 + dependency * 0.2 - rivalry * 0.35 + (left.reputation + right.reputation) * 0.08);
      relations.push({
        id: createStableEntityId("org-relation", `${input.seed}:${source}:${target}`),
        sourceOrganizationId: source,
        targetOrganizationId: target,
        trust: Math.round(trust),
        rivalry,
        dependency,
        leverage: clamp(Math.round(Math.abs(left.budget - right.budget) / Math.max(1, Math.max(left.budget, right.budget)) * 100)),
        status: relationStatus(trust, rivalry, dependency),
        lastUpdatedAt: input.timestamp
      });
    }
  }
  return relations;
}

function agreementKind(input: OrganizationEcosystemInput, leftId: string, rightId: string): OrganizationAgreementKind {
  const left = input.organizations.find((organization) => organization.id === leftId);
  const right = input.organizations.find((organization) => organization.id === rightId);
  if (left?.type === "gang" || right?.type === "gang") return "nonaggression";
  if (input.infrastructure.networks.some((network) => network.providerEntityId === leftId || network.providerEntityId === rightId)) return "service-concession";
  return "supply-framework";
}

function createAgreements(input: OrganizationEcosystemInput, relations: OrganizationRelationState[]): OrganizationAgreementState[] {
  return relations
    .filter((relation) => relation.dependency >= 18 && relation.status !== "hostile")
    .map((relation) => {
      const linked = input.production.contracts.filter((contract) => {
        const parties = contractOrganizations(input, contract);
        return (parties.source === relation.sourceOrganizationId && parties.target === relation.targetOrganizationId)
          || (parties.source === relation.targetOrganizationId && parties.target === relation.sourceOrganizationId);
      });
      const breaches = linked.reduce((sum, contract) => sum + contract.breachCount, 0);
      return {
        id: createStableEntityId("org-agreement", `${input.seed}:${relation.sourceOrganizationId}:${relation.targetOrganizationId}:${agreementKind(input, relation.sourceOrganizationId, relation.targetOrganizationId)}`),
        kind: agreementKind(input, relation.sourceOrganizationId, relation.targetOrganizationId),
        sourceOrganizationId: relation.sourceOrganizationId,
        targetOrganizationId: relation.targetOrganizationId,
        status: breaches >= 5 ? "breached" as const : breaches > 0 ? "strained" as const : "active" as const,
        startedAt: input.timestamp,
        reviewAt: input.timestamp + WEEK_MS,
        breachCount: breaches,
        linkedContractIds: linked.map((contract) => contract.id),
        weeklyValue: linked.reduce((sum, contract) => sum + contract.batchSize * contract.unitPrice, 0),
        metadata: { dependency: relation.dependency, trust: relation.trust }
      };
    });
}

function emptyTotals(): OrganizationEcosystemTotals {
  return { decisions: 0, blockedDecisions: 0, investments: 0, creditsCommitted: 0, expansions: 0, contractions: 0, leadershipChanges: 0, agreementsCreated: 0, agreementsBreached: 0 };
}

export function createOrganizationEcosystem(input: OrganizationEcosystemInput): OrganizationEcosystemState {
  const dayIndex = Math.floor(input.timestamp / DAY_MS);
  const weekIndex = Math.floor(input.timestamp / WEEK_MS);
  const relations = createRelations(input);
  const agreements = createAgreements(input, relations);
  return {
    version: 1,
    actors: input.organizations.map((organization) => createActor(input, organization, dayIndex, weekIndex)),
    relations,
    agreements,
    decisions: [],
    history: [],
    totals: { ...emptyTotals(), agreementsCreated: agreements.length, agreementsBreached: agreements.filter((agreement) => agreement.status === "breached").length },
    dayIndex,
    weekIndex,
    simulatedWeeks: 0,
    lastUpdatedAt: input.timestamp
  };
}

function updateLeadership(actor: OrganizationActorState, input: OrganizationEcosystemInput, dayIndex: number): { leadership: OrganizationLeadershipState; changed: boolean } {
  const candidates = eligibleLeaders(input, actor.organizationId);
  const current = actor.leadership.leaderResidentId ? input.population.residents.find((resident) => resident.id === actor.leadership.leaderResidentId) : undefined;
  const currentEmployment = actor.leadership.leaderResidentId ? input.population.employments.find((employment) => employment.residentId === actor.leadership.leaderResidentId && employment.organizationId === actor.organizationId && employment.status !== "unemployed") : undefined;
  const invalid = !current || !currentEmployment || current.health === "disabled" || current.healthScore < 34;
  const replacement = candidates[0];
  if (!invalid || !replacement || replacement.resident.id === actor.leadership.leaderResidentId) {
    return { leadership: { ...actor.leadership, continuity: clamp(actor.leadership.continuity + (invalid ? -8 : 1)) }, changed: false };
  }
  return {
    leadership: {
      leaderResidentId: replacement.resident.id,
      managementResidentIds: candidates.slice(1, 4).map((entry) => entry.resident.id),
      leadershipScore: replacement.score,
      continuity: Math.max(28, actor.leadership.continuity - 18),
      appointedDay: dayIndex,
      changes: actor.leadership.changes + 1
    },
    changed: true
  };
}

function decisionType(strategy: OrganizationStrategy, organization: OrganizationState, actor: OrganizationActorState): OrganizationDecisionType {
  if (organization.type === "gang" && (strategy === "market-capture" || strategy === "territorial-network")) return "fund-backchannel";
  if (strategy === "service-restoration") return "restore-network";
  if (strategy === "supply-security") return "secure-supply";
  if (strategy === "workforce-retention") return "raise-compensation";
  if (strategy === "cost-control") return actor.metrics.operatingProfit < -60 && actor.metrics.ownedBusinesses ? "reduce-costs" : actor.metrics.ownedBusinesses || actor.metrics.ownedFacilities ? "fund-operation" : "build-reserve";
  if (strategy === "consolidation") return actor.metrics.ownedBusinesses || actor.metrics.ownedFacilities ? "fund-operation" : "build-reserve";
  if (strategy === "expansion") return actor.metrics.ownedFacilities ? "expand-production" : actor.metrics.ownedBusinesses ? "expand-business" : "build-reserve";
  if (actor.health === "strained" || actor.health === "distressed") return "fund-operation";
  return "build-reserve";
}

function investmentAmount(organization: OrganizationState, actor: OrganizationActorState, type: OrganizationDecisionType): number {
  if (type === "build-reserve" || type === "reduce-costs") return 0;
  const scale = type === "expand-production" || type === "restore-network" ? 0.00055 : type === "expand-business" ? 0.00038 : 0.00022;
  const ceiling = type === "expand-production" ? 48_000 : type === "restore-network" ? 36_000 : 24_000;
  const desired = Math.round(Math.max(650, actor.metrics.baselineTreasury * scale));
  return Math.min(ceiling, desired, Math.max(0, Math.round(organization.budget * 0.18)));
}

interface MutableOrganizationWorld {
  organizations: OrganizationState[];
  population: OrganizationEcosystemInput["population"];
  economy: OrganizationEcosystemInput["economy"];
  infrastructure: OrganizationEcosystemInput["infrastructure"];
  production: OrganizationEcosystemInput["production"];
}

function spendOrganization(world: MutableOrganizationWorld, organizationId: string, amount: number): number {
  const organization = world.organizations.find((entry) => entry.id === organizationId);
  if (!organization || amount <= 0) return 0;
  const paid = Math.min(amount, Math.max(0, organization.budget));
  world.organizations = world.organizations.map((entry) => entry.id === organizationId ? { ...entry, budget: entry.budget - paid } : entry);
  return paid;
}

function organizationTransaction(seed: string, weekIndex: number, organizationId: string, targetId: string, amount: number, type: OrganizationDecisionType, timestamp: number): KernelTransactionDraft {
  return {
    idempotencyKey: `${seed}:org:${weekIndex}:${organizationId}:${type}:${targetId}:${amount}`,
    timestamp,
    debitEntityId: organizationId,
    creditEntityId: targetId,
    resource: "credits",
    amount,
    reason: "organization-investment",
    description: `${type.replace(/-/g, " ")} committed by organization governance.`
  };
}

function executeDecision(
  input: OrganizationEcosystemInput,
  world: MutableOrganizationWorld,
  actor: OrganizationActorState,
  organization: OrganizationState,
  weekIndex: number,
  timestamp: number
): { decision: OrganizationDecisionState; transactions: KernelTransactionDraft[]; notice?: OrganizationNotice; expansion: number; contraction: number; investment: number } {
  const type = decisionType(actor.strategy, organization, actor);
  const rng = new SeededRandom(`${input.seed}:org-decision:${weekIndex}:${organization.id}:${type}`);
  const decisionId = createStableEntityId("org-decision", `${input.seed}:${weekIndex}:${organization.id}:${type}`);
  const amount = investmentAmount(organization, actor, type);
  const transactions: KernelTransactionDraft[] = [];
  let status: OrganizationDecisionState["status"] = "executed";
  let targetEntityId: string | undefined;
  let description = "Treasury retained for later obligations.";
  let effects: Record<string, string | number | boolean> = {};
  let expansion = 0;
  let contraction = 0;
  let investment = 0;

  if (type === "restore-network") {
    const network = world.infrastructure.networks.filter((entry) => entry.providerEntityId === organization.id).sort((a, b) => a.averageServiceLevel - b.averageServiceLevel)[0];
    if (!network || amount <= 0) status = "blocked";
    else {
      const paid = spendOrganization(world, organization.id, amount);
      targetEntityId = network.id;
      world.infrastructure = {
        ...world.infrastructure,
        networks: world.infrastructure.networks.map((entry) => entry.id === network.id ? { ...entry, reserveFund: entry.reserveFund + paid, status: entry.status === "offline" ? "restricted" : entry.status } : entry),
        nodes: world.infrastructure.nodes.map((node) => node.networkId === network.id ? { ...node, condition: clamp(node.condition + 4), maintenanceBacklog: Math.max(0, node.maintenanceBacklog - 3) } : node),
        links: world.infrastructure.links.map((link) => link.networkId === network.id ? { ...link, condition: clamp(link.condition + 3) } : link)
      };
      transactions.push(organizationTransaction(input.seed, weekIndex, organization.id, network.id, paid, type, timestamp));
      description = `${organization.name} capitalized its weakest utility network.`;
      effects = { reserveAdded: paid, conditionRestored: 3 };
      investment = paid;
    }
  } else if (type === "secure-supply") {
    const contracts = world.production.contracts.filter((contract) => {
      const parties = contractOrganizations({ ...input, production: world.production, economy: world.economy }, contract);
      return (parties.source === organization.id || parties.target === organization.id) && contract.breachCount > 0;
    }).sort((a, b) => b.breachCount - a.breachCount);
    const contract = contracts[0];
    if (!contract || amount <= 0) status = "blocked";
    else {
      const paid = spendOrganization(world, organization.id, amount);
      const source = world.production.facilities.find((facility) => facility.id === contract.sourceFacilityId);
      targetEntityId = contract.id;
      world.production = {
        ...world.production,
        facilities: world.production.facilities.map((facility) => facility.id === source?.id ? { ...facility, cash: facility.cash + paid } : facility),
        contracts: world.production.contracts.map((entry) => entry.id === contract.id ? { ...entry, unitPrice: Math.max(1, Math.round(entry.unitPrice * 1.06)), batchSize: Math.max(entry.batchSize, Math.round(entry.batchSize * 1.1)), breachCount: Math.max(0, entry.breachCount - 2), status: entry.status === "breached" ? "strained" : entry.status } : entry)
      };
      if (source) transactions.push(organizationTransaction(input.seed, weekIndex, organization.id, source.id, paid, type, timestamp));
      description = `${organization.name} funded a breached supply route and raised its contract offer.`;
      effects = { contractId: contract.id, prepayment: paid, unitPriceIncrease: 6 };
      investment = paid;
    }
  } else if (type === "expand-business" || type === "fund-operation") {
    const businesses = world.economy.businesses.filter((business) => business.organizationId === organization.id);
    const target = businesses.sort((a, b) => type === "expand-business" ? b.rollingProfit - a.rollingProfit : a.rollingProfit - b.rollingProfit || a.cash - b.cash)[0];
    if (!target || amount <= 0) status = "blocked";
    else {
      const paid = spendOrganization(world, organization.id, amount);
      targetEntityId = target.id;
      world.economy = {
        ...world.economy,
        businesses: world.economy.businesses.map((business) => business.id === target.id ? {
          ...business,
          cash: business.cash + paid,
          capacityLevel: type === "expand-business" ? Math.min(8, business.capacityLevel + 1) : business.capacityLevel,
          targetStaff: type === "expand-business" ? business.targetStaff + 1 : business.targetStaff,
          infrastructureServiceLevel: clamp(business.infrastructureServiceLevel + (type === "fund-operation" ? 4 : 1))
        } : business)
      };
      transactions.push(organizationTransaction(input.seed, weekIndex, organization.id, target.id, paid, type, timestamp));
      description = type === "expand-business" ? `${organization.name} expanded a profitable operating unit.` : `${organization.name} recapitalized a strained operating unit.`;
      effects = { cashAdded: paid, capacityAdded: type === "expand-business" ? 1 : 0, jobsPlanned: type === "expand-business" ? 1 : 0 };
      investment = paid;
      expansion = type === "expand-business" ? 1 : 0;
    }
  } else if (type === "expand-production" || type === "fund-backchannel") {
    const facilities = world.production.facilities.filter((facility) => facility.ownerEntityId === organization.id && (type !== "fund-backchannel" || facility.kind === "black-market"));
    const target = facilities.sort((a, b) => type === "expand-production" ? b.throughputToday - a.throughputToday : a.cash - b.cash)[0];
    if (!target || amount <= 0) status = "blocked";
    else {
      const paid = spendOrganization(world, organization.id, amount);
      targetEntityId = target.id;
      world.production = {
        ...world.production,
        facilities: world.production.facilities.map((facility) => facility.id === target.id ? {
          ...facility,
          cash: facility.cash + paid,
          condition: clamp(facility.condition + 4),
          capacityLevel: Math.min(8, facility.capacityLevel + (type === "expand-production" ? 1 : 0)),
          productionBacklog: Math.max(0, facility.productionBacklog - 1)
        } : facility)
      };
      transactions.push(organizationTransaction(input.seed, weekIndex, organization.id, target.id, paid, type, timestamp));
      description = type === "fund-backchannel" ? `${organization.name} reinforced its unregistered distribution channel.` : `${organization.name} expanded owned production capacity.`;
      effects = { cashAdded: paid, conditionRestored: 4, capacityAdded: type === "expand-production" ? 1 : 0 };
      investment = paid;
      expansion = type === "expand-production" ? 1 : 0;
    }
  } else if (type === "raise-compensation") {
    const jobs = world.population.employments.filter((employment) => employment.organizationId === organization.id && employment.status !== "unemployed");
    if (!jobs.length || amount <= 0) status = "blocked";
    else {
      const paid = spendOrganization(world, organization.id, amount);
      const jobIds = new Set(jobs.map((job) => job.id));
      const residentIds = new Set(jobs.map((job) => job.residentId));
      world.population = {
        ...world.population,
        employments: world.population.employments.map((employment) => jobIds.has(employment.id) ? { ...employment, wagePerDay: Math.max(employment.wagePerDay + 1, Math.round(employment.wagePerDay * 1.045)), satisfaction: clamp((employment.satisfaction ?? 50) + 8), quitPressure: clamp((employment.quitPressure ?? 0) - 14) } : employment),
        residents: world.population.residents.map((resident) => residentIds.has(resident.id) ? { ...resident, skillLevel: clamp(resident.skillLevel + 1), skills: resident.skills ? { ...resident.skills, administration: clamp(resident.skills.administration + (rng.chance(0.45) ? 1 : 0)), technical: clamp(resident.skills.technical + (rng.chance(0.45) ? 1 : 0)) } : resident.skills } : resident)
      };
      targetEntityId = organization.id;
      transactions.push(organizationTransaction(input.seed, weekIndex, organization.id, createStableEntityId("kernel-system", `${input.seed}:city-services`), paid, type, timestamp));
      description = `${organization.name} raised pay bands and funded workforce retention.`;
      effects = { workersAffected: jobs.length, wageIncreasePercent: 4.5, retentionBudget: paid };
      investment = paid;
    }
  } else if (type === "reduce-costs") {
    const business = world.economy.businesses.filter((entry) => entry.organizationId === organization.id && entry.targetStaff > 1).sort((a, b) => a.rollingProfit - b.rollingProfit)[0];
    if (!business) status = "blocked";
    else {
      targetEntityId = business.id;
      world.economy = { ...world.economy, businesses: world.economy.businesses.map((entry) => entry.id === business.id ? { ...entry, targetStaff: Math.max(1, entry.targetStaff - 1), capacityLevel: Math.max(1, entry.capacityLevel - (entry.lossDays >= 6 ? 1 : 0)) } : entry) };
      description = `${organization.name} reduced the target size of an underperforming unit.`;
      effects = { targetStaffDelta: -1, capacityDelta: business.lossDays >= 6 ? -1 : 0 };
      contraction = 1;
    }
  } else {
    targetEntityId = organization.id;
    effects = { reserveRetained: Math.max(0, organization.budget - actor.reserveTarget) };
  }

  const decision: OrganizationDecisionState = {
    id: decisionId,
    organizationId: organization.id,
    type,
    strategy: actor.strategy,
    status,
    createdAt: timestamp,
    executedAt: status === "executed" ? timestamp : undefined,
    targetEntityId,
    creditsCommitted: status === "executed" ? investment : 0,
    description: status === "blocked" ? `${organization.name} could not execute ${type.replace(/-/g, " ")}.` : description,
    effects
  };
  const notice: OrganizationNotice | undefined = status === "executed" && type !== "build-reserve" ? {
    organizationId: organization.id,
    title: `${organization.name}: ${type.replace(/-/g, " ").toUpperCase()}`,
    detail: decision.description,
    importance: investment >= 20_000 || expansion ? 2 : 1
  } : undefined;
  return { decision, transactions, notice, expansion, contraction, investment };
}

function updateRelations(input: OrganizationEcosystemInput, previous: OrganizationRelationState[]): OrganizationRelationState[] {
  const current = createRelations(input);
  return current.map((relation) => {
    const old = previous.find((entry) => entry.id === relation.id);
    if (!old) return relation;
    const linked = input.production.contracts.filter((contract) => {
      const parties = contractOrganizations(input, contract);
      return (parties.source === relation.sourceOrganizationId && parties.target === relation.targetOrganizationId)
        || (parties.source === relation.targetOrganizationId && parties.target === relation.sourceOrganizationId);
    });
    const breaches = linked.reduce((sum, contract) => sum + contract.breachCount, 0);
    const trust = clamp(Math.round(old.trust * 0.72 + relation.trust * 0.28 - Math.min(8, breaches * 0.35)));
    const rivalry = clamp(Math.round(old.rivalry * 0.8 + relation.rivalry * 0.2));
    const dependency = clamp(Math.round(old.dependency * 0.6 + relation.dependency * 0.4));
    return { ...relation, trust, rivalry, dependency, status: relationStatus(trust, rivalry, dependency) };
  });
}

function updateAgreements(input: OrganizationEcosystemInput, relations: OrganizationRelationState[], previous: OrganizationAgreementState[]): OrganizationAgreementState[] {
  const generated = createAgreements(input, relations);
  const generatedIds = new Set(generated.map((agreement) => agreement.id));
  const merged = generated.map((agreement) => {
    const old = previous.find((entry) => entry.id === agreement.id);
    return old ? { ...agreement, startedAt: old.startedAt, breachCount: agreement.breachCount, reviewAt: input.timestamp + WEEK_MS } : agreement;
  });
  const ended = previous.filter((agreement) => !generatedIds.has(agreement.id) && agreement.status !== "ended").map((agreement) => ({ ...agreement, status: "ended" as const, endedAt: input.timestamp }));
  return [...merged, ...ended].slice(-240);
}

export function normalizeOrganizationEcosystem(value: unknown, input: OrganizationEcosystemInput): OrganizationEcosystemState {
  const fresh = createOrganizationEcosystem(input);
  if (!value || typeof value !== "object") return fresh;
  const raw = value as Partial<OrganizationEcosystemState>;
  if (raw.version !== 1 || !Array.isArray(raw.actors) || !Array.isArray(raw.relations)) return fresh;
  const actorById = new Map(raw.actors.map((actor) => [actor.organizationId, actor]));
  return {
    ...fresh,
    ...raw,
    actors: input.organizations.map((organization) => {
      const fallback = fresh.actors.find((actor) => actor.organizationId === organization.id)!;
      const old = actorById.get(organization.id);
      return old ? { ...fallback, ...old, metrics: { ...fallback.metrics, ...old.metrics }, leadership: { ...fallback.leadership, ...old.leadership }, influenceByDistrict: { ...fallback.influenceByDistrict, ...old.influenceByDistrict } } : fallback;
    }),
    relations: raw.relations,
    agreements: Array.isArray(raw.agreements) ? raw.agreements : fresh.agreements,
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    totals: { ...fresh.totals, ...(raw.totals ?? {}) }
  };
}

export function advanceOrganizationEcosystem(state: OrganizationEcosystemState, input: OrganizationEcosystemInput): OrganizationAdvanceResult {
  if (input.timestamp <= state.lastUpdatedAt) return { state, organizations: input.organizations, population: input.population, economy: input.economy, infrastructure: input.infrastructure, production: input.production, notices: [], transactions: [] };
  const targetDay = Math.floor(input.timestamp / DAY_MS);
  const targetWeek = Math.floor(input.timestamp / WEEK_MS);
  const world: MutableOrganizationWorld = {
    organizations: input.organizations.map((organization) => ({ ...organization })),
    population: { ...input.population, residents: input.population.residents.map((resident) => ({ ...resident, skills: resident.skills ? { ...resident.skills } : resident.skills })), employments: input.population.employments.map((employment) => ({ ...employment })) },
    economy: { ...input.economy, businesses: input.economy.businesses.map((business) => ({ ...business })) },
    infrastructure: { ...input.infrastructure, networks: input.infrastructure.networks.map((network) => ({ ...network })), nodes: input.infrastructure.nodes.map((node) => ({ ...node })), links: input.infrastructure.links.map((link) => ({ ...link })) },
    production: { ...input.production, facilities: input.production.facilities.map((facility) => ({ ...facility, inventory: facility.inventory.map((item) => ({ ...item })) })), contracts: input.production.contracts.map((contract) => ({ ...contract })) }
  };
  let actors = state.actors.map((actor) => ({ ...actor, metrics: { ...actor.metrics }, leadership: { ...actor.leadership }, influenceByDistrict: { ...actor.influenceByDistrict } }));
  let decisions = [...state.decisions];
  let history = [...state.history];
  let totals = { ...state.totals };
  const notices: OrganizationNotice[] = [];
  const transactions: KernelTransactionDraft[] = [];
  let weekIndex = state.weekIndex;

  while (weekIndex < targetWeek) {
    weekIndex += 1;
    let weeklyInvestments = 0;
    let weeklyCredits = 0;
    let weeklyLeadershipChanges = 0;
    let weeklyExpansions = 0;
    let weeklyContractions = 0;
    const snapshotInput: OrganizationEcosystemInput = { ...input, timestamp: weekIndex * WEEK_MS, organizations: world.organizations, population: world.population, economy: world.economy, infrastructure: world.infrastructure, production: world.production };

    actors = world.organizations.map((organization) => {
      const old = actors.find((actor) => actor.organizationId === organization.id) ?? createActor(snapshotInput, organization, targetDay, weekIndex);
      const metrics = metricsFor(snapshotInput, organization, old.metrics.baselineTreasury || organization.budget);
      const health = healthFor(metrics);
      const leadershipUpdate = updateLeadership(old, snapshotInput, targetDay);
      if (leadershipUpdate.changed) {
        weeklyLeadershipChanges += 1;
        totals.leadershipChanges += 1;
        notices.push({ organizationId: organization.id, title: `${organization.name} сменил руководителя.`, detail: `Управление перешло к другому работнику из действующего штата.`, importance: 2 });
      }
      const strategy = strategyFor(organization, metrics, health);
      const actor = { ...old, metrics, health, strategy, leadership: leadershipUpdate.leadership, lastUpdatedAt: snapshotInput.timestamp };
      const decisionCadence = actor.governance === "board" || actor.governance === "bureau" || actor.governance === "union" || actor.governance === "cooperative" ? 2 : 1;
      if (weekIndex - old.lastDecisionWeek < decisionCadence) return actor;
      const decision = executeDecision(snapshotInput, world, actor, organization, weekIndex, snapshotInput.timestamp);
      decisions.push(decision.decision);
      transactions.push(...decision.transactions);
      if (decision.notice) notices.push(decision.notice);
      totals.decisions += 1;
      if (decision.decision.status === "blocked") totals.blockedDecisions += 1;
      if (decision.investment > 0) {
        totals.investments += 1;
        totals.creditsCommitted += decision.investment;
        weeklyInvestments += 1;
        weeklyCredits += decision.investment;
      }
      totals.expansions += decision.expansion;
      totals.contractions += decision.contraction;
      weeklyExpansions += decision.expansion;
      weeklyContractions += decision.contraction;
      const influence = { ...actor.influenceByDistrict };
      if (actor.strategy === "market-capture" || actor.strategy === "territorial-network") {
        const targetDistrict = input.districts.slice().sort((a, b) => (influence[b.id] ?? 0) - (influence[a.id] ?? 0))[0];
        if (targetDistrict) influence[targetDistrict.id] = clamp((influence[targetDistrict.id] ?? 0) + 2);
      }
      return { ...actor, influenceByDistrict: influence, activeDecisionId: decision.decision.id, lastDecisionWeek: weekIndex };
    });

    const relationInput: OrganizationEcosystemInput = { ...snapshotInput, organizations: world.organizations, population: world.population, economy: world.economy, infrastructure: world.infrastructure, production: world.production };
    const relations = updateRelations(relationInput, state.relations);
    const agreements = updateAgreements(relationInput, relations, state.agreements);
    const newAgreementIds = new Set(state.agreements.map((agreement) => agreement.id));
    totals.agreementsCreated += agreements.filter((agreement) => !newAgreementIds.has(agreement.id) && agreement.status !== "ended").length;
    totals.agreementsBreached = agreements.filter((agreement) => agreement.status === "breached").length;
    state = { ...state, relations, agreements };
    const weeklySnapshot: OrganizationWeeklySnapshot = {
      weekIndex,
      activeOrganizations: actors.filter((actor) => actor.health !== "dormant").length,
      distressedOrganizations: actors.filter((actor) => actor.health === "distressed").length,
      strategicInvestments: weeklyInvestments,
      creditsCommitted: weeklyCredits,
      leadershipChanges: weeklyLeadershipChanges,
      agreementsActive: agreements.filter((agreement) => agreement.status === "active" || agreement.status === "strained").length,
      agreementsBreached: agreements.filter((agreement) => agreement.status === "breached").length
    };
    history.push(weeklySnapshot);
    void weeklyExpansions;
    void weeklyContractions;
  }

  const finalInput: OrganizationEcosystemInput = { ...input, organizations: world.organizations, population: world.population, economy: world.economy, infrastructure: world.infrastructure, production: world.production };
  const relations = updateRelations(finalInput, state.relations);
  const agreements = updateAgreements(finalInput, relations, state.agreements);
  actors = world.organizations.map((organization) => {
    const old = actors.find((actor) => actor.organizationId === organization.id) ?? createActor(finalInput, organization, targetDay, targetWeek);
    const metrics = metricsFor(finalInput, organization, old.metrics.baselineTreasury || organization.budget);
    const health = healthFor(metrics);
    return { ...old, metrics, health, strategy: strategyFor(organization, metrics, health), lastUpdatedAt: input.timestamp };
  });

  const nextState: OrganizationEcosystemState = {
    version: 1,
    actors,
    relations,
    agreements,
    decisions: decisions.slice(-MAX_DECISIONS),
    history: history.slice(-MAX_HISTORY),
    totals,
    dayIndex: targetDay,
    weekIndex: targetWeek,
    simulatedWeeks: state.simulatedWeeks + Math.max(0, targetWeek - state.weekIndex),
    lastUpdatedAt: input.timestamp
  };
  return {
    state: nextState,
    organizations: world.organizations,
    population: world.population,
    economy: world.economy,
    infrastructure: world.infrastructure,
    production: world.production,
    notices: notices.slice(-18),
    transactions
  };
}
