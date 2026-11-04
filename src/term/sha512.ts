import { SHA512_K } from "@/term/sha512-constants.ts";

const MASK64 = 0xffffffffffffffffn;

const rotateRight64 = (value: bigint, bits: bigint): bigint =>
  ((value >> bits) | (value << (64n - bits))) & MASK64;

/**
 * sha512Digest runs the SHA-512 compression over the input with the given
 * initial hash values, returning the 8 state words (or a prefix of them for
 * SHA-384).
 */
function sha512Words(
  input: string,
  initial: bigint[],
): bigint[] {
  const bytes = new TextEncoder().encode(input);
  const bitLength = BigInt(bytes.length * 8);
  const paddedLength = (((bytes.length + 16) >> 7) + 1) << 7;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  // 128-bit big-endian message length in bits.
  view.setBigUint64(paddedLength - 16, bitLength >> 64n, false);
  view.setBigUint64(paddedLength - 8, bitLength & MASK64, false);

  let state = [...initial];
  for (let offset = 0; offset < paddedLength; offset += 128) {
    const w = new Array<bigint>(80);
    for (let index = 0; index < 16; index++) {
      w[index] = view.getBigUint64(offset + index * 8, false);
    }
    for (let index = 16; index < 80; index++) {
      const s0 = rotateRight64(w[index - 15], 1n) ^
        rotateRight64(w[index - 15], 8n) ^ (w[index - 15] >> 7n);
      const s1 = rotateRight64(w[index - 2], 19n) ^
        rotateRight64(w[index - 2], 61n) ^ (w[index - 2] >> 6n);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 80; index++) {
      const s1 = rotateRight64(e, 14n) ^ rotateRight64(e, 18n) ^
        rotateRight64(e, 41n);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA512_K[index] + w[index]) & MASK64;
      const s0 = rotateRight64(a, 28n) ^ rotateRight64(a, 34n) ^
        rotateRight64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) & MASK64;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK64;
    }
    state = [
      (a + state[0]) & MASK64,
      (b + state[1]) & MASK64,
      (c + state[2]) & MASK64,
      (d + state[3]) & MASK64,
      (e + state[4]) & MASK64,
      (f + state[5]) & MASK64,
      (g + state[6]) & MASK64,
      (h + state[7]) & MASK64,
    ];
  }
  return state;
}

const SHA512_IV = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];

const SHA384_IV = [
  0xcbbb9d5dc1059ed8n,
  0x629a292a367cd507n,
  0x9159015a3070dd17n,
  0x152fecd8f70e5939n,
  0x67332667ffc00b31n,
  0x8eb44a8768581511n,
  0xdb0c2e0d64f98fa7n,
  0x47b5481dbefa4fa4n,
];

const word64Hex = (word: bigint): string => word.toString(16).padStart(16, "0");

/**
 * sha384Hex returns the SHA-384 digest of the UTF-8 encoding of the input as
 * lowercase hexadecimal.
 */
export function sha384Hex(input: string): string {
  return sha512Words(input, SHA384_IV).slice(0, 6).map(word64Hex).join("");
}

/**
 * sha512Hex returns the SHA-512 digest of the UTF-8 encoding of the input as
 * lowercase hexadecimal.
 */
export function sha512Hex(input: string): string {
  return sha512Words(input, SHA512_IV).map(word64Hex).join("");
}
