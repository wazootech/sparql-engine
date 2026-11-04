/**
 * sha1Hex returns the SHA-1 digest of the UTF-8 encoding of the input as
 * lowercase hexadecimal.
 */
export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  // 64-bit big-endian message length in bits.
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const rotateLeft = (value: number, bits: number): number =>
    ((value << bits) | (value >>> (32 - bits))) >>> 0;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const w = new Array<number>(80);
    for (let index = 0; index < 16; index++) {
      w[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 80; index++) {
      w[index] = rotateLeft(
        w[index - 3] ^ w[index - 8] ^ w[index - 14] ^ w[index - 16],
        1,
      );
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let index = 0; index < 80; index++) {
      let f: number;
      let k: number;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotateLeft(a, 5) + f + e + k + w[index]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const wordHex = (word: number): string => word.toString(16).padStart(8, "0");
  return wordHex(h0) + wordHex(h1) + wordHex(h2) + wordHex(h3) +
    wordHex(h4);
}
