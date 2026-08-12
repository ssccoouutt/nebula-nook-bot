import { describe, expect, it } from "vitest";
import {
  DEFAULT_TESTING_PRODUCTS,
  TESTING_WALLET_CREDIT_CENTS,
  TESTING_WALLET_CREDIT_REFERENCE,
} from "./telegram";

describe("testing bootstrap", () => {
  it("uses a ten-dollar wallet credit with a stable idempotency reference", () => {
    expect(TESTING_WALLET_CREDIT_CENTS).toBe(1000);
    expect(TESTING_WALLET_CREDIT_REFERENCE).toBe("testing-wallet-credit-v1");
    expect(TESTING_WALLET_CREDIT_REFERENCE).toMatch(/^[a-z0-9-]+$/);
  });

  it("provides an original active starter catalog with a free item", () => {
    expect(DEFAULT_TESTING_PRODUCTS.length).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_TESTING_PRODUCTS.every((product) => product.active === 1)).toBe(true);
    expect(DEFAULT_TESTING_PRODUCTS.every((product) => product.stock > 0)).toBe(true);
    expect(DEFAULT_TESTING_PRODUCTS.some((product) => product.freeEligible === 1)).toBe(true);
    expect(new Set(DEFAULT_TESTING_PRODUCTS.map((product) => product.name)).size).toBe(DEFAULT_TESTING_PRODUCTS.length);
  });
});
