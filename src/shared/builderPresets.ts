// The builder's scope presets: ready-made combinations of place and competition.
//
// SHARED, because the worker needs them too. The availability endpoint reports a
// real count for every preset card, which means the server has to know what each
// preset actually filters on. Keeping a second copy in the worker is how the two
// drift until a card shows a count for a filter it does not apply.

import { COUNTRIES } from "./constants.ts";
import type { Category, Region } from "./types.ts";

/**
 * A one-tap choice that fills in several fields at once.
 *
 * SCOPE PRESETS ONLY, now. The first wizard's quick-pick row mixed two different
 * kinds of thing — "ליגת האלופות" narrows where the football comes from, "מי
 * אני?" changes what the question looks like — and kept them in one list with a
 * `kind` discriminator to paper over it. The question shapes have moved to the
 * question-type step, which is where they belong and where they are now the
 * first decision the player makes. A preset is a place, a competition or a
 * ready-made combination of them, and nothing else.
 */
export interface Preset {
  key: string;
  labelHe: string;
  /** One line naming what is inside it — the spec's "small subtitle". */
  noteHe: string;
  icon: string;
  region?: Region;
  countries?: string[];
  competitions?: string[];
  categories?: Category[];
}

export const PRESETS: Preset[] = [
  {
    key: "top6",
    labelHe: "6 הליגות הגדולות",
    noteHe: "אנגליה, ספרד, איטליה, גרמניה, צרפת, פורטוגל",
    icon: "trophy",
    competitions: ["TOP_6_EUROPE"],
  },
  {
    key: "top5",
    labelHe: "5 הליגות הגדולות",
    noteHe: "בלי פורטוגל",
    icon: "trophy",
    competitions: ["TOP_5_EUROPE"],
  },
  { key: "ucl", labelHe: "ליגת האלופות", noteHe: "הגדולה באירופה", icon: "flame", competitions: ["UCL"] },
  { key: "uel", labelHe: "הליגה האירופית", noteHe: "המפעל השני של אירופה", icon: "shield", competitions: ["UEL"] },
  { key: "wc", labelHe: "מונדיאל", noteHe: "גביע העולם", icon: "globe", competitions: ["WORLD_CUP"] },
  { key: "euro", labelHe: "יורו", noteHe: "אליפות אירופה לנבחרות", icon: "globe", competitions: ["EURO"] },
  {
    key: "copa",
    labelHe: "קופה אמריקה",
    noteHe: "אליפות דרום אמריקה",
    icon: "globe",
    competitions: ["COPA_AMERICA"],
  },
  {
    key: "nations",
    labelHe: "נבחרות",
    noteHe: "כבוד לאומי בלבד",
    icon: "shirt",
    categories: ["NATIONAL_TEAMS", "WORLD_CUP"],
  },
  {
    key: "europe",
    labelHe: "אירופה",
    noteHe: "כל הליגות האירופיות",
    icon: "shield",
    countries: COUNTRIES.filter((c) => c.continent === "EUROPE").map((c) => c.code),
  },
  {
    key: "southamerica",
    labelHe: "דרום אמריקה",
    noteHe: "ברזיל, ארגנטינה, אורוגוואי",
    icon: "shield",
    countries: COUNTRIES.filter((c) => c.continent === "SOUTH_AMERICA").map((c) => c.code),
  },
  { key: "israel", labelHe: "ישראל", noteHe: "הכדורגל הישראלי", icon: "stadium", countries: ["ISR"] },
];

export const PRESET_BY_KEY = new Map(PRESETS.map((p) => [p.key, p]));
