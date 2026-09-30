// QR codes for the room link.
//
// The encoding (Reed-Solomon error correction, mask selection, version fitting)
// comes from `qrcode-generator` — hand-rolling that would be a lot of code to get
// subtly wrong, and a QR that scans on some phones and not others is worse than
// no QR at all.
//
// The RENDERING is ours, because the library's own renderers emit a table or an
// <img> and both would look pasted in. This returns one SVG path: every dark
// module as a rounded square, drawn in `currentColor` so the code inherits the
// ink of whatever it sits in, exactly like the icon set.
//
// Error correction level M is the right trade for this job: it survives a phone
// camera at an angle across a room, without inflating the module count the way H
// would and making each module too small to resolve on a laptop screen.

import qrcode from "qrcode-generator";

export interface QrRender {
  /** Module count per side, excluding the quiet zone. */
  count: number;
  /** viewBox side length, including the quiet zone. */
  size: number;
  /** A single `d` attribute covering every dark module. */
  path: string;
}

/** The four-module silent border the QR spec requires for reliable scanning. */
const QUIET_ZONE = 2;

/**
 * How round each module is, as a fraction of its size.
 *
 * Small on purpose. Rounded modules read as designed rather than dot-matrix, but
 * past about 0.2 the corners start eating the contrast a scanner relies on.
 */
const RADIUS = 0.18;

export function renderQr(text: string): QrRender {
  // Type 0 = "pick the smallest version that fits".
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;

  const parts: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      const x = col + QUIET_ZONE;
      const y = row + QUIET_ZONE;
      parts.push(roundedSquare(x, y, RADIUS));
    }
  }

  return { count, size, path: parts.join(" ") };
}

/**
 * One module as a rounded unit square, written as arcs so the whole code is a
 * single path rather than hundreds of elements.
 */
function roundedSquare(x: number, y: number, r: number): string {
  const s = 1;
  return [
    `M${x + r} ${y}`,
    `h${s - r * 2}`,
    `a${r} ${r} 0 0 1 ${r} ${r}`,
    `v${s - r * 2}`,
    `a${r} ${r} 0 0 1 ${-r} ${r}`,
    `h${-(s - r * 2)}`,
    `a${r} ${r} 0 0 1 ${-r} ${-r}`,
    `v${-(s - r * 2)}`,
    `a${r} ${r} 0 0 1 ${r} ${-r}`,
    "z",
  ].join(" ");
}
