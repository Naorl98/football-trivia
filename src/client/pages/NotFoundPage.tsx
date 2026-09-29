import { Link } from "react-router-dom";
import "./IntroPage.css";

export function NotFoundPage() {
  return (
    <div className="container intro-page">
      <div className="card intro-card">
        <div className="intro-emoji">🧭</div>
        <h1>הדף לא נמצא</h1>
        <p className="text-dim">נראה שהבעיטה הזאת פספסה את השער.</p>
        <Link className="btn btn-primary" to="/">
          חזרה לדף הבית
        </Link>
      </div>
    </div>
  );
}
