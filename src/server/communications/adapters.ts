/**
 * Delivery adapters. Real providers (e.g. an approved email or SMS gateway)
 * implement `DeliveryAdapter`; the MVP ships only the simulated adapter, which
 * records the message locally and never contacts anyone.
 */
import { db } from "../db/client";
import { simulatedMailbox } from "../db/schema";
import { now, randomToken } from "../util";

export interface OutboundMessage {
  orgId: string;
  communicationId: string | null;
  channel: "email" | "sms" | "letter";
  to: string;
  subject: string | null;
  body: string;
}

export interface DeliveryResult {
  adapter: string;
  messageId: string;
  accepted: boolean;
}

export interface DeliveryAdapter {
  readonly id: string;
  readonly live: boolean;
  send(msg: OutboundMessage): Promise<DeliveryResult>;
}

export const simulatedAdapter: DeliveryAdapter = {
  id: "simulated",
  live: false,
  async send(msg) {
    await db().insert(simulatedMailbox).values({
      orgId: msg.orgId,
      communicationId: msg.communicationId,
      channel: msg.channel,
      toAddress: msg.to,
      subject: msg.subject,
      body: msg.body,
      deliveredAt: now(),
    });
    return { adapter: "simulated", messageId: `sim_${randomToken(9)}`, accepted: true };
  },
};

/** The MVP never selects a live adapter. */
export function deliveryAdapter(): DeliveryAdapter {
  return simulatedAdapter;
}
