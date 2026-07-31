import type { PlayerState } from "../../gameplay/player/demoPlayer";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { OrganizationState } from "../../world/state/types";
import type { PopulationState } from "../population/types";
import type { ProductionState } from "../production/types";
import type { OrganizationEcosystemState } from "../organizations/types";
import type { GovernmentCrimeState } from "../government/types";
import type { HealthCyberwareState } from "../health/types";
import type { UrbanFabricState } from "../urban/types";
import type { WorldCoreState } from "../worldCore/types";
import type { SimulationKernelState } from "./types";

export interface CanonicalCreditsProjectionInput {
  timestamp: number;
  player: PlayerState;
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  production: ProductionState;
  organizationEcosystem: OrganizationEcosystemState;
  government: GovernmentCrimeState;
  health: HealthCyberwareState;
  urban: UrbanFabricState;
  worldCore: WorldCoreState;
}

export interface CanonicalCreditsProjectionResult extends CanonicalCreditsProjectionInput {}

function kernelCredits(kernel: SimulationKernelState): Map<string, number> {
  const result = new Map<string, number>();
  for (const account of kernel.accounts) {
    const credits = account.balances.find((balance) => balance.resource === "credits");
    if (credits) result.set(account.entityId, credits.amount);
  }
  return result;
}

export function projectCanonicalCreditsFromKernel(
  kernel: SimulationKernelState,
  input: CanonicalCreditsProjectionInput
): CanonicalCreditsProjectionResult {
  const credits = kernelCredits(kernel);
  const read = (entityId: string, fallback: number): number => credits.get(entityId) ?? fallback;

  const organizations = input.organizations.map((organization) => ({
    ...organization,
    budget: read(organization.id, organization.budget)
  }));

  const population: PopulationState = {
    ...input.population,
    residents: input.population.residents.map((resident) => ({
      ...resident,
      savings: read(resident.id, resident.savings)
    })),
    households: input.population.households.map((household) => ({
      ...household,
      balance: read(household.id, household.balance)
    })),
    housing: input.population.housing.map((housing) => ({
      ...housing,
      maintenanceFund: read(housing.id, housing.maintenanceFund)
    }))
  };

  const economy: LocalEconomyState = {
    ...input.economy,
    businesses: input.economy.businesses.map((business) => ({
      ...business,
      cash: read(business.id, business.cash)
    }))
  };

  const production: ProductionState = {
    ...input.production,
    facilities: input.production.facilities.map((facility) => ({
      ...facility,
      cash: read(facility.id, facility.cash)
    }))
  };

  const organizationEcosystem: OrganizationEcosystemState = {
    ...input.organizationEcosystem,
    actors: input.organizationEcosystem.actors.map((actor) => ({
      ...actor,
      metrics: {
        ...actor.metrics,
        treasury: read(actor.organizationId, actor.metrics.treasury)
      }
    }))
  };

  const government: GovernmentCrimeState = {
    ...input.government,
    budget: {
      ...input.government.budget,
      treasury: read(input.government.budget.authorityOrganizationId, input.government.budget.treasury)
    }
  };

  const health: HealthCyberwareState = {
    ...input.health,
    facilities: input.health.facilities.map((facility) => ({
      ...facility,
      cash: read(facility.id, facility.cash)
    }))
  };

  const urban: UrbanFabricState = {
    ...input.urban,
    venueOperations: {
      ...input.urban.venueOperations,
      operations: input.urban.venueOperations.operations.map((operation) => ({
        ...operation,
        cash: read(operation.venueId, operation.cash)
      }))
    }
  };

  const worldCore: WorldCoreState = {
    ...input.worldCore,
    businesses: input.worldCore.businesses.map((business) => ({
      ...business,
      cash: read(business.id, business.cash)
    }))
  };

  return {
    ...input,
    player: { ...input.player, balance: read(input.player.id, input.player.balance) },
    organizations,
    population,
    economy,
    production,
    organizationEcosystem,
    government,
    health,
    urban,
    worldCore
  };
}
