import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QUICK_PRESETS } from "../lib/presets";
import { startQuiz } from "../lib/startQuiz";
import { sound } from "../lib/sound";
import { Icon } from "../components/Icon";
import { Reveal } from "../components/Reveal";
import "./HomePage.css";

// The rotating subject line under the headline. These are the real scopes the
// bank covers, so the line is a claim the product can keep — not filler.
const SUBJECTS = [
  "לה ליגה",
  "המונדיאל",
  "ליגת האלופות",
  "העברות שחקנים",
  "פרמיירליג",
  "מסלולי קריירה",
  "סרייה א׳",
  "אצטדיונים",
];

/**
 * Facts about the bank, shown as a masthead stat strip.
 *
 * Counts are stated as floors ("1,600+") rather than the exact figure on the
 * day they were written. The bank is append-only and grows, so an exact number
 * goes stale and starts lying; a floor stays true. Check against
 * `npm run questions:stats` before raising one.
 */
const FIGURES = [
  { value: "1,600+", label: "שאלות מאומתות" },
  { value: "5", label: "רמות קושי" },
  { value: "12", label: "ליגות ותחרויות" },
  { value: "5", label: "מצבי משחק" },
];

export function HomePage() {
  const navigate = useNavigate();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState(0);

  // A slow rotation — one subject every 2.6s. Paused entirely for reduced
  // motion, where a silently changing word is a distraction, not a flourish.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setSubject((i) => (i + 1) % SUBJECTS.length), 2600);
    return () => window.clearInterval(timer);
  }, []);

  async function handlePreset(key: string, config: Parameters<typeof startQuiz>[1]) {
    setError(null);
    setLoadingKey(key);
    sound.play("click");
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
      {/* ---------- Front page ---------- */}
      <section className="page front" aria-labelledby="front-headline">
        <p className="front-kicker label">מבחן ידע · כדורגל · עברית</p>

        <h1 id="front-headline" className="front-headline display">
          כל מה שאתם חושבים
          <br />
          שאתם יודעים על כדורגל —<br />
          <span className="marked">במבחן.</span>
        </h1>

        <p className="front-subject">
          <span className="front-subject-label label">הערב על הפרק</span>
          {/* A live region would announce every rotation, which is noise — the
              subjects are decorative and the real scope list is on /build. */}
          <span className="front-subject-slot" aria-hidden="true">
            {SUBJECTS.map((item, i) => (
              <span key={item} className={`front-subject-item ${i === subject ? "is-on" : ""}`}>
                {item}
              </span>
            ))}
          </span>
        </p>

        <p className="front-lede prose">
          בונים חידון לפי הליגות, הקטגוריות ורמת הקושי שבוחרים — או מקלידים את התשובה בעצמכם, עם
          רמזים. בסוף מקבלים ציון Foot&shy;ball IQ אחד, ומשתפים אותו כאתגר.
        </p>

        <div className="front-actions">
          <button className="btn btn-ink" onClick={() => navigate("/build")}>
            בנו את המבחן
            <Icon name="arrow" size={18} />
          </button>
          <button className="btn btn-outline" onClick={() => navigate("/daily")}>
            <Icon name="calendar" size={18} />
            אתגר יומי
          </button>
        </div>

        {error && (
          <p className="front-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {/* ---------- Stat strip: the programme's credentials ---------- */}
      <div className="page">
        <hr className="rule" />
        <dl className="figures-strip">
          {FIGURES.map((figure, i) => (
            <div className="figure" key={figure.label} style={{ "--i": i } as React.CSSProperties}>
              {/* Isolated LTR: in an RTL paragraph the bidi algorithm drags the
                  trailing "+" of "1,600+" to the left, so it reads "+1,600". */}
              <dt className="figure-value figures" dir="ltr">
                {figure.value}
              </dt>
              <dd className="figure-label label">{figure.label}</dd>
            </div>
          ))}
        </dl>
        <hr className="rule" />
      </div>

      {/* ---------- Fixtures list: the quick starts ---------- */}
      <section className="page home-section" aria-labelledby="fixtures-title">
        <div className="section-head">
          <span className="section-index">01</span>
          <h2 id="fixtures-title" className="section-title">
            התחלה מהירה
          </h2>
        </div>

        <ul className="fixtures">
          {QUICK_PRESETS.map((preset, i) => (
            <Reveal as="li" key={preset.key} delay={i * 45}>
              <button
                className="fixture"
                disabled={loadingKey !== null}
                onClick={() => handlePreset(preset.key, preset.config)}
                aria-busy={loadingKey === preset.key}
              >
                <span className="fixture-index figures" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="fixture-mark">
                  <Icon name={preset.icon} size={22} />
                </span>
                <span className="fixture-body">
                  <span className="fixture-title">{preset.titleHe}</span>
                  <span className="fixture-sub">{preset.subtitleHe}</span>
                </span>
                <span className="stamp fixture-tag">{preset.tagHe}</span>
                <span className="fixture-go" aria-hidden="true">
                  {loadingKey === preset.key ? "טוען…" : <Icon name="arrow" size={20} />}
                </span>
              </button>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* ---------- Free text feature spread ---------- */}
      <section className="page home-section" aria-labelledby="freetext-title">
        <div className="section-head">
          <span className="section-index">02</span>
          <h2 id="freetext-title" className="section-title">
            בלי לבחור מתוך ארבע
          </h2>
        </div>

        <div className="spread">
          <Reveal className="spread-copy">
            <p className="prose">
              במצב תשובה חופשית אין רמז בארבע האפשרויות — מקלידים את השם. המערכת מקבלת עברית
              ואנגלית, שמות משפחה, כינויים, וגם שגיאות הקלדה סבירות: <b>ויניסיוס</b>,{" "}
              <b>Vinícius</b> ו-<b>Vini Jr</b> נחשבים לאותה תשובה.
            </p>
            <ul className="claims">
              <li>
                <Icon name="check" size={17} />
                התאמה מטושטשת עם תקציב שגיאות לפי אורך השם
              </li>
              <li>
                <Icon name="check" size={17} />
                יותר מ-4,000 כינויים ותעתיקים מוצהרים לשחקנים ולמועדונים
              </li>
              <li>
                <Icon name="check" size={17} />
                רמזים מדורגים, ואפשרות לחשוף תשובה במחיר ניקוד
              </li>
            </ul>
          </Reveal>

          {/* A static mock of the answer field — the interface explaining
              itself, rather than a stock illustration. */}
          <Reveal className="spread-demo" delay={120}>
            <div className="demo card" aria-hidden="true">
              <p className="demo-q">מי כבש את השער המנצח בגמר המונדיאל 2014?</p>
              <div className="demo-field">
                <span className="demo-typed">
                  גטצה<span className="demo-caret" />
                </span>
              </div>
              <div className="demo-verdict">
                <Icon name="check" size={17} />
                <span>נכון — התקבל ככינוי של Mario Götze</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Three clauses ---------- */}
      <section className="page home-section" aria-labelledby="how-title">
        <div className="section-head">
          <span className="section-index">03</span>
          <h2 id="how-title" className="section-title">
            איך זה עובד
          </h2>
        </div>

        <ol className="clauses">
          {[
            {
              n: "I",
              t: "בוחרים נושא",
              d: "ליגה, מדינה, קטגוריה, רמת קושי ומספר שאלות — או אחת מההתחלות המהירות.",
            },
            {
              n: "II",
              t: "עונים",
              d: "אמריקאי או תשובה חופשית. לוח הניקוד מראה רצף, התקדמות וכמה נותר.",
            },
            {
              n: "III",
              t: "משתפים",
              d: "מקבלים ציון Football IQ ושולחים לחברים קישור לאותן שאלות בדיוק.",
            },
          ].map((clause, i) => (
            <Reveal as="li" key={clause.n} delay={i * 70} className="clause">
              <span className="clause-num display" aria-hidden="true">
                {clause.n}
              </span>
              <h3 className="clause-title">{clause.t}</h3>
              <p className="clause-text">{clause.d}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ---------- Closing call ---------- */}
      <section className="page home-closing">
        <div className="closing card">
          <p className="closing-title display">מוכנים?</p>
          <p className="closing-sub">עשר שאלות. שלוש דקות. ציון אחד.</p>
          <button className="btn btn-spot" onClick={() => navigate("/build")}>
            בנו את המבחן
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}
