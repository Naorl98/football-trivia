import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QUICK_PRESETS } from "../lib/presets";
import { startQuiz } from "../lib/startQuiz";
import { sound } from "../lib/sound";
import { motionAllowed } from "../lib/a11y";
import { Icon } from "../components/Icon";
import { BallMark } from "../components/BallMark";
import "./HomePage.css";

/**
 * One screen, one decision: start.
 *
 * Headline, subtitle, a single call to action, and four one-tap starts under
 * it. There is deliberately nothing else here — no feature sections, no
 * explanation of how a quiz works. The quickest way to explain this product is
 * to let someone play it.
 */
export function HomePage() {
  const navigate = useNavigate();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreset(key: string, config: Parameters<typeof startQuiz>[1]) {
    setError(null);
    setLoadingKey(key);
    sound.play("select");
    try {
      await startQuiz(navigate, config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "משהו השתבש, נסו שוב.");
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="page home">
      <Hero />

      <h1 className="home-title a-fade-up">
        מה ה-<span className="green">Football&nbsp;IQ</span> שלכם?
      </h1>
      <p className="home-sub a-fade-up" style={{ animationDelay: "70ms" }}>
        בנו חידון ותגלו.
      </p>

      <button
        className="btn btn-primary btn-lg home-cta a-fade-up"
        style={{ animationDelay: "140ms" }}
        onClick={() => {
          sound.play("click");
          navigate("/build");
        }}
      >
        התחל משחק
        <Icon name="arrow" size={19} />
      </button>

      <div className="quick a-stagger" role="group" aria-label="התחלה מהירה">
        {QUICK_PRESETS.map((preset, i) => (
          <button
            key={preset.key}
            className="quick-btn"
            style={{ "--i": i + 3 } as React.CSSProperties}
            disabled={loadingKey !== null}
            aria-busy={loadingKey === preset.key}
            onClick={() => handlePreset(preset.key, preset.config)}
          >
            <Icon name={preset.icon} size={17} />
            <span>{loadingKey === preset.key ? "טוען…" : preset.titleHe}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="home-error a-pop" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The hero: a slowly turning ball with a few tactical lines behind it, and a
 * floodlight wash that drifts. Pointer parallax is applied to a wrapper via a
 * CSS variable so it costs one transform, and it is skipped entirely on coarse
 * pointers and under reduced motion.
 */
function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!motionAllowed()) return;
    if (window.matchMedia?.("(pointer: coarse)").matches) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { innerWidth, innerHeight } = window;
        setParallax({
          x: (event.clientX / innerWidth - 0.5) * 14,
          y: (event.clientY / innerHeight - 0.5) * 10,
        });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div
      className="hero"
      ref={ref}
      aria-hidden="true"
      style={{ "--px": `${parallax.x}px`, "--py": `${parallax.y}px` } as React.CSSProperties}
    >
      <span className="hero-light" data-ambient />
      <svg className="hero-lines" viewBox="0 0 220 120" fill="none">
        <path d="M14 96 C 60 74, 78 36, 112 28" stroke="var(--green)" strokeWidth="1.2" strokeDasharray="4 6" opacity="0.5" />
        <path d="M206 92 C 168 78, 152 44, 118 32" stroke="var(--blue)" strokeWidth="1.2" strokeDasharray="4 6" opacity="0.4" />
        <circle cx="14" cy="96" r="2.6" fill="var(--green)" opacity="0.7" />
        <circle cx="206" cy="92" r="2.6" fill="var(--blue)" opacity="0.6" />
      </svg>
      <span className="hero-ball">
        <BallMark size={78} spinning />
      </span>
    </div>
  );
}
