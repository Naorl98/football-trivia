// API-Football (API-Sports) v3 adapter.
//
// This is the only module that knows API-Football's URLs, headers, response
// envelope or field names. Everything above it works with the normalized types
// in ./types.ts.
//
// Quota handling matters here: the free plan allows ~100 requests/day with a
// per-minute cap, so the client reads the rate-limit headers on every response,
// throttles between calls, and raises ProviderQuotaError the moment the daily
// allowance is gone, rather than burning retries against a wall.

import {
  ProviderPermanentError,
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
  type NormalizedVenue,
  type Paged,
  type ProviderQuery,
} from "./types.ts";

const BASE_URL = "https://v3.football.api-sports.io";
export const PROVIDER_NAME = "api-football";

export interface ApiFootballOptions {
  apiKey: string;
  /** Minimum gap between requests, to respect the per-minute limit. */
  minRequestIntervalMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  onRequest?: (info: {
    endpoint: string;
    params: Record<string, string>;
    statusCode: number;
    results: number;
    rateLimitRemaining: number | null;
    rateLimitLimit: number | null;
  }) => void | Promise<void>;
}

interface ApiEnvelope<T> {
  get?: string;
  results?: number;
  paging?: { current?: number; total?: number };
  response?: T[];
  errors?: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toStringId(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export class ApiFootballProvider implements FootballDataProvider {
  readonly name = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly minInterval: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onRequest?: ApiFootballOptions["onRequest"];

  private requestsUsed = 0;
  private lastRequestAt = 0;
  private lastRateLimitRemaining: number | null = null;
  private lastRateLimitLimit: number | null = null;

  constructor(options: ApiFootballOptions) {
    if (!options.apiKey) {
      throw new ProviderPermanentError(
        "API_FOOTBALL_KEY is not set. See .env.example and README (Data ingestion)."
      );
    }
    this.apiKey = options.apiKey;
    this.minInterval = options.minRequestIntervalMs ?? 6500; // ~9 req/min, safely under the free tier's per-minute cap
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onRequest = options.onRequest;
  }

  getRequestsUsed(): number {
    return this.requestsUsed;
  }

  getLastRateLimit(): { remaining: number | null; limit: number | null } {
    return { remaining: this.lastRateLimitRemaining, limit: this.lastRateLimitLimit };
  }

  private async request<T>(endpoint: string, params: Record<string, string | number | undefined>): Promise<ApiEnvelope<T>> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    }
    const url = `${BASE_URL}${endpoint}${query.toString() ? `?${query}` : ""}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // Throttle: never exceed the per-minute allowance.
      const since = Date.now() - this.lastRequestAt;
      if (this.lastRequestAt > 0 && since < this.minInterval) {
        await sleep(this.minInterval - since);
      }

      let response: Response;
      try {
        this.lastRequestAt = Date.now();
        this.requestsUsed++;
        response = await this.fetchImpl(url, {
          headers: { "x-apisports-key": this.apiKey, accept: "application/json" },
        });
      } catch (networkError) {
        if (attempt === this.maxRetries) {
          throw new Error(`API-Football network failure on ${endpoint}: ${String(networkError)}`);
        }
        await sleep(1200 * Math.pow(2, attempt)); // controlled backoff
        continue;
      }

      const limitHeader = response.headers.get("x-ratelimit-requests-limit");
      const remainingHeader = response.headers.get("x-ratelimit-requests-remaining");
      this.lastRateLimitLimit = toNumberOrNull(limitHeader);
      this.lastRateLimitRemaining = toNumberOrNull(remainingHeader);

      // 429 = per-minute throttle; wait and retry. Daily exhaustion is reported
      // through the remaining-requests header instead.
      if (response.status === 429) {
        if (attempt === this.maxRetries) {
          throw new ProviderQuotaError("API-Football rate limit hit repeatedly (HTTP 429)");
        }
        await sleep(Math.max(this.minInterval, 20000));
        continue;
      }

      if (response.status === 499 || response.status === 403) {
        throw new ProviderPermanentError(
          `API-Football rejected the request (HTTP ${response.status}) — check the key or plan limits on ${endpoint}`
        );
      }

      if (!response.ok) {
        if (attempt === this.maxRetries) {
          throw new Error(`API-Football returned HTTP ${response.status} for ${endpoint}`);
        }
        await sleep(1200 * Math.pow(2, attempt));
        continue;
      }

      const body = (await response.json()) as ApiEnvelope<T>;

      await this.onRequest?.({
        endpoint,
        params: Object.fromEntries(query.entries()),
        statusCode: response.status,
        results: body.results ?? 0,
        rateLimitRemaining: this.lastRateLimitRemaining,
        rateLimitLimit: this.lastRateLimitLimit,
      });

      // API-Football returns 200 with a populated `errors` object for plan or
      // parameter problems.
      if (body.errors && !Array.isArray(body.errors) && Object.keys(body.errors as object).length > 0) {
        const message = JSON.stringify(body.errors);

        // Two very different failures both mention the plan, and conflating them
        // is expensive in opposite directions.
        //
        // "Free plans do not have access to this season" is permanent for this
        // request and irrelevant to every other: the right response is to give up
        // on that season and carry on. Treating it as a quota stop — which a bare
        // /plan/ test does, because the word "plans" is right there — aborts the
        // whole run on the first out-of-range season and leaves the day's
        // remaining budget unspent.
        //
        // Running out of requests for the day is the reverse: nothing else will
        // succeed either, and continuing just burns retries against a wall.
        if (/do not have access|upgrade your plan|not available for your plan/i.test(message)) {
          throw new ProviderPermanentError(
            `API-Football plan does not cover ${endpoint} for these parameters: ${message}`
          );
        }
        if (/request limit|too many requests|rateLimit|exceeded/i.test(message)) {
          throw new ProviderQuotaError(`API-Football quota exhausted on ${endpoint}: ${message}`);
        }
        throw new ProviderPermanentError(`API-Football error on ${endpoint}: ${message}`);
      }

      if (this.lastRateLimitRemaining !== null && this.lastRateLimitRemaining <= 0) {
        // Data from this response is still valid and must be saved by the
        // caller; the next request would fail, so flag it now.
        (body as ApiEnvelope<T> & { quotaExhausted?: boolean }).quotaExhausted = true;
      }

      return body;
    }

    throw new Error(`API-Football request to ${endpoint} failed after ${this.maxRetries + 1} attempts`);
  }

  private paged<T>(body: ApiEnvelope<unknown>, items: T[]): Paged<T> {
    return {
      items,
      page: body.paging?.current ?? 1,
      totalPages: body.paging?.total ?? 1,
      rateLimitRemaining: this.lastRateLimitRemaining,
      rateLimitLimit: this.lastRateLimitLimit,
    };
  }

  // -------------------------------------------------------------------------
  // Normalizers
  // -------------------------------------------------------------------------
  private normalizeVenue(raw: Record<string, unknown> | null | undefined): NormalizedVenue | null {
    if (!raw || !raw.id) return null;
    return {
      provider: PROVIDER_NAME,
      externalId: toStringId(raw.id),
      name: String(raw.name ?? ""),
      city: (raw.city as string) ?? null,
      countryName: (raw.country as string) ?? null,
      capacity: toNumberOrNull(raw.capacity),
    };
  }

  private normalizePlayer(raw: Record<string, unknown>): NormalizedPlayer {
    const birth = (raw.birth as Record<string, unknown> | undefined) ?? {};
    return {
      provider: PROVIDER_NAME,
      externalId: toStringId(raw.id),
      name: String(raw.name ?? ""),
      firstname: (raw.firstname as string) ?? null,
      lastname: (raw.lastname as string) ?? null,
      nationality: (raw.nationality as string) ?? null,
      birthDate: (birth.date as string) ?? null,
      position: (raw.position as string) ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Endpoints
  // -------------------------------------------------------------------------
  async getCountries(): Promise<Paged<NormalizedCountry>> {
    const body = await this.request<Record<string, unknown>>("/countries", {});
    const items = (body.response ?? []).map((raw) => ({
      provider: PROVIDER_NAME,
      // /countries has no numeric id; the code (or name) is the stable key.
      externalId: toStringId(raw.code ?? raw.name),
      name: String(raw.name ?? ""),
      code: (raw.code as string) ?? null,
    }));
    return this.paged(body, items);
  }

  async getCompetitions(query: ProviderQuery = {}): Promise<Paged<NormalizedCompetition>> {
    const body = await this.request<Record<string, unknown>>("/leagues", {
      id: query.competitionExternalId,
      season: query.season,
      search: query.search,
    });

    const items = (body.response ?? []).map((entry) => {
      const league = (entry.league as Record<string, unknown>) ?? {};
      const country = (entry.country as Record<string, unknown>) ?? {};
      const seasons = ((entry.seasons as Record<string, unknown>[]) ?? []).map((s) => ({
        season: Number(s.year),
        startDate: (s.start as string) ?? null,
        endDate: (s.end as string) ?? null,
        isCurrent: Boolean(s.current),
        coverage: (s.coverage as Record<string, unknown>) ?? null,
      }));
      const rawType = String(league.type ?? "").toLowerCase();
      return {
        provider: PROVIDER_NAME,
        externalId: toStringId(league.id),
        name: String(league.name ?? ""),
        type: rawType === "league" ? ("LEAGUE" as const) : rawType === "cup" ? ("CUP" as const) : ("UNKNOWN" as const),
        countryName: (country.name as string) ?? null,
        countryCode: (country.code as string) ?? null,
        seasons,
      };
    });
    return this.paged(body, items);
  }

  async getTeams(query: ProviderQuery): Promise<Paged<NormalizedTeam>> {
    const body = await this.request<Record<string, unknown>>("/teams", {
      league: query.competitionExternalId,
      season: query.season,
      id: query.teamExternalId,
    });

    const items = (body.response ?? []).map((entry) => {
      const team = (entry.team as Record<string, unknown>) ?? {};
      return {
        provider: PROVIDER_NAME,
        externalId: toStringId(team.id),
        name: String(team.name ?? ""),
        code: (team.code as string) ?? null,
        countryName: (team.country as string) ?? null,
        founded: toNumberOrNull(team.founded),
        isNational: Boolean(team.national),
        venue: this.normalizeVenue(entry.venue as Record<string, unknown>),
      };
    });
    return this.paged(body, items);
  }

  async getSquad(query: ProviderQuery): Promise<Paged<NormalizedSquadMember>> {
    const body = await this.request<Record<string, unknown>>("/players/squads", {
      team: query.teamExternalId,
    });

    const items: NormalizedSquadMember[] = [];
    for (const entry of body.response ?? []) {
      const team = (entry.team as Record<string, unknown>) ?? {};
      for (const raw of (entry.players as Record<string, unknown>[]) ?? []) {
        items.push({
          player: this.normalizePlayer(raw),
          teamExternalId: toStringId(team.id ?? query.teamExternalId),
          season: query.season ?? null,
        });
      }
    }
    return this.paged(body, items);
  }

  async getPlayers(query: ProviderQuery): Promise<Paged<NormalizedPlayer>> {
    const body = await this.request<Record<string, unknown>>("/players", {
      league: query.competitionExternalId,
      season: query.season,
      team: query.teamExternalId,
      id: query.playerExternalId,
      page: query.page,
    });

    const items = (body.response ?? []).map((entry) =>
      this.normalizePlayer((entry.player as Record<string, unknown>) ?? {})
    );
    return this.paged(body, items);
  }

  async getTransfers(query: ProviderQuery): Promise<Paged<NormalizedTransfer>> {
    const body = await this.request<Record<string, unknown>>("/transfers", {
      player: query.playerExternalId,
      team: query.teamExternalId,
    });

    const items: NormalizedTransfer[] = [];
    for (const entry of body.response ?? []) {
      const player = (entry.player as Record<string, unknown>) ?? {};
      for (const t of (entry.transfers as Record<string, unknown>[]) ?? []) {
        const teams = (t.teams as Record<string, unknown>) ?? {};
        const inTeam = (teams.in as Record<string, unknown>) ?? {};
        const outTeam = (teams.out as Record<string, unknown>) ?? {};
        items.push({
          playerExternalId: toStringId(player.id),
          playerName: String(player.name ?? ""),
          fromTeamExternalId: outTeam.id ? toStringId(outTeam.id) : null,
          fromTeamName: (outTeam.name as string) ?? null,
          toTeamExternalId: inTeam.id ? toStringId(inTeam.id) : null,
          toTeamName: (inTeam.name as string) ?? null,
          date: (t.date as string) ?? null,
          type: (t.type as string) ?? null,
          feeText: typeof t.type === "string" && /€|\$|£/.test(t.type) ? (t.type as string) : null,
        });
      }
    }
    return this.paged(body, items);
  }

  async getTrophies(query: ProviderQuery): Promise<Paged<NormalizedTrophy>> {
    const body = await this.request<Record<string, unknown>>("/trophies", {
      player: query.playerExternalId,
      coach: query.playerExternalId ? undefined : query.teamExternalId,
    });

    const items = (body.response ?? []).map((raw) => ({
      personExternalId: toStringId(query.playerExternalId ?? query.teamExternalId),
      competitionName: String(raw.league ?? ""),
      countryName: (raw.country as string) ?? null,
      season: raw.season ? String(raw.season) : null,
      place: (raw.place as string) ?? null,
    }));
    return this.paged(body, items);
  }

  async getCoaches(query: ProviderQuery): Promise<Paged<NormalizedCoach>> {
    const body = await this.request<Record<string, unknown>>("/coachs", {
      team: query.teamExternalId,
      id: query.playerExternalId,
    });

    const items = (body.response ?? []).map((raw) => {
      const birth = (raw.birth as Record<string, unknown> | undefined) ?? {};
      const careers = ((raw.career as Record<string, unknown>[]) ?? []).map((c) => {
        const team = (c.team as Record<string, unknown>) ?? {};
        return {
          teamExternalId: team.id ? toStringId(team.id) : null,
          teamName: (team.name as string) ?? null,
          start: (c.start as string) ?? null,
          end: (c.end as string) ?? null,
        };
      });
      return {
        provider: PROVIDER_NAME,
        externalId: toStringId(raw.id),
        name: String(raw.name ?? ""),
        nationality: (raw.nationality as string) ?? null,
        birthDate: (birth.date as string) ?? null,
        careers,
      };
    });
    return this.paged(body, items);
  }

  async getFixtures(query: ProviderQuery): Promise<Paged<NormalizedFixture>> {
    const body = await this.request<Record<string, unknown>>("/fixtures", {
      league: query.competitionExternalId,
      season: query.season,
      team: query.teamExternalId,
    });

    const items = (body.response ?? []).map((entry) => {
      const fixture = (entry.fixture as Record<string, unknown>) ?? {};
      const league = (entry.league as Record<string, unknown>) ?? {};
      const teams = (entry.teams as Record<string, unknown>) ?? {};
      const goals = (entry.goals as Record<string, unknown>) ?? {};
      const home = (teams.home as Record<string, unknown>) ?? {};
      const away = (teams.away as Record<string, unknown>) ?? {};
      const status = (fixture.status as Record<string, unknown>) ?? {};
      const score = (entry.score as Record<string, unknown>) ?? {};
      const penalty = (score.penalty as Record<string, unknown>) ?? {};
      return {
        provider: PROVIDER_NAME,
        externalId: toStringId(fixture.id),
        competitionExternalId: league.id ? toStringId(league.id) : null,
        season: toNumberOrNull(league.season),
        round: (league.round as string) ?? null,
        kickoff: (fixture.date as string) ?? null,
        venue: this.normalizeVenue(fixture.venue as Record<string, unknown>),
        homeTeamExternalId: home.id ? toStringId(home.id) : null,
        awayTeamExternalId: away.id ? toStringId(away.id) : null,
        homeTeamName: (home.name as string) ?? null,
        awayTeamName: (away.name as string) ?? null,
        homeGoals: toNumberOrNull(goals.home),
        awayGoals: toNumberOrNull(goals.away),
        homePenalties: toNumberOrNull(penalty.home),
        awayPenalties: toNumberOrNull(penalty.away),
        status: (status.short as string) ?? null,
      };
    });
    return this.paged(body, items);
  }

  async getStandings(query: ProviderQuery): Promise<Paged<NormalizedStandingRow>> {
    const body = await this.request<Record<string, unknown>>("/standings", {
      league: query.competitionExternalId,
      season: query.season,
    });

    const items: NormalizedStandingRow[] = [];
    for (const entry of body.response ?? []) {
      const league = (entry.league as Record<string, unknown>) ?? {};
      // `standings` is an array of groups, each an array of rows.
      for (const group of (league.standings as Record<string, unknown>[][]) ?? []) {
        for (const row of group ?? []) {
          const team = (row.team as Record<string, unknown>) ?? {};
          const all = (row.all as Record<string, unknown>) ?? {};
          const goals = (all.goals as Record<string, unknown>) ?? {};
          items.push({
            teamExternalId: toStringId(team.id),
            teamName: String(team.name ?? ""),
            rank: toNumberOrNull(row.rank),
            points: toNumberOrNull(row.points),
            played: toNumberOrNull(all.played),
            won: toNumberOrNull(all.win),
            drawn: toNumberOrNull(all.draw),
            lost: toNumberOrNull(all.lose),
            goalsFor: toNumberOrNull(goals.for),
            goalsAgainst: toNumberOrNull(goals.against),
          });
        }
      }
    }
    return this.paged(body, items);
  }

  async getTopScorers(query: ProviderQuery): Promise<Paged<NormalizedTopScorer>> {
    const body = await this.request<Record<string, unknown>>("/players/topscorers", {
      league: query.competitionExternalId,
      season: query.season,
    });

    const items = (body.response ?? []).map((entry) => {
      const stats = ((entry.statistics as Record<string, unknown>[]) ?? [])[0] ?? {};
      const team = (stats.team as Record<string, unknown>) ?? {};
      const goals = (stats.goals as Record<string, unknown>) ?? {};
      const games = (stats.games as Record<string, unknown>) ?? {};
      return {
        player: this.normalizePlayer((entry.player as Record<string, unknown>) ?? {}),
        teamExternalId: team.id ? toStringId(team.id) : null,
        goals: toNumberOrNull(goals.total),
        assists: toNumberOrNull(goals.assists),
        appearances: toNumberOrNull(games.appearences ?? games.appearances),
      };
    });
    return this.paged(body, items);
  }
}
