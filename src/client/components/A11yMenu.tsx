import { useCallback, useEffect, useRef, useState } from "react";
import { a11y, stepScale, TEXT_SCALES, type A11ySettings } from "../lib/a11y";
import { sound } from "../lib/sound";
import { Icon } from "./Icon";
import "./A11yMenu.css";

/**
 * The accessibility menu.
 *
 * A popover, not a page and not a sidebar — it should be one reach away and
 * then out of the way again. Everything in it takes effect immediately, with
 * no save step, because a person adjusting contrast needs to see the result
 * while they adjust it.
 */
export function A11yMenu() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<A11ySettings>(a11y.get());
  const [soundOn, setSoundOn] = useState(sound.isEnabled());
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => a11y.subscribe(setSettings), []);
  useEffect(() => sound.subscribe(setSoundOn), []);

  // Click-away and Escape both close it, and focus goes back to the trigger.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const scaleIndex = TEXT_SCALES.indexOf(settings.textScale as never);
  const atSmallest = scaleIndex <= 0;
  const atLargest = scaleIndex >= TEXT_SCALES.length - 1;

  const bump = useCallback(
    (direction: 1 | -1) => {
      a11y.set({ textScale: stepScale(settings.textScale, direction) });
      sound.play("click");
    },
    [settings.textScale]
  );

  return (
    <div className="a11y">
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="הגדרות נגישות"
        title="הגדרות נגישות"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="accessibility" size={18} />
      </button>

      {open && (
        <div className="a11y-panel card a-pop" role="dialog" aria-label="הגדרות נגישות" ref={panelRef}>
          <p className="a11y-title">נגישות</p>

          <div className="a11y-row">
            <span className="a11y-label">גודל טקסט</span>
            <div className="a11y-stepper">
              <button
                type="button"
                className="a11y-step"
                onClick={() => bump(-1)}
                disabled={atSmallest}
                aria-label="הקטנת טקסט"
              >
                −
              </button>
              <span className="a11y-scale num" aria-live="polite">
                {Math.round(settings.textScale * 100)}%
              </span>
              <button
                type="button"
                className="a11y-step"
                onClick={() => bump(1)}
                disabled={atLargest}
                aria-label="הגדלת טקסט"
              >
                +
              </button>
            </div>
          </div>

          <Switch
            label="ניגודיות גבוהה"
            checked={settings.highContrast}
            onChange={(v) => a11y.set({ highContrast: v })}
          />
          <Switch
            label="ביטול אנימציות"
            checked={settings.reduceMotion}
            onChange={(v) => a11y.set({ reduceMotion: v })}
          />
          <Switch
            label="ביטול צלילים"
            checked={!soundOn}
            onChange={(v) => sound.setEnabled(!v)}
          />
          <Switch
            label="הדגשת קישורים"
            checked={settings.underlineLinks}
            onChange={(v) => a11y.set({ underlineLinks: v })}
          />

          <button type="button" className="btn btn-quiet btn-sm a11y-reset" onClick={() => a11y.reset()}>
            איפוס
          </button>
        </div>
      )}
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="a11y-row a11y-switch-row">
      <span className="a11y-label">{label}</span>
      {/* A real checkbox underneath, so keyboard and assistive tech get the
          platform behaviour; only the appearance is ours. */}
      <input
        type="checkbox"
        className="a11y-switch"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
          sound.play("click");
        }}
      />
    </label>
  );
}
