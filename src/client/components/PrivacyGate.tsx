import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { privacy, type ConsentState } from "../lib/privacy";
import { Icon } from "./Icon";
import "./PrivacyGate.css";

const OPEN_EVENT = "fiq:privacy-open";

/** Lets any part of the app open the settings panel. */
export function openPrivacySettings() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * A slim bottom bar, never a blocking modal.
 *
 * The app sets no cookies and runs no analytics, so holding the game behind a
 * full-screen wall would be theatre. The bar states what is stored, offers the
 * three real choices, and gets out of the way.
 */
export function PrivacyGate() {
  const [state, setState] = useState<ConsentState>(privacy.get());
  const [panelOpen, setPanelOpen] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);

  useEffect(() => privacy.subscribe(setState), []);

  useEffect(() => {
    const open = () => setPanelOpen(true);
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  const showBar = !state.decided && !panelOpen;

  // Publish the bar's height so anything else pinned to the bottom (the
  // builder's start bar) can sit above it instead of underneath.
  useEffect(() => {
    const root = document.documentElement;
    if (!showBar) {
      root.style.removeProperty("--dock-offset");
      return;
    }
    const node = barRef.current;
    if (!node) return;
    const publish = () => root.style.setProperty("--dock-offset", `${node.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--dock-offset");
    };
  }, [showBar]);

  return (
    <>
      {showBar && (
        <section className="pv-bar a-fade-up" role="region" aria-label="הגדרות פרטיות" ref={barRef}>
          <div className="page-wide page pv-bar-inner">
            <p className="pv-bar-text">
              אין מעקב, אין Cookie ואין אנליטיקס. שומרים רק נתונים מקומיים בדפדפן כדי שהמשחק יעבוד.{" "}
              <Link to="/privacy" className="pv-link">
                עוד
              </Link>
            </p>
            <div className="pv-bar-actions">
              <button className="btn btn-primary btn-sm" onClick={() => privacy.acceptAll()}>
                מאשר
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => privacy.rejectOptional()}>
                דוחה לא חיוני
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => setPanelOpen(true)}>
                הגדרות
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

  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>("button, input, a[href]")?.focus();
    return () => {
      if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus();
    };
  }, []);

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
      if (!focusable?.length) return;
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
        className="pv-panel card a-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pv-title"
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <header className="pv-head">
          <h2 id="pv-title" className="pv-panel-title">
            נתונים מקומיים
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגור">
            <Icon name="cross" size={17} />
          </button>
        </header>

        <Row
          title="הכרחי"
          note="החידון הפעיל והתוצאה האחרונה. נמחק כשסוגרים את הכרטיסייה."
          checked
          locked
        />
        <Row
          title="העדפות"
          note="צלילים והגדרות נגישות. בלי אישור הבחירה עובדת אך לא נזכרת."
          checked={preferences}
          onChange={setPreferences}
        />
        <Row
          title="היסטוריית שאלות"
          note="מזהים של שאלות שראיתם, כדי להעדיף שאלות חדשות."
          checked={history}
          onChange={setHistory}
        />

        <p className="pv-note">
          אין Cookie, אין אנליטיקס ואין חשבונות.{" "}
          <Link to="/privacy" className="pv-link" onClick={onClose}>
            הפירוט המלא
          </Link>
        </p>

        <div className="pv-foot">
          <button className="btn btn-primary" onClick={save}>
            שמור
          </button>
          <button
            className={`btn btn-sm ${confirmingWipe ? "btn-amber" : "btn-quiet"}`}
            onClick={wipe}
            onBlur={() => setConfirmingWipe(false)}
          >
            {confirmingWipe ? "בטוחים?" : "מחק את הנתונים שלי"}
          </button>
        </div>

        <p className="pv-wiped" role="status">
          {wiped ? "הנתונים נמחקו." : ""}
        </p>
      </div>
    </div>
  );
}

function Row({
  title,
  note,
  checked,
  onChange,
  locked = false,
}: {
  title: string;
  note: string;
  checked: boolean;
  onChange?: (value: boolean) => void;
  locked?: boolean;
}) {
  return (
    <label className="pv-row">
      <span className="pv-row-body">
        <span className="pv-row-title">
          {title}
          {locked && <span className="tag tag-blue">תמיד פעיל</span>}
        </span>
        <span className="pv-row-note">{note}</span>
      </span>
      <input
        type="checkbox"
        className="a11y-switch"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
      />
    </label>
  );
}
