import { GuardError, VendorError } from "agentic-core";

// Prospect compliance columns shared with the growth-prospect-list
// format. A prospect row must carry a consent basis and an evidence
// URL. Rows flagged no-solicitation or do-not-contact never receive
// texts. Pure data and pure functions. No network calls live here.
export interface ProspectContact {
  phone: string;
  basis: string;
  evidence_url: string;
  no_solicitation_flag: boolean;
  do_not_contact: boolean;
}

export function checkProspectCompliance(
  prospect: ProspectContact,
): void {
  if (prospect.do_not_contact)
    throw new GuardError("prospect is on do-not-contact");
  if (prospect.no_solicitation_flag)
    throw new GuardError("prospect has a no-solicitation flag");
  if (prospect.basis.trim().length === 0)
    throw new VendorError("prospect needs a consent basis");
  if (prospect.evidence_url.trim().length === 0)
    throw new VendorError("prospect needs an evidence_url");
}

function parseFlag(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value ?? "").trim().toLowerCase());
}

export function prospectFromRow(
  row: Record<string, string | undefined>,
): ProspectContact {
  return {
    phone: (row["phone"] ?? "").trim(),
    basis: (row["basis"] ?? "").trim(),
    evidence_url: (row["evidence_url"] ?? "").trim(),
    no_solicitation_flag: parseFlag(row["no_solicitation_flag"]),
    do_not_contact: parseFlag(row["do_not_contact"]),
  };
}

export function parseProspectCsv(text: string): ProspectContact[] {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const row: Record<string, string | undefined> = {};
    for (const [index, header] of headers.entries()) row[header] = cells[index];
    return prospectFromRow(row);
  });
}

export function findProspect(
  prospects: ProspectContact[],
  phone: string,
): ProspectContact | undefined {
  return prospects.find((prospect) => prospect.phone === phone);
}

export function ensureProspect(
  prospects: ProspectContact[],
  phone: string,
): ProspectContact {
  const prospect = findProspect(prospects, phone);
  if (prospect === undefined)
    throw new VendorError(`no prospect row for ${phone}`);
  checkProspectCompliance(prospect);
  return prospect;
}
