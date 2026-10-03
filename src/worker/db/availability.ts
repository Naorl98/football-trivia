// Real availability counts, per option, for every step of the wizard.
//
// WHY THIS IS NOT "countAvailableQuestions, once per option"
//
// The wizard now shows a number beside every choice — 21 countries, 12 question
// types, 17 competitions, a dozen presets — and disables the ones that cannot
// fill the requested quiz. Done the obvious way that is one COUNT per option,
// and a COUNT over this filter reads the whole matching set: measured at 15,186
// rows for the simple case. Eighty-odd options would be over a million rows read
// to draw one screen, on a free tier with five million reads a day.
//
// So the counts come back a DIMENSION at a time, not an option at a time. One
// GROUP BY over the scope table answers "how many for each country?" in a single
// query that reads the filtered set once — 30 numbers for the price of one.
// Which is also why the endpoint takes a list of dimensions: a step asks for the
// one dimension it renders, so walking the whole wizard costs about five
// queries in total rather than five hundred.
//
// WHAT A COUNT MEANS HERE. Every count answers "how many questions would this
// option give me, given everything chosen SO FAR, but ignoring any previous
// choice in this same dimension". Picking Spain and then opening the country
// step again must show Italy's real count, not zero — the new choice replaces
// the old one rather than intersecting with it.

import type { Category, Difficulty, GameMode } from "../../shared/types.ts";
import { QUESTION_TYPES, MIXED_TYPE_KEY } from "../../shared/questionTypes.ts";
import { COUNTRIES } from "../../shared/constants.ts";
import { PRESETS } from "../../shared/builderPresets.ts";

/**
 * The continents the builder offers, which is all of them.
 *
 * Kept here rather than imported from the client wizard so the worker does not
 * depend on a client module; the two lists are asserted equal in
 * tests/builderWizard.test.ts, which is the cheaper of the two ways to keep
 * them honest.
 */
const BUILDER_CONTINENTS = [
  "EUROPE",
  "SOUTH_AMERICA",
  "NORTH_AMERICA",
  "ASIA",
  "AFRICA",
  "OCEANIA",
] as const;
import { buildWhere, type QuestionFilter } from "./questions.ts";

export type Dimension = "types" | "continents" | "countries" | "competitions" | "presets";

/**
 * The row ceiling on a preset's count.
 *
 * A preset is a region, a country set, a competition group and a category list
 * in any combination, so unlike the other dimensions it cannot be answered by
 * one GROUP BY — the combinations do not share a column to group on. That leaves
 * one COUNT per preset, and a COUNT over this filter reads every matching row.
 *
 * It does not need to. What the preset step does with the number is decide
 * whether the card is selectable and print it; above a few thousand the exact
 * figure is decoration. So each count stops at this many rows and the client
 * renders "3,000+" when it hits the ceiling, which keeps the whole step to about
 * thirty thousand rows read instead of a hundred and fifty thousand, and is
 * still a real measurement rather than a guess.
 */
const PRESET_COUNT_CEILING = 3000;

/** The filter a dimension's counts are measured against: itself removed. */
function withoutDimension(filter: QuestionFilter, dimension: Dimension): QuestionFilter {
  switch (dimension) {
    case "presets":
      // A preset replaces the whole scope, so none of it is kept.
      return { ...filter, region: null, countries: [], competitions: [], categories: [] };
    case "types":
      return { ...filter, gameMode: null, categories: [] };
    case "continents":
      return { ...filter, region: null, countries: [], competitions: [] };
    case "countries":
      /*
        The whole country filter goes, and that INCLUDES the continent.

        A continent is expressed as the set of its countries (see
        toConfiguration — there are only three REGION scope values in the bank,
        so a region tag could not carry Asia), which means the continent and the
        country live in the same field. Keeping "the continent" here is therefore
        not possible, and it is also not wanted: the country step asks what each
        country would give you on its own, so Spain's count must be Spain's,
        not Spain-within-whatever-is-already-selected. The step renders only its
        own continent's countries, so the extra keys in the response are unused
        rather than wrong.
      */
      return { ...filter, countries: [], competitions: [] };
    case "competitions":
      return { ...filter, competitions: [] };
  }
}

const SCOPE_TYPE_FOR: Record<"countries" | "competitions", string> = {
  countries: "COUNTRY",
  competitions: "COMPETITION",
};

/**
 * One GROUP BY over a scope dimension.
 *
 * COUNT(DISTINCT q.id) rather than COUNT(*) because a question can carry the
 * same scope type more than once — a transfer between two Spanish clubs is
 * tagged COUNTRY=ESP by both ends of the move, and counting rows would report it
 * twice.
 */
function scopeDimensionQuery(
  db: D1Database,
  filter: QuestionFilter,
  dimension: "countries" | "competitions"
) {
  const { where, params } = buildWhere(withoutDimension(filter, dimension));
  return db
    .prepare(
      `SELECT s.scope_value AS value, COUNT(DISTINCT q.id) AS n
         FROM question_scopes s
         JOIN questions q ON q.id = s.question_id
        WHERE s.scope_type = ? AND ${where}
        GROUP BY s.scope_value`
    )
    .bind(SCOPE_TYPE_FOR[dimension], ...params);
}

/**
 * The (mode, category) matrix, from which every question type's count is summed.
 *
 * A type is a mode plus optionally some categories, so the counts for all twelve
 * of them live in one 5x14 grid. Reading the grid once and adding it up in
 * memory is a query; asking the database twelve times is twelve.
 */
function typeMatrixQuery(db: D1Database, filter: QuestionFilter) {
  const { where, params } = buildWhere(withoutDimension(filter, "types"));
  return db
    .prepare(
      `SELECT q.mode AS mode, q.category AS category, COUNT(*) AS n
         FROM questions q
        WHERE ${where}
        GROUP BY q.mode, q.category`
    )
    .bind(...params);
}

/**
 * A count per continent, measured through its COUNTRIES rather than its REGION tag.
 *
 * WHY NOT THE REGION TAG. There are only three REGION scope values in the whole
 * bank — WORLD, EUROPE and SOUTH_AMERICA. Asia has none, so `region = 'ASIA'`
 * matched nothing and a continent step driven by region tags would have shown
 * Asia, Africa, North America and Oceania as permanently empty. Israel alone has
 * 55 questions and is a core domain for this audience; reporting it as zero
 * because of how the scope rows happen to be written would be a data artefact
 * presented as a fact about football.
 *
 * The COUNTRY dimension is populated for all thirty countries, so a continent is
 * counted — and selected — as the set of its countries. Measured: the seven big
 * European countries give 1,111 against REGION=EUROPE's 1,106, so nothing is
 * lost on the continent that did have a tag.
 *
 * COUNT(DISTINCT ... CASE) rather than one query per continent, and distinct
 * rather than rows: a transfer between two Spanish clubs carries COUNTRY=ESP
 * twice, and a transfer from Spain to Italy would otherwise count once for each
 * end within the same continent.
 */
function continentDimensionQuery(db: D1Database, filter: QuestionFilter) {
  const { where, params } = buildWhere(withoutDimension(filter, "continents"));
  const selects: string[] = [];
  const bound: unknown[] = [];
  /*
    EVERY continent the builder offers, including the ones with no countries.

    This used to iterate the distinct continents present in COUNTRIES, which
    meant Africa and Oceania were simply absent from the response — and an
    absent count reads as "unknown", which the builder treats as "do not
    disable". The card would have been selectable and produced an empty quiz.
    Reporting an explicit zero is what makes "offered but disabled" safe.
  */
  for (const continent of BUILDER_CONTINENTS) {
    const codes = COUNTRIES.filter((country) => country.continent === continent).map((c) => c.code);
    selects.push(
      codes.length === 0
        ? // No countries at all. `CASE WHEN 0` is a constant-false branch, which
          // keeps the column in the result as a zero rather than an empty IN ()
          // list, which is not valid SQL.
          `COUNT(DISTINCT CASE WHEN 0 THEN q.id END) AS "${continent}"`
        : `COUNT(DISTINCT CASE WHEN s.scope_value IN (${codes.map(() => "?").join(",")})` +
            ` THEN q.id END) AS "${continent}"`
    );
    bound.push(...codes);
  }
  return db
    .prepare(
      `SELECT ${selects.join(", ")}
         FROM question_scopes s
         JOIN questions q ON q.id = s.question_id
        WHERE s.scope_type = 'COUNTRY' AND ${where}`
    )
    .bind(...bound, ...params);
}

/**
 * One capped COUNT per preset.
 *
 * `SELECT COUNT(*) FROM (SELECT 1 ... LIMIT n)` is the whole trick: SQLite stops
 * walking the index once the subquery has its n rows, so the cost is bounded by
 * the ceiling rather than by how much the preset matches. See
 * PRESET_COUNT_CEILING for why that is the right trade here.
 */
function presetQueries(db: D1Database, filter: QuestionFilter) {
  const base = withoutDimension(filter, "presets");
  return PRESETS.map((preset) => {
    const { where, params } = buildWhere({
      ...base,
      region: preset.region ?? base.region,
      countries: preset.countries ?? [],
      competitions: preset.competitions ?? [],
      categories: preset.categories ?? [],
    });
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM questions q WHERE ${where} LIMIT ?)`
      )
      .bind(...params, PRESET_COUNT_CEILING);
  });
}

interface MatrixRow {
  mode: string;
  category: string;
  n: number;
}

interface ValueRow {
  value: string;
  n: number;
}

function typeCountsFrom(matrix: MatrixRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const spec of QUESTION_TYPES) {
    counts[spec.key] = matrix
      .filter(
        (cell) =>
          cell.mode === spec.mode &&
          (spec.categories.length === 0 || spec.categories.includes(cell.category as Category))
      )
      .reduce((sum, cell) => sum + Number(cell.n), 0);
  }

  /*
    "מעורב" is the sum of the types it actually draws from, not the whole bank.

    The distinction matters because CLASSIC is excluded from the mixed draw — it
    is the mode the category types live inside, so counting it would count
    transfers twice. Summing the eligible types is exact rather than approximate:
    their (mode, category) cells are disjoint by construction, since no two
    specs in the mixed set claim the same category of the same mode.
  */
  counts[MIXED_TYPE_KEY] = QUESTION_TYPES.filter((spec) => spec.inMixed).reduce(
    (sum, spec) => sum + (counts[spec.key] ?? 0),
    0
  );
  return counts;
}

export interface AvailabilityResult {
  /** The current selection's own count — what the summary shows. */
  total: number;
  types?: Record<string, number>;
  continents?: Record<string, number>;
  presets?: Record<string, number>;
  /** Preset counts stop here; the client renders "N+" when one equals it. */
  presetCeiling?: number;
  countries?: Record<string, number>;
  competitions?: Record<string, number>;
}

/**
 * Counts for the current selection plus every option in the named dimensions.
 *
 * One `batch` so the whole screen costs one round trip. `total` is always
 * included: it is the figure the step header and the final summary show, and it
 * is the one number that must agree with what the quiz endpoint will actually
 * return.
 */
export async function availabilityFor(
  db: D1Database,
  filter: QuestionFilter,
  dimensions: Dimension[]
): Promise<AvailabilityResult> {
  const wanted = [...new Set(dimensions)];
  const { where, params } = buildWhere(filter);

  /*
    Statements are tracked by RANGE rather than by index, because `presets`
    contributes one statement per preset while every other dimension
    contributes exactly one. Assuming one-to-one is how the counts would end up
    attached to the wrong dimension the moment presets are requested alongside
    anything else.
  */
  const statements = [
    db.prepare(`SELECT COUNT(*) AS n FROM questions q WHERE ${where}`).bind(...params),
  ];
  const spans: { dimension: Dimension; from: number; count: number }[] = [];
  for (const dimension of wanted) {
    const from = statements.length;
    if (dimension === "types") statements.push(typeMatrixQuery(db, filter));
    else if (dimension === "continents") statements.push(continentDimensionQuery(db, filter));
    else if (dimension === "presets") statements.push(...presetQueries(db, filter));
    else statements.push(scopeDimensionQuery(db, filter, dimension));
    spans.push({ dimension, from, count: statements.length - from });
  }

  const batched = (await db.batch(statements)) as unknown as { results: unknown[] }[];

  const result: AvailabilityResult = {
    total: Number((batched[0]?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };

  for (const span of spans) {
    const rowsAt = (offset: number) => batched[span.from + offset]?.results ?? [];

    if (span.dimension === "types") {
      result.types = typeCountsFrom(rowsAt(0) as MatrixRow[]);
      continue;
    }
    if (span.dimension === "continents") {
      const row = (rowsAt(0)[0] ?? {}) as Record<string, number>;
      result.continents = Object.fromEntries(
        Object.entries(row).map(([continent, n]) => [continent, Number(n)])
      );
      continue;
    }
    if (span.dimension === "presets") {
      const counts: Record<string, number> = {};
      PRESETS.forEach((preset, offset) => {
        counts[preset.key] = Number((rowsAt(offset)[0] as { n?: number } | undefined)?.n ?? 0);
      });
      result.presets = counts;
      result.presetCeiling = PRESET_COUNT_CEILING;
      continue;
    }
    const counts: Record<string, number> = {};
    for (const row of rowsAt(0) as ValueRow[]) counts[row.value] = Number(row.n);
    result[span.dimension] = counts;
  }

  return result;
}

/** The filter shape the availability endpoint builds from a partial selection. */
export function availabilityFilter(input: {
  region: string | null;
  countries: string[];
  competitions: string[];
  categories: Category[];
  difficulty: Difficulty | "MIXED";
  gameMode: GameMode | null;
  answerMode: QuestionFilter["answerMode"];
}): QuestionFilter {
  return {
    region: input.region,
    countries: input.countries,
    competitions: input.competitions,
    categories: input.categories,
    difficulty: input.difficulty,
    gameMode: input.gameMode,
    answerMode: input.answerMode,
  };
}
