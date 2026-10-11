// Compliance helpers: STOP/HELP keywords, the opt-out footer,
// Twilio error advice, and the A2P 10DLC checklist. Pure data and
// pure functions. No network calls live here.

export const STOP_KEYWORDS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
] as const;

export const HELP_KEYWORDS = ["HELP", "INFO"] as const;

export const START_KEYWORDS = ["START", "YES", "UNSTOP"] as const;

export type InboundKind = "stop" | "help" | "start" | "unknown";

export function classifyInbound(text: string): InboundKind {
  const first = text.trim().toUpperCase().split(/\s+/)[0] ?? "";
  if ((STOP_KEYWORDS as readonly string[]).includes(first)) return "stop";
  if ((HELP_KEYWORDS as readonly string[]).includes(first)) return "help";
  if ((START_KEYWORDS as readonly string[]).includes(first)) return "start";
  return "unknown";
}

export const OPT_OUT_FOOTER = "Reply STOP to opt out.";

export function hasOptOutNotice(text: string): boolean {
  return text.toUpperCase().includes("STOP");
}

export function withOptOutFooter(brand: string, body: string): string {
  if (hasOptOutNotice(body)) return `${brand}: ${body}`;
  return `${brand}: ${body} ${OPT_OUT_FOOTER}`;
}

// Default quiet window in UTC. It covers the US night. TCPA bans
// marketing texts before 8am and after 9pm in the recipient zone,
// so set your own window per base when the base sits elsewhere.

export const QUIET_DEFAULT = { startHour: 1, endHour: 13 } as const;

export const QUIET_NOTE =
  "Default quiet window is 01:00 to 13:00 UTC. It covers the US " +
  "night. TCPA bans marketing texts before 8am and after 9pm in " +
  "the recipient zone. Set your own window per base.";

// Twilio error codes worth distinct advice. Carriers filter
// unregistered A2P traffic, so most failures point at registration.

const TWILIO_ADVICE: Record<number, string> = {
  21610:
    "The number opted out. Record the STOP and drop it from the warm base.",
  30007:
    "The carrier filtered the text. Check A2P registration and drop SHAFT terms.",
  30034:
    "The number lacks A2P 10DLC registration. Register the brand and campaign first.",
  30032:
    "The toll-free number lacks verification. Verify it before you send.",
  21408: "The account lacks geo permission for this region. Enable it first.",
};

export function twilioAdvice(code: number): string | undefined {
  return TWILIO_ADVICE[code];
}

// A2P 10DLC registration happens in vendor consoles, not in this
// pack. The pack validates that a campaign file holds every field
// a registrar asks for, so gaps show before submission.

export const A2P_USE_CASES = [
  "marketing",
  "account-notification",
  "customer-care",
  "delivery-notification",
  "fraud-alert",
  "polling-voting",
  "public-service",
  "security-alert",
] as const;

export type A2PUseCase = (typeof A2P_USE_CASES)[number];

export interface A2PCampaign {
  brandName: string;
  brandContactEmail: string;
  useCase: string;
  optInFlow: string;
  sampleOptIn: string;
  sampleOptOut: string;
  sampleHelp: string;
  helpMessage: string;
}

const CAMPAIGN_FIELDS: { key: keyof A2PCampaign; label: string }[] = [
  { key: "brandName", label: "brand name" },
  { key: "brandContactEmail", label: "brand contact email" },
  { key: "useCase", label: "campaign use case" },
  { key: "optInFlow", label: "opt-in flow" },
  { key: "sampleOptIn", label: "sample opt-in text" },
  { key: "sampleOptOut", label: "sample opt-out text" },
  { key: "sampleHelp", label: "sample help text" },
  { key: "helpMessage", label: "help reply text" },
];

export interface CampaignCheck {
  ok: boolean;
  missing: string[];
}

export function validateA2PCampaign(
  campaign: Partial<A2PCampaign>,
): CampaignCheck {
  const missing = CAMPAIGN_FIELDS.filter(
    ({ key }) =>
      typeof campaign[key] !== "string" ||
      (campaign[key] as string).trim().length === 0,
  ).map(({ label }) => label);
  const useCase = (campaign.useCase ?? "").trim();
  if (
    useCase.length > 0 &&
    !(A2P_USE_CASES as readonly string[]).includes(useCase)
  ) {
    missing.push(`use case must be one of ${A2P_USE_CASES.join(", ")}`);
  }
  return { ok: missing.length === 0, missing };
}

export interface A2PChecklist {
  steps: string[];
  useCases: string[];
  vendorLinks: Record<string, string>;
  quietNote: string;
}

export function a2pChecklist(): A2PChecklist {
  return {
    steps: [
      "Register the brand in the vendor console with a legal name and contact.",
      "Open one campaign per use case and attach each sending number.",
      "Prove the opt-in flow with a screenshot or a pasted flow.",
      "File sample texts for opt-in, opt-out, and help replies.",
      "Wait for vetting before you send volume. It takes days.",
      "Keep this pack warm-base only. Never import cold lists.",
    ],
    useCases: [...A2P_USE_CASES],
    vendorLinks: {
      twilio: "https://www.twilio.com/docs/messaging/guides/10dlc",
      telnyx: "https://developers.telnyx.com/docs/v2/messaging/10dlc",
      plivo: "https://www.plivo.com/docs/sms/compliance/us-a2p-10dlc",
    },
    quietNote: QUIET_NOTE,
  };
}
