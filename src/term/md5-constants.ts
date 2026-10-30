/**
 * hash.ts implements the SPARQL 1.1 hash functions (MD5, SHA-1, SHA-256,
 * SHA-384, SHA-512) synchronously in pure TypeScript, so the expression
 * evaluator can call them without awaiting. SHA-1/SHA-256 use 32-bit word
 * arithmetic; SHA-384/SHA-512 use BigInt for the 64-bit words. All five
 * return lowercase hexadecimal strings of the digest.
 *
 * Prior art: the algorithms are the standard published message digests —
 * MD5 per IETF RFC 1321 and the SHA family per NIST FIPS 180-4 (which
 * SPARQL 1.1 §17.4.1.7 delegates to).
 * @see {@link https://www.rfc-editor.org/rfc/rfc1321 Rivest, "The MD5 Message-Digest Algorithm," IETF RFC 1321, 1992}
 * @see {@link https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf NIST, "Secure Hash Standard (SHS)," FIPS PUB 180-4, 2015}
 */

export const MD5_S = [
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
];

/**
 * MD5_K holds the 64 round constants, defined as floor(|sin(i+1)| * 2^32).
 */
export const MD5_K: number[] = Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000),
);
