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
  mode: "CLASSIC" | "CAREER_PATH" | "CLUB_CONNECTION";
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
}

export interface TrophyRow {
  player_id: number;
  player_name: string;
  competition_name: string;
  season: string | null;
  place: string | null;
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

/** "Who won competition X in season Y?" — from competition_winners. */
export function generateCompetitionWinners(winners: WinnerRow[]): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const byCompetition = new Map<number, WinnerRow[]>();
  for (const row of winners) {
    byCompetition.set(row.competition_id, [...(byCompetition.get(row.competition_id) ?? []), row]);
  }

  for (const [, rows] of byCompetition) {
    const championPool = [...new Set(rows.map((r) => r.team_name))];
    if (championPool.length < 4) continue; // not enough believable distractors

    for (const row of rows) {
      const distractors = pickDistinct(
        championPool.filter((name) => name !== row.team_name),
        3,
        `kb_winner:${row.competition_id}:${row.season}`
      );
      if (distractors.length < 3) continue;

      out.push({
        semanticKey: `KB_COMPETITION_WINNER:${row.competition_id}:${row.season}`,
        mode: "CLASSIC",
        category: "TITLES",
        difficulty: classifyDifficulty({
          resource: "winner",
          season: row.season,
          competitionPriority: row.competition_priority,
        }),
        questionHe: `מי זכתה באליפות ${row.competition_name} בעונת ${row.season}/${String(row.season + 1).slice(2)}?`,
        explanationHe: row.runner_up_name
          ? `${row.team_name} סיימה במקום הראשון בעונת ${row.season}, לפני ${row.runner_up_name}.`
          : `${row.team_name} זכתה באליפות ${row.competition_name} בעונת ${row.season}.`,
        options: [row.team_name, ...distractors],
        correctIndex: 0,
        scopes: scopesForCompetition(row.competition_local_code, null),
        sourceLabel: "מסד נתוני כדורגל מיובא",
        freeText: true,
        canonicalAnswer: row.team_name,
        aliases: [row.team_name],
        hints: [`התחרות: ${row.competition_name}`, `העונה: ${row.season}`],
      });
    }
  }
  return out;
}

/** "Which club did X move to from Y?" — from player_transfers. */
export function generateTransferQuestions(
  transfers: TransferRow[],
  teamPool: TeamRow[]
): KnowledgeQuestion[] {
  const out: KnowledgeQuestion[] = [];
  const teamNames = teamPool.map((t) => display(t));

  for (const transfer of transfers) {
    // Both ends must be known, and a loan is not a clean "moved to" fact.
    if (!transfer.from_team_name || !transfer.to_team_name) continue;
    if (/loan/i.test(transfer.transfer_type ?? "")) continue;
    if (transfer.from_team_name === transfer.to_team_name) continue;

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
      scopes: [{ type: "REGION", value: "WORLD" }],
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
  playerPool: PlayerRow[]
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
      scopes: [{ type: "REGION", value: "WORLD" }],
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
