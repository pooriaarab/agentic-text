import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GuardError } from "agentic-core";
import { assertE164 } from "./vendors.js";

// Warm base: the opted-in contact list plus the STOP log. The pack
// sends to warm numbers only. A number joins through add with a
// recorded opt-in source, and leaves through recordStop. One JSON
// file holds both lists.

export interface WarmContact {
  to: string;
  name?: string;
  optedInAt: string;
  source: string;
}

export interface StopEntry {
  to: string;
  at: string;
  keyword: string;
}

export interface WarmBaseFile {
  contacts: WarmContact[];
  stops: StopEntry[];
}

const EMPTY: WarmBaseFile = { contacts: [], stops: [] };

export function defaultWarmbasePath(): string {
  const override = (process.env.AGENTIC_TEXT_WARMBASE ?? "").trim();
  if (override.length > 0) return override;
  return join(homedir(), ".agentic-text", "warmbase.json");
}

function parseFile(raw: string, path: string): WarmBaseFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`warm base at ${path} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`warm base at ${path} must hold an object`);
  }
  const { contacts, stops } = parsed as Partial<WarmBaseFile>;
  return {
    contacts: Array.isArray(contacts) ? contacts : [],
    stops: Array.isArray(stops) ? stops : [],
  };
}

export class WarmBase {
  private readonly path: string | undefined;
  private readonly contacts = new Map<string, WarmContact>();
  private readonly stops = new Map<string, StopEntry>();

  constructor(seed: WarmBaseFile = EMPTY, path?: string) {
    for (const contact of seed.contacts) {
      this.contacts.set(contact.to, { ...contact });
    }
    for (const stop of seed.stops) {
      this.stops.set(stop.to, { ...stop });
    }
    this.path = path;
  }

  static load(path: string): WarmBase {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return new WarmBase(EMPTY, path);
      }
      throw error;
    }
    return new WarmBase(parseFile(raw, path), path);
  }

  save(path?: string): void {
    const target = path ?? this.path;
    if (target === undefined) {
      throw new Error("warm base has no path, pass one to save");
    }
    mkdirSync(dirname(target), { recursive: true });
    const file: WarmBaseFile = {
      contacts: [...this.contacts.values()],
      stops: [...this.stops.values()],
    };
    writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  add(contact: {
    to: string;
    name?: string;
    source: string;
    optedInAt?: string;
  }): WarmContact {
    assertE164(contact.to, "to");
    if (contact.source.trim().length === 0) {
      throw new Error("warm contact needs an opt-in source");
    }
    const full: WarmContact = {
      to: contact.to,
      optedInAt: contact.optedInAt ?? new Date().toISOString(),
      source: contact.source,
      ...(contact.name !== undefined ? { name: contact.name } : {}),
    };
    this.contacts.set(contact.to, full);
    return { ...full };
  }

  has(to: string): boolean {
    return this.contacts.has(to);
  }

  get(to: string): WarmContact | undefined {
    const found = this.contacts.get(to);
    return found === undefined ? undefined : { ...found };
  }

  listContacts(): WarmContact[] {
    return [...this.contacts.values()].map((contact) => ({ ...contact }));
  }

  recordStop(to: string, keyword = "STOP"): StopEntry {
    assertE164(to, "to");
    const entry: StopEntry = {
      to,
      at: new Date().toISOString(),
      keyword: keyword.trim().toUpperCase() || "STOP",
    };
    this.stops.set(to, entry);
    this.contacts.delete(to);
    return { ...entry };
  }

  isStopped(to: string): boolean {
    return this.stops.has(to);
  }

  listStops(): StopEntry[] {
    return [...this.stops.values()].map((stop) => ({ ...stop }));
  }

  get size(): number {
    return this.contacts.size;
  }
}

// ensureWarm enforces warm-base-only. It throws GuardError for cold
// numbers and for numbers on the STOP log. Call it before any send,
// including dry runs, so previews match live behavior.

export function ensureWarm(to: string, base: WarmBase): WarmContact {
  if (base.isStopped(to)) {
    throw new GuardError(`${to} sent STOP and stays out of sends`);
  }
  const contact = base.get(to);
  if (contact === undefined) {
    throw new GuardError(`${to} is not in the warm base`);
  }
  return contact;
}
