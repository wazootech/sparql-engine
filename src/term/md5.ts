import { MD5_K, MD5_S } from "@/term/md5-constants.ts";

/**
 * md5Hex returns the MD5 digest of the UTF-8 encoding of the input as
 * lowercase hexadecimal.
 */
export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  // 64-bit little-endian message length in bits.
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const m = new Array<number>(16);
    for (let index = 0; index < 16; index++) {
      m[index] = view.getUint32(offset + index * 4, true);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index++) {
      let f: number;
      let g: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }
      f = (f + a + MD5_K[index] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << MD5_S[index]) | (f >>> (32 - MD5_S[index])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  // MD5 digests the words in little-endian byte order.
  const wordHex = (word: number): string => {
    let result = "";
    for (let byte = 0; byte < 4; byte++) {
      result += ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, "0");
    }
    return result;
  };
  return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0);
}
