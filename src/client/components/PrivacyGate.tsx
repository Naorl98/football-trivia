import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { privacy, type ConsentState } from "../lib/privacy";
import { Icon } from "./Icon";
import "./PrivacyGate.css";

const OPEN_EVENT = "fiq:privacy-open";

/** Lets any part of the app (footer link, results page) open the panel. */
export function openPrivacySettings() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * The consent banner plus the settings dialog.
 *
 * The banner is non-blocking by design: nothing here is tracking, so holding
 * the game hostage behind a modal would be dishonest friction. It sits at the
 * bottom, is reachable by keyboard, and stays until answered.
 */
export function PrivacyGate() {
  const [state, setState] = useState<ConsentState>(privacy.get());
  const [panelOpen, setPanelOpen] = useState(false);
  const bannerRef = useRef<HTMLElement | null>(null);

  useEffect(() => privacy.subscribe(setState), []);

  useEffect(() => {
    const open = () => setPanelOpen(true);
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  const showBanner = !state.decided && !panelOpen;

  // The banner and the builder's start bar both dock to the bottom edge. Rather
  // than guess at a height, publish the banner's measured height as
  // `--dock-offset` so anything else pinned to the bottom can sit above it.
  useEffect(() => {
    const root = document.documentElement;
    if (!showBanner) {
      root.style.removeProperty("--dock-offset");
      return;
    }
    const node = bannerRef.current;
    if (!node) return;
    const publish = () => root.style.setProperty("--dock-offset", `${node.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--dock-offset");
    };
  }, [showBanner]);

  return (
    <>
      {showBanner && (
        <section className="pv-banner" role="region" aria-label="הגדרות פרטיות" ref={bannerRef}>
          <div className="pv-banner-inner">
            <span className="pv-banner-mark" aria-hidden="true">
              <Icon name="lock" size={22} />
            </span>
            <div className="pv-banner-copy">
              <p className="pv-banner-title">אין כאן מעקב.</p>
              <p className="pv-banner-text">
                האתר לא משתמש בקובצי Cookie, לא באנליטיקס ולא בפרסום. כדי לשמור את החידון הפעיל,
                את בחירת הצליל ואת השאלות שראיתם — נשתמש באחסון מקומי בדפדפן שלכם בלבד.{" "}
                <Link to="/privacy" className="pv-link">
                  מה בדיוק נשמר
                </Link>
              </p>
            </div>
            <div className="pv-banner-actions">
              <button className="btn btn-ink btn-sm" onClick={() => privacy.acceptAll()}>
                מאשר הכול
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => privacy.rejectOptional()}>
                רק ההכרחי
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => setPanelOpen(true)}>
                התאמה
              </button>
            </div>
          </div>
        </section>
      )}

      {panelOpen && <PrivacyPanel state={state} onClose={() => setPanelOpen(false)} />}
    </>
  );
}

function PrivacyPanel({ state, onClose }: { state: ConsentState; onClose: () => void }) {
  const [preferences, setPreferences] = useState(state.preferences);
  const [history, setHistory] = useState(state.history);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiped, setWiped] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  // Remember where focus came from, move it into the dialog, put it back on
  // close. Without this a keyboard user is dropped at the top of the document.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    const firstControl = dialogRef.current?.querySelector<HTMLElement>("button, input, a[href]");
    firstControl?.focus();
    return () => {
      if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus();
    };
  }, []);

  // Escape closes; Tab cycles inside the dialog.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  // The page behind must not scroll while the dialog owns the screen.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function save() {
    privacy.set({ preferences, history });
    onClose();
  }

  function wipe() {
    if (!confirmingWipe) {
      setConfirmingWipe(true);
      return;
    }
    privacy.clearAllData();
    setPreferences(false);
    setHistory(false);
    setConfirmingWipe(false);
    setWiped(true);
  }

  return (
    <div className="pv-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="pv-panel card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pv-panel-title"
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <header className="pv-panel-head">
          <p className="label">Football IQ — נתונים מקומיים</p>
          <h2 id="pv-panel-title" className="pv-panel-title display">
            מה נשמר אצלכם
          </h2>
          <button className="pv-close" onClick={onClose} aria-label="סגור">
            <Icon name="cross" size={20} />
          </button>
        </header>

        <hr className="rule-thin" />

        <div className="pv-rows">
          <ConsentRow
            title="הכרחי"
            note="החידון שאתם משחקים כרגע והתוצאה האחרונה. נשמר ב-sessionStorage ונמחק כשסוגרים את הכרטיסייה. בלי זה רענון של הדף מאבד את המשחק."
            keys="fiq_active_quiz, fiq_last_result"
            checked
            locked
          />
          <ConsentRow
            title="העדפות"
            note="האם הצלילים דלוקים. בלי אישור הבחירה עדיין עובדת — היא פשוט לא נזכרת בכניסה הבאה."
            keys="fiq_sound_enabled"
            checked={preferences}
            onChange={setPreferences}
          />
          <ConsentRow
            title="היסטוריית שאלות"
            note="מזהים של עד 300 שאלות שראיתם, כדי שהחידון הבא יעדיף שאלות חדשות. בלי אישור ייתכנו חזרות."
            keys="fiq_recent_questions"
            checked={history}
            onChange={setHistory}
          />
        </div>

        <hr className="rule-thin" />

        <p className="pv-fineprint">
          אין קובצי Cookie, אין אנליטיקס, אין מזהי פרסום, ואין חשבונות. הציונים נרשמים בשרת בלי שם
          ובלי מזהה אישי. הגופנים נטענים מ-Google Fonts, כך שכתובת ה-IP שלכם נחשפת אליהם בטעינה —{" "}
          <Link to="/privacy" className="pv-link" onClick={onClose}>
            ההסבר המלא
          </Link>
          .
        </p>

        <footer className="pv-panel-foot">
          <button className="btn btn-ink" onClick={save}>
            שמור בחירה
          </button>
          <button
            className={`btn btn-sm ${confirmingWipe ? "btn-spot" : "btn-quiet"}`}
            onClick={wipe}
            onBlur={() => setConfirmingWipe(false)}
          >
            {confirmingWipe ? "בטוחים? מחק הכול" : "מחק את כל הנתונים שלי"}
          </button>
        </footer>

        {/* Announced to screen readers without stealing focus. */}
        <p className="pv-wiped" role="status">
          {wiped ? "כל הנתונים המקומיים נמחקו." : ""}
        </p>
      </div>
    </div>
  );
}

function ConsentRow({
  title,
  note,
  keys,
  checked,
  onChange,
  locked = false,
}: {
  title: string;
  note: string;
  keys: string;
  checked: boolean;
  onChange?: (value: boolean) => void;
  locked?: boolean;
}) {
  return (
    <div className="pv-row">
      <label className="pv-row-head">
        <input
          type="checkbox"
          className="pv-switch"
          checked={checked}
          disabled={locked}
          onChange={(e) => onChange?.(e.target.checked)}
        />
        <span className="pv-row-title">{title}</span>
        {locked && <span className="stamp stamp-blue">תמיד פעיל</span>}
      </label>
      <p className="pv-row-note">{note}</p>
      <code className="pv-row-keys">{keys}</code>
    </div>
  );
}
