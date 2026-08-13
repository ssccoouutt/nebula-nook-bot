import { describe, expect, it } from "vitest";
import { normalizeSqliteParams, normalizeSqliteRow } from "./db";

describe("SQLite parameter normalization", () => {
  it("converts unsupported values without changing supported values", () => {
    const date = new Date("2026-08-13T00:00:00.000Z");
    expect(normalizeSqliteParams([undefined, date, true, false, 42n, "value", null])).toEqual([
      null,
      date.getTime(),
      1,
      0,
      42,
      "value",
      null,
    ]);
  });

  it("converts native SQLite result objects to positional Drizzle rows", () => {
    expect(normalizeSqliteRow({ id: 17, balanceCents: 1000 })).toEqual([17, 1000]);
    expect(normalizeSqliteRow(undefined)).toBeUndefined();
  });
});
