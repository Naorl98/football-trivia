const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Short, URL-friendly public id (avoids visually ambiguous chars like 0/O, 1/l/I).
 *
 * This id is the only thing standing between a challenge URL and anyone who
 * guesses it, so the digits have to be uniform. `bytes[i] % 57` is not: 256 is
 * not a multiple of 57, so the first 28 letters of the alphabet came up slightly
 * more often than the rest and the id was worth a little less than the 46 bits
 * its length suggests. Rejection sampling discards the bytes that would skew it
 * — the same approach, and the same reasoning, as the room-code generator.
 */
export function generatePublicId(length = 8): string {
  // The largest multiple of the alphabet size that fits in a byte; anything at
  // or above it is thrown away rather than folded back in.
  const ceiling = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

  let id = "";
  // Asking for extra up front keeps this to one or two CSRNG calls: with a
  // ceiling of 228, about one byte in nine is discarded.
  const buffer = new Uint8Array(length * 2);
  let cursor = buffer.length;

  while (id.length < length) {
    if (cursor >= buffer.length) {
      crypto.getRandomValues(buffer);
      cursor = 0;
    }
    const byte = buffer[cursor++];
    if (byte >= ceiling) continue;
    id += ALPHABET[byte % ALPHABET.length];
  }
  return id;
}
