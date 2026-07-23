import { useState } from "react";
import { getFoodProduct } from "../../data/products/foodCatalog";
import type { HouseholdStatus } from "../../simulation/population/types";
import type { GameSession } from "../../world/state/types";

type PopulationTab = "spatial" | "buildings" | "districts" | "lifecycle" | "households" | "housing" | "labor" | "infrastructure" | "supply" | "organizations" | "government" | "health" | "data" | "flow";

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
  const healthFacility = session.health.facilities.find((item) => item.id === entityId);
  if (healthFacility) return locationName(session, healthFacility.locationId);
  const household = session.population.households.find((item) => item.id === entityId);
  if (household) return `${household.kind.toUpperCase()} HOUSEHOLD`;
  const resident = session.population.residents.find((item) => item.id === entityId);
  if (resident) return resident.name;
  const housing = session.population.housing.find((item) => item.id === entityId);
  if (housing) return locationName(session, housing.locationId);
  if (entityId.startsWith("kernel-system")) {
    if (entityId.includes("corrupt-officials")) return "CORRUPT OFFICIALS";
    if (entityId.includes("illegal-consumption")) return "UNREGISTERED DEMAND";
    if (entityId.includes("city-courts")) return "CITY COURTS";
    return "CITY CLEARING";
  }
  return entityId;
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
  const [tab, setTab] = useState<PopulationTab>("spatial");
  const state = session.population;
  const labor = state.laborMarket;
  const lifecycle = state.lifecycle;
  const recentLifecycleEvents = lifecycle.events.slice(-18).reverse();
  const deceased = lifecycle.archive.filter((record) => record.status === "deceased").length;
  const emigrated = lifecycle.archive.filter((record) => record.status === "emigrated").length;
  const enrolled = lifecycle.institutions.reduce((sum, institution) => sum + institution.enrolled, 0);
  const waitlisted = lifecycle.institutions.reduce((sum, institution) => sum + institution.waitlist, 0);
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
  const government = session.government;
  const openCases = government.cases.filter((item) => item.status === "open" || item.status === "investigating" || item.status === "charged");
  const suspendedLicenses = government.licenses.filter((item) => item.status === "suspended" || item.status === "revoked");
  const activeOperations = government.crimeNetworks.flatMap((network) => network.operations).filter((item) => item.status !== "dormant");
  const health = session.health;
  const activeConditions = health.conditions.filter((item) => item.stage !== "resolved");
  const waitingCases = health.cases.filter((item) => item.status === "waiting" || item.status === "admitted");
  const activeMedicalDebts = health.debts.filter((item) => item.status === "current" || item.status === "delinquent");
  const activeInstallations = health.installations.filter((item) => item.status !== "removed");
  const failedInstallations = activeInstallations.filter((item) => item.status === "failed");
  const recentHealthSnapshot = health.history[health.history.length - 1];
  const recentCases = health.cases.slice().sort((left, right) => right.requestedDay - left.requestedDay).slice(0, 12);
  const highRiskConditions = activeConditions.slice().sort((left, right) => right.severity - left.severity).slice(0, 12);
  const dataState = session.data;
  const recentDataSnapshot = dataState.history[dataState.history.length - 1];
  const activeBreaches = dataState.breaches.filter((item) => item.status === "active");
  const activeForgeries = dataState.forgeries.filter((item) => item.status === "active");
  const compromisedIdentities = dataState.identities.filter((item) => item.status === "compromised" || item.status === "forged" || item.status === "suspended");
  const recentAccesses = dataState.accessEvents.slice(-14).reverse();
  const recentBreaches = dataState.breaches.slice(-10).reverse();
  const metropolitan = session.metropolitan;
  const focusSector = metropolitan.sectors.find((sector) => sector.id === metropolitan.streaming.focusSectorId);
  const activeSpatialDistrict = focusSector ? metropolitan.districts.find((district) => district.districtId === focusSector.districtId) : undefined;
  const busiestSectors = metropolitan.sectors.slice().sort((left, right) => right.crowdLoad - left.crowdLoad || right.trafficLoad - left.trafficLoad).slice(0, 12);
  const largestLocations = metropolitan.locations.slice().sort((left, right) => (right.bounds.widthM * right.bounds.heightM * right.floors) - (left.bounds.widthM * left.bounds.heightM * left.floors)).slice(0, 12);
  const urban = session.urban;
  const mass = urban.demography;
  const recentMass = mass.history[mass.history.length - 1];
  const largestBuildings = urban.buildings.slice().sort((left, right) => right.floorAreaM2 - left.floorAreaM2).slice(0, 14);
  const focusBuildings = focusSector ? urban.buildings.filter((building) => building.sectorId === focusSector.id).slice(0, 16) : [];
  const recentAddresses = urban.householdAddresses.slice(0, 16);

  return (
    <div className="population-workspace">
      <section className="population-summary">
        <div><span>CITY POPULATION</span><strong>{mass.totals.population.toLocaleString("ru-RU")}</strong><small>{state.residents.length} detailed · {activeLinks} active NPC</small></div>
        <div><span>HOUSEHOLDS</span><strong>{state.households.length}</strong><small>{atRisk.length} under pressure</small></div>
        <div><span>EMPLOYMENT</span><strong>{employed}</strong><small>{unemployed} unemployed · {absent} absent</small></div>
        <div><span>HOUSING</span><strong>{availableBeds} BEDS</strong><small>{state.totals.moves} total moves</small></div>
      </section>

      <nav className="population-tabs" aria-label="Population systems">
        <button type="button" className={tab === "spatial" ? "is-active" : ""} onClick={() => setTab("spatial")}>МАСШТАБ</button>
        <button type="button" className={tab === "buildings" ? "is-active" : ""} onClick={() => setTab("buildings")}>ЗДАНИЯ</button>
        <button type="button" className={tab === "districts" ? "is-active" : ""} onClick={() => setTab("districts")}>РАЙОНЫ</button>
        <button type="button" className={tab === "lifecycle" ? "is-active" : ""} onClick={() => setTab("lifecycle")}>ЖИЗНЬ</button>
        <button type="button" className={tab === "households" ? "is-active" : ""} onClick={() => setTab("households")}>СЕМЬИ</button>
        <button type="button" className={tab === "housing" ? "is-active" : ""} onClick={() => setTab("housing")}>ЖИЛЬЁ</button>
        <button type="button" className={tab === "labor" ? "is-active" : ""} onClick={() => setTab("labor")}>ТРУД</button>
        <button type="button" className={tab === "infrastructure" ? "is-active" : ""} onClick={() => setTab("infrastructure")}>СЕТИ</button>
        <button type="button" className={tab === "supply" ? "is-active" : ""} onClick={() => setTab("supply")}>СНАБЖЕНИЕ</button>
        <button type="button" className={tab === "organizations" ? "is-active" : ""} onClick={() => setTab("organizations")}>ОРГАНИЗАЦИИ</button>
        <button type="button" className={tab === "government" ? "is-active" : ""} onClick={() => setTab("government")}>ВЛАСТЬ</button>
        <button type="button" className={tab === "health" ? "is-active" : ""} onClick={() => setTab("health")}>МЕДИЦИНА</button>
        <button type="button" className={tab === "data" ? "is-active" : ""} onClick={() => setTab("data")}>ДАННЫЕ</button>
        <button type="button" className={tab === "flow" ? "is-active" : ""} onClick={() => setTab("flow")}>ПОТОКИ</button>
      </nav>

      {tab === "spatial" ? (
        <section className="data-workspace metropolitan-workspace">
          <div className="population-labor__summary">
            <div><span>CITY FOOTPRINT</span><strong>{metropolitan.config.widthM / 1000} × {metropolitan.config.heightM / 1000} KM</strong><small>{Math.round(metropolitan.config.widthM * metropolitan.config.heightM / 1_000_000).toLocaleString("ru-RU")} km² physical extent</small></div>
            <div><span>REPRESENTED POPULATION</span><strong>{metropolitan.totals.representedPopulation.toLocaleString("ru-RU")}</strong><small>{state.residents.length} detailed resident records</small></div>
            <div><span>SECTORS</span><strong>{metropolitan.totals.sectors.toLocaleString("ru-RU")}</strong><small>{metropolitan.streaming.activeSectorIds.length} active · {metropolitan.streaming.warmSectorIds.length} warm</small></div>
            <div><span>BUILDINGS</span><strong>{metropolitan.totals.estimatedBuildings.toLocaleString("ru-RU")}</strong><small>{Math.round(metropolitan.totals.estimatedFloorAreaM2 / 1_000_000).toLocaleString("ru-RU")}M m² estimated floor area</small></div>
            <div><span>MEMORY</span><strong>{metropolitan.streaming.estimatedMemoryMb.toFixed(1)} MB</strong><small>budget {metropolitan.config.memoryBudgetMb} MB · peak {metropolitan.streaming.peakEstimatedMemoryMb.toFixed(1)} MB</small></div>
            <div><span>DETAIL CACHE</span><strong>{metropolitan.streaming.materializedResidentCount} NPC</strong><small>{metropolitan.streaming.materializedInteriorCount} interiors · {metropolitan.streaming.sectorsEvicted} sectors evicted</small></div>
          </div>
          <div className="population-labor__columns">
            <section className="population-labor__list">
              <header><span>PHYSICAL DISTRICTS</span><strong>REAL METRIC BOUNDS</strong></header>
              {metropolitan.districts.map((district) => (
                <article key={district.districtId}>
                  <div><span>{district.dominantLandUse.toUpperCase()}</span><strong>{districtName(session, district.districtId)}</strong><small>{district.sectorIds.length} km² sectors · center {Math.round(district.center.xM / 1000)},{Math.round(district.center.yM / 1000)} km</small></div>
                  <div><span>POPULATION</span><strong>{district.representedPopulation.toLocaleString("ru-RU")}</strong><small>{district.densityPerKm2.toLocaleString("ru-RU")} / km²</small></div>
                  <div><span>VERTICALITY</span><strong>{district.verticality}%</strong><small>transit {district.transitScore}%</small></div>
                </article>
              ))}
            </section>
            <section className="population-labor__list">
              <header><span>STREAMING WINDOW</span><strong>{focusSector?.code ?? "NO FOCUS"}</strong></header>
              <article>
                <div><span>FOCUS</span><strong>{focusSector ? districtName(session, focusSector.districtId) : "UNKNOWN"}</strong><small>{focusSector?.landUse.toUpperCase() ?? "COLD"} · {focusSector?.representedPopulation.toLocaleString("ru-RU") ?? 0} represented residents</small></div>
                <div><span>DETAIL</span><strong>{focusSector?.detailLevel.toUpperCase() ?? "COLD"}</strong><small>{activeSpatialDistrict?.densityPerKm2.toLocaleString("ru-RU") ?? 0} / km² district density</small></div>
                <div><span>LOAD</span><strong>{focusSector?.crowdLoad ?? 0}% / {focusSector?.trafficLoad ?? 0}%</strong><small>crowd / traffic</small></div>
              </article>
              <article>
                <div><span>CACHE POLICY</span><strong>ACTIVE → WARM → COLD</strong><small>{metropolitan.config.activeRadius} km active radius · {metropolitan.config.warmRadius} km warm radius</small></div>
                <div><span>LIMITS</span><strong>{metropolitan.config.maxMaterializedResidents} NPC</strong><small>{metropolitan.config.maxMaterializedInteriors} detailed interiors</small></div>
                <div><span>COMPACTION</span><strong>{metropolitan.streaming.compactions}</strong><small>{metropolitan.streaming.residentsDematerialized} NPC · {metropolitan.streaming.interiorsDematerialized} interiors released</small></div>
              </article>
            </section>
          </div>
          <div className="population-labor__columns">
            <section className="population-labor__list">
              <header><span>CITY MOVEMENT LOAD</span><strong>AGGREGATED SECTORS</strong></header>
              {busiestSectors.map((sector) => (
                <article key={sector.id}>
                  <div><span>{sector.code}</span><strong>{districtName(session, sector.districtId)}</strong><small>{sector.landUse.toUpperCase()} · {sector.representedPopulation.toLocaleString("ru-RU")} residents</small></div>
                  <div><span>CROWD</span><strong>{sector.crowdLoad}%</strong><small>{sector.detailLevel.toUpperCase()}</small></div>
                  <div><span>TRAFFIC</span><strong>{sector.trafficLoad}%</strong><small>{Math.round(sector.roadLengthM / 1000)} km local roads</small></div>
                </article>
              ))}
            </section>
            <section className="population-labor__list">
              <header><span>PLACED LANDMARKS</span><strong>PERSISTENT ADDRESSES</strong></header>
              {largestLocations.map((placement) => (
                <article key={placement.locationId}>
                  <div><span>{placement.addressCode}</span><strong>{locationName(session, placement.locationId)}</strong><small>{placement.footprintKind.toUpperCase()} · sector {metropolitan.sectors.find((sector) => sector.id === placement.sectorId)?.code ?? "UNKNOWN"}</small></div>
                  <div><span>STRUCTURE</span><strong>{placement.floors} F</strong><small>{placement.basementLevels} basement levels</small></div>
                  <div><span>CAPACITY</span><strong>{placement.verticalPopulationCapacity.toLocaleString("ru-RU")}</strong><small>{placement.entranceCount} public entrances</small></div>
                </article>
              ))}
            </section>
          </div>
        </section>
      ) : null}

      {tab === "buildings" ? (
        <section className="data-workspace urban-buildings-workspace">
          <div className="population-labor__summary">
            <div><span>INDEXED BUILDINGS</span><strong>{urban.totals.indexedBuildings.toLocaleString("ru-RU")}</strong><small>{urban.totals.materializedBuildings} currently materialized</small></div>
            <div><span>RESIDENTIAL UNITS</span><strong>{urban.totals.indexedResidentialUnits.toLocaleString("ru-RU")}</strong><small>capacity {urban.totals.indexedResidentCapacity.toLocaleString("ru-RU")}</small></div>
            <div><span>DETAILED ADDRESSES</span><strong>{urban.totals.detailedHouseholdAddresses}</strong><small>{urban.totals.materializedUnits} concrete units cached</small></div>
            <div><span>INTERIORS</span><strong>{urban.totals.materializedInteriors}</strong><small>limit {urban.memory.interiorCacheLimit} · deterministic seeds</small></div>
            <div><span>URBAN CACHE</span><strong>{urban.memory.estimatedMemoryMb.toFixed(1)} MB</strong><small>peak {urban.memory.peakEstimatedMemoryMb.toFixed(1)} MB</small></div>
            <div><span>MASS DEMOGRAPHY</span><strong>{mass.totals.population.toLocaleString("ru-RU")}</strong><small>{state.residents.length} detailed sample links</small></div>
          </div>
          <div className="population-labor__columns">
            <section className="population-labor__list">
              <header><span>MASS POPULATION</span><strong>CITY-WIDE MONTHLY MODEL</strong></header>
              <article>
                <div><span>POPULATION</span><strong>{mass.totals.population.toLocaleString("ru-RU")}</strong><small>{mass.totals.households.toLocaleString("ru-RU")} households</small></div>
                <div><span>BIRTHS / DEATHS</span><strong>{mass.totals.births.toLocaleString("ru-RU")} / {mass.totals.deaths.toLocaleString("ru-RU")}</strong><small>since world start</small></div>
                <div><span>MIGRATION</span><strong>+{mass.totals.immigrants.toLocaleString("ru-RU")} / −{mass.totals.emigrants.toLocaleString("ru-RU")}</strong><small>{mass.totals.internalMoves.toLocaleString("ru-RU")} internal moves</small></div>
              </article>
              <article>
                <div><span>LATEST MONTH</span><strong>{recentMass ? `+${recentMass.births} / −${recentMass.deaths}` : "NO DATA"}</strong><small>births / deaths</small></div>
                <div><span>WORK</span><strong>{recentMass?.employed.toLocaleString("ru-RU") ?? 0}</strong><small>{recentMass?.unemployed.toLocaleString("ru-RU") ?? 0} unemployed</small></div>
                <div><span>EDUCATION</span><strong>{recentMass?.students.toLocaleString("ru-RU") ?? 0}</strong><small>{mass.totals.graduates.toLocaleString("ru-RU")} graduates</small></div>
              </article>
            </section>
            <section className="population-labor__list">
              <header><span>MEMORY POLICY</span><strong>SEED + PERSISTENT DELTAS</strong></header>
              <article>
                <div><span>BUILDINGS</span><strong>{urban.memory.cachedBuildings}/{urban.memory.buildingCacheLimit}</strong><small>{urban.memory.buildingsEvicted} evicted</small></div>
                <div><span>UNITS</span><strong>{urban.memory.cachedUnits}/{urban.memory.unitCacheLimit}</strong><small>{urban.memory.unitsEvicted} evicted</small></div>
                <div><span>INTERIORS</span><strong>{urban.memory.cachedInteriors}/{urban.memory.interiorCacheLimit}</strong><small>{urban.memory.interiorsEvicted} evicted</small></div>
              </article>
              <article>
                <div><span>RECONSTRUCTION</span><strong>DETERMINISTIC</strong><small>same building, floor, apartment and room layout after reload</small></div>
                <div><span>PERSISTENT</span><strong>{urban.interiorDeltas.length}</strong><small>damage, ownership, evidence and access deltas</small></div>
                <div><span>FOCUS SECTOR</span><strong>{focusBuildings.length}</strong><small>materialized building records</small></div>
              </article>
            </section>
          </div>
          <div className="population-labor__columns">
            <section className="population-labor__list">
              <header><span>MATERIALIZED BUILDINGS</span><strong>REAL COORDINATES</strong></header>
              {largestBuildings.map((building) => (
                <article key={building.id}>
                  <div><span>{building.addressCode}</span><strong>{building.anchorLocationId ? locationName(session, building.anchorLocationId) : building.use.toUpperCase()}</strong><small>{building.scale.toUpperCase()} · {building.floorAreaM2.toLocaleString("ru-RU")} m²</small></div>
                  <div><span>STRUCTURE</span><strong>{building.floors} F / {building.basementLevels} B</strong><small>{building.elevatorCount} elevators · {building.stairwellCount} stairs</small></div>
                  <div><span>UNITS</span><strong>{building.residentialUnits.toLocaleString("ru-RU")}</strong><small>{building.representedResidents.toLocaleString("ru-RU")} represented residents</small></div>
                </article>
              ))}
            </section>
            <section className="population-labor__list">
              <header><span>DETAILED HOUSEHOLDS</span><strong>CONCRETE APARTMENTS</strong></header>
              {recentAddresses.map((address) => {
                const unit = urban.units.find((item) => item.id === address.unitId);
                const household = state.households.find((item) => item.id === address.householdId);
                return (
                  <article key={address.householdId}>
                    <div><span>{address.addressCode}</span><strong>{household?.kind.toUpperCase() ?? "HOUSEHOLD"}</strong><small>{address.residentIds.map((residentId) => residentName(session, residentId)).slice(0, 3).join(" · ")}</small></div>
                    <div><span>FLOOR</span><strong>{unit?.floor ?? 0}</strong><small>{unit?.areaM2 ?? 0} m² · {unit?.roomCount ?? 0} rooms</small></div>
                    <div><span>RENT</span><strong>₵{unit?.monthlyRent ?? 0}</strong><small>condition {unit?.condition ?? 0}%</small></div>
                  </article>
                );
              })}
            </section>
          </div>
        </section>
      ) : null}

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

      {tab === "lifecycle" ? (
        <section className="population-lifecycle">
          <div className="population-labor__summary">
            <div><span>BIRTHS / DEATHS</span><strong>{lifecycle.totals.births} / {lifecycle.totals.deaths}</strong><small>{deceased} archived deaths</small></div>
            <div><span>MIGRATION</span><strong>+{lifecycle.totals.immigrants} / −{lifecycle.totals.emigrants}</strong><small>{emigrated} archived departures</small></div>
            <div><span>HOUSEHOLDS</span><strong>{lifecycle.totals.householdsFormed}</strong><small>{lifecycle.totals.partnerships} partnerships · {lifecycle.totals.separations} separations</small></div>
            <div><span>EDUCATION</span><strong>{enrolled}</strong><small>{waitlisted} waitlisted · {lifecycle.totals.graduates} graduates</small></div>
            <div><span>RETIREMENTS</span><strong>{lifecycle.totals.retirements}</strong><small>exact age progression</small></div>
          </div>
          <div className="population-lifecycle__grid">
            <section className="population-labor__list">
              <header><span>EDUCATION NETWORK</span><strong>PHYSICAL CAPACITY</strong></header>
              {lifecycle.institutions.map((institution) => (
                <article key={institution.id}>
                  <div><span>{institution.track.toUpperCase()}</span><strong>{locationName(session, institution.locationId)}</strong><small>{districtName(session, institution.districtId)}</small></div>
                  <div><span>LOAD</span><strong>{institution.enrolled}/{institution.capacity}</strong><small>{institution.waitlist} waitlisted</small></div>
                  <div><span>QUALITY</span><strong>{institution.quality}%</strong><small>{institution.status.toUpperCase()} · tuition ₵{institution.tuitionPerDay}</small></div>
                </article>
              ))}
            </section>
            <section className="population-labor__list">
              <header><span>DEMOGRAPHIC HISTORY</span><strong>AUTONOMOUS EVENTS</strong></header>
              {recentLifecycleEvents.map((item) => (
                <article key={item.id}>
                  <div><span>{item.type.replace(/-/g, " ").toUpperCase()}</span><strong>{item.summary}</strong><small>{districtName(session, item.districtId)} · day {item.dayIndex}</small></div>
                </article>
              ))}
              {!recentLifecycleEvents.length ? <div className="empty-terminal">Жизненный цикл ещё не создал изменений.</div> : null}
            </section>
          </div>
          <div className="population-lifecycle__districts">
            {session.world.districts.map((district) => (
              <div key={district.id}><span>{district.name}</span><strong>{Math.round(lifecycle.representedPopulationByDistrict[district.id] ?? district.population).toLocaleString("ru-RU")}</strong><small>represented residents</small></div>
            ))}
          </div>
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

      {tab === "government" ? (
        <section className="government-workspace">
          <div className="government-summary">
            <div><span>CIVIC TREASURY</span><strong>₵ {Math.round(government.budget.treasury).toLocaleString("ru-RU")}</strong><small>reserve target ₵ {government.budget.reserveTarget.toLocaleString("ru-RU")}</small></div>
            <div><span>TAXES</span><strong>₵ {government.totals.taxesCollected.toLocaleString("ru-RU")}</strong><small>licenses ₵ {government.totals.licenseFeesCollected.toLocaleString("ru-RU")}</small></div>
            <div><span>PUBLIC SPENDING</span><strong>₵ {(government.totals.socialTransfers + government.totals.publicGrants).toLocaleString("ru-RU")}</strong><small>social support and grants</small></div>
            <div><span>LICENSES</span><strong>{government.licenses.length - suspendedLicenses.length}/{government.licenses.length}</strong><small>{suspendedLicenses.length} suspended or revoked</small></div>
            <div><span>ENFORCEMENT</span><strong>{openCases.length} CASES</strong><small>{government.totals.arrests} arrests · {government.totals.convictions} convictions</small></div>
            <div><span>ILLEGAL ECONOMY</span><strong>₵ {government.totals.crimeRevenue.toLocaleString("ru-RU")}</strong><small>bribes ₵ {government.totals.bribesPaid.toLocaleString("ru-RU")}</small></div>
          </div>
          <div className="government-columns">
            <section className="government-list">
              <header><span>DISTRICT LAW</span><strong>{government.policy.enforcementFocus.replace(/-/g, " ").toUpperCase()}</strong></header>
              {government.districts.map((law) => (
                <article className="government-district" key={law.districtId}>
                  <div><span>DISTRICT</span><strong>{districtName(session, law.districtId)}</strong><small>public trust {Math.round(law.publicTrust)}%</small></div>
                  <div><span>PATROL / READINESS</span><strong>{Math.round(law.patrolCoverage)}% / {Math.round(law.policeReadiness)}%</strong><small>corruption {Math.round(law.corruption)}%</small></div>
                  <div><span>CRIME</span><strong>{Math.round((law.violentCrime + law.propertyCrime + law.cyberCrime) / 3)}%</strong><small>illegal market {Math.round(law.illegalMarketShare)}%</small></div>
                  <div><span>CASELOAD</span><strong>{law.unresolvedCases}</strong><small>court backlog {Math.round(law.courtBacklog)}</small></div>
                </article>
              ))}
            </section>
            <section className="government-list">
              <header><span>CRIME NETWORKS</span><strong>{activeOperations.length} ACTIVE OPERATIONS</strong></header>
              {government.crimeNetworks.map((network) => (
                <article className="crime-network" key={network.id}>
                  <div><span>{network.name}</span><strong>₵ {Math.round(network.treasury).toLocaleString("ru-RU")}</strong><small>{network.memberResidentIds.length} linked residents</small></div>
                  <div><span>HEAT / SECRECY</span><strong>{Math.round(network.heat)}% / {Math.round(network.secrecy)}%</strong><small>corruption budget ₵ {network.corruptionBudget.toLocaleString("ru-RU")}</small></div>
                  <div><span>OPERATIONS</span><strong>{network.operations.filter((item) => item.status !== "dormant").length}</strong><small>{network.operations.map((item) => item.kind.replace(/-/g, " ")).slice(0, 2).join(" · ")}</small></div>
                </article>
              ))}
            </section>
          </div>
          <div className="government-cases">
            {openCases.slice().sort((left, right) => right.priority - left.priority).slice(0, 12).map((caseState) => (
              <article className={`government-case government-case--${caseState.status}`} key={caseState.id}>
                <span>{caseState.kind.replace(/-/g, " ").toUpperCase()}</span>
                <strong>{districtName(session, caseState.districtId)} · EVIDENCE {Math.round(caseState.evidence)}%</strong>
                <small>{caseState.status.toUpperCase()} · {caseState.arrests} arrests · seized ₵ {caseState.seizedCredits}</small>
              </article>
            ))}
            {!openCases.length ? <div className="empty-terminal">Открытых расследований нет.</div> : null}
          </div>
        </section>
      ) : null}

      {tab === "health" ? (
        <section className="health-workspace">
          <div className="health-summary">
            <div><span>ACTIVE CONDITIONS</span><strong>{activeConditions.length}</strong><small>{highRiskConditions.filter((item) => item.severity >= 70).length} severe</small></div>
            <div><span>CLINICAL QUEUE</span><strong>{waitingCases.length}</strong><small>{health.facilities.reduce((sum, item) => sum + item.occupiedBeds, 0)} occupied beds</small></div>
            <div><span>TREATED</span><strong>{health.totals.casesTreated}</strong><small>{health.totals.procedures} procedures</small></div>
            <div><span>MEDICAL DEBT</span><strong>₵ {Math.round(activeMedicalDebts.reduce((sum, item) => sum + item.principal, 0)).toLocaleString("ru-RU")}</strong><small>{activeMedicalDebts.filter((item) => item.status === "delinquent").length} delinquent</small></div>
            <div><span>CYBERWARE</span><strong>{activeInstallations.length}</strong><small>{failedInstallations.length} failed · {health.totals.cyberwareMaintained} services</small></div>
            <div><span>COVERAGE</span><strong>{health.policies.filter((item) => item.status === "active").length}</strong><small>{recentHealthSnapshot?.uninsuredResidents ?? 0} uninsured residents</small></div>
          </div>
          <div className="health-columns">
            <section className="health-list">
              <header><span>CLINICAL NETWORK</span><strong>CAPACITY / STOCK / STAFF</strong></header>
              {health.facilities.map((facility) => (
                <article className={`health-facility health-facility--${facility.status}`} key={facility.id}>
                  <div><span>{facility.kind.replace(/-/g, " ").toUpperCase()}</span><strong>{locationName(session, facility.locationId)}</strong><small>{facility.licensed ? "LICENSED" : "UNLICENSED"} · {districtName(session, facility.districtId)}</small></div>
                  <div><span>LOAD</span><strong>{facility.occupiedBeds}/{facility.bedCapacity} BEDS</strong><small>{facility.queueLength} waiting · {facility.treatmentRooms} rooms</small></div>
                  <div><span>READINESS</span><strong>{Math.round((facility.staffing + facility.serviceLevel) / 2)}%</strong><small>staff {facility.staffing}% · utilities {facility.serviceLevel}%</small></div>
                  <div><span>STOCK</span><strong>{Math.round(facility.medicalStock)} MED</strong><small>{Math.round(facility.implantParts)} parts · {Math.round(facility.maintenanceKits)} service kits</small></div>
                </article>
              ))}
            </section>
            <section className="health-list">
              <header><span>CASES / CONDITIONS</span><strong>TRIAGE FROM REAL NEED</strong></header>
              {recentCases.map((caseState) => {
                const conditionState = health.conditions.find((item) => caseState.conditionIds.includes(item.id));
                return (
                  <article className={`health-case health-case--${caseState.status}`} key={caseState.id}>
                    <div><span>TRIAGE {caseState.triageLevel}</span><strong>{residentName(session, caseState.residentId)}</strong><small>{conditionState?.kind.replace(/-/g, " ").toUpperCase() ?? "CLINICAL CASE"}</small></div>
                    <div><span>{caseState.status.toUpperCase()}</span><strong>{caseState.waitingDays} DAYS</strong><small>{kernelEntityName(session, caseState.facilityId)}</small></div>
                    <div><span>BILL</span><strong>₵ {caseState.estimatedCost}</strong><small>insurer {caseState.insurerPaid} · patient {caseState.patientPaid} · debt {caseState.debtCreated}</small></div>
                  </article>
                );
              })}
              {!recentCases.length ? <div className="empty-terminal">Клинических обращений ещё нет.</div> : null}
            </section>
          </div>
          <div className="health-lower">
            <section className="health-list health-list--compact">
              <header><span>HIGH-RISK CONDITIONS</span><strong>CAUSE / WORK LIMIT</strong></header>
              {highRiskConditions.map((conditionState) => (
                <article key={conditionState.id}>
                  <div><span>{conditionState.origin.toUpperCase()}</span><strong>{residentName(session, conditionState.residentId)}</strong><small>{conditionState.kind.replace(/-/g, " ").toUpperCase()}</small></div>
                  <div><span>SEVERITY</span><strong>{Math.round(conditionState.severity)}%</strong><small>work restriction {conditionState.workRestriction}% · untreated {conditionState.untreatedDays} d</small></div>
                </article>
              ))}
            </section>
            <section className="health-list health-list--compact">
              <header><span>CYBERWARE REGISTRY</span><strong>CONDITION / SERVICE</strong></header>
              {activeInstallations.slice(-12).reverse().map((installation) => {
                const model = health.cyberwareModels.find((item) => item.id === installation.modelId);
                return (
                  <article key={installation.id}>
                    <div><span>{installation.licensedSerial ? "LICENSED" : "UNREGISTERED"}</span><strong>{residentName(session, installation.residentId)}</strong><small>{model?.name ?? installation.modelId}</small></div>
                    <div><span>{installation.status.toUpperCase()}</span><strong>{Math.round(installation.condition)}%</strong><small>service day {installation.maintenanceDueDay} · failures {installation.failures}</small></div>
                  </article>
                );
              })}
              {!activeInstallations.length ? <div className="empty-terminal">Установленных имплантов пока нет.</div> : null}
            </section>
          </div>
        </section>
      ) : null}

      {tab === "data" ? (
        <section className="data-workspace">
          <div className="population-labor__summary">
            <div><span>DIGITAL IDENTITIES</span><strong>{dataState.identities.length}</strong><small>{compromisedIdentities.length} compromised / limited</small></div>
            <div><span>SURVEILLANCE</span><strong>{recentDataSnapshot?.activeNodes ?? 0}</strong><small>{recentDataSnapshot?.offlineNodes ?? 0} offline nodes</small></div>
            <div><span>ACCESS REQUESTS</span><strong>{dataState.totals.accesses.toLocaleString("ru-RU")}</strong><small>{dataState.totals.deniedAccesses} denied</small></div>
            <div><span>BREACHES</span><strong>{activeBreaches.length}</strong><small>{dataState.totals.recordsStolen} records stolen</small></div>
            <div><span>FORGED IDS</span><strong>{activeForgeries.length}</strong><small>{dataState.totals.forgeriesDetected} detected</small></div>
            <div><span>AVG CREDIT</span><strong>{recentDataSnapshot?.averageCreditScore ?? 0}</strong><small>300–850 civic score</small></div>
          </div>
          <div className="population-labor__columns">
            <section className="population-labor__list">
              <header><span>NETWORK NODES</span><strong>PHYSICAL COVERAGE</strong></header>
              {dataState.nodes.slice().sort((left, right) => left.status.localeCompare(right.status) || right.vulnerability - left.vulnerability).slice(0, 16).map((node) => (
                <article key={node.id}>
                  <div><span>{node.kind.replace(/-/g, " ").toUpperCase()}</span><strong>{locationName(session, node.locationId)}</strong><small>{districtName(session, node.districtId)} · {node.ownerEntityId}</small></div>
                  <div><span>STATUS</span><strong>{node.status.toUpperCase()}</strong><small>quality {node.quality}%</small></div>
                  <div><span>RISK</span><strong>{node.vulnerability}%</strong><small>{node.capturesToday} captures today</small></div>
                </article>
              ))}
            </section>
            <section className="population-labor__list">
              <header><span>DATA BREACHES</span><strong>REAL RECORD LOSS</strong></header>
              {recentBreaches.map((breach) => (
                <article key={breach.id}>
                  <div><span>{breach.status.toUpperCase()}</span><strong>{kernelEntityName(session, breach.sourceEntityId)}</strong><small>{districtName(session, breach.districtId)} · day {breach.startedDay}</small></div>
                  <div><span>STOLEN</span><strong>{breach.stolenRecords}</strong><small>severity {breach.severity}</small></div>
                  <div><span>VALUE</span><strong>₵ {breach.marketValue}</strong><small>evidence {breach.evidence}%</small></div>
                </article>
              ))}
              {!recentBreaches.length ? <div className="empty-terminal">Подтверждённых утечек пока нет.</div> : null}
            </section>
          </div>
          <div className="population-labor__columns">
            <section className="population-labor__list">
              <header><span>RECENT ACCESS</span><strong>WHO KNOWS WHAT</strong></header>
              {recentAccesses.map((access) => {
                const record = dataState.records.find((item) => item.id === access.recordId);
                return (
                  <article key={access.id}>
                    <div><span>{access.purpose.replace(/-/g, " ").toUpperCase()}</span><strong>{kernelEntityName(session, access.actorEntityId)}</strong><small>{record ? residentName(session, record.subjectId) : "EXPIRED RECORD"}</small></div>
                    <div><span>RECORD</span><strong>{record?.kind.replace(/-/g, " ").toUpperCase() ?? "PURGED"}</strong><small>{record?.sensitivity.toUpperCase() ?? "RETAINED LOG"}</small></div>
                    <div><span>RESULT</span><strong>{access.outcome.toUpperCase()}</strong><small>day {access.dayIndex}</small></div>
                  </article>
                );
              })}
              {!recentAccesses.length ? <div className="empty-terminal">Запросов к реестрам пока нет.</div> : null}
            </section>
            <section className="population-labor__list">
              <header><span>IDENTITY PRESSURE</span><strong>SERVICE ACCESS</strong></header>
              {compromisedIdentities.slice().sort((left, right) => left.digitalAccess - right.digitalAccess).slice(0, 14).map((identity) => (
                <article key={identity.id}>
                  <div><span>{identity.status.toUpperCase()}</span><strong>{residentName(session, identity.residentId)}</strong><small>{identity.aliases.length ? identity.aliases.join(" / ") : identity.civicIdentifier}</small></div>
                  <div><span>ACCESS</span><strong>{identity.digitalAccess}%</strong><small>profile {identity.profileCompleteness}%</small></div>
                  <div><span>CREDIT</span><strong>{identity.creditScore}</strong><small>fraud risk {identity.fraudRisk}%</small></div>
                </article>
              ))}
              {!compromisedIdentities.length ? <div className="empty-terminal">Все активные профили подтверждены.</div> : null}
            </section>
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
