import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { QUICK_PRESETS } from "../lib/presets";
import { startQuiz } from "../lib/startQuiz";
import "./HomePage.css";

export function HomePage() {
  const navigate = useNavigate();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreset(key: string, config: Parameters<typeof startQuiz>[1]) {
    setError(null);
    setLoadingKey(key);
    try {
      await startQuiz(navigate, config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "משהו השתבש, נסו שוב.");
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="home">
      <section className="hero container">
        <div className="hero-badge badge badge-green animate-in">⚽ חידוני כדורגל בעברית</div>
        <h1 className="hero-title animate-in">
          מה ה-<span className="text-green">Football IQ</span> שלכם?
        </h1>
        <p className="hero-subtitle text-dim animate-in">
          בחרו ליגות, רמת קושי וקטגוריות — ותוכיחו כמה אתם באמת יודעים בכדורגל.
        </p>
        <div className="hero-actions animate-in">
          <button className="btn btn-primary" onClick={() => navigate("/build")}>
            התחל משחק
          </button>
          <button className="btn btn-ghost" onClick={() => navigate("/daily")}>
            אתגר יומי 🔥
          </button>
        </div>
        {error && <p className="text-center" style={{ color: "var(--danger)", marginTop: 12 }}>{error}</p>}
      </section>

      <section className="container quick-section">
        <h2 className="section-title">התחלה מהירה</h2>
        <div className="quick-grid">
          {QUICK_PRESETS.map((preset) => (
            <button
              key={preset.key}
              className="card card-interactive quick-card"
              disabled={loadingKey !== null}
              onClick={() => handlePreset(preset.key, preset.config)}
            >
              <span className="quick-emoji">{preset.emoji}</span>
              <span className="quick-title">{preset.titleHe}</span>
              <span className="quick-subtitle text-dim">{preset.subtitleHe}</span>
              {loadingKey === preset.key && <span className="quick-loading">טוען…</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="container how-section">
        <h2 className="section-title">איך זה עובד</h2>
        <div className="how-steps">
          <div className="how-step">
            <div className="how-num badge-green badge">1</div>
            <p>בחרו נושא</p>
          </div>
          <div className="how-arrow text-faint">←</div>
          <div className="how-step">
            <div className="how-num badge-green badge">2</div>
            <p>ענו על השאלות</p>
          </div>
          <div className="how-arrow text-faint">←</div>
          <div className="how-step">
            <div className="how-num badge-green badge">3</div>
            <p>השוו תוצאות</p>
          </div>
        </div>
      </section>
    </div>
  );
}
