// The multiplayer front door.
//
// Three things, in the order people actually want them: pick how you want to
// play, open a room, or get into one somebody else opened. The random duel sits
// apart from the five host-selectable modes because it is the one that needs no
// code, no friends and no waiting for anyone — it is a different kind of decision.
//
// The modes are not a grid of identical cards with icons. Each carries a small
// tactical diagram of how it plays: dots converging on one ball for a free-for-all,
// a rotation for turns, two halves for a duel. A player should be able to tell
// them apart at a glance, before reading a word.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MODES, type ModeMeta } from "../../shared/multiplayer/constants";
import type { MultiplayerMode } from "../../shared/multiplayer/types";
import { normalizeRoomCodeInput } from "../../shared/multiplayer/roomCode";
import { createRoom, fetchRoomSummary } from "../lib/api";
import { sound } from "../lib/sound";
import { Icon } from "../components/Icon";
import { readLocalStats } from "../lib/mp/identity";
import "./MultiplayerPage.css";

export function MultiplayerPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<MultiplayerMode>("CLASSIC_BATTLE");
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stats = readLocalStats();

  const hostModes = MODES.filter((m) => m.hostSelectable);

  async function create() {
    setError(null);
    setCreating(true);
    sound.play("select");
    try {
      const { code } = await createRoom(selected);
      navigate(`/room/${code}`);
    } catch {
      setError("לא הצלחנו לפתוח חדר כרגע. נסו שוב.");
    } finally {
      setCreating(false);
    }
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Accepts a pasted link or a spaced code, not just six bare digits — people
    // share the link far more often than the number.
    const code = normalizeRoomCodeInput(joinCode);
    if (!code) {
      setError("קוד חדר הוא שש ספרות.");
      return;
    }

    setJoining(true);
    sound.play("click");
    try {
      const summary = await fetchRoomSummary(code);
      if (!summary) {
        setError("החדר הזה לא קיים. בדקו את הקוד ונסו שוב.");
        return;
      }
      navigate(`/room/${code}`);
    } catch {
      setError("לא הצלחנו לבדוק את הקוד. נסו שוב.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="page mp-home">
      <header className="mp-home-head">
        <p className="tiny">מולטיפלייר</p>
        <h1 className="mp-home-title">משחק עם חברים</h1>
        <p className="mp-home-sub">קוד אחד, כמה טלפונים, ומי שחושב שהוא מבין הכי הרבה.</p>
      </header>

      <section className="mp-home-section" aria-labelledby="mp-modes-head">
        <h2 id="mp-modes-head" className="mp-home-h2">
          איך משחקים
        </h2>
        <div className="mp-modes" role="radiogroup" aria-label="בחירת סוג משחק">
          {hostModes.map((mode) => (
            <ModeCard
              key={mode.code}
              mode={mode}
              selected={selected === mode.code}
              onSelect={() => {
                sound.play("click");
                setSelected(mode.code);
              }}
            />
          ))}
        </div>

        <button className="btn btn-primary btn-lg btn-block mp-create" onClick={create} disabled={creating}>
          {creating ? "פותח חדר…" : "צור חדר"}
          {!creating && <Icon name="arrow" size={18} />}
        </button>
      </section>

      <section className="mp-home-section" aria-labelledby="mp-join-head">
        <h2 id="mp-join-head" className="mp-home-h2">
          יש לכם קוד?
        </h2>
        <form className="mp-join" onSubmit={join}>
          <label className="sr-only" htmlFor="mp-join-code">
            קוד חדר
          </label>
          <input
            id="mp-join-code"
            className="input mp-join-input num"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="482731"
            inputMode="numeric"
            autoComplete="off"
            maxLength={64}
            dir="ltr"
          />
          <button className="btn btn-ghost" type="submit" disabled={joining}>
            {joining ? "בודק…" : "הצטרף"}
          </button>
        </form>
      </section>

      <section className="mp-home-section" aria-labelledby="mp-random-head">
        <h2 id="mp-random-head" className="mp-home-h2">
          אין עם מי?
        </h2>
        <button
          className="mp-random"
          onClick={() => {
            sound.play("select");
            navigate("/multiplayer/duel");
          }}
        >
          <span className="mp-random-glyph" aria-hidden="true">
            <ModeGlyph mode="RANDOM_DUEL" />
          </span>
          <span className="mp-random-text">
            <span className="mp-random-title">דו קרב אקראי</span>
            <span className="mp-random-sub">מצא יריב עכשיו — בלי קוד, בלי הזמנות</span>
          </span>
          <Icon name="arrow" size={18} />
        </button>
      </section>

      {error && (
        <p className="mp-home-error a-pop" role="alert">
          {error}
        </p>
      )}

      {stats.played > 0 && (
        <p className="mp-home-stats tiny">
          על המכשיר הזה: {stats.played} משחקים · {stats.wins} נצחונות · רצף שיא {stats.bestStreak}
          <span className="mp-home-stats-note"> (נספר מקומית בדפדפן, לא אצלנו)</span>
        </p>
      )}
    </div>
  );
}

function ModeCard({
  mode,
  selected,
  onSelect,
}: {
  mode: ModeMeta;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`mp-mode ${selected ? "is-on" : ""}`}
      onClick={onSelect}
    >
      <span className="mp-mode-glyph" aria-hidden="true">
        <ModeGlyph mode={mode.code} />
      </span>
      <span className="mp-mode-body">
        <span className="mp-mode-title">{mode.labelHe}</span>
        <span className="mp-mode-tag">{mode.taglineHe}</span>
        <span className="mp-mode-blurb">{mode.blurbHe}</span>
      </span>
      {selected && (
        <span className="mp-mode-check" aria-hidden="true">
          <Icon name="check" size={15} strokeWidth={2.6} />
        </span>
      )}
    </button>
  );
}

/**
 * A tactical diagram per mode, drawn on the same 40-unit grid with the icon set's
 * stroke language so it sits beside the rest of the product's marks.
 *
 * These carry the actual shape of the mode — how many players, who answers when —
 * which is why they earn their place over a generic icon.
 */
export function ModeGlyph({ mode }: { mode: MultiplayerMode }) {
  const common = {
    viewBox: "0 0 40 40",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (mode) {
    // Everyone converging on one ball.
    case "CLASSIC_BATTLE":
      return (
        <svg {...common}>
          <circle cx="20" cy="20" r="4.4" fill="var(--green)" stroke="none" />
          <circle cx="20" cy="20" r="4.4" />
          {[
            [7, 9],
            [33, 9],
            [7, 31],
            [33, 31],
          ].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="2.6" />
              <path d={`M${x + (x < 20 ? 3.4 : -3.4)} ${y + (y < 20 ? 2.6 : -2.6)}L${x < 20 ? 15.8 : 24.2} ${y < 20 ? 16.6 : 23.4}`} opacity="0.5" strokeDasharray="2 2.5" />
            </g>
          ))}
        </svg>
      );

    // A rotation: one player lit, an arrow round the circle.
    case "TURN_BASED":
      return (
        <svg {...common}>
          <path d="M20 6.5a13.5 13.5 0 1 1-9.5 4" strokeDasharray="3 3" opacity="0.6" />
          <path d="M10.5 4.5v6h6" />
          <circle cx="20" cy="6.5" r="3.4" fill="var(--green)" stroke="none" />
          <circle cx="20" cy="6.5" r="3.4" />
          <circle cx="32" cy="27" r="2.6" opacity="0.65" />
          <circle cx="8" cy="27" r="2.6" opacity="0.65" />
        </svg>
      );

    // A row of shirts: all of them, every time.
    case "EVERYONE_ANSWERS":
      return (
        <svg {...common}>
          {[8, 20, 32].map((x, i) => (
            <path
              key={x}
              d={`M${x - 5} 14l2.6-1.6 2.4 1.1 2.4-1.1L${x + 5} 14l-.8 2.6-1.6-.6V27h-6V16l-1.6.6z`}
              opacity={i === 1 ? 1 : 0.6}
              fill={i === 1 ? "var(--green-wash)" : "none"}
            />
          ))}
          <path d="M6 32h28" opacity="0.4" strokeDasharray="2 3" />
        </svg>
      );

    // Two halves, one line down the middle.
    case "DUEL":
      return (
        <svg {...common}>
          <path d="M20 5v30" strokeDasharray="3 3" opacity="0.6" />
          <circle cx="20" cy="20" r="6" opacity="0.4" />
          <path d="M5 12h7M5 20h7M5 28h7" stroke="var(--green)" />
          <path d="M28 12h7M28 20h7M28 28h7" stroke="var(--amber)" />
        </svg>
      );

    // Two clusters facing off.
    case "TEAM_BATTLE":
      return (
        <svg {...common}>
          <path d="M20 5v30" strokeDasharray="3 3" opacity="0.5" />
          {[
            [8, 12],
            [13, 20],
            [8, 28],
          ].map(([x, y]) => (
            <circle key={`g${x}${y}`} cx={x} cy={y} r="3" fill="var(--green-wash)" stroke="var(--green)" />
          ))}
          {[
            [32, 12],
            [27, 20],
            [32, 28],
          ].map(([x, y]) => (
            <circle key={`a${x}${y}`} cx={x} cy={y} r="3" fill="var(--amber-wash)" stroke="var(--amber)" />
          ))}
        </svg>
      );

    // A radar sweep looking for somebody.
    case "RANDOM_DUEL":
    default:
      return (
        <svg {...common}>
          <circle cx="20" cy="20" r="14" opacity="0.35" />
          <circle cx="20" cy="20" r="8.5" opacity="0.5" />
          <circle cx="20" cy="20" r="2.4" fill="var(--green)" stroke="none" />
          <path d="M20 20L31 11" stroke="var(--green)" />
          <circle cx="29" cy="27" r="2.2" fill="var(--amber)" stroke="none" />
        </svg>
      );
  }
}
