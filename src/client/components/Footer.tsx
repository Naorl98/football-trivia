import { Link } from "react-router-dom";
import { openPrivacySettings } from "./PrivacyGate";
import { Icon } from "./Icon";
import "./Footer.css";

/**
 * A colophon, not a sitemap. It closes the page the way a printed programme
 * does: a rule, who made it, and the one honest line about data — with the
 * privacy controls reachable from every screen, which is the point.
 */
export function Footer() {
  return (
    <footer className="colophon">
      <hr className="rule" />
      <div className="page colophon-inner">
        <p className="colophon-line">
          <span className="colophon-mark">FOOTBALL <span className="spot">IQ</span></span>
          <span className="colophon-sep" aria-hidden="true">·</span>
          חידוני כדורגל בעברית
          <span className="colophon-sep" aria-hidden="true">·</span>
          ללא Cookie, ללא אנליטיקס, ללא חשבונות
        </p>
        <nav className="colophon-nav" aria-label="מסמכים והגדרות">
          <Link to="/privacy" className="colophon-link">
            פרטיות
          </Link>
          <button className="colophon-link colophon-btn" onClick={openPrivacySettings}>
            <Icon name="sliders" size={15} />
            הגדרות נתונים
          </button>
        </nav>
      </div>
    </footer>
  );
}
