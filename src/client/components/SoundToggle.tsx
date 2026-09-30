import { useEffect, useState } from "react";
import { sound } from "../lib/sound";
import { Icon } from "./Icon";

export function SoundToggle() {
  const [enabled, setEnabled] = useState(sound.isEnabled());

  useEffect(() => sound.subscribe(setEnabled), []);

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        sound.toggle();
        // Give audible confirmation when turning it back on.
        if (!enabled) sound.play("click");
      }}
      aria-pressed={enabled}
      aria-label={enabled ? "כבה צלילים" : "הפעל צלילים"}
      title={enabled ? "כבה צלילים" : "הפעל צלילים"}
    >
      <Icon name={enabled ? "sound-on" : "sound-off"} size={18} />
    </button>
  );
}
