// In-memory provider used by the test suite.
//
// Lets the import pipeline, pagination, idempotency and quota handling be
// tested end to end without spending a single real API request.

import {
  ProviderQuotaError,
  type FootballDataProvider,
  type NormalizedCoach,
  type NormalizedCompetition,
  type NormalizedCountry,
  type NormalizedFixture,
  type NormalizedPlayer,
  type NormalizedSquadMember,
  type NormalizedStandingRow,
  type NormalizedTeam,
  type NormalizedTopScorer,
  type NormalizedTransfer,
  type NormalizedTrophy,
  type Paged,
  type ProviderQuery,
} from "./types.ts";

export interface MockData {
  countries?: NormalizedCountry[];
  competitions?: NormalizedCompetition[];
  teams?: NormalizedTeam[];
  squad?: NormalizedSquadMember[];
  players?: NormalizedPlayer[][]; // one entry per page
  transfers?: NormalizedTransfer[];
  trophies?: NormalizedTrophy[];
  coaches?: NormalizedCoach[];
  fixtures?: NormalizedFixture[];
  standings?: NormalizedStandingRow[];
  topScorers?: NormalizedTopScorer[];
}

export class MockProvider implements FootballDataProvider {
  readonly name = "api-football";
  private requests = 0;
  readonly calls: { endpoint: string; query: ProviderQuery }[] = [];

  private readonly data: MockData;
  private readonly quotaAfter: number;

  constructor(data: MockData = {}, quotaAfter = Infinity) {
    this.data = data;
    this.quotaAfter = quotaAfter;
  }

  getRequestsUsed(): number {
    return this.requests;
  }

  private page<T>(items: T[], endpoint: string, query: ProviderQuery = {}, totalPages = 1): Paged<T> {
    this.requests++;
    this.calls.push({ endpoint, query });
    if (this.requests > this.quotaAfter) {
      throw new ProviderQuotaError("mock quota exhausted");
    }
    return {
      items,
      page: query.page ?? 1,
      totalPages,
      rateLimitRemaining: Math.max(0, this.quotaAfter - this.requests),
      rateLimitLimit: Number.isFinite(this.quotaAfter) ? this.quotaAfter : null,
    };
  }

  async getCountries() {
    return this.page(this.data.countries ?? [], "/countries");
  }
  async getCompetitions(query: ProviderQuery = {}) {
    return this.page(this.data.competitions ?? [], "/leagues", query);
  }
  async getTeams(query: ProviderQuery) {
    return this.page(this.data.teams ?? [], "/teams", query);
  }
  async getSquad(query: ProviderQuery) {
    return this.page(this.data.squad ?? [], "/players/squads", query);
  }
  async getPlayers(query: ProviderQuery) {
    const pages = this.data.players ?? [[]];
    const index = Math.max(0, (query.page ?? 1) - 1);
    return this.page(pages[index] ?? [], "/players", query, pages.length);
  }
  async getTransfers(query: ProviderQuery) {
    return this.page(this.data.transfers ?? [], "/transfers", query);
  }
  async getTrophies(query: ProviderQuery) {
    return this.page(this.data.trophies ?? [], "/trophies", query);
  }
  async getCoaches(query: ProviderQuery) {
    return this.page(this.data.coaches ?? [], "/coachs", query);
  }
  async getFixtures(query: ProviderQuery) {
    return this.page(this.data.fixtures ?? [], "/fixtures", query);
  }
  async getStandings(query: ProviderQuery) {
    return this.page(this.data.standings ?? [], "/standings", query);
  }
  async getTopScorers(query: ProviderQuery) {
    return this.page(this.data.topScorers ?? [], "/players/topscorers", query);
  }
}
