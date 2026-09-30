import { Link, useLocation } from "react-router-dom";
import { SoundToggle } from "./SoundToggle";
import { BallMark } from "./BallMark";
import "./Header.css";

/**
 * The programme masthead.
 *
 * Set like the top of a printed matchday programme rather than a web app bar:
 * a drawn wordmark, an issue line carrying the edition metadata, and a heavy
 * ink rule closing it off. No blur, no sticky translucency.
 */
export function Header() {
  const { pathname } = useLocation();
  const onDaily = pathname === "/daily";

  return (
    <header className="masthead">
      <div className="page masthead-inner">
        <Link to="/" className="wordmark" aria-label="Football IQ — לעמוד הבית">
          <BallMark size={30} />
          <span className="wordmark-text">
            <span className="wordmark-main">FOOTBALL</span>
            <span className="wordmark-iq">IQ</span>
          </span>
        </Link>

        <p className="masthead-issue label" aria-hidden="true">
          חידון עברית · מהדורה ראשונה
        </p>

        <nav className="masthead-nav" aria-label="ניווט ראשי">
          <SoundToggle />
          <Link to="/daily" className={`masthead-link ${onDaily ? "is-current" : ""}`} aria-current={onDaily ? "page" : undefined}>
            אתגר יומי
          </Link>
        </nav>
      </div>
      <hr className="rule" />
    </header>
  );
}
