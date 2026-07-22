import { useState } from "react";
import { getFoodProduct } from "../../data/products/foodCatalog";
import type { HouseholdStatus } from "../../simulation/population/types";
import type { GameSession } from "../../world/state/types";

type PopulationTab = "districts" | "households" | "housing" | "labor" | "infrastructure" | "supply" | "organizations" | "flow";

function statusRank(status: HouseholdStatus): number {
  if (status === "displaced") return 4;
  if (status === "arrears") return 3;
  if (status === "strained") return 2;
  return 1;
}

function districtName(session: GameSession, districtId: string): string {
  return session.world.districts.find((district) => district.id === districtId)?.name ?? "UNKNOWN DISTRICT";
}

function locationName(session: GameSession, locationId: string | null): string {
  if (!locationId) return "NO FIXED ADDRESS";
  return session.world.locations.find((location) => location.id === locationId)?.name ?? "UNKNOWN HOUSING";
}


function residentName(session: GameSession, residentId: string): string {
  return session.population.residents.find((resident) => resident.id === residentId)?.name ?? "UNKNOWN RESIDENT";
}

function kernelEntityName(session: GameSession, entityId: string): string {
  if (entityId === session.player.id) return session.player.name;
  const organization = session.world.organizations.find((item) => item.id === entityId);
  if (organization) return organization.name;
  const business = session.economy.businesses.find((item) => item.id === entityId);
  if (business) return locationName(session, business.locationId);
  const facility = session.production.facilities.find((item) => item.id === entityId);
  if (facility) return facility.name;
  const household = session.population.households.find((item) => item.id === entityId);
  if (household) return `${household.kind.toUpperCase()} HOUSEHOLD`;
  const resident = session.population.residents.find((item) => item.id === entityId);
  if (resident) return resident.name;
  const housing = session.population.housing.find((item) => item.id === entityId);
  if (housing) return locationName(session, housing.locationId);
  return entityId.startsWith("kernel-system") ? "CITY CLEARING" : entityId;
}

function transactionLabel(reason: string): string {
  return reason.replace(/-/g, " ").toUpperCase();
}

function skillLabel(skill: string): string {
  const labels: Record<string, string> = {
    logistics: "LOGISTICS",
    technical: "TECHNICAL",
    medical: "MEDICAL",
    service: "SERVICE",
    administration: "ADMIN",
    security: "SECURITY"
  };
  return labels[skill] ?? skill.toUpperCase();
}


function productionResourceLabel(resource: string): string {
  return resource.replace(/-units$|-feedstock$/g, "").replace(/-/g, " ").toUpperCase();
}

function facilityInventoryLabel(session: GameSession, facilityId: string): string {
  const facility = session.production.facilities.find((item) => item.id === facilityId);
  if (!facility?.inventory.length) return "EMPTY";
  return facility.inventory
    .slice()
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3)
    .map((item) => `${productionResourceLabel(item.resource)} ${Math.round(item.amount)}`)
    .join(" · ");
}
function pantryLabel(session: GameSession, householdId: string): string {
  const household = session.population.households.find((item) => item.id === householdId);
  if (!household?.pantry.length) return "EMPTY";
  return household.pantry
    .slice(0, 3)
    .map((item) => `${getFoodProduct(item.productId).code} ×${item.units}`)
    .join(" · ");
}

export function PopulationWorkspace({ session }: { session: GameSession }) {
  const [tab, setTab] = useState<PopulationTab>("districts");
  const state = session.population;
  const labor = state.laborMarket;
  const atRisk = state.households
    .filter((household) => household.status !== "stable")
    .slice()
    .sort((left, right) => statusRank(right.status) - statusRank(left.status) || right.debt - left.debt)
    .slice(0, 24);
  const workingAgeResidents = state.residents.filter((resident) => resident.lifeStage === "working-age");
  const employedResidentIds = new Set(state.employments.filter((employment) => employment.status !== "unemployed").map((employment) => employment.residentId));
  const unemployed = workingAgeResidents.filter((resident) => !employedResidentIds.has(resident.id)).length;
  const employed = workingAgeResidents.length - unemployed;
  const absent = state.employments.filter((employment) => employment.status === "absent").length;
  const openVacancies = labor.vacancies.filter((vacancy) => vacancy.status === "open");
  const recentAccepted = labor.applications.filter((application) => application.status === "accepted").slice(-12).reverse();
  const recentSnapshot = labor.history[labor.history.length - 1];
  const activeLinks = state.residents.filter((resident) => resident.activePersonId).length;
  const availableBeds = state.housing.reduce((sum, housing) => sum + Math.max(0, housing.capacity - housing.occupied), 0);
  const kernel = session.kernel;
  const activeContracts = kernel.contracts.filter((contract) => contract.status === "active" || contract.status === "breached").length;
  const recentKernelTransactions = kernel.transactions.slice(-8).reverse();
  const organizationState = session.organizationEcosystem;
  const recentOrganizationDecisions = organizationState.decisions.slice(-14).reverse();
  const strainedOrganizations = organizationState.actors.filter((actor) => actor.health === "strained" || actor.health === "distressed").length;

  return (
    <div className="population-workspace">
      <section className="population-summary">
        <div><span>RESIDENTS</span><strong>{state.residents.length}</strong><small>{activeLinks} active NPC</small></div>
        <div><span>HOUSEHOLDS</span><strong>{state.households.length}</strong><small>{atRisk.length} under pressure</small></div>
        <div><span>EMPLOYMENT</span><strong>{employed}</strong><small>{unemployed} unemployed · {absent} absent</small></div>
        <div><span>HOUSING</span><strong>{availableBeds} BEDS</strong><small>{state.totals.moves} total moves</small></div>
      </section>

      <nav className="population-tabs" aria-label="Population systems">
        <button type="button" className={tab === "districts" ? "is-active" : ""} onClick={() => setTab("districts")}>РАЙОНЫ</button>
        <button type="button" className={tab === "households" ? "is-active" : ""} onClick={() => setTab("households")}>СЕМЬИ</button>
        <button type="button" className={tab === "housing" ? "is-active" : ""} onClick={() => setTab("housing")}>ЖИЛЬЁ</button>
        <button type="button" className={tab === "labor" ? "is-active" : ""} onClick={() => setTab("labor")}>ТРУД</button>
        <button type="button" className={tab === "infrastructure" ? "is-active" : ""} onClick={() => setTab("infrastructure")}>СЕТИ</button>
        <button type="button" className={tab === "supply" ? "is-active" : ""} onClick={() => setTab("supply")}>СНАБЖЕНИЕ</button>
        <button type="button" className={tab === "organizations" ? "is-active" : ""} onClick={() => setTab("organizations")}>ОРГАНИЗАЦИИ</button>
        <button type="button" className={tab === "flow" ? "is-active" : ""} onClick={() => setTab("flow")}>ПОТОКИ</button>
      </nav>

      {tab === "districts" ? (
        <section className="population-districts">
          {state.cohorts.map((cohort) => {
            const employmentBase = Math.max(1, cohort.employed + cohort.unemployed);
            const employmentRate = Math.round(cohort.employed / employmentBase * 100);
            const foodSecurity = Math.round(cohort.foodSecureHouseholds / Math.max(1, cohort.households) * 100);
            return (
              <article className="population-district" key={cohort.districtId}>
                <header>
                  <div><span>DISTRICT COHORT</span><strong>{districtName(session, cohort.districtId)}</strong><small>{cohort.sampleSize} stable records represent {cohort.representedPopulation.toLocaleString("ru-RU")} residents</small></div>
                  <em>{employmentRate}% EMPLOYED</em>
                </header>
                <div className="population-district__metrics">
                  <div><span>UNEMPLOYED</span><strong>{cohort.unemployed.toLocaleString("ru-RU")}</strong></div>
                  <div><span>ILL / DISABLED</span><strong>{cohort.ill.toLocaleString("ru-RU")}</strong></div>
                  <div><span>UNHOUSED</span><strong>{cohort.unhoused.toLocaleString("ru-RU")}</strong></div>
                  <div><span>FOOD SECURE</span><strong>{foodSecurity}%</strong></div>
                </div>
                <footer><span>{cohort.households} households</span><span>{cohort.householdsInArrears} in arrears</span><span>AVG RENT ₵ {cohort.averageRent}</span></footer>
              </article>
            );
          })}
        </section>
      ) : null}

      {tab === "households" ? (
        <section className="population-households">
          <header><div><span>HOUSEHOLD ECONOMY</span><strong>{atRisk.length ? "UNSTABLE HOMES" : "NO CRITICAL HOUSEHOLDS"}</strong></div><small>Money, concrete food, rent and work are settled every day.</small></header>
          <div className="population-household-list">
            {atRisk.map((household) => (
              <article className={`population-household population-household--${household.status}`} key={household.id}>
                <div><span>{household.kind.toUpperCase()} · {districtName(session, household.districtId)}</span><strong>{locationName(session, household.homeLocationId)}</strong><small>{household.memberIds.length} residents · {pantryLabel(session, household.id)}</small></div>
                <div><span>{household.spendingMode.toUpperCase()}</span><strong>₵ {household.dailyIncome} / DAY</strong><small>spent ₵ {household.dailyExpenses}</small></div>
                <div><span>BALANCE</span><strong>₵ {household.balance}</strong><small>debt ₵ {household.debt} · moves {household.moveCount}</small></div>
                <em>{household.status.toUpperCase()}</em>
              </article>
            ))}
            {!atRisk.length ? <div className="empty-terminal">Домохозяйства пока удерживают жильё, питание и платежи.</div> : null}
          </div>
        </section>
      ) : null}

      {tab === "housing" ? (
        <section className="population-housing-list">
          {state.housing.map((housing) => {
            const location = session.world.locations.find((item) => item.id === housing.locationId);
            const occupancy = Math.round(housing.occupied / Math.max(1, housing.capacity) * 100);
            return (
              <article className={`population-housing population-housing--${housing.status}`} key={housing.id}>
                <header><div><span>{districtName(session, housing.districtId)}</span><strong>{location?.name ?? "HOUSING"}</strong></div><em>{housing.status.toUpperCase()}</em></header>
                <div><span>OCCUPANCY</span><strong>{housing.occupied}/{housing.capacity}</strong><small>{occupancy}% · {Math.max(0, housing.capacity - housing.occupied)} free</small></div>
                <div><span>RENT / BED</span><strong>₵ {housing.baseRentPerBedWeek}</strong><small>collected today ₵ {housing.rentCollectedToday}</small></div>
                <div><span>CONDITION</span><strong>{housing.condition}%</strong><small>maintenance ₵ {housing.maintenanceFund}</small></div>
                <div><span>ARREARS</span><strong>{housing.arrearsHouseholds}</strong><small>households</small></div>
              </article>
            );
          })}
        </section>
      ) : null}


      {tab === "labor" ? (
        <section className="population-labor">
          <div className="population-labor__summary">
            <div><span>OPEN VACANCIES</span><strong>{openVacancies.length}</strong><small>{recentSnapshot?.averageDaysOpen ?? 0} days average</small></div>
            <div><span>AVERAGE OFFER</span><strong>₵ {recentSnapshot?.averageOffer ?? 0}</strong><small>per working day</small></div>
            <div><span>HIRES / EXITS</span><strong>{labor.totalHires} / {labor.totalQuits + labor.totalLayoffs}</strong><small>{labor.totalQuits} quits · {labor.totalLayoffs} layoffs</small></div>
            <div><span>APPLICATIONS</span><strong>{labor.applications.length}</strong><small>{labor.totalRejectedApplications} rejected</small></div>
          </div>
          <div className="population-labor__columns">
            <div className="population-labor__list">
              <header><span>LIVE VACANCIES</span><strong>DEMAND FROM REAL BUSINESSES</strong></header>
              {openVacancies
                .slice()
                .sort((left, right) => right.wagePerDay - left.wagePerDay || left.openedDay - right.openedDay)
                .slice(0, 14)
                .map((vacancy) => (
                  <article key={vacancy.id}>
                    <div><span>{skillLabel(vacancy.requiredSkill)} · {vacancy.shift.toUpperCase()}</span><strong>{vacancy.title}</strong><small>{locationName(session, vacancy.locationId)}</small></div>
                    <div><span>REQUIREMENT</span><strong>{vacancy.minimumSkill}</strong><small>{vacancy.applicationIds.length} applications</small></div>
                    <div><span>OFFER</span><strong>₵ {vacancy.wagePerDay}</strong><small>open {Math.max(0, state.dayIndex - vacancy.openedDay)} days</small></div>
                  </article>
                ))}
              {!openVacancies.length ? <div className="empty-terminal">Открытых рабочих мест сейчас нет.</div> : null}
            </div>
            <div className="population-labor__list">
              <header><span>RECENT HIRES</span><strong>AUTONOMOUS MOVEMENT</strong></header>
              {recentAccepted.map((application) => {
                const vacancy = labor.vacancies.find((item) => item.id === application.vacancyId);
                return (
                  <article key={application.id}>
                    <div><span>CANDIDATE</span><strong>{residentName(session, application.residentId)}</strong><small>{vacancy ? locationName(session, vacancy.locationId) : "WORK NODE"}</small></div>
                    <div><span>MATCH</span><strong>{application.score}</strong><small>skill {application.skillScore >= 0 ? "+" : ""}{application.skillScore}</small></div>
                    <div><span>WAGE CHANGE</span><strong>{application.wageGain >= 0 ? "+" : ""}₵ {application.wageGain}</strong><small>commute −{application.commutePenalty}</small></div>
                  </article>
                );
              })}
              {!recentAccepted.length ? <div className="empty-terminal">Рынок ещё не закрыл ни одной вакансии.</div> : null}
            </div>
          </div>
          <div className="population-labor__pressure">
            {session.world.districts.map((district) => (
              <div key={district.id}><span>{district.name}</span><strong>{labor.wagePressureByDistrict[district.id] ?? 100}%</strong><small>wage pressure</small></div>
            ))}
          </div>
        </section>
      ) : null}


      {tab === "infrastructure" ? (
        <section className="infrastructure-workspace">
          <div className="infrastructure-networks">
            {session.infrastructure.networks.map((network) => {
              const provider = session.world.organizations.find((item) => item.id === network.providerEntityId)?.name ?? session.world.city.name;
              const openMaintenance = session.infrastructure.maintenance.filter((item) => item.networkId === network.id && item.status !== "completed").length;
              return (
                <article className={`infrastructure-network infrastructure-network--${network.status}`} key={network.id}>
                  <header><div><span>{network.kind.toUpperCase()} NETWORK</span><strong>{provider}</strong></div><em>{network.status.toUpperCase()}</em></header>
                  <div><span>SERVICE</span><strong>{network.averageServiceLevel}%</strong><small>{Math.round(network.totalDelivered)}/{Math.round(network.totalDemand)} units</small></div>
                  <div><span>RESERVE</span><strong>₵ {Math.round(network.reserveFund).toLocaleString("ru-RU")}</strong><small>{openMaintenance} maintenance orders</small></div>
                  <div><span>UNMET</span><strong>{Math.round(network.unmetDemand)}</strong><small>{network.outageHours} outage hours</small></div>
                </article>
              );
            })}
          </div>
          <div className="infrastructure-districts">
            {session.world.districts.map((district) => (
              <article key={district.id}>
                <header><span>DISTRICT SERVICE</span><strong>{district.name}</strong></header>
                <div className="infrastructure-districts__grid">
                  {(["power", "water", "data", "transport", "waste"] as const).map((kind) => {
                    const services = session.infrastructure.services.filter((item) => item.districtId === district.id && item.kind === kind);
                    const level = services.length ? Math.round(services.reduce((sum, item) => sum + item.serviceLevel, 0) / services.length) : 100;
                    return <div key={kind}><span>{kind.toUpperCase()}</span><strong>{level}%</strong><small>{level < 45 ? "RESTRICTED" : level < 70 ? "STRAINED" : "STABLE"}</small></div>;
                  })}
                </div>
              </article>
            ))}
          </div>
          <div className="infrastructure-bottom">
            <section>
              <header><span>MAINTENANCE</span><strong>{session.infrastructure.maintenance.filter((item) => item.status !== "completed").length} ACTIVE</strong></header>
              {session.infrastructure.maintenance.filter((item) => item.status !== "completed").slice(-8).reverse().map((order) => (
                <article key={order.id}><div><span>{order.kind.toUpperCase()} · {order.targetKind.toUpperCase()}</span><strong>{order.status.toUpperCase()}</strong></div><small>₵ {order.creditsCost} · {order.partsCost} parts · {order.completedLaborHours}/{order.laborHours} labor</small></article>
              ))}
              {!session.infrastructure.maintenance.some((item) => item.status !== "completed") ? <div className="empty-terminal">Открытых работ нет.</div> : null}
            </section>
            <section>
              <header><span>ACTIVE INCIDENTS</span><strong>{session.infrastructure.incidents.filter((item) => item.status === "active").length}</strong></header>
              {session.infrastructure.incidents.filter((item) => item.status === "active").slice(-8).reverse().map((incident) => (
                <article key={incident.id}><div><span>{incident.kind.toUpperCase()}</span><strong>SEVERITY {incident.severity}</strong></div><small>{incident.cause.replace(/-/g, " ")} · service loss {Math.round(incident.serviceLoss)}%</small></article>
              ))}
              {!session.infrastructure.incidents.some((item) => item.status === "active") ? <div className="empty-terminal">Активных аварий нет.</div> : null}
            </section>
          </div>
        </section>
      ) : null}

      {tab === "supply" ? (
        <section className="production-workspace">
          <div className="production-summary">
            <div><span>FACILITIES</span><strong>{session.production.facilities.length}</strong><small>{session.production.facilities.filter((item) => item.status === "offline").length} offline</small></div>
            <div><span>ACTIVE SHIPMENTS</span><strong>{session.production.shipments.filter((item) => item.status === "in-transit").length}</strong><small>{session.production.totals.shipmentsDelivered} delivered</small></div>
            <div><span>CONTRACTS</span><strong>{session.production.contracts.length}</strong><small>{session.production.contracts.filter((item) => item.status === "breached").length} breached</small></div>
            <div><span>PRODUCED</span><strong>{Math.round(session.production.totals.producedUnits).toLocaleString("ru-RU")}</strong><small>{Math.round(session.production.totals.importedUnits).toLocaleString("ru-RU")} imported</small></div>
            <div><span>WHOLESALE</span><strong>₵ {Math.round(session.production.totals.legalWholesaleRevenue).toLocaleString("ru-RU")}</strong><small>legal chain</small></div>
            <div><span>BACKCHANNEL</span><strong>₵ {Math.round(session.production.totals.blackMarketRevenue).toLocaleString("ru-RU")}</strong><small>unregistered supply</small></div>
          </div>
          <div className="production-columns">
            <section className="production-list">
              <header><span>PRODUCTION NODES</span><strong>PHYSICAL INVENTORY</strong></header>
              {session.production.facilities.map((facility) => (
                <article className={`production-facility production-facility--${facility.status}`} key={facility.id}>
                  <div><span>{facility.kind.replace(/-/g, " ").toUpperCase()}</span><strong>{facility.name}</strong><small>{locationName(session, facility.locationId)}</small></div>
                  <div><span>STATUS</span><strong>{facility.status.toUpperCase()}</strong><small>condition {Math.round(facility.condition)}%</small></div>
                  <div><span>INPUT / OUTPUT</span><strong>{facilityInventoryLabel(session, facility.id)}</strong><small>staff {facility.staffing}% · infra {facility.infrastructureLevel}%</small></div>
                  <div><span>CASH</span><strong>₵ {Math.round(facility.cash).toLocaleString("ru-RU")}</strong><small>backlog {facility.productionBacklog}</small></div>
                </article>
              ))}
            </section>
            <section className="production-list">
              <header><span>SHIPMENTS</span><strong>WAREHOUSE → BUYER</strong></header>
              {session.production.shipments.slice(-16).reverse().map((shipment) => (
                <article className={`production-shipment production-shipment--${shipment.legality}`} key={shipment.id}>
                  <div><span>{productionResourceLabel(shipment.resource)}</span><strong>{shipment.units} UNITS</strong><small>{shipment.legality.toUpperCase()}</small></div>
                  <div><span>STATUS</span><strong>{shipment.status.toUpperCase()}</strong><small>condition {shipment.condition}%</small></div>
                  <div><span>ROUTE</span><strong>{kernelEntityName(session, shipment.sourceFacilityId)}</strong><small>→ {kernelEntityName(session, shipment.targetFacilityId ?? shipment.targetBusinessId ?? "UNKNOWN")}</small></div>
                  <div><span>VALUE</span><strong>₵ {Math.round(shipment.units * shipment.unitPrice).toLocaleString("ru-RU")}</strong><small>delay {shipment.delayHours}h</small></div>
                </article>
              ))}
              {!session.production.shipments.length ? <div className="empty-terminal">Поставки появятся после первого шестичасового цикла.</div> : null}
            </section>
          </div>
          <div className="production-contracts">
            {session.production.contracts
              .filter((item) => item.status !== "active" || item.breachCount > 0)
              .slice(0, 12)
              .map((contract) => (
                <article key={contract.id}>
                  <span>{productionResourceLabel(contract.resource)}</span>
                  <strong>{contract.status.toUpperCase()} · {contract.breachCount} BREACH</strong>
                  <small>{kernelEntityName(session, contract.sourceFacilityId)} → {kernelEntityName(session, contract.targetFacilityId ?? contract.targetBusinessId ?? "UNKNOWN")}</small>
                </article>
              ))}
            {!session.production.contracts.some((item) => item.status !== "active" || item.breachCount > 0) ? <div className="empty-terminal">Все договоры снабжения исполняются.</div> : null}
          </div>
        </section>
      ) : null}


      {tab === "organizations" ? (
        <section className="organization-workspace">
          <div className="organization-summary">
            <div><span>ORGANIZATIONS</span><strong>{organizationState.actors.length}</strong><small>{strainedOrganizations} strained or distressed</small></div>
            <div><span>AGREEMENTS</span><strong>{organizationState.agreements.filter((item) => item.status !== "ended").length}</strong><small>{organizationState.agreements.filter((item) => item.status === "breached").length} breached</small></div>
            <div><span>DECISIONS</span><strong>{organizationState.totals.decisions}</strong><small>{organizationState.totals.blockedDecisions} blocked</small></div>
            <div><span>CAPITAL COMMITTED</span><strong>₵ {Math.round(organizationState.totals.creditsCommitted).toLocaleString("ru-RU")}</strong><small>{organizationState.totals.investments} investments</small></div>
            <div><span>EXPANSION / CUTS</span><strong>{organizationState.totals.expansions} / {organizationState.totals.contractions}</strong><small>capacity decisions</small></div>
            <div><span>LEADERSHIP</span><strong>{organizationState.totals.leadershipChanges}</strong><small>autonomous changes</small></div>
          </div>
          <div className="organization-columns">
            <section className="organization-list">
              <header><span>ACTIVE INSTITUTIONS</span><strong>STRATEGY FROM REAL CONDITIONS</strong></header>
              {organizationState.actors.map((actor) => {
                const organization = session.world.organizations.find((item) => item.id === actor.organizationId);
                const leader = actor.leadership.leaderResidentId ? residentName(session, actor.leadership.leaderResidentId) : "NO SIMULATED LEADER";
                return (
                  <article className={`organization-card organization-card--${actor.health}`} key={actor.organizationId}>
                    <header><div><span>{actor.governance.toUpperCase()}</span><strong>{organization?.name ?? actor.organizationId}</strong><small>{leader} · continuity {actor.leadership.continuity}%</small></div><em>{actor.health.toUpperCase()}</em></header>
                    <div><span>STRATEGY</span><strong>{actor.strategy.replace(/-/g, " ").toUpperCase()}</strong><small>risk {actor.riskTolerance}% · legal preference {actor.legalPreference}%</small></div>
                    <div><span>TREASURY</span><strong>₵ {Math.round(actor.metrics.treasury).toLocaleString("ru-RU")}</strong><small>assets ₵ {Math.round(actor.metrics.assetValue).toLocaleString("ru-RU")}</small></div>
                    <div><span>OPERATIONS</span><strong>{actor.metrics.ownedBusinesses + actor.metrics.ownedFacilities + actor.metrics.ownedNetworks + actor.metrics.ownedHousing}</strong><small>{actor.metrics.activeWorkers}/{actor.metrics.simulatedWorkers} active staff</small></div>
                    <div><span>RELIABILITY</span><strong>{Math.round((actor.metrics.serviceReliability + actor.metrics.productionReliability) / 2)}%</strong><small>{actor.metrics.supplyBreaches} supply breaches · gap {actor.metrics.staffGap}</small></div>
                  </article>
                );
              })}
            </section>
            <section className="organization-list">
              <header><span>RECENT GOVERNANCE</span><strong>WEEKLY CAPITAL ALLOCATION</strong></header>
              {recentOrganizationDecisions.map((decision) => (
                <article className={`organization-decision organization-decision--${decision.status}`} key={decision.id}>
                  <div><span>{decision.strategy.replace(/-/g, " ").toUpperCase()}</span><strong>{decision.type.replace(/-/g, " ").toUpperCase()}</strong><small>{kernelEntityName(session, decision.organizationId)}</small></div>
                  <div><span>{decision.status.toUpperCase()}</span><strong>{decision.creditsCommitted ? `₵ ${decision.creditsCommitted.toLocaleString("ru-RU")}` : "NO CAPITAL"}</strong><small>{decision.description}</small></div>
                </article>
              ))}
              {!recentOrganizationDecisions.length ? <div className="empty-terminal">Стратегические решения появятся после первого недельного расчёта.</div> : null}
            </section>
          </div>
          <div className="organization-relations">
            {organizationState.relations
              .slice()
              .sort((left, right) => Math.max(right.rivalry, right.dependency) - Math.max(left.rivalry, left.dependency))
              .slice(0, 12)
              .map((relation) => (
                <article className={`organization-relation organization-relation--${relation.status}`} key={relation.id}>
                  <span>{relation.status.toUpperCase()}</span>
                  <strong>{kernelEntityName(session, relation.sourceOrganizationId)} ↔ {kernelEntityName(session, relation.targetOrganizationId)}</strong>
                  <small>trust {relation.trust} · rivalry {relation.rivalry} · dependency {relation.dependency}</small>
                </article>
              ))}
          </div>
        </section>
      ) : null}

      {tab === "flow" ? (
        <section className="population-flow-stack">
          <div className="population-flow">
            <div><span>WAGES PAID</span><strong>₵ {state.totals.wagesPaid.toLocaleString("ru-RU")}</strong><small>unpaid ₵ {state.totals.unpaidWages.toLocaleString("ru-RU")}</small></div>
            <div><span>RENT</span><strong>₵ {state.totals.rentPaid.toLocaleString("ru-RU")}</strong><small>maintenance ₵ {state.totals.maintenanceSpent.toLocaleString("ru-RU")}</small></div>
            <div><span>FOOD SALES</span><strong>₵ {state.totals.foodSales.toLocaleString("ru-RU")}</strong><small>concrete products removed from shops</small></div>
            <div><span>SERVICES</span><strong>₵ {(state.totals.medicalSales + state.totals.transportSales + state.totals.discretionarySales).toLocaleString("ru-RU")}</strong><small>medical, transit and leisure</small></div>
            <div><span>DEBT REPAID</span><strong>₵ {state.totals.debtRepaid.toLocaleString("ru-RU")}</strong><small>{state.simulatedDays} settled days</small></div>
            <div><span>MOVES</span><strong>{state.totals.moves}</strong><small>between physical housing nodes</small></div>
          </div>
          <section className={`population-kernel ${kernel.integrity.healthy ? "is-healthy" : "is-warning"}`}>
            <header>
              <div><span>SIMULATION KERNEL 2.0</span><strong>{kernel.integrity.healthy ? "LEDGER CONSISTENT" : "STRUCTURAL WARNING"}</strong><small>Ownership, contracts and resource transfers share one registry.</small></div>
              <em>DAY {kernel.clock.dayIndex} · WEEK {kernel.clock.weekIndex}</em>
            </header>
            <div className="population-kernel__summary">
              <div><span>ASSETS</span><strong>{kernel.assets.length}</strong><small>{kernel.ownership.length} ownership records</small></div>
              <div><span>CONTRACTS</span><strong>{activeContracts}</strong><small>{kernel.contracts.filter((item) => item.status === "breached").length} breached</small></div>
              <div><span>LEDGER</span><strong>{kernel.totals.transactions}</strong><small>₵ {Math.round(kernel.totals.creditsTransferred).toLocaleString("ru-RU")} moved</small></div>
              <div><span>PHYSICAL FLOW</span><strong>{Math.round(kernel.totals.physicalUnitsTransferred).toLocaleString("ru-RU")}</strong><small>tracked resource units</small></div>
              <div><span>RECONCILIATION</span><strong>{kernel.integrity.reconciliationTransactions}</strong><small>₵ {Math.round(kernel.integrity.reconciliationCreditVolume).toLocaleString("ru-RU")} current tick</small></div>
              <div><span>INTEGRITY</span><strong>{kernel.integrity.warnings.length}</strong><small>warnings</small></div>
            </div>
            <div className="population-kernel__ledger">
              <header><span>RECENT TRANSFERS</span><strong>ENTITY → ENTITY</strong></header>
              {recentKernelTransactions.map((transaction) => (
                <article key={transaction.id}>
                  <div><span>{transactionLabel(transaction.reason)}</span><strong>{kernelEntityName(session, transaction.debitEntityId)}</strong><small>→ {kernelEntityName(session, transaction.creditEntityId)}</small></div>
                  <div><span>{transaction.resource.toUpperCase()}</span><strong>{transaction.resource === "credits" ? "₵ " : ""}{transaction.amount.toLocaleString("ru-RU")}</strong><small>{transaction.description ?? "settled by kernel"}</small></div>
                </article>
              ))}
              {!recentKernelTransactions.length ? <div className="empty-terminal">Транзакции появятся после первого суточного расчёта.</div> : null}
            </div>
          </section>
        </section>
      ) : null}
    </div>
  );
}
