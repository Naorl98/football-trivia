import { useEffect, useState } from "react";
import { sound } from "../lib/sound";

export function SoundToggle() {
  const [enabled, setEnabled] = useState(sound.isEnabled());

  useEffect(() => sound.subscribe(setEnabled), []);

  return (
    <button
      type="button"
      className="badge sound-toggle"
      onClick={() => {
        sound.toggle();
        // Give audible confirmation when turning it back on.
        if (!enabled) sound.play("click");
      }}
      aria-pressed={enabled}
      aria-label={enabled ? "כבה צלילים" : "הפעל צלילים"}
      title={enabled ? "כבה צלילים" : "הפעל צלילים"}
    >
      <span aria-hidden="true">{enabled ? "🔊" : "🔇"}</span>
    </button>
  );
}
