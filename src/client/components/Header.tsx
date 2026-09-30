import { Link, useLocation } from "react-router-dom";
import { BallMark } from "./BallMark";
import { SoundToggle } from "./SoundToggle";
import { A11yMenu } from "./A11yMenu";
import "./Header.css";

/**
 * A thin, quiet bar: the mark, and the two controls a player might reach for
 * mid-game. Everything else lives on the pages themselves — a trivia game does
 * not need navigation.
 */
export function Header() {
  const { pathname } = useLocation();
  const playing = pathname === "/play";

  return (
    <header className="topbar">
      <div className="page-wide page topbar-inner">
        <Link to="/" className="mark" aria-label="Football IQ — לעמוד הבית">
          <BallMark size={26} />
          <span className="mark-text">
            Football <span className="green">IQ</span>
          </span>
        </Link>

        <div className="row g2">
          {/* Hidden mid-quiz: the daily link is a trap door out of a run. */}
          {!playing && (
            <Link to="/daily" className="topbar-link">
              אתגר יומי
            </Link>
          )}
          <SoundToggle />
          <A11yMenu />
        </div>
      </div>
    </header>
  );
}
