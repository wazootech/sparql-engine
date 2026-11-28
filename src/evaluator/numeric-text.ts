import { formatNumber } from "@/term/mod.ts";

/** numericText renders a numeric value's string form, integers exactly. */
export function numericText(value: number | bigint, datatype: string): string {
  return typeof value === "bigint"
    ? value.toString()
    : formatNumber(value, datatype);
}
