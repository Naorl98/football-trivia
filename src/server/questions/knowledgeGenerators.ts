// Question generators over the imported knowledge base.
//
// These read only from D1 (never from the provider), so gameplay and question
// generation are completely independent of API-Football availability.
//
// Quality gates applied to every candidate before it is kept:
//   * the answer must be a single stored fact, not an inference
//   * no option may also be a correct answer
//   * four distinct options, exactly one correct
//   * career ordering must be certain, or the question is dropped
//   * a semantic key must not already exist
//
// WHAT CHANGED, AND WHY IT IS WORTH KNOWING
//
// Each generator used to pick its own distractors — filter a name list, shuffle,
// take three — and set its own difficulty from a five-step ladder. Both are now
// delegated:
//
//   * distractors come from src/server/football/distractors.ts, which is handed
//     the archetype's declared answer type and REFUSES to mix kinds. That is
//     what stopped 2,291 club-transfer questions offering a national team, and
//     52 "which club am I?" questions answering with one.
//   * difficulty comes from src/server/football/difficulty.ts, which knows how
//     famous the subject is and which football world the fact belongs to. The
//     old model knew neither, and labelled an obscure Ligue 1 full-back's 2024
//     move HARD.
//
// Every generator therefore now takes a `FootballContext` (see
// ../football/context.ts): the knowledge base with every team classified and
// every club, player and competition scored.

import { normalizeAnswer } from "../../shared/answerMatching.ts";
import { answerTypeFor, winnerTypeOfCompetition, type Archetype } from "../football/archetypes.ts";
import {
  classifyMovement,
  hePrefix,
  MOVEMENT_EXPLANATION_HE,
  MOVEMENT_QUESTION_HE,
  type FactConfidence,
} from "../football/career.ts";
import {
  toClubCandidate,
  toNationalCandidate,
  toPlayerCandidate,
  type FootballContext,
  type TeamProfile,
} from "../football/context.ts";
import { classifyDifficulty, type Band, type DistractorCloseness } from "../football/difficulty.ts";
import { generateDistractors, type SimilarityAxes } from "../football/distractors.ts";
import type { Candidate, EntityType } from "../football/entities.ts";
import { BROAD_HE, DETAILED_HE } from "../football/positions.ts";
import { factProminence, type DomainTier, type FactProminence } from "../football/prominence.ts";
import { validateSemantics, type SemanticFacts } from "../football/validate.ts";
import {
  buildHints,
  clubHintCandidates,
  countryHe,
  firstLetterHint,
  transferTypeHint,
  competitionHe,
  hint,
  regionOf,
  type ClubHintFacts,
  type HintCandidate,
  type HintStrength,
} from "./hints.ts";

/**
 * Club facts looked up by display name, for hint building.
 *
 * Generators receive clubs as names rather than ids — that is what a transfer row
 * carries — so the lookup is keyed the same way.
 */
export type ClubFactsByName = Map<string, ClubHintFacts>;

export function indexClubFacts(teams: TeamRow[], cupScopes?: CupScopesByClub): ClubFactsByName {
  const index: ClubFactsByName = new Map();
  for (const team of teams) {
    const name = team.name_he || team.name;
    if (!name) continue;
    index.set(name, {
      countryName: team.country_name,
      localCode: team.local_code,
      venueName: team.venue_name,
      founded: team.founded,
      cupCodes: cupScopes?.get(name) ?? [],
    });
  }
  return index;
}

export type Difficulty = "EASY" | "NORMAL" | "HARD" | "EXPERT" | "IMPOSSIBLE";

export interface KnowledgeQuestion extends SemanticFacts {
  semanticKey: string;
  mode: "CLASSIC" | "CAREER_PATH" | "CLUB_CONNECTION" | "WHO_AM_I" | "GUESS_THE_CLUB";
  category: string;
  difficulty: Difficulty;
  questionHe: string;
  explanationHe: string;
  options: string[];
  correctIndex: number;
  clues?: string[];
  scopes: { type: "REGION" | "COUNTRY" | "COMPETITION" | "CLUB"; value: string }[];
  sourceLabel: string;
  freeText: boolean;
  canonicalAnswer?: string;
  aliases?: string[];
  hints?: string[];
  /**
   * Hints with a declared strength, for generators that know how much each one
   * gives away. Preferred over `hints`: finalizeHints orders these weakest-first
   * and gates the opener on difficulty. Anything left in `hints` is treated as a
   * middling candidate and still has to survive the same filters.
   */
  hintCandidates?: HintCandidate[];
}

// ---------------------------------------------------------------------------
// Rows as read from D1
// ---------------------------------------------------------------------------
export interface TeamRow {
  id: number;
  name: string;
  name_he: string | null;
  country_name: string | null;
  founded: number | null;
  venue_name: string | null;
  local_code: string | null;
  competition_priority: number | null;
  /**
   * The provider's `national` flag.
   *
   * Absent from this interface until now, which is precisely how national teams
   * reached the club distractor pool: the row carried the information and the
   * type threw it away.
   */
  is_national?: number | boolean | null;
  european_seasons?: number | null;
  titles?: number | null;
  harvested_seasons?: number | null;
}

export interface PlayerRow {
  id: number;
  name: string;
  name_he: string | null;
  nationality: string | null;
  position: string | null;
}

export interface TransferRow {
  player_id: number;
  player_name: string;
  from_team_id: number | null;
  from_team_name: string | null;
  to_team_id: number | null;
  to_team_name: string | null;
  transfer_date: string | null;
  transfer_type: string | null;
}

export interface WinnerRow {
  competition_id: number;
  competition_name: string;
  competition_local_code: string | null;
  competition_priority: number | null;
  /** LEAGUE | CUP | CONTINENTAL | INTERNATIONAL — decides club vs national team. */
  competition_type?: string | null;
  season: number;
  team_name: string;
  runner_up_name: string | null;
  /** The champion's country, used for hints — never for the question itself. */
  team_country?: string | null;
  /** Pre-formatted by seasonLabel(); "2024/25" or "2024". */
  season_label?: string | null;
}

/**
 * How a season should be written.
 *
 * A European league's season 2024 is the 2024/25 campaign, but Brazil, Argentina
 * and MLS play within a single calendar year, where "2024/25" names a season that
 * never existed. The provider's own start and end dates settle it, so the label is
 * read from the data rather than assumed from the number; with no dates stored,
 * the bare year is used, because it is never wrong.
 */
export function seasonLabel(season: number, startDate?: string | null, endDate?: string | null): string {
  const startYear = startDate ? Number(startDate.slice(0, 4)) : null;
  const endYear = endDate ? Number(endDate.slice(0, 4)) : null;
  if (startYear && endYear && endYear > startYear) {
    return `${season}/${String(season + 1).slice(2)}`;
  }
  return String(season);
}

export interface TrophyRow {
  player_id: number;
  player_name: string;
  competition_name: string;
  country_name?: string | null;
  season: string | null;
  place: string | null;
}

/** One coach's spell at one club, from coach_teams. */
export interface CoachSpellRow {
  coach_id: number;
  coach_name: string;
  nationality: string | null;
  team_id: number;
  team_name: string;
  start_date: string | null;
  end_date: string | null;
}

/** One known player-at-club relationship, from player_teams. */
export interface PlayerTeamRow {
  player_id: number;
  player_name: string;
  position: string | null;
  nationality: string | null;
  team_id: number;
  team_name: string;
  /** The *club's* country, not the player's. */
  country_name: string | null;
  season: number | null;
  start_date?: string | null;
}

/** A player's scoring record in one competition season, from player_season_stats. */
export interface SeasonStatRow {
  player_id: number;
  player_name: string;
  team_name: string | null;
  competition_name: string;
  competition_local_code: string | null;
  competition_priority: number | null;
  season: number;
  goals: number | null;
  assists: number | null;
  appearances: number | null;
  /** Pre-formatted by seasonLabel(); "2024/25" or "2024". */
  season_label?: string | null;
}

// ---------------------------------------------------------------------------
// Deterministic helpers — the same inputs always produce the same question set,
// so re-generation does not churn ids.
// ---------------------------------------------------------------------------
function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickDistinct<T>(pool: T[], n: number, seedKey: string): T[] {
  const rand = mulberry32(hashString(seedKey));
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

const display = (row: { name: string; name_he: string | null }) => row.name_he || row.name;

/**
 * Safe aliases for a player name, derived mechanically.
 * Only surname and ASCII-folded forms — never invented nicknames, which have
 * to be curated to be trustworthy.
 */
export function derivePlayerAliases(name: string): string[] {
  const aliases = new Set<string>();
  const trimmed = name.trim();
  if (!trimmed) return [];
  aliases.add(trimmed);

  const ascii = trimmed.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (ascii !== trimmed) aliases.add(ascii);

  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    const surname = parts[parts.length - 1];
    // A one-word surname is only a safe alias when it is distinctive enough.
    if (surname.length >= 4) {
      aliases.add(surname);
      const surnameAscii = surname.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (surnameAscii !== surname) aliases.add(surnameAscii);
    }
  }
  return [...aliases];
}

export function deriveTeamAliases(row: TeamRow): string[] {
  const aliases = new Set<string>([row.name]);
  const ascii = row.name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (ascii !== row.name) aliases.add(ascii);
  if (row.name_he) aliases.add(row.name_he);
  // Drop common club-type prefixes/suffixes ("FC Barcelona" -> "Barcelona").
  const stripped = row.name.replace(/\b(FC|CF|AC|SC|AFC|CD|SS|SV|BSC)\b/g, "").replace(/\s+/g, " ").trim();
  if (stripped.length >= 4 && stripped !== row.name) aliases.add(stripped);
  return [...aliases];
}

// ---------------------------------------------------------------------------
// The shared question-building path
//
// Every generator below funnels through `build`. That is the enforcement point:
// a generator cannot produce a question without naming its archetype, and
// naming the archetype is what fixes the answer type, which is what makes the
// distractor engine able to refuse a mismatch.
// ---------------------------------------------------------------------------

/** What a generator knows about the football behind one question. */
export interface QuestionFacts {
  /** Fame of the person the question is about, 0 (Messi) to 3. */
  subjectFame?: number;
  /** Prominence of the LEAST well-known entity the player must recognise. */
  entityProminence?: number;
  tier?: DomainTier;
  factProminence?: FactProminence;
  year?: number | null;
  factConfidence?: FactConfidence;
}

export interface BuildRequest {
  archetype: Archetype;
  /** Required when the archetype answers with either a club or a national team. */
  resolvedTeamType?: Extract<EntityType, "CLUB" | "NATIONAL_TEAM">;
  answer: Candidate;
  pool: Candidate[];
  seedKey: string;
  /** Right-type values that would also be correct, or are named in the question. */
  exclude?: Iterable<string>;
  similarity?: SimilarityAxes;
  bandFactor?: number;
  facts?: QuestionFacts;
}

export interface BuiltQuestion {
  options: string[];
  correctIndex: 0;
  difficulty: Band;
  closeness: DistractorCloseness;
  /** True when the answer was the only prominent option — a recognition giveaway. */
  giveaway: boolean;
  /** Everything the validation gate needs, ready to spread onto the question. */
  facts: SemanticFacts;
}

/**
 * Picks the options and the difficulty for one question, or returns null.
 *
 * Null means "do not generate this": the pool could not supply three distractors
 * of the right kind. That is the only safe outcome, and it is why the bank will
 * get smaller before it gets better — a question with a national team in it was
 * never three distractors away from being right.
 */
export function build(request: BuildRequest): BuiltQuestion | null {
  const expected = answerTypeFor(request.archetype, request.resolvedTeamType);

  const drawn = generateDistractors({
    expectedEntityType: expected,
    answer: request.answer,
    pool: request.pool,
    seedKey: request.seedKey,
    exclude: request.exclude,
    similarity: request.similarity,
    bandFactor: request.bandFactor,
    context: request.archetype,
  });
  if (!drawn) return null;

  const facts = request.facts ?? {};
  const signals = {
    archetype: request.archetype,
    subjectFame: facts.subjectFame,
    entityProminence: facts.entityProminence,
    tier: facts.tier,
    factProminence: facts.factProminence,
    year: facts.year ?? undefined,
    distractors: drawn.closeness,
  };
  const { band } = classifyDifficulty(signals);

  return {
    options: [request.answer.text, ...drawn.distractors.map((d) => d.text)],
    correctIndex: 0,
    difficulty: band,
    closeness: drawn.closeness,
    giveaway: drawn.giveaway,
    facts: {
      archetype: request.archetype,
      resolvedTeamType: request.resolvedTeamType,
      answerCandidate: request.answer,
      distractorCandidates: drawn.distractors,
      factConfidence: facts.factConfidence ?? "HIGH",
      difficultySignals: signals,
    },
  };
}

/** The prominence of the least-known entity among several. */
export function leastProminent(...values: (number | null | undefined)[]): number | undefined {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length > 0 ? Math.max(...known) : undefined;
}

/** The prominence of the best-known entity among several. */
export function mostProminent(...values: (number | null | undefined)[]): number | undefined {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length > 0 ? Math.min(...known) : undefined;
}

/** The weakest (least familiar) tier among several. */
export function weakestTier(...tiers: (DomainTier | null | undefined)[]): DomainTier {
  const known = tiers.filter((t): t is DomainTier => Boolean(t));
  if (known.includes("NON_CORE")) return "NON_CORE";
  if (known.includes("NEAR_CORE")) return "NEAR_CORE";
  return "CORE";
}

/** A club profile by provider name, or null when the name is not an askable club. */
export function askableClub(context: FootballContext, name: string | null | undefined): TeamProfile | null {
  if (!name) return null;
  const profile = context.teamByName.get(name);
  return profile && profile.kind === "CLUB" ? profile : null;
}

/** A senior national team by provider name. */
export function nationalTeam(context: FootballContext, name: string | null | undefined): TeamProfile | null {
  if (!name) return null;
  const profile = context.teamByName.get(name);
  return profile && profile.kind === "NATIONAL_TEAM" ? profile : null;
}

/** A team of whichever kind the resolved answer type calls for. */
export function teamOfType(
  context: FootballContext,
  name: string | null | undefined,
  type: Extract<EntityType, "CLUB" | "NATIONAL_TEAM">
): TeamProfile | null {
  return type === "CLUB" ? askableClub(context, name) : nationalTeam(context, name);
}

function teamCandidate(profile: TeamProfile): Candidate {
  return profile.kind === "NATIONAL_TEAM" ? toNationalCandidate(profile) : toClubCandidate(profile);
}

/** Candidates for the named teams that are of the requested kind. Order kept. */
export function teamPoolOfType(
  context: FootballContext,
  names: Iterable<string>,
  type: Extract<EntityType, "CLUB" | "NATIONAL_TEAM">
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    const profile = teamOfType(context, name, type);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    out.push(teamCandidate(profile));
  }
  return out;
}

/** " בשנת 2024", or "" when the year is unknown. Never "בשנת null". */
export const whenHe = (year: number | null | undefined): string =>
  typeof year === "number" && Number.isFinite(year) ? ` בשנת ${year}` : "";

/**
 * The topical category a competition's questions belong in.
 *
 * The app exposes Champions League and World Cup as their own filters, so a UCL
 * final tagged TITLES is findable only by someone browsing trophies in general —
 * the specialist mode they picked stays empty however much UCL data arrives.
 */
export function categoryForCompetition(localCode: string | null): string {
  switch (localCode) {
    case "UCL":
      return "CHAMPIONS_LEAGUE";
    case "WORLD_CUP":
      return "WORLD_CUP";
    case "EURO":
    case "COPA_AMERICA":
      return "NATIONAL_TEAMS";
    default:
      return "TITLES";
  }
}

function scopesForCompetition(localCode: string | null, countryName: string | null) {
  const scopes: KnowledgeQuestion["scopes"] = [];
  if (localCode) scopes.push({ type: "COMPETITION", value: localCode });
  const countryCodes: Record<string, string> = {
    England: "ENG", Spain: "ESP", Italy: "ITA", Germany: "GER", France: "FRA",
    Portugal: "POR", Netherlands: "NED", Israel: "ISR", Brazil: "BRA", Argentina: "ARG",
  };
  if (countryName && countryCodes[countryName]) {
    scopes.push({ type: "COUNTRY", value: countryCodes[countryName] });
  }
  if (scopes.length === 0) scopes.push({ type: "REGION", value: "WORLD" });
  return scopes;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * "Who won competition X in season Y?" — from competition_winners.
 *
 * Distractors are the competition's other clubs, not only its other champions.
 * Requiring four past champions sounds like the safer rule but it silently
 * produces nothing at all until a competition has four *different* winners in
 * store: with three accessible seasons per league, every champion fact we hold
 * generated zero questions. Rival clubs from the same division are both
 * available and more believable — the plausible wrong answer to "who won the
 * Premier League" is the club that finished second, not a champion from a
 * different decade.
 */
export function generateCompetitionWinners(
  winners: WinnerRow[],
  clubsByCompetition: Map<number, string[]> = new Map(),
  context?: FootballContext
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  if (!context) return out;

  const byCompetition = new Map<number, WinnerRow[]>();
  for (const row of winners) {
    byCompetition.set(row.competition_id, [...(byCompetition.get(row.competition_id) ?? []), row]);
  }

  for (const [competitionId, rows] of byCompetition) {
    /*
      WHICH KIND OF TEAM WINS THIS.

      A Champions League winner is a club; a World Cup winner is a nation. Both
      live in the same `competition_winners` table and both used to draw from the
      same undifferentiated name pool, which is how two active questions ended up
      offering a World Cup champion beside three clubs. The competition's own
      stored type settles it, so nothing is inferred from the name.
    */
    const first = rows[0];
    const teamType = winnerTypeOfCompetition({
      type: first.competition_type ?? null,
      localCode: first.competition_local_code ?? null,
    });
    const pool = teamPoolOfType(
      context,
      new Set([...(clubsByCompetition.get(competitionId) ?? []), ...rows.map((r) => r.team_name)]),
      teamType
    );
    if (pool.length < 4) continue; // not enough believable distractors

    const tier = (context.teamByName.get(first.team_name)?.tier ?? "CORE") as DomainTier;

    for (const row of rows) {
      const champion = teamOfType(context, row.team_name, teamType);
      if (!champion) continue; // the stored winner is not a team of the right kind

      const built = build({
        archetype: "COMPETITION_WINNER",
        resolvedTeamType: teamType,
        answer: teamCandidate(champion),
        pool,
        seedKey: `kb_winner:${row.competition_id}:${row.season}`,
        // The runner-up is a wrong answer, but a famous-enough one to be the
        // best distractor available — so it stays in the pool deliberately.
        facts: {
          entityProminence: champion.prominence,
          tier,
          year: row.season,
          factProminence: factProminence({
            bestClubProminence: champion.prominence,
            tier,
            year: row.season,
          }),
        },
      });
      if (!built) continue;

      out.push({
        semanticKey: `KB_COMPETITION_WINNER:${row.competition_id}:${row.season}`,
        mode: "CLASSIC",
        category: categoryForCompetition(row.competition_local_code),
        difficulty: built.difficulty,
        questionHe: `מי זכתה באליפות ${row.competition_name} בעונת ${row.season_label ?? row.season}?`,
        explanationHe: row.runner_up_name
          ? `${row.team_name} סיימה במקום הראשון בעונת ${row.season_label ?? row.season}, לפני ${row.runner_up_name}.`
          : `${row.team_name} זכתה באליפות ${row.competition_name} בעונת ${row.season_label ?? row.season}.`,
        options: built.options,
        correctIndex: 0,
        scopes: scopesForCompetition(row.competition_local_code, null),
        sourceLabel: "מסד נתוני כדורגל מיובא",
        freeText: true,
        canonicalAnswer: row.team_name,
        aliases: [row.team_name],
        hintCandidates: [
          ...hint(1, regionOf(row.team_country) ? `האלופה מ${regionOf(row.team_country)}` : null),
          ...hint(2, countryHe(row.team_country) ? `האלופה פועלת ב${countryHe(row.team_country)}` : null),
          ...hint(3, row.runner_up_name ? `היא סיימה לפני ${row.runner_up_name}` : null),
        ],
        ...built.facts,
      });
    }
  }
  return out;
}

/**
 * Clubs worth building a question around.
 *
 * A club enters the knowledge base for two very different reasons: because it
 * played in a harvested competition, or because somebody once transferred there.
 * The second kind arrives in bulk — one Premier League club's transfer list
 * reaches its academy, its lower-division loan partners and every minor club a
 * fringe player passed through — and questions built on those are unanswerable
 * trivia rather than football knowledge. Only clubs with a recorded season in a
 * real competition are treated as askable subjects; the rest still matter as the
 * far end of a career path, which is why they are imported at all.
 */
export function notableClubNames(teams: TeamRow[]): Set<string> {
  // competition_priority is non-null exactly when the club has a team_seasons
  // row, which is what distinguishes "played in a competition we harvested"
  // from "appeared as the other end of a transfer".
  return new Set(teams.filter((t) => t.competition_priority !== null).map((t) => display(t)));
}

/**
 * Cup competitions a club has played in, keyed by club name.
 *
 * Used to put a career question in scope for the competitions its clubs
 * contested. This is a scope, never a category: "which club did X join from
 * Real Madrid" is a transfer question, and calling it a Champions League question
 * would be relabelling. But someone who picked a Champions League quiz is asking
 * about that world, and a move between two clubs who played in it belongs there —
 * which is the only way the filter reaches beyond the handful of finals.
 */
export type CupScopesByClub = Map<string, string[]>;

function cupScopesFor(
  cupScopes: CupScopesByClub | undefined,
  ...clubNames: (string | null | undefined)[]
): KnowledgeQuestion["scopes"] {
  if (!cupScopes) return [];
  const codes = new Set<string>();
  for (const name of clubNames) {
    if (!name) continue;
    for (const code of cupScopes.get(name) ?? []) codes.add(code);
  }
  return [...codes].sort().map((value) => ({ type: "COMPETITION" as const, value }));
}

/**
 * Shared options for every generator here.
 *
 * `context` is mandatory and first-class. A generator without it cannot know
 * whether "Japan" is a club, and every bug this phase fixed came from one that
 * did not have to know.
 */
export interface GeneratorOptions {
  context: FootballContext;
  cupScopes?: CupScopesByClub;
  clubFacts?: ClubFactsByName;
  /** Caps the fan-out of generators that produce pairs. */
  maxPerClub?: number;
  /** Club countries by team id, for the "never played for" separation rule. */
  clubCountryById?: Map<number, string | null>;
}

/**
 * Club transfers, in both directions.
 *
 * THE RULE: CLUB → CLUB, and nothing else. Both ends are looked up in the
 * context and must come back as askable clubs; a national team, a reserve side,
 * a youth team or an unclassified name drops the question. Measured against
 * production, that alone removes the 2,291 questions whose options included a
 * national team — and it removes them by construction rather than by a filter
 * somebody has to remember to apply.
 *
 * LOANS ARE NO LONGER DISCARDED. They used to be, on the grounds that "a loan is
 * not a clean 'moved to' fact" — which is true of the wording, not of the fact.
 * A loan is a perfectly good question when it is called one, so the wording is
 * chosen from the movement kind (see career.MOVEMENT_QUESTION_HE) and a loan
 * asks "לאיזו קבוצה הושאל". A blank provider `transfer_type`, which is common,
 * gets the neutral "הגיע" rather than claiming a permanent move nobody verified.
 */
function generateMoveQuestions(
  direction: "TO" | "FROM",
  transfers: TransferRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context, cupScopes, clubFacts } = options;
  const otherFacts = (names: readonly string[]): ClubHintFacts[] =>
    names.map((nm) => clubFacts?.get(nm) ?? {});

  for (const transfer of transfers) {
    if (!transfer.from_team_name || !transfer.to_team_name) continue;
    if (transfer.from_team_name === transfer.to_team_name) continue;

    const from = askableClub(context, transfer.from_team_name);
    const to = askableClub(context, transfer.to_team_name);
    if (!from || !to) continue;

    const answerClub = direction === "TO" ? to : from;
    const namedClub = direction === "TO" ? from : to;

    const year = transfer.transfer_date ? Number(transfer.transfer_date.slice(0, 4)) : null;
    const archetype: Archetype = direction === "TO" ? "TRANSFER_TO" : "TRANSFER_FROM";
    const seedKey =
      direction === "TO"
        ? `KB_TRANSFER_TO:${transfer.player_id}:${transfer.to_team_id}:${year ?? "-"}`
        : `KB_TRANSFER_FROM:${transfer.player_id}:${transfer.from_team_id}:${year ?? "-"}`;

    const player = context.playerByName.get(transfer.player_name) ?? null;
    const tier = weakestTier(from.tier, to.tier);
    const facts: QuestionFacts = {
      subjectFame: player?.fame,
      entityProminence: leastProminent(from.prominence, to.prominence),
      tier,
      year,
      factProminence: factProminence({
        subjectFame: player?.fame,
        bestClubProminence: mostProminent(from.prominence, to.prominence),
        worstClubProminence: leastProminent(from.prominence, to.prominence),
        tier,
        year,
      }),
      // A stored transfer row is a direct provider fact about both ends.
      factConfidence: "HIGH",
    };

    const built = build({
      archetype,
      answer: toClubCandidate(answerClub),
      pool: context.clubPool,
      seedKey,
      // The club named in the question is not a wrong answer, it is a given.
      exclude: [namedClub.name, namedClub.displayName],
      facts,
    });
    if (!built) continue;

    const movement = classifyMovement(transfer.transfer_type);
    const when = whenHe(year);
    const questionHe =
      direction === "TO"
        ? MOVEMENT_QUESTION_HE[movement].to(transfer.player_name, namedClub.name, when)
        : MOVEMENT_QUESTION_HE[movement].from(transfer.player_name, namedClub.name, when);

    out.push({
      semanticKey: seedKey,
      mode: "CLASSIC",
      category: "TRANSFERS",
      difficulty: built.difficulty,
      questionHe,
      explanationHe: MOVEMENT_EXPLANATION_HE[movement](
        transfer.player_name,
        from.name,
        to.name,
        when
      ),
      options: built.options,
      correctIndex: 0,
      scopes: [
        { type: "REGION", value: "WORLD" },
        ...cupScopesFor(cupScopes, transfer.from_team_name, transfer.to_team_name),
      ],
      sourceLabel: "מסד נתוני העברות מיובא",
      freeText: true,
      canonicalAnswer: answerClub.name,
      aliases: [answerClub.name],
      // The question already names the other club and the year, so hints are
      // about the club being asked for.
      hintCandidates: [
        ...clubHintCandidates(
          clubFacts?.get(answerClub.name) ?? {},
          otherFacts(built.options.slice(1))
        ),
        ...transferTypeHint(transfer.transfer_type),
      ],
      ...built.facts,
      movement,
    });
  }
  return out;
}

/** "Which club did X move to from Y?" — from player_transfers. */
export function generateTransferQuestions(
  transfers: TransferRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  return generateMoveQuestions("TO", transfers, options);
}

/**
 * "Which player's career path is this?" — from ordered transfer chains.
 *
 * A CLUB career path contains clubs. That sounds like a tautology and was not
 * true: the path was built from raw transfer rows, so a national-team appearance
 * or a B-team spell went straight onto the list of clues, and 50 active
 * questions showed a reserve side as the first stop in a career. Both ends of
 * every move are now resolved through the context and anything that is not an
 * askable club is dropped from the path — not substituted, dropped, because a
 * path with a hole in it is still a correct ordered subset of the career, which
 * is all this mode ever claimed to show.
 *
 * International football is a separate thing worth asking about. It is not this
 * mode, and mixing it in here is what made it look like a bug rather than a
 * feature.
 */
export function generateCareerPaths(
  transfersByPlayer: Map<number, TransferRow[]>,
  playerPool: PlayerRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context, cupScopes, clubFacts } = options;
  const playerById = new Map(playerPool.map((p) => [p.id, p]));

  // Distractors are other players we hold a career for, typed as players so the
  // engine can rank them by fame rather than by nothing at all.
  const playerCandidates = playerPool
    .map((p) => context.playerByName.get(display(p)) ?? context.playerByName.get(p.name))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map(toPlayerCandidate);

  for (const [playerId, transfers] of transfersByPlayer) {
    // Ordering must be certain: every move needs a date.
    if (transfers.some((t) => !t.transfer_date)) continue;
    const ordered = [...transfers].sort((a, b) => (a.transfer_date! < b.transfer_date! ? -1 : 1));
    if (ordered.length < 3) continue;

    const playerName = ordered[0].player_name;
    const path: string[] = [];
    const pushClub = (name: string | null) => {
      const club = askableClub(context, name);
      if (club && club.name !== path[path.length - 1]) path.push(club.name);
    };
    pushClub(ordered[0].from_team_name);
    for (const move of ordered) pushClub(move.to_team_name);
    if (path.length < 3) continue;

    const subject = context.playerByName.get(playerName) ?? null;
    const answer = subject
      ? toPlayerCandidate(subject)
      : ({ text: playerName, type: "PLAYER" as const, prominence: 2.5 } as Candidate);

    const clubProfiles = path.map((name) => context.teamByName.get(name)).filter(Boolean) as TeamProfile[];
    const tier = weakestTier(...clubProfiles.map((c) => c.tier));

    const built = build({
      archetype: "CAREER_PATH",
      answer,
      pool: playerCandidates,
      seedKey: `KB_CAREER_PATH:${playerId}`,
      facts: {
        subjectFame: subject?.fame,
        entityProminence: leastProminent(...clubProfiles.map((c) => c.prominence)),
        tier,
        factProminence: factProminence({
          subjectFame: subject?.fame,
          bestClubProminence: mostProminent(...clubProfiles.map((c) => c.prominence)),
          worstClubProminence: leastProminent(...clubProfiles.map((c) => c.prominence)),
          tier,
        }),
        factConfidence: "HIGH",
      },
    });
    if (!built) continue;

    // Facts for the hints. The clubs themselves are already the clues, so a hint
    // repeating one would be filtered out; these describe the player instead.
    const playerRecord = playerById.get(playerId) ?? null;
    const pathCountries = [
      ...new Set(path.map((club) => clubFacts?.get(club)?.countryName).filter(Boolean)),
    ] as string[];
    const firstSeason = ordered[0].transfer_date ? Number(ordered[0].transfer_date.slice(0, 4)) : null;

    out.push({
      semanticKey: `KB_CAREER_PATH:${playerId}`,
      mode: "CAREER_PATH",
      category: "CAREER_PATH",
      difficulty: built.difficulty,
      questionHe: "של מי מסלול הקריירה הזה?",
      explanationHe: `זהו מסלול הקריירה של ${playerName}.`,
      clues: path,
      options: built.options,
      correctIndex: 0,
      // A career that passed through the competition belongs in its quiz.
      scopes: [{ type: "REGION", value: "WORLD" }, ...cupScopesFor(cupScopes, ...path)],
      sourceLabel: "מסד נתוני העברות מיובא",
      freeText: true,
      canonicalAnswer: playerName,
      aliases: derivePlayerAliases(playerName),
      hintCandidates: [
        // The unit, not a raw provider string: the feed says "Attacker" and a
        // hint reading "העמדה שלו: Attacker" is two scripts and a wrong noun.
        ...hint(1, positionHintHe(context, playerName, playerRecord?.position ?? null)),
        ...hint(1, pathCountries.length >= 2 ? `הקריירה שלו עברה ב${pathCountries.length} מדינות` : null),
        // The first dated move places the career in time, which the club list on
        // screen does not: every career path question has one.
        ...hint(1, firstSeason ? `המעבר הראשון שלו היה בשנת ${firstSeason}` : null),
        ...hint(2, playerRecord?.nationality ? `הלאום שלו: ${countryHe(playerRecord.nationality) ?? playerRecord.nationality}` : null),
      ],
      ...built.facts,
    });
  }
  return out;
}

/**
 * A player's position as a Hebrew hint, at whatever precision is established.
 *
 * Returns the unit ("הוא שחקן התקפה") for broad evidence and the role ("התפקיד
 * שלו: קיצוני ימני") only where a role is actually known. Never the provider's
 * own word, which is English and is a category rather than a position.
 */
function positionHintHe(
  context: FootballContext,
  playerName: string,
  rawPosition: string | null
): string | null {
  const resolved = context.playerByName.get(playerName)?.position;
  if (resolved?.detailed && (resolved.confidence === "HIGH" || resolved.confidence === "MEDIUM")) {
    return `התפקיד שלו: ${DETAILED_HE[resolved.detailed]}`;
  }
  const broad = resolved?.broad ?? null;
  // "הוא שחקן שוער" is not Hebrew. A keeper is named, not described by his unit.
  if (broad === "GOALKEEPER") return "הוא שוער";
  if (broad) return `הוא שחקן ${BROAD_HE[broad]}`;
  // Nothing resolved — say nothing rather than echo the provider.
  void rawPosition;
  return null;
}

/**
 * "Which stadium does club X play at?" — from teams + venues.
 *
 * The subject must be an askable club: a national team does not have a home
 * ground in the sense this question means, and a reserve side usually shares its
 * parent's, which makes the answer ambiguous rather than wrong.
 */
export function generateVenueQuestions(
  teams: TeamRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const { context } = options;
  const withVenue = teams.filter((t) => t.venue_name && askableClub(context, t.name));
  // Stadium candidates, typed. Prominence is inherited from the club that plays
  // there, so the Bernabéu is not offered beside three fourth-division grounds.
  const venuePool: Candidate[] = [];
  const seenVenues = new Set<string>();
  for (const team of withVenue) {
    const name = team.venue_name!;
    if (seenVenues.has(name)) continue;
    seenVenues.add(name);
    const club = context.teamByName.get(team.name);
    venuePool.push({
      text: name,
      type: "STADIUM",
      prominence: club?.prominence,
      country: team.country_name ?? null,
      competitionCode: team.local_code ?? null,
    });
  }
  if (venuePool.length < 4) return [];

  const out: KnowledgeQuestion[] = [];
  for (const team of withVenue) {
    const club = context.teamByName.get(team.name)!;
    const answer = venuePool.find((v) => v.text === team.venue_name);
    if (!answer) continue;

    const built = build({
      archetype: "CLUB_STADIUM",
      answer,
      pool: venuePool,
      seedKey: `KB_VENUE:${team.id}`,
      facts: {
        entityProminence: club.prominence,
        tier: club.tier,
        factProminence: factProminence({ bestClubProminence: club.prominence, tier: club.tier }),
        factConfidence: "HIGH",
      },
    });
    if (!built) continue;

    out.push({
      semanticKey: `KB_TEAM_VENUE:${team.id}`,
      mode: "CLASSIC",
      category: "STADIUMS",
      difficulty: built.difficulty,
      questionHe: `באיזה אצטדיון משחקת ${display(team)} את משחקי הבית שלה?`,
      explanationHe: `${display(team)} משחקת ${hePrefix("ב", team.venue_name!)}.`,
      options: built.options,
      correctIndex: 0,
      scopes: scopesForCompetition(team.local_code, team.country_name),
      sourceLabel: "מסד נתוני מועדונים מיובא",
      freeText: true,
      canonicalAnswer: team.venue_name!,
      aliases: [team.venue_name!],
      hintCandidates: [
        ...hint(1, regionOf(team.country_name) ? `האצטדיון נמצא ב${regionOf(team.country_name)}` : null),
        ...hint(2, countryHe(team.country_name) ? `האצטדיון נמצא ב${countryHe(team.country_name)}` : null),
        ...hint(2, competitionHe(team.local_code) ? `הקבוצה משחקת ב${competitionHe(team.local_code)}` : null),
      ],
      ...built.facts,
    });
  }
  return out;
}

/** "Which competition did X win?" — from player_trophies. */
export function generateTrophyQuestions(
  trophies: TrophyRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const { context } = options;
  const winners = trophies.filter((t) => (t.place ?? "").toLowerCase() === "winner" && t.competition_name);
  const competitionPool: Candidate[] = [];
  const seen = new Set<string>();
  for (const t of winners) {
    if (seen.has(t.competition_name)) continue;
    seen.add(t.competition_name);
    competitionPool.push({
      text: t.competition_name,
      type: "COMPETITION",
      country: t.country_name ?? null,
    });
  }
  if (competitionPool.length < 4) return [];

  const out: KnowledgeQuestion[] = [];
  // Only ask when the player won exactly one competition in that season, so
  // the answer cannot be ambiguous.
  const bySeasonPlayer = new Map<string, TrophyRow[]>();
  for (const t of winners) {
    const key = `${t.player_id}:${t.season ?? "-"}`;
    bySeasonPlayer.set(key, [...(bySeasonPlayer.get(key) ?? []), t]);
  }

  for (const [key, rows] of bySeasonPlayer) {
    if (rows.length !== 1) continue;
    const row = rows[0];
    if (!row.season) continue;

    const player = context.playerByName.get(row.player_name) ?? null;
    const answer = competitionPool.find((c) => c.text === row.competition_name)!;
    const seasonYear = Number(String(row.season).slice(0, 4));

    const built = build({
      archetype: "PLAYER_TROPHY",
      answer,
      pool: competitionPool,
      seedKey: `KB_TROPHY:${key}`,
      facts: {
        subjectFame: player?.fame,
        year: Number.isFinite(seasonYear) ? seasonYear : null,
        factConfidence: "HIGH",
      },
    });
    if (!built) continue;

    out.push({
      semanticKey: `KB_TROPHY_PLAYER:${row.player_id}:${row.competition_name}:${row.season}`,
      mode: "CLASSIC",
      category: "TITLES",
      difficulty: built.difficulty,
      questionHe: `באיזו תחרות זכה ${row.player_name} בעונת ${row.season}?`,
      explanationHe: `${row.player_name} זכה ${hePrefix("ב", row.competition_name)} בעונת ${row.season}.`,
      options: built.options,
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני תארים מיובא",
      freeText: false,
      hintCandidates: [
        ...hint(2, countryHe(row.country_name) ? `התחרות מתקיימת ב${countryHe(row.country_name)}` : null),
      ],
      ...built.facts,
    });
  }
  return out;
}

const yearOf = (date: string | null): number | null => {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
};

/**
 * Managers — from coaches + coach_teams.
 *
 * Both directions are asked, and each is only asked where the stored spells make
 * the answer unique: a coach who held two jobs in the same calendar year has no
 * single club for "which club did he manage in 2019", and a club that changed
 * manager mid-season has no single manager for that year. Those are dropped
 * rather than guessed at, which is why a sacking season produces no question.
 */
export function generateManagerQuestions(
  spells: CoachSpellRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context, clubFacts } = options;
  // A spell at a reserve or youth side is a real job and a bad question: the
  // answer is a team the player has never heard of and would not recognise even
  // if told. Those are dropped; national-team spells are kept and asked
  // separately, because "which country did he manage" is its own question.
  const dated = spells.filter(
    (s) =>
      s.team_name &&
      s.coach_name &&
      s.start_date &&
      (askableClub(context, s.team_name) || nationalTeam(context, s.team_name))
  );
  const otherClubFacts = (names: readonly string[]): ClubHintFacts[] =>
    names.map((nm) => clubFacts?.get(nm) ?? {});

  // Another club the same coach held, which is the strongest hint available about
  // a manager without naming him.
  const clubsByCoach = new Map<number, string[]>();
  for (const spell of dated) {
    const held = clubsByCoach.get(spell.coach_id) ?? [];
    if (!held.includes(spell.team_name)) held.push(spell.team_name);
    clubsByCoach.set(spell.coach_id, held);
  }
  const otherClubOf = (row: CoachSpellRow): string | null =>
    (clubsByCoach.get(row.coach_id) ?? []).find((name) => name !== row.team_name) ?? null;

  const coachNames = [...new Set(dated.map((s) => s.coach_name))];
  const clubNames = [...new Set(dated.map((s) => s.team_name))];
  if (coachNames.length < 4 || clubNames.length < 4) return out;

  // Which clubs a coach held in a given year, used for the uniqueness test
  // below rather than as a question source in its own right.
  const clubsByCoachYear = new Map<string, Set<string>>();
  const coachesByClubYear = new Map<string, Set<string>>();
  const spellYears = (spell: CoachSpellRow): number[] => {
    const start = yearOf(spell.start_date)!;
    const end = yearOf(spell.end_date) ?? start;
    const years: number[] = [];
    for (let year = start; year <= Math.min(end, start + 12); year++) years.push(year);
    return years;
  };

  for (const spell of dated) {
    for (const year of spellYears(spell)) {
      const byCoach = clubsByCoachYear.get(`${spell.coach_id}:${year}`) ?? new Set<string>();
      byCoach.add(spell.team_name);
      clubsByCoachYear.set(`${spell.coach_id}:${year}`, byCoach);

      const byClub = coachesByClubYear.get(`${spell.team_id}:${year}`) ?? new Set<string>();
      byClub.add(spell.coach_name);
      coachesByClubYear.set(`${spell.team_id}:${year}`, byClub);
    }
  }

  /**
   * One question per spell, not per year of it.
   *
   * Asking about every year a manager stayed somewhere turns a four-season spell
   * into four questions with the same answer, which pads the bank without adding
   * anything to know. The spell is the fact; a single representative year is
   * enough to state it, and the year chosen is the first one where the answer is
   * unambiguous.
   */
  const spellKey = (spell: CoachSpellRow) => `${spell.coach_id}:${spell.team_id}:${spell.start_date}`;
  const seenSpells = new Set<string>();

  // Coach candidates, typed. A coach pool has no prominence signal available, so
  // the engine ranks them by nationality and nothing else — which is honest:
  // this is the one entity in the model we hold no fame data for.
  const coachPool: Candidate[] = coachNames.map((name) => ({
    text: name,
    type: "COACH",
    country: dated.find((s) => s.coach_name === name)?.nationality ?? null,
  }));

  // "Which club / which country did <coach> manage in <year>?"
  for (const spell of dated) {
    const key = spellKey(spell);
    if (seenSpells.has(key)) continue;

    const year = spellYears(spell).find(
      (candidate) => clubsByCoachYear.get(`${spell.coach_id}:${candidate}`)?.size === 1
    );
    if (year === undefined) continue; // every year of this spell overlapped another job
    seenSpells.add(key);
    const row = spell;

    const club = askableClub(context, row.team_name);
    const country = club ? null : nationalTeam(context, row.team_name);
    const team = club ?? country;
    if (!team) continue;

    const archetype: Archetype = club ? "COACH_CLUB" : "COACH_NATIONAL_TEAM";
    const built = build({
      archetype,
      answer: club ? toClubCandidate(club) : toNationalCandidate(country!),
      pool: club ? context.clubPool : context.nationalTeamPool,
      seedKey: `KB_COACH_CLUB:${row.coach_id}:${year}`,
      facts: {
        entityProminence: team.prominence,
        tier: team.tier,
        year,
        factProminence: factProminence({ bestClubProminence: team.prominence, tier: team.tier, year }),
        factConfidence: "HIGH",
      },
    });
    if (!built) continue;

    out.push({
      semanticKey: `KB_COACH_CLUB:${row.coach_id}:${row.team_id}`,
      mode: "CLASSIC",
      category: "COACHES",
      difficulty: built.difficulty,
      questionHe: club
        ? `את איזו קבוצה אימן ${row.coach_name} בשנת ${year}?`
        : `את איזו נבחרת אימן ${row.coach_name} בשנת ${year}?`,
      explanationHe: `${row.coach_name} אימן את ${team.name} בשנת ${year}.`,
      options: built.options,
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני מאמנים מיובא",
      freeText: true,
      canonicalAnswer: team.name,
      aliases: [team.name],
      hintCandidates: [
        ...hint(1, countryHe(row.nationality) ? `הלאום של המאמן: ${countryHe(row.nationality)}` : null),
        ...clubHintCandidates(clubFacts?.get(team.name) ?? {}, otherClubFacts(built.options.slice(1))),
      ],
      ...built.facts,
    });
  }

  // "Who managed <club> in <year>?" — the same one-per-spell rule, per club.
  const seenClubSpells = new Set<string>();
  for (const spell of dated) {
    const key = spellKey(spell);
    if (seenClubSpells.has(key)) continue;

    const year = spellYears(spell).find(
      (candidate) => coachesByClubYear.get(`${spell.team_id}:${candidate}`)?.size === 1
    );
    if (year === undefined) continue; // the club changed manager in every year of it
    seenClubSpells.add(key);
    const row = spell;

    const team = askableClub(context, row.team_name) ?? nationalTeam(context, row.team_name);
    if (!team) continue;

    const built = build({
      archetype: "CLUB_COACH",
      answer: { text: row.coach_name, type: "COACH", country: row.nationality ?? null },
      pool: coachPool,
      seedKey: `KB_CLUB_COACH:${row.team_id}:${year}`,
      facts: {
        entityProminence: team.prominence,
        tier: team.tier,
        year,
        factProminence: factProminence({ bestClubProminence: team.prominence, tier: team.tier, year }),
        factConfidence: "HIGH",
      },
    });
    if (!built) continue;

    out.push({
      semanticKey: `KB_CLUB_COACH:${row.team_id}:${row.coach_id}`,
      mode: "CLASSIC",
      category: "COACHES",
      difficulty: built.difficulty,
      questionHe: `מי אימן את ${team.name} בשנת ${year}?`,
      explanationHe: `${row.coach_name} אימן את ${team.name} בשנת ${year}.`,
      options: built.options,
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני מאמנים מיובא",
      freeText: true,
      canonicalAnswer: row.coach_name,
      aliases: derivePlayerAliases(row.coach_name),
      hintCandidates: [
        ...hint(1, countryHe(row.nationality) ? `הלאום שלו: ${countryHe(row.nationality)}` : null),
        ...hint(3, otherClubOf(row) ? `הוא אימן גם את ${otherClubOf(row)}` : null),
      ],
      ...built.facts,
    });
  }

  return out;
}

/**
 * Indexes the player-at-club table once; several generators below share it.
 *
 * CLUBS ONLY. The table holds whatever relationship was imported — a squad
 * listing, a transfer, a scoring record — and some of those are national-team
 * call-ups and reserve-side appearances. Letting them in put national teams into
 * the Club Connection pool and reserve sides into career paths, so the filter
 * lives here, once, at the point where the index is built. International
 * appearances are kept separately rather than discarded: they are a real fact
 * and the material for a future international mode.
 */
interface CareerIndex {
  clubsByPlayer: Map<number, Set<number>>;
  playersByClub: Map<number, number[]>;
  playerById: Map<number, PlayerTeamRow>;
  clubNameById: Map<number, string>;
  /** Countries a player has a club in, where the club's country is known. */
  countriesByPlayer: Map<number, Set<string>>;
  /** Earliest recorded year at any club — NOT a career start. See football/career.ts. */
  firstYearByPlayer: Map<number, number>;
  /** Senior national teams on record, by player. Never mixed into the club career. */
  nationalTeamsByPlayer: Map<number, Set<string>>;
  /** Rows dropped as non-club, by team kind — reported by the audit. */
  droppedByKind: Record<string, number>;
}

export function indexCareers(rows: PlayerTeamRow[], context?: FootballContext): CareerIndex {
  const clubsByPlayer = new Map<number, Set<number>>();
  const playersByClub = new Map<number, number[]>();
  const playerById = new Map<number, PlayerTeamRow>();
  const clubNameById = new Map<number, string>();
  const countriesByPlayer = new Map<number, Set<string>>();
  const firstYearByPlayer = new Map<number, number>();
  const nationalTeamsByPlayer = new Map<number, Set<string>>();
  const droppedByKind: Record<string, number> = {};

  for (const row of rows) {
    if (!row.player_name || !row.team_name) continue;

    if (context) {
      const profile = context.teamByName.get(row.team_name);
      if (!profile || profile.kind !== "CLUB") {
        const kind = profile?.kind ?? "UNCLASSIFIED";
        droppedByKind[kind] = (droppedByKind[kind] ?? 0) + 1;
        if (kind === "NATIONAL_TEAM") {
          const teams = nationalTeamsByPlayer.get(row.player_id) ?? new Set<string>();
          teams.add(row.team_name);
          nationalTeamsByPlayer.set(row.player_id, teams);
        }
        // The player's own attributes are still worth keeping even when this
        // particular row is not a club spell.
        if (!playerById.has(row.player_id)) playerById.set(row.player_id, row);
        continue;
      }
    }

    clubNameById.set(row.team_id, row.team_name);

    if (row.country_name) {
      const countries = countriesByPlayer.get(row.player_id) ?? new Set<string>();
      countries.add(row.country_name);
      countriesByPlayer.set(row.player_id, countries);
    }
    const year = row.season ?? (row.start_date ? Number(row.start_date.slice(0, 4)) : null);
    if (year && Number.isFinite(year)) {
      const existing = firstYearByPlayer.get(row.player_id);
      if (existing === undefined || year < existing) firstYearByPlayer.set(row.player_id, year);
    }
    if (!playerById.has(row.player_id)) playerById.set(row.player_id, row);
    else {
      // Keep whichever row actually carries attributes; a stub created by a
      // transfer has neither position nor nationality.
      const existing = playerById.get(row.player_id)!;
      if (!existing.position && row.position) existing.position = row.position;
      if (!existing.nationality && row.nationality) existing.nationality = row.nationality;
    }

    const clubs = clubsByPlayer.get(row.player_id) ?? new Set<number>();
    if (!clubs.has(row.team_id)) {
      clubs.add(row.team_id);
      clubsByPlayer.set(row.player_id, clubs);
      playersByClub.set(row.team_id, [...(playersByClub.get(row.team_id) ?? []), row.player_id]);
    }
  }
  return {
    clubsByPlayer,
    playersByClub,
    playerById,
    clubNameById,
    countriesByPlayer,
    firstYearByPlayer,
    nationalTeamsByPlayer,
    droppedByKind,
  };
}

/**
 * Club Connection — "at which club did both of these players play?"
 *
 * The distractors are the safety mechanism here, and they are chosen as clubs
 * *neither* player is known to have played for. That matters because our view of
 * a career is only as complete as what has been harvested: if the pair in fact
 * shared a second club nobody has imported yet, an answer keyed to one shared
 * club would be marking a true answer wrong. Excluding every club either player
 * touched means the four options on screen still contain exactly one right
 * answer, whatever is missing from the database.
 */
export function generateClubConnections(
  careers: CareerIndex,
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context, cupScopes, clubFacts } = options;
  const maxPerClub = options.maxPerClub ?? 6;

  // The index already holds clubs only (see indexCareers), so this is a pool of
  // askable clubs by construction rather than by a notability filter applied here.
  const clubIds = [...careers.clubNameById.keys()].filter((id) =>
    askableClub(context, careers.clubNameById.get(id)!)
  );
  if (clubIds.length < 4) return out;

  for (const [clubId, playerIds] of careers.playersByClub) {
    const clubName = careers.clubNameById.get(clubId);
    const club = askableClub(context, clubName);
    if (!club) continue;

    // Players whose careers we know something about make better puzzles, and
    // the "well known" proxy available here is simply how many clubs we hold.
    const ranked = playerIds
      .filter((id) => (careers.clubsByPlayer.get(id)?.size ?? 0) >= 2)
      .sort(
        (a, b) =>
          (careers.clubsByPlayer.get(b)?.size ?? 0) - (careers.clubsByPlayer.get(a)?.size ?? 0) ||
          a - b
      )
      .slice(0, 14);
    if (ranked.length < 2) continue;

    let made = 0;
    for (let i = 0; i < ranked.length && made < maxPerClub; i++) {
      for (let j = i + 1; j < ranked.length && made < maxPerClub; j++) {
        const [aId, bId] = [ranked[i], ranked[j]];
        const a = careers.playerById.get(aId);
        const b = careers.playerById.get(bId);
        if (!a || !b || a.player_name === b.player_name) continue;

        const aClubs = careers.clubsByPlayer.get(aId)!;
        const bClubs = careers.clubsByPlayer.get(bId)!;
        const touched = new Set([...aClubs, ...bClubs]);

        // Distractors are clubs NEITHER player is known to have played for. Our
        // view of a career is only as complete as what has been harvested, so if
        // the pair in fact shared a second club nobody imported, an answer keyed
        // to one shared club would mark a true answer wrong. Excluding every club
        // either player touched means the four options still contain exactly one
        // right answer, whatever is missing from the database.
        const pool = teamPoolOfType(
          context,
          clubIds.filter((id) => !touched.has(id)).map((id) => careers.clubNameById.get(id)!),
          "CLUB"
        );

        const famePair = [
          context.playerByName.get(a.player_name)?.fame,
          context.playerByName.get(b.player_name)?.fame,
        ];
        const built = build({
          archetype: "CLUB_CONNECTION_CLUB",
          answer: toClubCandidate(club),
          pool,
          seedKey: `KB_CLUB_CONNECTION:${clubId}:${aId}:${bId}`,
          facts: {
            // The player has to recognise BOTH names, so the harder of the two
            // is what the question actually costs.
            subjectFame: leastProminent(...famePair),
            entityProminence: club.prominence,
            tier: club.tier,
            factProminence: factProminence({
              subjectFame: leastProminent(...famePair),
              bestClubProminence: club.prominence,
              tier: club.tier,
            }),
            factConfidence: "HIGH",
          },
        });
        if (!built) continue;

        made++;
        out.push({
          semanticKey: `KB_CLUB_CONNECTION:${clubId}:${Math.min(aId, bId)}:${Math.max(aId, bId)}`,
          mode: "CLUB_CONNECTION",
          category: "CAREERS",
          difficulty: built.difficulty,
          questionHe: `באיזה מועדון שיחקו גם ${a.player_name} וגם ${b.player_name}?`,
          explanationHe: `גם ${a.player_name} וגם ${b.player_name} שיחקו ${hePrefix("ב", club.name)}.`,
          clues: [a.player_name, b.player_name],
          options: built.options,
          correctIndex: 0,
          scopes: [
            { type: "REGION", value: "WORLD" },
            ...cupScopesFor(cupScopes, club.name),
          ],
          sourceLabel: "מסד נתוני קריירות מיובא",
          freeText: true,
          canonicalAnswer: club.name,
          aliases: [club.name],
          hintCandidates: [
            ...hint(1, `בקריירה של ${a.player_name} היו ${aClubs.size} מועדונים`),
            ...clubHintCandidates(
              clubFacts?.get(club.name) ?? {},
              built.options.slice(1).map((nm) => clubFacts?.get(nm) ?? {})
            ),
          ],
          ...built.facts,
        });
      }
    }
  }
  return out;
}

/**
 * Who Am I — a player named from their position and the clubs they played for.
 *
 * Nationality is used when it is known but is not required, because on this
 * provider it usually is not: /players/squads returns a position for every player
 * and no nationality at all, so demanding both produced a generator that could
 * never fire. The career itself carries most of the identifying information
 * anyway — a run of three or more clubs narrows a player down far more sharply
 * than a passport does.
 *
 * The clue set still has to single the player out: if any other candidate shares
 * the position, the nationality where known, and every club listed, the puzzle
 * has two answers and is dropped. Two team-mates of the same position who moved
 * together are exactly the case this catches.
 */
export function generateWhoAmI(
  careers: CareerIndex,
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context } = options;

  /**
   * What is known about a player beyond the bare list of their clubs.
   *
   * At least one of these is required. Without that rule the puzzle degenerates
   * into "my clubs were A, B and C" — which is Career Path wearing a different
   * hat, and the bank gains a near-duplicate of a question it already has rather
   * than a new one. Requiring *position specifically*, as this once did, was the
   * opposite failure: the provider's squad feed carries no nationality at all and
   * a position for only a few hundred players, so 46 of 1,675 eligible careers
   * qualified and the mode stayed empty.
   */
  const attributesOf = (p: PlayerTeamRow) => {
    const countries = [...(careers.countriesByPlayer.get(p.player_id) ?? [])].sort();
    const firstYear = careers.firstYearByPlayer.get(p.player_id);
    return {
      position: p.position ?? null,
      nationality: p.nationality ?? null,
      // Two or more is the interesting fact — one country is just "played at home".
      countries: countries.length >= 2 ? countries : [],
      firstYear: firstYear ?? null,
    };
  };

  const candidates = [...careers.playerById.values()].filter((p) => {
    if ((careers.clubsByPlayer.get(p.player_id)?.size ?? 0) < 3) return false;
    const a = attributesOf(p);
    return Boolean(a.position || a.nationality || a.countries.length > 0);
  });
  if (candidates.length < 4) return out;

  const namesByPosition = new Map<string, string[]>();
  for (const p of careers.playerById.values()) {
    if (!p.position) continue;
    namesByPosition.set(p.position, [...(namesByPosition.get(p.position) ?? []), p.player_name]);
  }
  // Fallback distractor pool: players with a career of comparable length, so the
  // options are alike even when nobody's position is on record.
  const namesWithCareers = candidates.map((p) => p.player_name);

  for (const player of candidates) {
    const clubIds = [...careers.clubsByPlayer.get(player.player_id)!];
    const clubNames = clubIds.map((id) => careers.clubNameById.get(id)!).filter(Boolean).sort();
    if (clubNames.length < 3) continue;
    const attrs = attributesOf(player);

    // The clue set must single this player out. Anyone matching every stated
    // attribute *and* holding all the listed clubs is a second valid answer.
    const ambiguous = candidates.some((other) => {
      if (other.player_id === player.player_id) return false;
      const theirs = attributesOf(other);
      if (attrs.position && theirs.position !== attrs.position) return false;
      if (attrs.nationality && theirs.nationality !== attrs.nationality) return false;
      if (attrs.countries.length > 0) {
        const theirCountries = new Set(theirs.countries);
        if (!attrs.countries.every((c) => theirCountries.has(c))) return false;
      }
      return clubIds.every((id) => careers.clubsByPlayer.get(other.player_id)?.has(id));
    });
    if (ambiguous) continue;

    const poolNames = (
      attrs.position ? (namesByPosition.get(attrs.position) ?? []) : namesWithCareers
    ).filter((n) => n !== player.player_name);
    const pool = poolNames
      .map((name) => context.playerByName.get(name))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map(toPlayerCandidate);

    const subject = context.playerByName.get(player.player_name) ?? null;
    const clubProfiles = clubNames
      .map((name) => context.teamByName.get(name))
      .filter(Boolean) as TeamProfile[];
    const tier = weakestTier(...clubProfiles.map((c) => c.tier));

    const built = build({
      archetype: "WHO_AM_I",
      answer: subject
        ? toPlayerCandidate(subject)
        : ({ text: player.player_name, type: "PLAYER", prominence: 2.6 } as Candidate),
      pool,
      seedKey: `KB_WHO_AM_I:${player.player_id}`,
      facts: {
        subjectFame: subject?.fame,
        entityProminence: leastProminent(...clubProfiles.map((c) => c.prominence)),
        tier,
        factProminence: factProminence({
          subjectFame: subject?.fame,
          bestClubProminence: mostProminent(...clubProfiles.map((c) => c.prominence)),
          worstClubProminence: leastProminent(...clubProfiles.map((c) => c.prominence)),
          tier,
        }),
        factConfidence: "HIGH",
      },
    });
    if (!built) continue;

    /*
      THE POSITION CLUE.

      It used to read "העמדה שלי: Attacker" — the provider's English word for a
      unit, presented as a position. Two problems in one clue: it is not Hebrew,
      and "Attacker" is not a position. Now it states the unit in Hebrew, and
      states a precise role only where one is actually established.
    */
    const positionClue =
      subject?.position.detailed &&
      (subject.position.confidence === "HIGH" || subject.position.confidence === "MEDIUM")
        ? `התפקיד שלי: ${DETAILED_HE[subject.position.detailed]}`
        : subject?.position.broad === "GOALKEEPER"
          ? "אני שוער"
          : subject?.position.broad
            ? `אני משחק בחוליית ה${BROAD_HE[subject.position.broad]}`
            : null;

    const clues = [
      ...(attrs.nationality
        ? [`הלאום שלי: ${countryHe(attrs.nationality) ?? attrs.nationality}`]
        : []),
      ...(positionClue ? [positionClue] : []),
      ...(attrs.countries.length > 0
        ? [`שיחקתי בליגות של: ${attrs.countries.map((c) => countryHe(c) ?? c).join(", ")}`]
        : []),
      // "העונה הראשונה שלי במסד" named the database, not the football. The
      // honest version of the same fact is the earliest season on record.
      ...(attrs.firstYear ? [`העונה המוקדמת ביותר שתועדה לי: ${attrs.firstYear}`] : []),
      `סך המועדונים בקריירה שלי: ${clubNames.length}`,
      `בין המועדונים שלי: ${clubNames.slice(0, 4).join(", ")}`,
    ];

    out.push({
      semanticKey: `KB_WHO_AM_I:${player.player_id}`,
      mode: "WHO_AM_I",
      category: "WHO_AM_I",
      difficulty: built.difficulty,
      questionHe: "מי אני?",
      explanationHe: `התשובה היא ${player.player_name}.`,
      clues,
      options: built.options,
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני שחקנים מיובא",
      freeText: true,
      canonicalAnswer: player.player_name,
      aliases: derivePlayerAliases(player.player_name),
      hintCandidates: [
        ...hint(1, attrs.countries.length >= 2 ? `שיחקתי ב${attrs.countries.length} מדינות שונות` : null),
        ...hint(2, attrs.firstYear ? `העונה המוקדמת שתועדה לי היא ${attrs.firstYear}` : null),
        // A club the clue list did not show is the strongest thing left to give.
        ...hint(3, clubNames.length > 4 ? `שיחקתי גם ${hePrefix("ב", clubNames[clubNames.length - 1])}` : null),
      ],
      ...built.facts,
    });
  }
  return out;
}

/**
 * "Which of these clubs did X never play for?"
 *
 * This is the one generator here that asserts a negative, and a negative can only
 * ever be as good as the record is complete. Two conditions make it defensible:
 *
 *  * The transfers endpoint returns a player's *entire* move history, not just
 *    the spell at the club being queried. So for anyone who passed through a
 *    harvested club, the career on file is the whole career, not a fragment.
 *  * The subject must still have at least five clubs on record. A player with two
 *    is one we happen to know two things about, and the missing years are exactly
 *    where a wrong "never" would hide.
 *
 * Where a club's country is known, the absent club is also required to be from a
 * country the player has no recorded club in, which puts a second, independent
 * barrier in front of the failure that matters: naming a club the player really
 * did turn out for.
 */
export function generateDidNotPlayFor(
  careers: CareerIndex,
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context } = options;
  const countries = options.clubCountryById ?? new Map<number, string | null>();

  const clubIdPool = [...careers.clubNameById.keys()].filter((id) =>
    askableClub(context, careers.clubNameById.get(id)!)
  );
  if (clubIdPool.length < 4) return out;

  for (const [playerId, clubIds] of careers.clubsByPlayer) {
    if (clubIds.size < 5) continue;
    const player = careers.playerById.get(playerId);
    if (!player) continue;

    const played = [...clubIds]
      .map((id) => ({ id, name: careers.clubNameById.get(id) ?? "" }))
      .filter((entry) => askableClub(context, entry.name));
    if (played.length < 3) continue;

    const playedCountries = new Set(
      [...clubIds].map((id) => countries.get(id)).filter((c): c is string => Boolean(c))
    );

    const absentPool = clubIdPool.filter((id) => {
      if (clubIds.has(id)) return false;
      const country = countries.get(id);
      // Unknown country cannot confirm separation, so such a club is not used
      // once we have any country information for this player at all.
      if (playedCountries.size > 0) return Boolean(country) && !playedCountries.has(country!);
      return true;
    });
    if (absentPool.length === 0) continue;

    const answerId = pickDistinct(absentPool, 1, `KB_NEVER_PLAYED:${playerId}`)[0];
    const answerClub = askableClub(context, careers.clubNameById.get(answerId))!;
    const shown = pickDistinct(played.map((p) => p.name), 3, `KB_NEVER_PLAYED_SHOWN:${playerId}`);
    if (shown.length < 3 || shown.includes(answerClub.name)) continue;

    /*
      THE ODD ONE OUT IS THE ANSWER, AND THE THREE SHOWN CLUBS ARE FIXED.

      So this generator cannot delegate its options: the three wrong ones have
      to be clubs the player DID turn out for, which is a property no generic
      pool can supply. What it can delegate is the type check — every one of the
      four is resolved through the context above — and the difficulty, which is
      what it does below.
    */
    const shownProfiles = shown.map((name) => context.teamByName.get(name)!).filter(Boolean);
    const subject = context.playerByName.get(player.player_name) ?? null;
    const tier = weakestTier(answerClub.tier, ...shownProfiles.map((c) => c.tier));
    const { band } = classifyDifficulty({
      archetype: "NOT_PLAYED_FOR",
      subjectFame: subject?.fame,
      entityProminence: leastProminent(answerClub.prominence, ...shownProfiles.map((c) => c.prominence)),
      tier,
      factProminence: factProminence({
        subjectFame: subject?.fame,
        bestClubProminence: mostProminent(...shownProfiles.map((c) => c.prominence)),
        worstClubProminence: leastProminent(...shownProfiles.map((c) => c.prominence)),
        tier,
      }),
      // The three real clubs come from the player's own career, which is as
      // close as a distractor gets.
      distractors: "near",
    });

    out.push({
      semanticKey: `KB_NEVER_PLAYED:${playerId}:${answerId}`,
      mode: "CLASSIC",
      category: "CAREERS",
      difficulty: band,
      questionHe: `באיזו קבוצה מהרשימה ${player.player_name} מעולם לא שיחק?`,
      explanationHe: `${player.player_name} שיחק ${hePrefix("ב", shown.join(", "))}, אך לא ${hePrefix("ב", answerClub.name)}.`,
      options: [answerClub.name, ...shown],
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני קריירות מיובא",
      freeText: false,
      hintCandidates: [
        ...hint(1, `בקריירה שלו היו ${clubIds.size} מועדונים`),
        ...hint(2, playedCountries.size >= 2 ? `הוא שיחק ב${playedCountries.size} מדינות` : null),
      ],
      archetype: "NOT_PLAYED_FOR",
      answerCandidate: toClubCandidate(answerClub),
      distractorCandidates: shownProfiles.map(toClubCandidate),
      factConfidence: "MEDIUM",
      difficultySignals: {
        archetype: "NOT_PLAYED_FOR",
        subjectFame: subject?.fame,
        tier,
        distractors: "near",
      },
    });
  }
  return out;
}

/**
 * Guess The Club — a club named from country, founding year and stadium.
 *
 * Only clubs whose three facts are all stored and jointly unique are used; two
 * clubs sharing a ground, as several city rivals do, cancel each other out.
 */
export function generateGuessTheClub(
  teams: TeamRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context } = options;
  /*
    THE SUBJECT MUST BE A CLUB.

    The question is "איזה מועדון אני?" and 52 active questions answered it with a
    national team — 32 of them with the national team as the correct answer,
    because Qatar and Canada have a country, a founding year and a stadium on
    record exactly like a club does. The three facts were all true; the question
    was still wrong, and no amount of better distractors would have fixed it.
  */
  const usable = teams.filter(
    (t) => t.country_name && t.founded && t.venue_name && askableClub(context, t.name)
  );
  if (usable.length < 4) return out;

  for (const club of usable) {
    const ambiguous = usable.some(
      (other) =>
        other.id !== club.id &&
        other.country_name === club.country_name &&
        other.founded === club.founded &&
        other.venue_name === club.venue_name
    );
    if (ambiguous) continue;

    const profile = context.teamByName.get(club.name)!;
    const built = build({
      archetype: "GUESS_THE_CLUB",
      answer: toClubCandidate(profile),
      // Same-country clubs rank highest through the plausibility axes, so the
      // believable wrong answers come out first without a special case here.
      pool: teamPoolOfType(context, usable.map((t) => t.name), "CLUB"),
      seedKey: `KB_GUESS_CLUB:${club.id}`,
      facts: {
        entityProminence: profile.prominence,
        tier: profile.tier,
        factProminence: factProminence({ bestClubProminence: profile.prominence, tier: profile.tier }),
        factConfidence: "HIGH",
      },
    });
    if (!built) continue;

    out.push({
      semanticKey: `KB_GUESS_CLUB:${club.id}`,
      mode: "GUESS_THE_CLUB",
      category: "GUESS_THE_CLUB",
      difficulty: built.difficulty,
      questionHe: "איזה מועדון אני?",
      explanationHe: `התשובה היא ${display(club)}.`,
      clues: [
        `המדינה שלי: ${countryHe(club.country_name) ?? club.country_name}`,
        `נוסדתי בשנת ${club.founded}`,
        `האצטדיון שלי: ${club.venue_name}`,
      ],
      options: built.options,
      correctIndex: 0,
      scopes: scopesForCompetition(club.local_code, club.country_name),
      sourceLabel: "מסד נתוני מועדונים מיובא",
      freeText: true,
      canonicalAnswer: club.name,
      aliases: deriveTeamAliases(club),
      hintCandidates: [
        ...hint(1, regionOf(club.country_name) ? `אני מ${regionOf(club.country_name)}` : null),
        ...hint(2, competitionHe(club.local_code) ? `אני משחק ב${competitionHe(club.local_code)}` : null),
      ],
      ...built.facts,
    });
  }
  return out;
}

/**
 * "Which club did X leave to join Y?" — the mirror of generateTransferQuestions,
 * asking for the origin of a move rather than its destination. One transfer row
 * therefore supports two distinct questions with two distinct semantic keys.
 */
export function generatePreviousClubQuestions(
  transfers: TransferRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  return generateMoveQuestions("FROM", transfers, options);
}

/**
 * Top scorers — "who finished top scorer in X in season Y?"
 *
 * Asked only where one player leads the stored table outright. A shared golden
 * boot, which happens often enough, has no single answer and is skipped.
 */
export function generateTopScorerQuestions(
  stats: SeasonStatRow[],
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context } = options;
  const scored = stats.filter((s) => typeof s.goals === "number" && s.goals! > 0 && s.player_name);

  const byCompetitionSeason = new Map<string, SeasonStatRow[]>();
  for (const row of scored) {
    const key = `${row.competition_name}:${row.season}`;
    byCompetitionSeason.set(key, [...(byCompetitionSeason.get(key) ?? []), row]);
  }

  const allScorers = [...new Set(scored.map((s) => s.player_name))];
  if (allScorers.length < 4) return out;

  for (const [key, rows] of byCompetitionSeason) {
    const best = Math.max(...rows.map((r) => r.goals!));
    const leaders = rows.filter((r) => r.goals === best);
    if (leaders.length !== 1) continue; // shared top scorer — ambiguous
    const row = leaders[0];

    const subject = context.playerByName.get(row.player_name) ?? null;
    // Other scorers in the same competition and season: the right pool, because
    // they are players the question's own audience was watching.
    const pool: Candidate[] = rows
      .filter((r) => r.player_name !== row.player_name)
      .map(
        (r) =>
          context.playerByName.get(r.player_name)
            ? toPlayerCandidate(context.playerByName.get(r.player_name)!)
            : ({ text: r.player_name, type: "PLAYER", prominence: 2.4 } as Candidate)
      );

    const tier = (context.teamByName.get(row.team_name ?? "")?.tier ?? "CORE") as DomainTier;
    const built = build({
      archetype: "TOP_SCORER",
      answer: subject
        ? toPlayerCandidate(subject)
        : ({ text: row.player_name, type: "PLAYER", prominence: 2.4 } as Candidate),
      pool,
      seedKey: `KB_TOP_SCORER:${key}`,
      facts: {
        subjectFame: subject?.fame,
        tier,
        year: row.season,
        factProminence: factProminence({ subjectFame: subject?.fame, tier, year: row.season }),
        factConfidence: "MEDIUM",
      },
    });
    if (!built) continue;

    out.push({
      semanticKey: `KB_TOP_SCORER:${row.competition_name}:${row.season}`,
      mode: "CLASSIC",
      category: "STATS",
      difficulty: built.difficulty,
      questionHe: `מי היה מלך השערים של ${row.competition_name} בעונת ${row.season_label ?? row.season}?`,
      explanationHe: `${row.player_name} סיים כמלך השערים עם ${best} שערים${
        row.team_name ? `, בשורות ${row.team_name}` : ""
      }.`,
      options: built.options,
      correctIndex: 0,
      scopes: scopesForCompetition(row.competition_local_code, null),
      sourceLabel: "מסד נתוני סטטיסטיקות מיובא",
      freeText: true,
      canonicalAnswer: row.player_name,
      aliases: derivePlayerAliases(row.player_name),
      hintCandidates: [
        ...hint(1, `הוא כבש ${best} שערים באותה עונה`),
        ...hint(3, row.team_name ? `הוא שיחק ${hePrefix("ב", row.team_name)}` : null),
      ],
      ...built.facts,
    });
  }
  return out;
}

/** One stored fixture, as the cup generators read it. */
export interface FixtureRow {
  id: number;
  competition_id: number;
  competition_name: string;
  competition_local_code: string | null;
  competition_priority: number | null;
  /** LEAGUE | CUP | CONTINENTAL | INTERNATIONAL — decides club vs national team. */
  competition_type?: string | null;
  season: number;
  season_label?: string | null;
  round: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_goals: number | null;
  away_goals: number | null;
  home_penalties: number | null;
  away_penalties: number | null;
  status: string | null;
}

const FINISHED = new Set(["FT", "AET", "PEN"]);
const isFinal = (round: string | null) => (round ?? "").trim().toLowerCase() === "final";

/** How a finished tie reads, shootout included. */
function scoreText(f: FixtureRow): string | null {
  if (f.home_goals === null || f.away_goals === null) return null;
  const base = `${f.home_goals}-${f.away_goals}`;
  if (f.home_penalties !== null && f.away_penalties !== null) {
    return `${base} (${f.home_penalties}-${f.away_penalties} בפנדלים)`;
  }
  return base;
}

/**
 * Cup finals — who contested one, and how it finished.
 *
 * "Who won" is deliberately absent here: the final already produced a
 * competition_winners row at import, so generateCompetitionWinners asks that and
 * these add what the fixture knows beyond the trophy. Distractors come from the
 * clubs that actually played in that competition and season, which is the pool a
 * plausible wrong answer lives in.
 */
export function generateCupFinalQuestions(
  finals: FixtureRow[],
  participantsByCompetitionSeason: Map<string, string[]>,
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context, clubFacts } = options;

  for (const f of finals) {
    if (!isFinal(f.round) || !FINISHED.has((f.status ?? "").toUpperCase())) continue;
    if (!f.home_team_name || !f.away_team_name) continue;

    const label = f.season_label ?? String(f.season);
    const category = categoryForCompetition(f.competition_local_code);
    const scopes = scopesForCompetition(f.competition_local_code, null);
    // A World Cup final is contested by nations, a Champions League final by
    // clubs, and both arrive through this generator. The competition's stored
    // type decides which pool the options come from, so the two can never mix.
    const teamType = winnerTypeOfCompetition({
      type: f.competition_type ?? null,
      localCode: f.competition_local_code ?? null,
    });
    const pool = teamPoolOfType(
      context,
      (participantsByCompetitionSeason.get(`${f.competition_id}:${f.season}`) ?? []).filter(
        (name) => name !== f.home_team_name && name !== f.away_team_name
      ),
      teamType
    );

    // Which two sides reached the final. Asked from one side so the answer is a
    // single team: "who did X face in the final".
    for (const [subject, opponent] of [
      [f.home_team_name, f.away_team_name],
      [f.away_team_name, f.home_team_name],
    ]) {
      const opponentProfile = teamOfType(context, opponent, teamType);
      const subjectProfile = teamOfType(context, subject, teamType);
      if (!opponentProfile || !subjectProfile) continue;

      const tier = weakestTier(opponentProfile.tier, subjectProfile.tier);
      const built = build({
        archetype: "CUP_FINAL_OPPONENT",
        resolvedTeamType: teamType,
        answer: teamCandidate(opponentProfile),
        pool,
        seedKey: `KB_CUP_FINALIST:${f.id}:${subject}`,
        exclude: [subject],
        facts: {
          entityProminence: leastProminent(opponentProfile.prominence, subjectProfile.prominence),
          tier,
          year: f.season,
          factProminence: factProminence({
            bestClubProminence: mostProminent(opponentProfile.prominence, subjectProfile.prominence),
            worstClubProminence: leastProminent(opponentProfile.prominence, subjectProfile.prominence),
            tier,
            year: f.season,
          }),
          factConfidence: "HIGH",
        },
      });
      if (!built) continue;

      out.push({
        semanticKey: `KB_CUP_FINAL_OPPONENT:${f.id}:${subject}`,
        mode: "CLASSIC",
        category,
        difficulty: built.difficulty,
        questionHe: `נגד מי שיחקה ${subject} בגמר ${f.competition_name} ${label}?`,
        explanationHe: `${f.home_team_name} פגשה את ${f.away_team_name} בגמר ${f.competition_name} ${label}.`,
        options: built.options,
        correctIndex: 0,
        scopes,
        sourceLabel: "מסד נתוני משחקים מיובא",
        freeText: true,
        canonicalAnswer: opponent,
        aliases: [opponent],
        hintCandidates: clubHintCandidates(
          clubFacts?.get(opponent) ?? {},
          built.options.slice(1).map((nm) => clubFacts?.get(nm) ?? {})
        ),
        ...built.facts,
      });
    }

    // The scoreline. Multiple choice only — a free-text score invites a dozen
    // spellings of the same answer.
    const actual = scoreText(f);
    if (actual) {
      const alternatives = ["1-0", "2-0", "2-1", "3-1", "1-1", "3-0", "4-1", "0-0", "3-2"].filter(
        (s) => s !== actual
      );
      const scorePool: Candidate[] = alternatives.map((text) => ({ text, type: "SCORELINE" }));
      const homeProfile = context.teamByName.get(f.home_team_name);
      const awayProfile = context.teamByName.get(f.away_team_name);
      const tier = weakestTier(homeProfile?.tier, awayProfile?.tier);

      const built = build({
        archetype: "CUP_FINAL_SCORE",
        answer: { text: actual, type: "SCORELINE" },
        pool: scorePool,
        seedKey: `KB_CUP_FINAL_SCORE:${f.id}`,
        facts: {
          entityProminence: leastProminent(homeProfile?.prominence, awayProfile?.prominence),
          tier,
          year: f.season,
          // An exact scoreline is an obscure fact about a famous match, which is
          // exactly the distinction the fact-prominence axis exists to carry.
          factProminence: "OBSCURE",
          factConfidence: "HIGH",
        },
      });
      if (built) {
        out.push({
          semanticKey: `KB_CUP_FINAL_SCORE:${f.id}`,
          mode: "CLASSIC",
          category,
          difficulty: built.difficulty,
          questionHe: `מה הייתה התוצאה בגמר ${f.competition_name} ${label} בין ${f.home_team_name} ל${f.away_team_name}?`,
          explanationHe: `הגמר הסתיים ${actual}.`,
          options: built.options,
          correctIndex: 0,
          scopes,
          sourceLabel: "מסד נתוני משחקים מיובא",
          freeText: false,
          hintCandidates: [...hint(2, `המשחק היה חלק ${hePrefix("מ", f.competition_name)}`)],
          ...built.facts,
        });
      }
    }
  }
  return out;
}

/**
 * "Who did the eventual finalist beat in the semi-final?"
 *
 * The result is read from the *next* round's team sheet rather than from the
 * semi-final scoreline, and that matters: a Champions League semi-final is two
 * legs, so neither leg's score settles the tie, and an aggregate would still have
 * to account for a shootout. But a club appearing in the final necessarily won its
 * semi — so the loser is simply the other club in that club's semi-final fixtures.
 * No inference about the football, only about the bracket.
 */
export function generateKnockoutProgressionQuestions(
  fixtures: FixtureRow[],
  participantsByCompetitionSeason: Map<string, string[]>,
  options: GeneratorOptions
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const { context, clubFacts } = options;

  const byCompetitionSeason = new Map<string, FixtureRow[]>();
  for (const f of fixtures) {
    const key = `${f.competition_id}:${f.season}`;
    byCompetitionSeason.set(key, [...(byCompetitionSeason.get(key) ?? []), f]);
  }

  // Each earlier round is resolved by who turned up in the later one.
  const LADDER: [string, string][] = [
    ["semi-finals", "final"],
    ["quarter-finals", "semi-finals"],
    ["round of 16", "quarter-finals"],
  ];

  for (const [key, rows] of byCompetitionSeason) {
    const normalized = (round: string | null) => (round ?? "").trim().toLowerCase();
    const pool = participantsByCompetitionSeason.get(key) ?? [];

    for (const [earlier, later] of LADDER) {
      const laterFixtures = rows.filter((f) => normalized(f.round) === later);
      const earlierFixtures = rows.filter((f) => normalized(f.round) === earlier);
      if (laterFixtures.length === 0 || earlierFixtures.length === 0) continue;

      // Everyone who played the later round therefore won the earlier one.
      const advanced = new Set<number>();
      for (const f of laterFixtures) {
        if (f.home_team_id) advanced.add(f.home_team_id);
        if (f.away_team_id) advanced.add(f.away_team_id);
      }

      for (const winnerId of advanced) {
        const tie = earlierFixtures.filter(
          (f) => f.home_team_id === winnerId || f.away_team_id === winnerId
        );
        if (tie.length === 0) continue;

        const opponents = new Set(
          tie.map((f) => (f.home_team_id === winnerId ? f.away_team_name : f.home_team_name)).filter(Boolean)
        );
        // Two legs name the same opponent twice; anything else is not a clean tie.
        if (opponents.size !== 1) continue;
        const opponentName = [...opponents][0]!;

        const winnerName =
          tie[0].home_team_id === winnerId ? tie[0].home_team_name : tie[0].away_team_name;
        if (!winnerName || winnerName === opponentName) continue;

        const first = tie[0];
        const label = first.season_label ?? String(first.season);
        const teamType = winnerTypeOfCompetition({
          type: first.competition_type ?? null,
          localCode: first.competition_local_code ?? null,
        });
        const opponentProfile = teamOfType(context, opponentName, teamType);
        const winnerProfile = teamOfType(context, winnerName, teamType);
        if (!opponentProfile || !winnerProfile) continue;

        const tier = weakestTier(opponentProfile.tier, winnerProfile.tier);
        const built = build({
          archetype: "KNOCKOUT_BEATEN_OPPONENT",
          resolvedTeamType: teamType,
          answer: teamCandidate(opponentProfile),
          pool: teamPoolOfType(context, pool, teamType),
          seedKey: `KB_KO_BEAT:${key}:${earlier}:${winnerId}`,
          exclude: [winnerName],
          facts: {
            entityProminence: leastProminent(opponentProfile.prominence, winnerProfile.prominence),
            tier,
            year: first.season,
            // Who lost a semi-final is a detail even followers of the
            // competition forget, which is what makes it a good hard question
            // and a bad easy one.
            factProminence: "OBSCURE",
            factConfidence: "HIGH",
          },
        });
        if (!built) continue;

        const roundHe = earlier === "semi-finals" ? "חצי הגמר" : "רבע הגמר";
        out.push({
          semanticKey: `KB_KNOCKOUT_BEAT:${first.competition_id}:${first.season}:${earlier}:${winnerId}`,
          mode: "CLASSIC",
          category: categoryForCompetition(first.competition_local_code),
          difficulty: built.difficulty,
          questionHe: `את מי ניצחה ${winnerName} ב${roundHe} של ${first.competition_name} ${label}?`,
          explanationHe: `${winnerName} עלתה על ${opponentName} ב${roundHe} של ${first.competition_name} ${label}.`,
          options: built.options,
          correctIndex: 0,
          scopes: scopesForCompetition(first.competition_local_code, null),
          sourceLabel: "מסד נתוני משחקים מיובא",
          freeText: true,
          canonicalAnswer: opponentName,
          aliases: [opponentName],
          hintCandidates: clubHintCandidates(
            clubFacts?.get(opponentName) ?? {},
            built.options.slice(1).map((nm) => clubFacts?.get(nm) ?? {})
          ),
          ...built.facts,
        });
      }
    }
  }
  return out;
}

/**
 * "Which of these clubs played in the 2024 Champions League?"
 *
 * Sound only where the competition's whole fixture list is stored, because the
 * question turns on three clubs *not* having taken part. With every fixture of
 * that season present, a club absent from its team sheet demonstrably did not
 * play; with a partial import the same absence means nothing, so callers pass
 * only the competition-seasons they imported in full.
 */
export function generateCompetitionParticipation(
  participantsByCompetitionSeason: Map<string, string[]>,
  meta: Map<
    string,
    {
      competitionId: number;
      competitionName: string;
      localCode: string | null;
      priority: number | null;
      /** Needed to decide whether the entrants are clubs or nations. */
      type?: string | null;
      season: number;
      seasonLabel: string;
    }
  >,
  notableTeams: string[],
  options: GeneratorOptions & { maxPerCompetitionSeason?: number }
): KnowledgeQuestion[] {
  const { context, clubFacts } = options;
  const out: KnowledgeQuestion[] = [];
  const cap = options.maxPerCompetitionSeason ?? 40;

  for (const [key, participants] of participantsByCompetitionSeason) {
    const info = meta.get(key);
    if (!info || participants.length < 4) continue;

    // THE ENTRANTS ARE EITHER CLUBS OR NATIONS, NEVER BOTH. 71 active questions
    // asked "איזו מהקבוצות האלה השתתפה במונדיאל" and offered a nation beside
    // three clubs, which answers itself.
    const teamType = winnerTypeOfCompetition({ type: info.type ?? null, localCode: info.localCode });
    const played = new Set(participants);
    const absent = teamPoolOfType(
      context,
      notableTeams.filter((name) => !played.has(name)),
      teamType
    );
    if (absent.length < 3) continue;

    for (const [index, subject] of participants.slice(0, cap).entries()) {
      const subjectProfile = teamOfType(context, subject, teamType);
      if (!subjectProfile) continue;

      const built = build({
        archetype: "COMPETITION_PARTICIPATION",
        resolvedTeamType: teamType,
        answer: teamCandidate(subjectProfile),
        pool: absent,
        seedKey: `KB_PARTICIPATION:${key}:${index}`,
        facts: {
          entityProminence: subjectProfile.prominence,
          tier: subjectProfile.tier,
          year: info.season,
          factProminence: factProminence({
            bestClubProminence: subjectProfile.prominence,
            tier: subjectProfile.tier,
            year: info.season,
          }),
          factConfidence: "HIGH",
        },
      });
      if (!built) continue;

      out.push({
        semanticKey: `KB_COMPETITION_PARTICIPATION:${info.competitionId}:${info.season}:${subject}`,
        mode: "CLASSIC",
        category: categoryForCompetition(info.localCode),
        difficulty: built.difficulty,
        questionHe:
          teamType === "CLUB"
            ? `איזו מהקבוצות האלה השתתפה ${hePrefix("ב", info.competitionName)} ${info.seasonLabel}?`
            : `איזו מהנבחרות האלה השתתפה ${hePrefix("ב", info.competitionName)} ${info.seasonLabel}?`,
        explanationHe: `${subject} השתתפה ${hePrefix("ב", info.competitionName)} ${info.seasonLabel}.`,
        options: built.options,
        correctIndex: 0,
        scopes: scopesForCompetition(info.localCode, null),
        sourceLabel: "מסד נתוני משחקים מיובא",
        freeText: false,
        hintCandidates: clubHintCandidates(
          clubFacts?.get(subject) ?? {},
          built.options.slice(1).map((nm) => clubFacts?.get(nm) ?? {})
        ),
        ...built.facts,
      });
    }
  }
  return out;
}

/**
 * Final quality gate. Drops anything ambiguous, duplicated or malformed before
 * it can reach the question bank.
 */
/**
 * Settles a question's hints, the last thing done before it is accepted.
 *
 * Every question passes through here, which is the point: a generator that says
 * nothing about hint strength still has its hints checked for repeating the
 * question, repeating a clue, or containing the answer. That single pass is what
 * removes the bank's two worst habits — a hint reading "השנה: 2022" on a question
 * that already says "בשנת 2022", and one reading "the two players shared a club"
 * on a question asking which club they shared.
 */
export function finalizeHints(q: KnowledgeQuestion): KnowledgeQuestion {
  const answer = q.canonicalAnswer ?? q.options[q.correctIndex];
  const candidates: HintCandidate[] = [
    ...(q.hintCandidates && q.hintCandidates.length > 0
      ? q.hintCandidates
      : (q.hints ?? []).map((text) => ({ text, strength: 2 as HintStrength }))),
    // Appended last and strongest, so it is the final hint where it survives at
    // all — and only offered on free-text questions, where the first character is
    // worth something. On multiple choice the options are already on screen.
    ...(q.freeText ? firstLetterHint(answer) : []),
  ];

  const hints = buildHints({
    candidates,
    questionHe: q.questionHe,
    answer: q.canonicalAnswer ?? q.options[q.correctIndex],
    aliases: q.aliases,
    clues: q.clues,
    difficulty: q.difficulty,
  });

  const { hintCandidates: _dropped, ...rest } = q;
  return { ...rest, hints };
}

export function validateAndDedupe(
  candidates: KnowledgeQuestion[],
  existingSemanticKeys: Set<string>,
  options: { semantic?: boolean } = {}
): { accepted: KnowledgeQuestion[]; rejected: { question: KnowledgeQuestion; reason: string }[] } {
  const accepted: KnowledgeQuestion[] = [];
  const rejected: { question: KnowledgeQuestion; reason: string }[] = [];
  const seen = new Set(existingSemanticKeys);
  // On by default. Opting out exists only for the structural unit tests, which
  // construct questions by hand and are not about the semantic layer.
  const semantic = options.semantic !== false;

  for (const q of candidates) {
    if (seen.has(q.semanticKey)) {
      rejected.push({ question: q, reason: "duplicate-semantic-key" });
      continue;
    }
    if (q.options.length !== 4) {
      rejected.push({ question: q, reason: "wrong-option-count" });
      continue;
    }
    if (new Set(q.options.map(normalizeAnswer)).size !== 4) {
      rejected.push({ question: q, reason: "duplicate-options" });
      continue;
    }
    if (q.options.some((o) => !o || !o.trim())) {
      rejected.push({ question: q, reason: "empty-option" });
      continue;
    }
    if (q.correctIndex < 0 || q.correctIndex > 3) {
      rejected.push({ question: q, reason: "bad-correct-index" });
      continue;
    }
    if (!q.questionHe.trim() || !q.explanationHe.trim()) {
      rejected.push({ question: q, reason: "missing-text" });
      continue;
    }
    // A free-text answer whose canonical value collides with a distractor
    // would accept a wrong answer as correct.
    if (q.freeText) {
      const canonical = normalizeAnswer(q.canonicalAnswer ?? "");
      if (!canonical) {
        rejected.push({ question: q, reason: "free-text-without-canonical" });
        continue;
      }
      const distractors = q.options.filter((_, i) => i !== q.correctIndex).map(normalizeAnswer);
      if (distractors.includes(canonical)) {
        rejected.push({ question: q, reason: "canonical-collides-with-distractor" });
        continue;
      }
      const aliasCollision = (q.aliases ?? [])
        .map(normalizeAnswer)
        .some((alias) => alias && distractors.includes(alias));
      if (aliasCollision) {
        rejected.push({ question: q, reason: "alias-collides-with-distractor" });
        continue;
      }
    }

    /*
      THE SEMANTIC GATE.

      Everything above checks that the question is well FORMED. This checks that
      it MEANS what it says: the answer is the kind of thing the archetype asks
      for, every option is that same kind, a loan is called a loan, a precise
      position is not derived from a broad one, and the difficulty is consistent
      with how obscure the subject is.

      A question that fails is dropped, not downgraded. See football/validate.ts
      for why rejecting is the only safe outcome.
    */
    if (semantic) {
      const issues = validateSemantics(q);
      const blocking = issues.find((issue) => issue.severity === "REJECT");
      if (blocking) {
        rejected.push({ question: q, reason: blocking.code });
        continue;
      }
    }

    seen.add(q.semanticKey);
    accepted.push(finalizeHints(q));
  }

  return { accepted, rejected };
}
