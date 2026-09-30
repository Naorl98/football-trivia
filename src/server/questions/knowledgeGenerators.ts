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
// Distractors are drawn from the same context as the answer (same league for
// clubs, same position/nationality band for players), so wrong options are
// believable rather than obviously silly.

import { normalizeAnswer } from "../../shared/answerMatching.ts";

export type Difficulty = "EASY" | "NORMAL" | "HARD" | "EXPERT" | "IMPOSSIBLE";

export interface KnowledgeQuestion {
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
  season: number;
  team_name: string;
  runner_up_name: string | null;
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

/**
 * Deterministic difficulty. Same rules -> same answer, every time; no LLM in
 * the generation path.
 */
export function classifyDifficulty(input: {
  resource: "winner" | "transfer" | "career" | "trophy" | "venue" | "country";
  season?: number | null;
  competitionPriority?: number | null;
  subjectProminence?: number; // 1 = famous, 3 = obscure
}): Difficulty {
  const ladder: Difficulty[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];
  let index = 1;

  if (input.resource === "country" || input.resource === "venue") index = 1;
  if (input.resource === "winner") index = 1;
  if (input.resource === "transfer") index = 2;
  if (input.resource === "career") index = 2;
  if (input.resource === "trophy") index = 2;

  // Older facts are harder.
  if (typeof input.season === "number") {
    const age = 2026 - input.season;
    if (age > 6) index += 1;
    if (age > 12) index += 1;
  }

  // Lower-priority competitions are more obscure.
  const priority = input.competitionPriority ?? 2;
  if (priority >= 3) index += 1;

  if (input.subjectProminence && input.subjectProminence >= 3) index += 1;

  return ladder[Math.max(0, Math.min(ladder.length - 1, index))];
}

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
  clubsByCompetition: Map<number, string[]> = new Map()
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const byCompetition = new Map<number, WinnerRow[]>();
  for (const row of winners) {
    byCompetition.set(row.competition_id, [...(byCompetition.get(row.competition_id) ?? []), row]);
  }

  for (const [competitionId, rows] of byCompetition) {
    const pool = [
      ...new Set([...(clubsByCompetition.get(competitionId) ?? []), ...rows.map((r) => r.team_name)]),
    ];
    if (pool.length < 4) continue; // not enough believable distractors

    for (const row of rows) {
      const distractors = pickDistinct(
        pool.filter((name) => name !== row.team_name),
        3,
        `kb_winner:${row.competition_id}:${row.season}`
      );
      if (distractors.length < 3) continue;

      out.push({
        semanticKey: `KB_COMPETITION_WINNER:${row.competition_id}:${row.season}`,
        mode: "CLASSIC",
        category: categoryForCompetition(row.competition_local_code),
        difficulty: classifyDifficulty({
          resource: "winner",
          season: row.season,
          competitionPriority: row.competition_priority,
        }),
        questionHe: `מי זכתה באליפות ${row.competition_name} בעונת ${row.season_label ?? row.season}?`,
        explanationHe: row.runner_up_name
          ? `${row.team_name} סיימה במקום הראשון בעונת ${row.season_label ?? row.season}, לפני ${row.runner_up_name}.`
          : `${row.team_name} זכתה באליפות ${row.competition_name} בעונת ${row.season_label ?? row.season}.`,
        options: [row.team_name, ...distractors],
        correctIndex: 0,
        scopes: scopesForCompetition(row.competition_local_code, null),
        sourceLabel: "מסד נתוני כדורגל מיובא",
        freeText: true,
        canonicalAnswer: row.team_name,
        aliases: [row.team_name],
        hints: [`התחרות: ${row.competition_name}`, `העונה: ${row.season_label ?? row.season}`],
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

/** "Which club did X move to from Y?" — from player_transfers. */
export function generateTransferQuestions(
  transfers: TransferRow[],
  teamPool: TeamRow[],
  notable: Set<string> = new Set(),
  cupScopes?: CupScopesByClub
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const isNotable = (name: string) => notable.size === 0 || notable.has(name);
  // Distractors are drawn from the same notability band as the answer. Mixing
  // obscure clubs in beside a famous one gives the answer away by recognition,
  // which is a harder problem than an implausible distractor: the question looks
  // well-formed and is still free.
  const teamNames = teamPool.map((t) => display(t)).filter(isNotable);

  for (const transfer of transfers) {
    // Both ends must be known, and a loan is not a clean "moved to" fact.
    if (!transfer.from_team_name || !transfer.to_team_name) continue;
    if (/loan/i.test(transfer.transfer_type ?? "")) continue;
    if (transfer.from_team_name === transfer.to_team_name) continue;
    // Both ends must also be clubs a player could reasonably be asked about.
    if (!isNotable(transfer.from_team_name) || !isNotable(transfer.to_team_name)) continue;

    const year = transfer.transfer_date ? Number(transfer.transfer_date.slice(0, 4)) : null;
    const seedKey = `KB_TRANSFER_TO:${transfer.player_id}:${transfer.to_team_id}:${year ?? "-"}`;

    const distractors = pickDistinct(
      teamNames.filter((n) => n !== transfer.to_team_name && n !== transfer.from_team_name),
      3,
      seedKey
    );
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: seedKey,
      mode: "CLASSIC",
      category: "TRANSFERS",
      difficulty: classifyDifficulty({ resource: "transfer", season: year }),
      questionHe: `לאיזו קבוצה עבר ${transfer.player_name} מ${transfer.from_team_name}${
        year ? ` בשנת ${year}` : ""
      }?`,
      explanationHe: `${transfer.player_name} עבר מ${transfer.from_team_name} ל${transfer.to_team_name}${
        year ? ` בשנת ${year}` : ""
      }.`,
      options: [transfer.to_team_name, ...distractors],
      correctIndex: 0,
      scopes: [
        { type: "REGION", value: "WORLD" },
        ...cupScopesFor(cupScopes, transfer.from_team_name, transfer.to_team_name),
      ],
      sourceLabel: "מסד נתוני העברות מיובא",
      freeText: true,
      canonicalAnswer: transfer.to_team_name,
      aliases: [transfer.to_team_name],
      hints: [`המועדון הקודם: ${transfer.from_team_name}`, ...(year ? [`השנה: ${year}`] : [])],
    });
  }
  return out;
}

/** "Which player's career path is this?" — from ordered transfer chains. */
export function generateCareerPaths(
  transfersByPlayer: Map<number, TransferRow[]>,
  playerPool: PlayerRow[],
  cupScopes?: CupScopesByClub
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const playerNames = playerPool.map((p) => display(p));

  for (const [playerId, transfers] of transfersByPlayer) {
    // Ordering must be certain: every move needs a date.
    if (transfers.some((t) => !t.transfer_date)) continue;
    const ordered = [...transfers].sort((a, b) => (a.transfer_date! < b.transfer_date! ? -1 : 1));
    if (ordered.length < 3) continue;

    const playerName = ordered[0].player_name;
    const path: string[] = [];
    if (ordered[0].from_team_name) path.push(ordered[0].from_team_name);
    for (const move of ordered) {
      if (move.to_team_name && move.to_team_name !== path[path.length - 1]) path.push(move.to_team_name);
    }
    if (path.length < 3) continue;

    const distractors = pickDistinct(
      playerNames.filter((n) => n !== playerName),
      3,
      `KB_CAREER_PATH:${playerId}`
    );
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `KB_CAREER_PATH:${playerId}`,
      mode: "CAREER_PATH",
      category: "CAREER_PATH",
      difficulty: classifyDifficulty({ resource: "career", subjectProminence: 2 }),
      questionHe: "של מי מסלול הקריירה הזה?",
      explanationHe: `זהו מסלול הקריירה של ${playerName}.`,
      clues: path,
      options: [playerName, ...distractors],
      correctIndex: 0,
      // A career that passed through the competition belongs in its quiz.
      scopes: [{ type: "REGION", value: "WORLD" }, ...cupScopesFor(cupScopes, ...path)],
      sourceLabel: "מסד נתוני העברות מיובא",
      freeText: true,
      canonicalAnswer: playerName,
      aliases: derivePlayerAliases(playerName),
      hints: [`המועדון הראשון ברשימה: ${path[0]}`, `מספר המועדונים: ${path.length}`],
    });
  }
  return out;
}

/** "Which stadium does club X play at?" — from teams + venues. */
export function generateVenueQuestions(teams: TeamRow[]): KnowledgeQuestion[] {
  const withVenue = teams.filter((t) => t.venue_name);
  const venueNames = [...new Set(withVenue.map((t) => t.venue_name!))];
  if (venueNames.length < 4) return [];

  const out: KnowledgeQuestion[] = [];
  for (const team of withVenue) {
    const distractors = pickDistinct(
      venueNames.filter((v) => v !== team.venue_name),
      3,
      `KB_VENUE:${team.id}`
    );
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `KB_TEAM_VENUE:${team.id}`,
      mode: "CLASSIC",
      category: "STADIUMS",
      difficulty: classifyDifficulty({
        resource: "venue",
        competitionPriority: team.competition_priority,
      }),
      questionHe: `באיזה אצטדיון משחקת ${display(team)} את משחקי הבית שלה?`,
      explanationHe: `${display(team)} משחקת ב${team.venue_name}.`,
      options: [team.venue_name!, ...distractors],
      correctIndex: 0,
      scopes: scopesForCompetition(team.local_code, team.country_name),
      sourceLabel: "מסד נתוני מועדונים מיובא",
      freeText: true,
      canonicalAnswer: team.venue_name!,
      aliases: [team.venue_name!],
      hints: [...(team.country_name ? [`המדינה: ${team.country_name}`] : [])],
    });
  }
  return out;
}

/** "Which competition did X win?" — from player_trophies. */
export function generateTrophyQuestions(trophies: TrophyRow[]): KnowledgeQuestion[] {
  const winners = trophies.filter((t) => (t.place ?? "").toLowerCase() === "winner" && t.competition_name);
  const competitionPool = [...new Set(winners.map((t) => t.competition_name))];
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

    const distractors = pickDistinct(
      competitionPool.filter((c) => c !== row.competition_name),
      3,
      `KB_TROPHY:${key}`
    );
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `KB_TROPHY_PLAYER:${row.player_id}:${row.competition_name}:${row.season}`,
      mode: "CLASSIC",
      category: "TITLES",
      difficulty: classifyDifficulty({ resource: "trophy", subjectProminence: 2 }),
      questionHe: `באיזו תחרות זכה ${row.player_name} בעונת ${row.season}?`,
      explanationHe: `${row.player_name} זכה ב${row.competition_name} בעונת ${row.season}.`,
      options: [row.competition_name, ...distractors],
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני תארים מיובא",
      freeText: false,
      hints: [`העונה: ${row.season}`],
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
export function generateManagerQuestions(spells: CoachSpellRow[]): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const dated = spells.filter((s) => s.team_name && s.coach_name && s.start_date);

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

  // "Which club did <coach> manage in <year>?"
  for (const spell of dated) {
    const key = spellKey(spell);
    if (seenSpells.has(key)) continue;

    const year = spellYears(spell).find(
      (candidate) => clubsByCoachYear.get(`${spell.coach_id}:${candidate}`)?.size === 1
    );
    if (year === undefined) continue; // every year of this spell overlapped another job
    seenSpells.add(key);
    const row = spell;

    const distractors = pickDistinct(
      clubNames.filter((n) => n !== row.team_name),
      3,
      `KB_COACH_CLUB:${row.coach_id}:${year}`
    );
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `KB_COACH_CLUB:${row.coach_id}:${row.team_id}`,
      mode: "CLASSIC",
      category: "COACHES",
      difficulty: classifyDifficulty({ resource: "career", season: year, subjectProminence: 2 }),
      questionHe: `את איזו קבוצה אימן ${row.coach_name} בשנת ${year}?`,
      explanationHe: `${row.coach_name} אימן את ${row.team_name} בשנת ${year}.`,
      options: [row.team_name, ...distractors],
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני מאמנים מיובא",
      freeText: true,
      canonicalAnswer: row.team_name,
      aliases: [row.team_name],
      hints: [...(row.nationality ? [`הלאום של המאמן: ${row.nationality}`] : []), `השנה: ${year}`],
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

    const distractors = pickDistinct(
      coachNames.filter((n) => n !== row.coach_name),
      3,
      `KB_CLUB_COACH:${row.team_id}:${year}`
    );
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `KB_CLUB_COACH:${row.team_id}:${row.coach_id}`,
      mode: "CLASSIC",
      category: "COACHES",
      difficulty: classifyDifficulty({ resource: "career", season: year, subjectProminence: 2 }),
      questionHe: `מי אימן את ${row.team_name} בשנת ${year}?`,
      explanationHe: `${row.coach_name} אימן את ${row.team_name} בשנת ${year}.`,
      options: [row.coach_name, ...distractors],
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני מאמנים מיובא",
      freeText: true,
      canonicalAnswer: row.coach_name,
      aliases: derivePlayerAliases(row.coach_name),
      hints: [`הקבוצה: ${row.team_name}`, `השנה: ${year}`],
    });
  }

  return out;
}

/** Indexes the player-at-club table once; several generators below share it. */
interface CareerIndex {
  clubsByPlayer: Map<number, Set<number>>;
  playersByClub: Map<number, number[]>;
  playerById: Map<number, PlayerTeamRow>;
  clubNameById: Map<number, string>;
  /** Countries a player has a club in, where the club's country is known. */
  countriesByPlayer: Map<number, Set<string>>;
  /** Earliest recorded year at any club — a rough career start. */
  firstYearByPlayer: Map<number, number>;
}

export function indexCareers(rows: PlayerTeamRow[]): CareerIndex {
  const clubsByPlayer = new Map<number, Set<number>>();
  const playersByClub = new Map<number, number[]>();
  const playerById = new Map<number, PlayerTeamRow>();
  const clubNameById = new Map<number, string>();
  const countriesByPlayer = new Map<number, Set<string>>();
  const firstYearByPlayer = new Map<number, number>();

  for (const row of rows) {
    if (!row.player_name || !row.team_name) continue;
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
  return { clubsByPlayer, playersByClub, playerById, clubNameById, countriesByPlayer, firstYearByPlayer };
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
  options: { maxPerClub?: number; notable?: Set<string>; cupScopes?: CupScopesByClub } = {}
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const maxPerClub = options.maxPerClub ?? 6;
  const notable = options.notable ?? new Set<string>();
  const isNotable = (name: string) => notable.size === 0 || notable.has(name);
  // Both the answer and its distractors are held to the same standard, so the
  // four clubs on screen are comparable and the famous one is not the giveaway.
  const allClubIds = [...careers.clubNameById.keys()].filter((id) =>
    isNotable(careers.clubNameById.get(id)!)
  );
  if (allClubIds.length < 4) return out;

  for (const [clubId, playerIds] of careers.playersByClub) {
    const clubName = careers.clubNameById.get(clubId);
    if (!clubName || !isNotable(clubName)) continue;

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

        const distractors = pickDistinct(
          allClubIds.filter((id) => !touched.has(id)).map((id) => careers.clubNameById.get(id)!),
          3,
          `KB_CLUB_CONNECTION:${clubId}:${aId}:${bId}`
        );
        if (distractors.length < 3 || distractors.some((d) => d === clubName)) continue;

        made++;
        out.push({
          semanticKey: `KB_CLUB_CONNECTION:${clubId}:${Math.min(aId, bId)}:${Math.max(aId, bId)}`,
          mode: "CLUB_CONNECTION",
          category: "CAREERS",
          difficulty: classifyDifficulty({ resource: "career", subjectProminence: 2 }),
          questionHe: `באיזה מועדון שיחקו גם ${a.player_name} וגם ${b.player_name}?`,
          explanationHe: `גם ${a.player_name} וגם ${b.player_name} שיחקו ב${clubName}.`,
          clues: [a.player_name, b.player_name],
          options: [clubName, ...distractors],
          correctIndex: 0,
          scopes: [
            { type: "REGION", value: "WORLD" },
            ...cupScopesFor(options.cupScopes, clubName),
          ],
          sourceLabel: "מסד נתוני קריירות מיובא",
          freeText: true,
          canonicalAnswer: clubName,
          aliases: [clubName],
          hints: [`שני השחקנים חלקו מועדון אחד`, `מספר המועדונים בקריירה של ${a.player_name}: ${aClubs.size}`],
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
export function generateWhoAmI(careers: CareerIndex): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];

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

    const pool = (
      attrs.position ? (namesByPosition.get(attrs.position) ?? []) : namesWithCareers
    ).filter((n) => n !== player.player_name);
    const distractors = pickDistinct(pool, 3, `KB_WHO_AM_I:${player.player_id}`);
    if (distractors.length < 3) continue;

    const clues = [
      ...(attrs.nationality ? [`הלאום שלי: ${attrs.nationality}`] : []),
      ...(attrs.position ? [`העמדה שלי: ${attrs.position}`] : []),
      ...(attrs.countries.length > 0 ? [`שיחקתי בליגות של: ${attrs.countries.join(", ")}`] : []),
      ...(attrs.firstYear ? [`העונה הראשונה שלי במסד: ${attrs.firstYear}`] : []),
      `סך המועדונים בקריירה שלי: ${clubNames.length}`,
      `בין המועדונים שלי: ${clubNames.slice(0, 4).join(", ")}`,
    ];

    out.push({
      semanticKey: `KB_WHO_AM_I:${player.player_id}`,
      mode: "WHO_AM_I",
      category: "WHO_AM_I",
      difficulty: classifyDifficulty({
        resource: "career",
        // A career we know a lot about belongs to a more prominent player.
        subjectProminence: clubNames.length >= 5 ? 2 : 3,
      }),
      questionHe: "מי אני?",
      explanationHe: `התשובה היא ${player.player_name}.`,
      clues,
      options: [player.player_name, ...distractors],
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני שחקנים מיובא",
      freeText: true,
      canonicalAnswer: player.player_name,
      aliases: derivePlayerAliases(player.player_name),
      hints: [
        ...(attrs.nationality ? [`הלאום: ${attrs.nationality}`] : []),
        ...(attrs.position ? [`העמדה: ${attrs.position}`] : []),
        `מספר המועדונים בקריירה: ${clubNames.length}`,
      ],
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
  options: { notable?: Set<string>; clubCountryById?: Map<number, string | null> } = {}
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const notable = options.notable ?? new Set<string>();
  const countries = options.clubCountryById ?? new Map<number, string | null>();
  const isNotable = (name: string) => notable.size === 0 || notable.has(name);

  const notableClubIds = [...careers.clubNameById.keys()].filter((id) =>
    isNotable(careers.clubNameById.get(id)!)
  );
  if (notableClubIds.length < 4) return out;

  for (const [playerId, clubIds] of careers.clubsByPlayer) {
    if (clubIds.size < 5) continue;
    const player = careers.playerById.get(playerId);
    if (!player) continue;

    const played = [...clubIds]
      .filter((id) => isNotable(careers.clubNameById.get(id) ?? ""))
      .map((id) => ({ id, name: careers.clubNameById.get(id)! }));
    if (played.length < 3) continue;

    const playedCountries = new Set(
      [...clubIds].map((id) => countries.get(id)).filter((c): c is string => Boolean(c))
    );

    const absentPool = notableClubIds.filter((id) => {
      if (clubIds.has(id)) return false;
      const country = countries.get(id);
      // Unknown country cannot confirm separation, so such a club is not used
      // once we have any country information for this player at all.
      if (playedCountries.size > 0) return Boolean(country) && !playedCountries.has(country!);
      return true;
    });
    if (absentPool.length === 0) continue;

    const answerId = pickDistinct(absentPool, 1, `KB_NEVER_PLAYED:${playerId}`)[0];
    const answer = careers.clubNameById.get(answerId)!;
    const shown = pickDistinct(played.map((p) => p.name), 3, `KB_NEVER_PLAYED_SHOWN:${playerId}`);
    if (shown.length < 3 || shown.includes(answer)) continue;

    out.push({
      semanticKey: `KB_NEVER_PLAYED:${playerId}:${answerId}`,
      mode: "CLASSIC",
      category: "CAREERS",
      difficulty: classifyDifficulty({ resource: "career", subjectProminence: 2 }),
      questionHe: `באיזו קבוצה מהרשימה ${player.player_name} מעולם לא שיחק?`,
      explanationHe: `${player.player_name} שיחק ב${shown.join(", ")}, אך לא ב${answer}.`,
      options: [answer, ...shown],
      correctIndex: 0,
      scopes: [{ type: "REGION", value: "WORLD" }],
      sourceLabel: "מסד נתוני קריירות מיובא",
      freeText: false,
      hints: [`מספר המועדונים בקריירה: ${clubIds.size}`],
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
export function generateGuessTheClub(teams: TeamRow[]): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const usable = teams.filter((t) => t.country_name && t.founded && t.venue_name);
  if (usable.length < 4) return out;

  const names = usable.map((t) => display(t));

  for (const club of usable) {
    const ambiguous = usable.some(
      (other) =>
        other.id !== club.id &&
        other.country_name === club.country_name &&
        other.founded === club.founded &&
        other.venue_name === club.venue_name
    );
    if (ambiguous) continue;

    // Clubs from the same country are the believable wrong answers.
    const sameCountry = usable.filter((t) => t.id !== club.id && t.country_name === club.country_name);
    const pool = (sameCountry.length >= 3 ? sameCountry : usable.filter((t) => t.id !== club.id)).map((t) =>
      display(t)
    );
    const distractors = pickDistinct(pool, 3, `KB_GUESS_CLUB:${club.id}`);
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `KB_GUESS_CLUB:${club.id}`,
      mode: "GUESS_THE_CLUB",
      category: "GUESS_THE_CLUB",
      difficulty: classifyDifficulty({
        resource: "venue",
        competitionPriority: club.competition_priority,
      }),
      questionHe: "איזה מועדון אני?",
      explanationHe: `התשובה היא ${display(club)}.`,
      clues: [
        `המדינה שלי: ${club.country_name}`,
        `נוסדתי בשנת ${club.founded}`,
        `האצטדיון שלי: ${club.venue_name}`,
      ],
      options: [display(club), ...distractors],
      correctIndex: 0,
      scopes: scopesForCompetition(club.local_code, club.country_name),
      sourceLabel: "מסד נתוני מועדונים מיובא",
      freeText: true,
      canonicalAnswer: display(club),
      aliases: deriveTeamAliases(club),
      hints: [`המדינה: ${club.country_name}`, `שנת ההיווסדות: ${club.founded}`],
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
  teamPool: TeamRow[],
  notable: Set<string> = new Set(),
  cupScopes?: CupScopesByClub
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const isNotable = (name: string) => notable.size === 0 || notable.has(name);
  const teamNames = teamPool.map((t) => display(t)).filter(isNotable);

  for (const transfer of transfers) {
    if (!transfer.from_team_name || !transfer.to_team_name) continue;
    if (/loan/i.test(transfer.transfer_type ?? "")) continue;
    if (transfer.from_team_name === transfer.to_team_name) continue;
    if (!isNotable(transfer.from_team_name) || !isNotable(transfer.to_team_name)) continue;

    const year = transfer.transfer_date ? Number(transfer.transfer_date.slice(0, 4)) : null;
    const seedKey = `KB_TRANSFER_FROM:${transfer.player_id}:${transfer.from_team_id}:${year ?? "-"}`;

    const distractors = pickDistinct(
      teamNames.filter((n) => n !== transfer.to_team_name && n !== transfer.from_team_name),
      3,
      seedKey
    );
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: seedKey,
      mode: "CLASSIC",
      category: "TRANSFERS",
      difficulty: classifyDifficulty({ resource: "transfer", season: year }),
      questionHe: `מאיזו קבוצה הגיע ${transfer.player_name} ל${transfer.to_team_name}${
        year ? ` בשנת ${year}` : ""
      }?`,
      explanationHe: `${transfer.player_name} הגיע ל${transfer.to_team_name} מ${transfer.from_team_name}${
        year ? ` בשנת ${year}` : ""
      }.`,
      options: [transfer.from_team_name, ...distractors],
      correctIndex: 0,
      scopes: [
        { type: "REGION", value: "WORLD" },
        ...cupScopesFor(cupScopes, transfer.from_team_name, transfer.to_team_name),
      ],
      sourceLabel: "מסד נתוני העברות מיובא",
      freeText: true,
      canonicalAnswer: transfer.from_team_name,
      aliases: [transfer.from_team_name],
      hints: [`המועדון החדש: ${transfer.to_team_name}`, ...(year ? [`השנה: ${year}`] : [])],
    });
  }
  return out;
}

/**
 * Top scorers — "who finished top scorer in X in season Y?"
 *
 * Asked only where one player leads the stored table outright. A shared golden
 * boot, which happens often enough, has no single answer and is skipped.
 */
export function generateTopScorerQuestions(stats: SeasonStatRow[]): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
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

    const distractors = pickDistinct(
      rows.filter((r) => r.player_name !== row.player_name).map((r) => r.player_name),
      3,
      `KB_TOP_SCORER:${key}`
    );
    if (distractors.length < 3) continue;

    out.push({
      semanticKey: `KB_TOP_SCORER:${row.competition_name}:${row.season}`,
      mode: "CLASSIC",
      category: "STATS",
      difficulty: classifyDifficulty({
        resource: "trophy",
        season: row.season,
        competitionPriority: row.competition_priority,
      }),
      questionHe: `מי היה מלך השערים של ${row.competition_name} בעונת ${row.season_label ?? row.season}?`,
      explanationHe: `${row.player_name} סיים כמלך השערים עם ${best} שערים${
        row.team_name ? `, בשורות ${row.team_name}` : ""
      }.`,
      options: [row.player_name, ...distractors],
      correctIndex: 0,
      scopes: scopesForCompetition(row.competition_local_code, null),
      sourceLabel: "מסד נתוני סטטיסטיקות מיובא",
      freeText: true,
      canonicalAnswer: row.player_name,
      aliases: derivePlayerAliases(row.player_name),
      hints: [`התחרות: ${row.competition_name}`, `מספר השערים: ${best}`],
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
  participantsByCompetitionSeason: Map<string, string[]>
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];

  for (const f of finals) {
    if (!isFinal(f.round) || !FINISHED.has((f.status ?? "").toUpperCase())) continue;
    if (!f.home_team_name || !f.away_team_name) continue;

    const label = f.season_label ?? String(f.season);
    const category = categoryForCompetition(f.competition_local_code);
    const scopes = scopesForCompetition(f.competition_local_code, null);
    const pool = (participantsByCompetitionSeason.get(`${f.competition_id}:${f.season}`) ?? []).filter(
      (name) => name !== f.home_team_name && name !== f.away_team_name
    );

    // Which two sides reached the final. Asked from one side so the answer is a
    // single club: "who did X face in the final".
    for (const [subject, opponent] of [
      [f.home_team_name, f.away_team_name],
      [f.away_team_name, f.home_team_name],
    ]) {
      const distractors = pickDistinct(pool, 3, `KB_CUP_FINALIST:${f.id}:${subject}`);
      if (distractors.length < 3) continue;
      out.push({
        semanticKey: `KB_CUP_FINAL_OPPONENT:${f.id}:${subject}`,
        mode: "CLASSIC",
        category,
        difficulty: classifyDifficulty({
          resource: "winner",
          season: f.season,
          competitionPriority: f.competition_priority,
        }),
        questionHe: `נגד מי שיחקה ${subject} בגמר ${f.competition_name} ${label}?`,
        explanationHe: `${f.home_team_name} פגשה את ${f.away_team_name} בגמר ${f.competition_name} ${label}.`,
        options: [opponent, ...distractors],
        correctIndex: 0,
        scopes,
        sourceLabel: "מסד נתוני משחקים מיובא",
        freeText: true,
        canonicalAnswer: opponent,
        aliases: [opponent],
        hints: [`התחרות: ${f.competition_name}`, `העונה: ${label}`],
      });
    }

    // The scoreline. Multiple choice only — a free-text score invites a dozen
    // spellings of the same answer.
    const actual = scoreText(f);
    if (actual) {
      const alternatives = ["1-0", "2-0", "2-1", "3-1", "1-1", "3-0", "4-1", "0-0", "3-2"].filter(
        (s) => s !== actual
      );
      const distractors = pickDistinct(alternatives, 3, `KB_CUP_FINAL_SCORE:${f.id}`);
      if (distractors.length === 3) {
        out.push({
          semanticKey: `KB_CUP_FINAL_SCORE:${f.id}`,
          mode: "CLASSIC",
          category,
          difficulty: classifyDifficulty({
            resource: "winner",
            season: f.season,
            competitionPriority: f.competition_priority,
            subjectProminence: 3,
          }),
          questionHe: `מה היה התוצאה בגמר ${f.competition_name} ${label} בין ${f.home_team_name} ל${f.away_team_name}?`,
          explanationHe: `הגמר הסתיים ${actual}.`,
          options: [actual, ...distractors],
          correctIndex: 0,
          scopes,
          sourceLabel: "מסד נתוני משחקים מיובא",
          freeText: false,
          hints: [`התחרות: ${f.competition_name}`, `העונה: ${label}`],
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
  participantsByCompetitionSeason: Map<string, string[]>
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];

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
        const distractors = pickDistinct(
          pool.filter((n) => n !== winnerName && n !== opponentName),
          3,
          `KB_KO_BEAT:${key}:${earlier}:${winnerId}`
        );
        if (distractors.length < 3) continue;

        const roundHe = earlier === "semi-finals" ? "חצי הגמר" : "רבע הגמר";
        out.push({
          semanticKey: `KB_KNOCKOUT_BEAT:${first.competition_id}:${first.season}:${earlier}:${winnerId}`,
          mode: "CLASSIC",
          category: categoryForCompetition(first.competition_local_code),
          difficulty: classifyDifficulty({
            resource: "winner",
            season: first.season,
            competitionPriority: first.competition_priority,
            subjectProminence: 3,
          }),
          questionHe: `את מי ניצחה ${winnerName} ב${roundHe} של ${first.competition_name} ${label}?`,
          explanationHe: `${winnerName} עלתה על ${opponentName} ב${roundHe} של ${first.competition_name} ${label}.`,
          options: [opponentName, ...distractors],
          correctIndex: 0,
          scopes: scopesForCompetition(first.competition_local_code, null),
          sourceLabel: "מסד נתוני משחקים מיובא",
          freeText: true,
          canonicalAnswer: opponentName,
          aliases: [opponentName],
          hints: [`התחרות: ${first.competition_name}`, `העונה: ${label}`],
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
  meta: Map<string, { competitionId: number; competitionName: string; localCode: string | null; priority: number | null; season: number; seasonLabel: string }>,
  notableClubs: string[],
  options: { maxPerCompetitionSeason?: number } = {}
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const cap = options.maxPerCompetitionSeason ?? 40;

  for (const [key, participants] of participantsByCompetitionSeason) {
    const info = meta.get(key);
    if (!info || participants.length < 4) continue;

    const played = new Set(participants);
    const absent = notableClubs.filter((name) => !played.has(name));
    if (absent.length < 3) continue;

    for (const [index, subject] of participants.slice(0, cap).entries()) {
      const distractors = pickDistinct(absent, 3, `KB_PARTICIPATION:${key}:${index}`);
      if (distractors.length < 3) continue;

      out.push({
        semanticKey: `KB_COMPETITION_PARTICIPATION:${info.competitionId}:${info.season}:${subject}`,
        mode: "CLASSIC",
        category: categoryForCompetition(info.localCode),
        difficulty: classifyDifficulty({
          resource: "winner",
          season: info.season,
          competitionPriority: info.priority,
          subjectProminence: 3,
        }),
        questionHe: `איזו מהקבוצות האלה השתתפה ב${info.competitionName} ${info.seasonLabel}?`,
        explanationHe: `${subject} השתתפה ב${info.competitionName} ${info.seasonLabel}.`,
        options: [subject, ...distractors],
        correctIndex: 0,
        scopes: scopesForCompetition(info.localCode, null),
        sourceLabel: "מסד נתוני משחקים מיובא",
        freeText: false,
        hints: [`התחרות: ${info.competitionName}`, `העונה: ${info.seasonLabel}`],
      });
    }
  }
  return out;
}

/**
 * Final quality gate. Drops anything ambiguous, duplicated or malformed before
 * it can reach the question bank.
 */
export function validateAndDedupe(
  candidates: KnowledgeQuestion[],
  existingSemanticKeys: Set<string>
): { accepted: KnowledgeQuestion[]; rejected: { question: KnowledgeQuestion; reason: string }[] } {
  const accepted: KnowledgeQuestion[] = [];
  const rejected: { question: KnowledgeQuestion; reason: string }[] = [];
  const seen = new Set(existingSemanticKeys);

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

    seen.add(q.semanticKey);
    accepted.push(q);
  }

  return { accepted, rejected };
}
