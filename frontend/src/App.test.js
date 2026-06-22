import { describe, expect, it } from "vitest";

import { validateTicketExportOptions, validateTicketImportOptions } from "./App";

describe("ticket export validation", () => {
  it("requires a date range when ticket export is selected", () => {
    expect(validateTicketExportOptions({ tickets: true }, { ticketDateRange: { from: "", to: "" } })).toContain(
      "date range is required",
    );
  });

  it("allows a partial ticket export range", () => {
    expect(validateTicketExportOptions({ tickets: true }, { ticketDateRange: { from: "2026-01-01", to: "" } })).toBe("");
    expect(validateTicketExportOptions({ tickets: true }, { ticketDateRange: { from: "", to: "2026-01-31" } })).toBe("");
  });

  it("does not require ticket dates when tickets are not selected", () => {
    expect(validateTicketExportOptions({ tickets: false }, { ticketDateRange: { from: "", to: "" } })).toBe("");
  });
});

describe("ticket import validation", () => {
  it("requires a date range when the bundle contains tickets", () => {
    expect(validateTicketImportOptions({ counts: { tickets: 2 } }, { ticketDateRange: { from: "", to: "" } })).toContain(
      "ticket import date range is required",
    );
  });

  it("allows a partial ticket import range", () => {
    expect(validateTicketImportOptions({ counts: { tickets: 2 } }, { ticketDateRange: { from: "2026-01-01", to: "" } })).toBe("");
    expect(validateTicketImportOptions({ counts: { tickets: 2 } }, { ticketDateRange: { from: "", to: "2026-01-31" } })).toBe("");
  });

  it("does not require ticket import dates when the bundle has no tickets", () => {
    expect(validateTicketImportOptions({ counts: { tickets: 0 } }, { ticketDateRange: { from: "", to: "" } })).toBe("");
  });
});
