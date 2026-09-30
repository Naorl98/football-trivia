// Room codes.
//
// Six numeric digits, because the code is read aloud across a room and typed on
// a phone keypad. Letters would halve the length but would also introduce the
// O/0, I/1, S/5 problems and force a full keyboard; digits get a numeric keypad
// on every mobile browser for free.
//
// Uniqueness is NOT enforced here. Each code addresses one Durable Object by
// name, and that object claims itself atomically on first use (see
// RoomDurableObject.claim): a Durable Object processes one request at a time, so
// two racing creations cannot both win the same code. The creator retries with a
// fresh code when a claim is refused. That keeps code allocation free of a
// central registry that every room creation would have to queue behind.

export const ROOM_CODE_LENGTH = 6;

const CODE_PATTERN = /^[0-9]{6}$/;

/** True for a string that could be a room code. Says nothing about whether it exists. */
export function isValidRoomCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/**
 * Normalizes what a player typed or pasted into a candidate code.
 *
 * People paste whole links, add spaces, or type the code with a dash in the
 * middle. Everything that is not a digit is dropped and the LAST six digits are
 * kept, so "https://…/room/482731" and "482-731" both land on 482731.
 * Returns null when there is no six-digit run to be had.
 */
export function normalizeRoomCodeInput(input: string): string | null {
  const digits = (input ?? "").replace(/\D+/g, "");
  if (digits.length < ROOM_CODE_LENGTH) return null;
  return digits.slice(-ROOM_CODE_LENGTH);
}

/**
 * A fresh random code.
 *
 * `randomSource` is injected so tests can drive the generator deterministically;
 * in production it is crypto.getRandomValues, which both Workers and browsers
 * provide. Rejection sampling keeps the digits uniform: taking a byte modulo 10
 * would make 0-5 slightly likelier than 6-9, and while that would not break
 * anything it would show up as a bias in a large enough sample of codes.
 */
export function generateRoomCode(randomSource?: (bytes: Uint8Array) => void): string {
  const fill =
    randomSource ??
    ((bytes: Uint8Array) => {
      // The cast is only about the lib's ArrayBuffer/SharedArrayBuffer split:
      // this buffer is always a plain ArrayBuffer, as the line below shows.
      crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
    });

  let code = "";
  const buffer = new Uint8Array(new ArrayBuffer(ROOM_CODE_LENGTH * 2));
  let cursor = buffer.length;

  while (code.length < ROOM_CODE_LENGTH) {
    if (cursor >= buffer.length) {
      fill(buffer);
      cursor = 0;
    }
    const byte = buffer[cursor++];
    // 250 is the largest multiple of 10 at or below 256; anything above it is
    // discarded rather than folded in.
    if (byte >= 250) continue;
    code += String(byte % 10);
  }
  return code;
}

/** The URL a player scans or taps to join. Always absolute — it goes into a QR code. */
export function roomJoinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/room/${code}`;
}

/** Grouped for reading aloud: "482 731". */
export function formatRoomCode(code: string): string {
  return code.length === ROOM_CODE_LENGTH ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
