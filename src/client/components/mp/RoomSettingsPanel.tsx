// The host's control panel, in the lobby.
//
// Everything here is a *request*: each control sends an UPDATE_SETTINGS patch and
// then waits for the room to broadcast its new state. Nothing is applied
// optimistically, which is why every player's panel agrees with every other's —
// the values on screen are always the room's, never this client's guess at them.
//
// The layout follows the builder's: chips for anything multi-select, a segmented
// row for anything single-select, and the advanced filters folded away. A host
// deciding "ten questions, twenty seconds, go" should never have to scroll past
// a competition picker to find the start button.

import { useEffect, useRef, useState } from "react";
import {
  CATEGORIES,
  COMPETITIONS,
  COUNTRIES,
  DIFFICULTY_LABELS,
  ENABLED_GAME_MODES,
  GAME_MODE_LABELS,
} from "../../../shared/constants";
import { DIFFICULTIES } from "../../../shared/types";
import type { Category, Difficulty } from "../../../shared/types";
import {
  MODES,
  type ModeMeta,
  QUESTION_COUNT_CHOICES,
  SECONDS_PER_QUESTION_CHOICES,
} from "../../../shared/multiplayer/constants";
import { scoringSummaryHe } from "../../../shared/multiplayer/scoring";
import type { MultiplayerMode, RoomSettings } from "../../../shared/multiplayer/types";
import { sound } from "../../lib/sound";
import { Icon } from "../Icon";

interface Props {
  settings: RoomSettings;
  playerCount: number;
  onChange: (patch: Partial<RoomSettings>) => void;
}

export function RoomSettingsPanel({ settings, playerCount, onChange }: Props) {
  const [advanced, setAdvanced] = useState(false);
  /** Which mode's explanation is open, if any. */
  const [explaining, setExplaining] = useState<ModeMeta | null>(null);

  function patch(next: Partial<RoomSettings>) {
    sound.play("click");
    onChange(next);
  }

  function toggleCategory(code: Category) {
    const on = settings.categories.includes(code);
    patch({ categories: on ? settings.categories.filter((c) => c !== code) : [...settings.categories, code] });
  }

  function toggleCompetition(code: string) {
    const on = settings.competitions.includes(code);
    patch({ competitions: on ? settings.competitions.filter((c) => c !== code) : [...settings.competitions, code] });
  }

  function toggleCountry(code: string) {
    const on = settings.countries.includes(code);
    patch({ countries: on ? settings.countries.filter((c) => c !== code) : [...settings.countries, code] });
  }

  const modeMeta = MODES.find((m) => m.code === settings.mode);
  const tooFewForMode = modeMeta ? playerCount < modeMeta.minPlayers : false;
  const tooManyForMode = modeMeta ? playerCount > modeMeta.maxPlayers : false;

  return (
    <div className="mp-settings">
      <Group label="סוג משחק">
        {/* Each mode is a choice plus its own ⓘ, rather than a card carrying a
            paragraph nobody reads while four other options wait below it. The
            two are separate buttons so asking what a mode is never selects it. */}
        <div className="mp-modes-pick">
          {MODES.filter((m) => m.hostSelectable).map((mode) => (
            <div key={mode.code} className="mp-mode-pick">
              <SegButton
                on={settings.mode === mode.code}
                onClick={() => patch({ mode: mode.code as MultiplayerMode })}
              >
                {mode.labelHe}
              </SegButton>
              <button
                type="button"
                className="mp-mode-info"
                aria-label={`הסבר על ${mode.labelHe}`}
                onClick={() => {
                  sound.play("click");
                  setExplaining(mode);
                }}
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
            </div>
          ))}
        </div>
        {(tooFewForMode || tooManyForMode) && (
          <p className="mp-settings-warn" role="status">
            <Icon name="shield" size={14} />
            {tooFewForMode
              ? `צריך לפחות ${modeMeta!.minPlayers} שחקנים ל${modeMeta!.labelHe}`
              : `${modeMeta!.labelHe} הוא ל-${modeMeta!.maxPlayers} שחקנים בלבד`}
          </p>
        )}
      </Group>

      {explaining && <ModeExplainer mode={explaining} onClose={() => setExplaining(null)} />}

      <Group label="כמה שאלות">
        <div className="mp-seg">
          {QUESTION_COUNT_CHOICES.map((count) => (
            <SegButton key={count} on={settings.questionCount === count} onClick={() => patch({ questionCount: count })}>
              <span className="num">{count}</span>
            </SegButton>
          ))}
        </div>
      </Group>

      <Group label="זמן לשאלה">
        <div className="mp-seg">
          {SECONDS_PER_QUESTION_CHOICES.map((seconds) => (
            <SegButton
              key={seconds}
              on={settings.secondsPerQuestion === seconds}
              onClick={() => patch({ secondsPerQuestion: seconds })}
            >
              <span className="num">{seconds}</span>
              <span className="mp-seg-unit">שנ׳</span>
            </SegButton>
          ))}
        </div>
      </Group>

      <Group label="רמת קושי">
        <div className="mp-seg mp-seg-wrap">
          <SegButton on={settings.difficulty === "MIXED"} onClick={() => patch({ difficulty: "MIXED" })}>
            מעורב
          </SegButton>
          {DIFFICULTIES.map((difficulty: Difficulty) => (
            <SegButton
              key={difficulty}
              on={settings.difficulty === difficulty}
              onClick={() => patch({ difficulty })}
            >
              {DIFFICULTY_LABELS[difficulty]}
            </SegButton>
          ))}
        </div>
      </Group>

      <Group label="איך עונים">
        <div className="mp-seg">
          <SegButton
            on={settings.answerMode === "MULTIPLE_CHOICE"}
            onClick={() => patch({ answerMode: "MULTIPLE_CHOICE" })}
          >
            אמריקאי
          </SegButton>
          <SegButton on={settings.answerMode === "FREE_TEXT"} onClick={() => patch({ answerMode: "FREE_TEXT" })}>
            תשובה חופשית
          </SegButton>
        </div>
      </Group>

      <Group label="רמזים">
        <div className="mp-seg">
          <SegButton on={settings.hintsAllowed} onClick={() => patch({ hintsAllowed: true })}>
            מותר
          </SegButton>
          <SegButton on={!settings.hintsAllowed} onClick={() => patch({ hintsAllowed: false })}>
            אסור
          </SegButton>
        </div>
      </Group>

      <p className="mp-settings-scoring tiny">
        <Icon name="target" size={13} />
        {scoringSummaryHe(settings.mode, settings.hintsAllowed)}
      </p>

      <button
        type="button"
        className="btn btn-quiet btn-sm mp-settings-more"
        onClick={() => setAdvanced((open) => !open)}
        aria-expanded={advanced}
      >
        <Icon name="sliders" size={15} />
        {advanced ? "פחות אפשרויות" : "סינון מתקדם"}
      </button>

      {advanced && (
        <div className="mp-settings-advanced">
          <Group label="סוג שאלה">
            <div className="mp-seg mp-seg-wrap">
              {ENABLED_GAME_MODES.map((gameMode) => (
                <SegButton key={gameMode} on={settings.gameMode === gameMode} onClick={() => patch({ gameMode })}>
                  {GAME_MODE_LABELS[gameMode]}
                </SegButton>
              ))}
            </div>
          </Group>

          <Group label="נושאים" hint="בלי בחירה — הכול">
            <div className="row wrap g2">
              {CATEGORIES.map((category) => (
                <Chip
                  key={category.code}
                  on={settings.categories.includes(category.code)}
                  onClick={() => toggleCategory(category.code)}
                >
                  {category.labelHe}
                </Chip>
              ))}
            </div>
          </Group>

          <Group label="ליגות" hint="בלי בחירה — הכול">
            <div className="row wrap g2">
              {COMPETITIONS.filter((c) => c.code !== "ALL").map((competition) => (
                <Chip
                  key={competition.code}
                  on={settings.competitions.includes(competition.code)}
                  onClick={() => toggleCompetition(competition.code)}
                >
                  {competition.nameHe}
                </Chip>
              ))}
            </div>
          </Group>

          <Group label="מדינות" hint="בלי בחירה — הכול">
            <div className="row wrap g2">
              {COUNTRIES.map((country) => (
                <Chip
                  key={country.code}
                  on={settings.countries.includes(country.code)}
                  onClick={() => toggleCountry(country.code)}
                >
                  {country.nameHe}
                </Chip>
              ))}
            </div>
          </Group>
        </div>
      )}
    </div>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="mp-group">
      <legend className="mp-group-label tiny">
        {label}
        {hint && <span className="mp-group-hint"> · {hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

function SegButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="mp-seg-btn" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      <span className="chip-tick" aria-hidden="true">
        <Icon name="check" size={13} strokeWidth={2.6} />
      </span>
      {children}
    </button>
  );
}

/**
 * The ⓘ explanation for one mode.
 *
 * A dialog rather than a tooltip because this is reached by tap as often as by
 * pointer, and a tooltip on a phone is a thing you cannot dismiss. It closes on
 * Escape, on the backdrop and on its own button, and returns focus to the ⓘ that
 * opened it so a host tabbing through the modes does not lose their place.
 *
 * Nothing here touches room state: opening it is a local question about a mode,
 * not a change to the lobby, so the room carries on underneath.
 */
function ModeExplainer({ mode, onClose }: { mode: ModeMeta; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Focus goes back where it came from, not to the top of the document.
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [onClose]);

  return (
    <div
      className="mp-mode-explain-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="mp-mode-explain"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mp-mode-explain-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="mp-mode-explain-title" className="mp-mode-explain-title">
          {mode.labelHe}
        </h3>
        <p className="mp-mode-explain-body">{mode.explainHe}</p>
        <p className="mp-mode-explain-meta">
          {mode.minPlayers === mode.maxPlayers
            ? `${mode.minPlayers} שחקנים`
            : `${mode.minPlayers}–${mode.maxPlayers} שחקנים`}
        </p>
        <button ref={closeRef} type="button" className="btn btn-sm mp-mode-explain-close" onClick={onClose}>
          הבנתי
        </button>
      </div>
    </div>
  );
}
