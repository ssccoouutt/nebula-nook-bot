import { describe, expect, it } from "vitest";
import { normalizeSqliteParams } from "./db";

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
});
