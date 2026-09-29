import { Link } from "react-router-dom";
import "./Header.css";

export function Header() {
  return (
    <header className="site-header">
      <div className="container row" style={{ justifyContent: "space-between", height: "var(--header-h)" }}>
        <Link to="/" className="row gap-2 brand">
          <span className="brand-mark">⚽</span>
          <span className="brand-name">
            Football <span className="text-green">IQ</span>
          </span>
        </Link>
        <Link to="/daily" className="badge badge-gold">
          אתגר יומי
        </Link>
      </div>
    </header>
  );
}
