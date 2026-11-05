import { assertEquals } from "@std/assert";
import { numberFromText } from "@/term/numeric.ts";

Deno.test("numberFromText matches Number() for lexical forms", () => {
  const samples = [
    "0",
    "42",
    "-7",
    "+3.5",
    "1.",
    ".5",
    "1e3",
    "-2.5E-2",
    "  12  ",
    "",
    "   ",
    "0x1F",
    "0o17",
    "0b101",
    "Infinity",
    "-Infinity",
    "+Infinity",
    "abc",
    "1abc",
    "1_000",
    "-0x1",
    "1e",
    "NaN",
  ];
  for (const sample of samples) {
    assertEquals(
      Object.is(numberFromText(sample), Number(sample)),
      true,
      `numberFromText(${JSON.stringify(sample)})`,
    );
  }
});
