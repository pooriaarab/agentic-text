import { describe, expect, test } from "vitest";
import { GuardError } from "agentic-core";
import {
  checkProspectCompliance,
  ensureProspect,
  findProspect,
  parseProspectCsv,
  prospectFromRow,
} from "./prospects.js";

const TO = "+15551234567";

const row = {
  phone: TO,
  basis: "prior purchase",
  evidence_url: "https://example.com/consent/1",
  no_solicitation_flag: "false",
  do_not_contact: "0",
};

describe("prospect compliance columns", () => {
  test("a complete row passes", () => {
    expect(() =>
      checkProspectCompliance(prospectFromRow(row)),
    ).not.toThrow();
  });

  test("do-not-contact and no-solicitation flags refuse", () => {
    for (const override of [
      { do_not_contact: "true" },
      { do_not_contact: "1" },
      { no_solicitation_flag: "yes" },
      { no_solicitation_flag: "TRUE" },
    ])
      expect(() =>
        checkProspectCompliance(prospectFromRow({ ...row, ...override })),
      ).toThrow(GuardError);
  });

  test("a missing basis or evidence_url refuses", () => {
    expect(() =>
      checkProspectCompliance(prospectFromRow({ ...row, basis: "  " })),
    ).toThrow(/basis/);
    expect(() =>
      checkProspectCompliance(prospectFromRow({ ...row, evidence_url: "" })),
    ).toThrow(/evidence_url/);
  });

  test("csv parses and finds rows by phone", () => {
    const csv = [
      "phone,basis,evidence_url,no_solicitation_flag,do_not_contact",
      `${TO},prior purchase,https://example.com/consent/1,false,false`,
      "+15550001111,web form,https://example.com/consent/2,true,false",
    ].join("\n");
    const prospects = parseProspectCsv(csv);
    expect(prospects).toHaveLength(2);
    expect(findProspect(prospects, TO)?.basis).toBe("prior purchase");
    expect(findProspect(prospects, "+19995550100")).toBeUndefined();
    expect(parseProspectCsv("phone,basis\n")).toEqual([]);
  });

  test("ensureProspect enforces presence and flags", () => {
    const prospects = parseProspectCsv(
      [
        "phone,basis,evidence_url,no_solicitation_flag,do_not_contact",
        `${TO},prior purchase,https://example.com/consent/1,false,false`,
      ].join("\n"),
    );
    expect(ensureProspect(prospects, TO).phone).toBe(TO);
    expect(() => ensureProspect(prospects, "+19995550100")).toThrow(
      /no prospect row/,
    );
    expect(() =>
      ensureProspect([{ ...prospects[0]!, do_not_contact: true }], TO),
    ).toThrow(GuardError);
  });
});
