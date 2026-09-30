import { Link, useLocation } from "react-router-dom";
import { openPrivacySettings } from "./PrivacyGate";
import "./Footer.css";

/**
 * Two links and a line. It disappears entirely mid-quiz, where nothing below
 * the answers should compete for attention.
 */
export function Footer() {
  const { pathname } = useLocation();
  if (pathname === "/play") return null;

  return (
    <footer className="foot">
      <div className="page-wide page foot-inner">
        <span className="foot-text">Football IQ · חידוני כדורגל בעברית</span>
        <nav className="foot-nav" aria-label="מידע">
          <Link to="/privacy" className="foot-link">
            פרטיות
          </Link>
          <button className="foot-link foot-btn" onClick={openPrivacySettings}>
            נתונים
          </button>
        </nav>
      </div>
    </footer>
  );
}
