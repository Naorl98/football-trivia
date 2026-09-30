// Normalized football domain types.
//
// These are the ONLY shapes the import layer and question generators see. No
// provider-specific field names, ids or response envelopes may leak past the
// provider implementation, so swapping API-Football for Sportmonks or
// football-data.org is a new adapter rather than a rewrite.

export interface ProviderRef {
  /** Provider slug, e.g. "api-football". */
  provider: string;
  /** The provider's own id for this entity, as a string. */
  externalId: string;
}

export interface NormalizedCountry extends ProviderRef {
  name: string;
  code: string | null;
}

export interface NormalizedVenue extends ProviderRef {
  name: string;
  city: string | null;
  countryName: string | null;
  capacity: number | null;
}

export type CompetitionType = "LEAGUE" | "CUP" | "UNKNOWN";

export interface NormalizedCompetition extends ProviderRef {
  name: string;
  type: CompetitionType;
  countryName: string | null;
  countryCode: string | null;
  /** Seasons the provider reports coverage for, newest last. */
  seasons: NormalizedSeason[];
}

export interface NormalizedSeason {
  season: number;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  /** Raw coverage flags, used by the planner to avoid queueing missing data. */
  coverage: Record<string, unknown> | null;
}

export interface NormalizedTeam extends ProviderRef {
  name: string;
  code: string | null;
  countryName: string | null;
  founded: number | null;
  isNational: boolean;
  venue: NormalizedVenue | null;
}

export interface NormalizedPlayer extends ProviderRef {
  name: string;
  firstname: string | null;
  lastname: string | null;
  nationality: string | null;
  birthDate: string | null;
  position: string | null;
}

export interface NormalizedSquadMember {
  player: NormalizedPlayer;
  teamExternalId: string;
  season: number | null;
}

export interface NormalizedTransfer {
  playerExternalId: string;
  playerName: string;
  fromTeamExternalId: string | null;
  fromTeamName: string | null;
  toTeamExternalId: string | null;
  toTeamName: string | null;
  date: string | null;
  type: string | null;
  feeText: string | null;
}

export interface NormalizedTrophy {
  personExternalId: string;
  competitionName: string;
  countryName: string | null;
  season: string | null;
  place: string | null;
}

export interface NormalizedCoach extends ProviderRef {
  name: string;
  nationality: string | null;
  birthDate: string | null;
  careers: { teamExternalId: string | null; teamName: string | null; start: string | null; end: string | null }[];
}

export interface NormalizedFixture extends ProviderRef {
  competitionExternalId: string | null;
  season: number | null;
  round: string | null;
  kickoff: string | null;
  venue: NormalizedVenue | null;
  homeTeamExternalId: string | null;
  awayTeamExternalId: string | null;
  /** Carried so a fixture can stub the clubs it names, as standings do. */
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  /**
   * Shootout score, when there was one. Without this a final that finished 3-3
   * and was decided on penalties — Argentina v France in 2022 — reads as having
   * no winner at all, and a goals-only comparison would either find a draw or,
   * worse, name the wrong side.
   */
  homePenalties: number | null;
  awayPenalties: number | null;
  status: string | null;
}

export interface NormalizedStandingRow {
  teamExternalId: string;
  teamName: string;
  rank: number | null;
  points: number | null;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
}

export interface NormalizedTopScorer {
  player: NormalizedPlayer;
  teamExternalId: string | null;
  goals: number | null;
  assists: number | null;
  appearances: number | null;
}

/** Pagination envelope shared by every paged provider call. */
export interface Paged<T> {
  items: T[];
  page: number;
  totalPages: number;
  /** Requests the provider says remain in the current quota window, if known. */
  rateLimitRemaining: number | null;
  rateLimitLimit: number | null;
}

export interface ProviderQuery {
  competitionExternalId?: string;
  teamExternalId?: string;
  playerExternalId?: string;
  season?: number;
  page?: number;
  search?: string;
}

/**
 * The contract every football data provider must satisfy.
 *
 * Implementations are responsible for their own HTTP details, auth, retries
 * and response shapes; callers only ever see normalized types. A provider may
 * throw `ProviderQuotaError` to signal that the caller must stop for the day.
 */
export interface FootballDataProvider {
  readonly name: string;

  /** Requests consumed by this provider instance so far in the process. */
  getRequestsUsed(): number;

  getCountries(): Promise<Paged<NormalizedCountry>>;
  getCompetitions(query?: ProviderQuery): Promise<Paged<NormalizedCompetition>>;
  getTeams(query: ProviderQuery): Promise<Paged<NormalizedTeam>>;
  getSquad(query: ProviderQuery): Promise<Paged<NormalizedSquadMember>>;
  getPlayers(query: ProviderQuery): Promise<Paged<NormalizedPlayer>>;
  getTransfers(query: ProviderQuery): Promise<Paged<NormalizedTransfer>>;
  getTrophies(query: ProviderQuery): Promise<Paged<NormalizedTrophy>>;
  getCoaches(query: ProviderQuery): Promise<Paged<NormalizedCoach>>;
  getFixtures(query: ProviderQuery): Promise<Paged<NormalizedFixture>>;
  getStandings(query: ProviderQuery): Promise<Paged<NormalizedStandingRow>>;
  getTopScorers(query: ProviderQuery): Promise<Paged<NormalizedTopScorer>>;
}

/** Thrown when the provider's quota is exhausted — harvests must stop cleanly. */
export class ProviderQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderQuotaError";
  }
}

/** Thrown for errors that will never succeed on retry (bad ids, 404, plan limits). */
export class ProviderPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderPermanentError";
  }
}
