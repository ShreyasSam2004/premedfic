/**
 * Versioned homeowner message templates.
 *
 * Tone rules (enforced by `lintMessage` and unit tests): plain language, no
 * implication of fault, payment, penalties, or legal conclusions.
 */

export type Channel = "email" | "sms" | "letter";
export type TemplateId = "initial_notice" | "follow_up" | "info_request" | "verification_code" | "status_update";

export interface TemplateContext {
  ownerName: string | null;
  permitNumber: string;
  address: string;
  categoryLabel: string;
  departmentName: string;
  departmentPhone: string | null;
  departmentEmail: string | null;
  portalUrl: string;
  requestedItems: string[];
  requestMessage?: string;
  code?: string;
  statusMessage?: string;
}

export const PORTAL_LINK_PLACEHOLDER = "[secure portal link — generated when the message is sent]";

const greeting = (c: TemplateContext) => `Hello ${c.ownerName ?? "Property Owner"},`;
const contactLine = (c: TemplateContext) =>
  `If you have questions, contact ${c.departmentName}${c.departmentPhone ? ` at ${c.departmentPhone}` : ""}${c.departmentEmail ? ` or ${c.departmentEmail}` : ""}.`;
const items = (c: TemplateContext) => c.requestedItems.map((i) => `  • ${i}`).join("\n");

type Renderer = (c: TemplateContext) => { subject: string | null; body: string };

export const TEMPLATES: Record<TemplateId, { version: number; channels: Partial<Record<Channel, Renderer>> }> = {
  initial_notice: {
    version: 1,
    channels: {
      email: (c) => ({
        subject: `Building permit ${c.permitNumber} — information requested`,
        body: [
          greeting(c),
          "",
          `Our records indicate that a building permit associated with your property at ${c.address} may still require administrative resolution.`,
          "",
          `Permit: ${c.permitNumber} (${c.categoryLabel})`,
          "",
          "This message is not a finding that anything is wrong with your property. Older permits often remain open because a final step was never recorded. If the work was completed, documentation from you helps us review the record.",
          "",
          "Please review the information and provide any requested documentation:",
          items(c),
          "",
          "You can view the permit details and upload documents securely here:",
          c.portalUrl,
          "",
          "To protect your privacy, you will be asked to confirm a one-time code before any case details are shown.",
          "",
          contactLine(c),
          "If you are no longer the owner of this property, please let us know.",
          "",
          c.departmentName,
        ].join("\n"),
      }),
      sms: (c) => ({
        subject: null,
        body: `${c.departmentName}: Our records show building permit ${c.permitNumber} for ${c.address} may need administrative resolution. Review and upload documents: ${c.portalUrl} Reply STOP to opt out of texts.`,
      }),
      letter: (c) => ({
        subject: `Building permit ${c.permitNumber}`,
        body: [
          greeting(c),
          "",
          `Our records indicate that a building permit associated with your property at ${c.address} may still require administrative resolution (permit ${c.permitNumber}, ${c.categoryLabel}).`,
          "",
          "This letter is not a finding that anything is wrong with your property. Please review the information and provide any requested documentation:",
          items(c),
          "",
          `You can respond online at ${c.portalUrl} or by contacting our office.`,
          "",
          contactLine(c),
          "",
          c.departmentName,
        ].join("\n"),
      }),
    },
  },
  follow_up: {
    version: 1,
    channels: {
      email: (c) => ({
        subject: `Reminder: building permit ${c.permitNumber}`,
        body: [
          greeting(c),
          "",
          `We recently wrote about building permit ${c.permitNumber} for ${c.address}. If you have documentation of the completed work, you can share it securely here:`,
          c.portalUrl,
          "",
          "Requested items:",
          items(c),
          "",
          contactLine(c),
          "",
          c.departmentName,
        ].join("\n"),
      }),
      sms: (c) => ({
        subject: null,
        body: `${c.departmentName}: Reminder about permit ${c.permitNumber} for ${c.address}. Share documents securely: ${c.portalUrl} Reply STOP to opt out.`,
      }),
    },
  },
  info_request: {
    version: 1,
    channels: {
      email: (c) => ({
        subject: `Building permit ${c.permitNumber} — the reviewer has a question`,
        body: [
          greeting(c),
          "",
          `Thank you for the information you provided about permit ${c.permitNumber}. The reviewer has asked for the following:`,
          "",
          c.requestMessage ?? "",
          "",
          "You can respond securely here:",
          c.portalUrl,
          "",
          contactLine(c),
          "",
          c.departmentName,
        ].join("\n"),
      }),
    },
  },
  verification_code: {
    version: 1,
    channels: {
      email: (c) => ({
        subject: `Your verification code`,
        body: `Your ${c.departmentName} verification code is ${c.code}. It expires in 15 minutes. If you did not request it, you can ignore this message.`,
      }),
      sms: (c) => ({
        subject: null,
        body: `${c.departmentName} verification code: ${c.code}. Expires in 15 minutes.`,
      }),
    },
  },
  status_update: {
    version: 1,
    channels: {
      email: (c) => ({
        subject: `Update on building permit ${c.permitNumber}`,
        body: [greeting(c), "", c.statusMessage ?? "", "", contactLine(c), "", c.departmentName].join("\n"),
      }),
    },
  },
};

export function renderTemplate(id: TemplateId, channel: Channel, ctx: TemplateContext) {
  const tpl = TEMPLATES[id];
  const renderer = tpl.channels[channel] ?? tpl.channels.email!;
  return { ...renderer(ctx), templateId: id, templateVersion: tpl.version };
}

const PROHIBITED: [RegExp, string][] = [
  [/\bfine[sd]?\b/i, "mentions fines"],
  [/\bpenalt(y|ies)\b/i, "mentions penalties"],
  [/\bviolations?\b/i, "alleges a violation"],
  [/\b(payment|pay)\b.{0,20}\b(due|required|now|immediately)\b/i, "implies payment is required"],
  [/\bmust pay\b/i, "implies payment is required"],
  [/\blegal action\b|\blawsuit\b|\bcourt\b/i, "threatens legal action"],
  [/\bfinal (notice|warning)\b/i, "uses escalation language"],
  [/\b(arrest|criminal|prosecut)/i, "threatening language"],
  [/\bfailure to (respond|comply)\b/i, "threatening language"],
  [/\b(unsafe|illegal|non-?compliant)\b/i, "implies a legal or safety conclusion"],
];

/** Returns tone problems in a message body; empty means acceptable. */
export function lintMessage(text: string): string[] {
  return PROHIBITED.filter(([re]) => re.test(text)).map(([, why]) => why);
}
