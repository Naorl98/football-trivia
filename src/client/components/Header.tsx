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
  // A multiplayer room counts too: walking out of a live room costs other people
  // their game, so the links out are not on offer while one is open.
  const playing = pathname === "/play" || pathname.startsWith("/room/");

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
          {/* Hidden mid-quiz: these are trap doors out of a run. */}
          {!playing && (
            <>
              <Link to="/multiplayer" className="topbar-link">
                מולטיפלייר
              </Link>
              <Link to="/daily" className="topbar-link">
                אתגר יומי
              </Link>
            </>
          )}
          <SoundToggle />
          <A11yMenu />
        </div>
      </div>
    </header>
  );
}
