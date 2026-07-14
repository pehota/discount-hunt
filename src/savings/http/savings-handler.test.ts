/**
 * Integration tests for SavingsHandler (step 01-04).
 *
 * Tests the HTTP adapter's rendered HTML output for the D23 data attribute contract.
 */

import { describe, test, expect } from "bun:test";
import { createDb } from "../../shared/db.ts";
import { SQLiteSavingsRepository } from "../adapters/sqlite-savings-repository.ts";
import { SavingsService } from "../savings-service.ts";
import { SavingsHandler } from "./savings-handler.ts";

describe("SavingsHandler", () => {
  test("handleGet renders data-saved-amount attribute in cents (integer, no decimals)", async () => {
    const db = createDb(":memory:");
    const savingsRepo = new SQLiteSavingsRepository(db);
    const savingsService = new SavingsService(savingsRepo);
    const handler = new SavingsHandler(savingsService);

    // Seed a savings record directly
    savingsService.recordSavings(
      "plan-id-001",
      290,            // savedAmount in cents
      337,            // totalSalePrice
      627,            // totalRegularPrice
      3,              // itemCount
      "2026-07-13",  // weekStart
    );

    const response = await handler.handleGet(new Request("http://localhost/savings"));
    expect(response.ok).toBe(true);

    const html = await response.text();
    // D23 contract: data attribute must be present with cents integer value
    expect(html).toMatch(/data-saved-amount="290"/);
  });

  test("handleGet renders 200 with HTML content-type", async () => {
    const db = createDb(":memory:");
    const savingsRepo = new SQLiteSavingsRepository(db);
    const savingsService = new SavingsService(savingsRepo);
    const handler = new SavingsHandler(savingsService);

    const response = await handler.handleGet(new Request("http://localhost/savings"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
