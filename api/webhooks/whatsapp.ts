// ─── WhatsApp Cloud API Webhook (Vercel Function) ─────────────────────────────
// Replaces apps/api/src/routes/webhooks/whatsapp.ts.
//
//  GET  → Meta verification handshake. Looks up the tenant whose
//         whatsappVerifyToken equals hub.verify_token and echoes the challenge.
//  POST → Incoming messages / status updates from the WhatsApp Cloud API.
//         The handler verifies the x-hub-signature-256 HMAC, fans the entries
//         out to Inngest, and ALWAYS responds 200 quickly so Meta does not
//         retry. All real processing happens in Inngest functions.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, tenants } from "@sahay/db";
import { eq } from "drizzle-orm";
import { env } from "../../apps/api/src/lib/env";
import { verifyHmacSha256 } from "../../apps/api/src/lib/crypto";
import { readRawBody } from "../../apps/api/src/lib/raw-body";
import { enforce, limits } from "../../apps/api/src/lib/rate-limit";
import { logger } from "../../apps/api/src/lib/logger";
import { sendEvent } from "../../apps/api/src/inngest/client";

// Required so we can compute HMAC over the exact bytes Meta signed.
export const config = { api: { bodyParser: false } };

// ─── Webhook payload shape (subset we care about) ────────────────────────────

interface WhatsAppStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message: string }>;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

interface WhatsAppChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

interface WhatsAppChange {
  field: string;
  value: WhatsAppChangeValue;
}

interface WhatsAppEntry {
  id: string;
  changes?: WhatsAppChange[];
}

interface WhatsAppPayload {
  object?: string;
  entry?: WhatsAppEntry[];
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const log = logger.child({ webhook: "whatsapp", method: req.method });

  if (req.method === "GET") {
    await handleVerification(req, res, log);
    return;
  }

  if (req.method === "POST") {
    // Capture raw body BEFORE we ack — the request stream is consumed once.
    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(req);
    } catch (err) {
      log.error({ err }, "Failed to read WhatsApp webhook body");
      // Still respond 200 so Meta doesn't retry on transport errors.
      res.status(200).send("EVENT_RECEIVED");
      return;
    }

    const signature = req.headers["x-hub-signature-256"];
    const sigHeader = Array.isArray(signature) ? signature[0] : signature;

    // Acknowledge immediately. Per Meta docs: respond 200 within 20s or they
    // retry. All heavy work is async via Inngest.
    res.status(200).send("EVENT_RECEIVED");

    try {
      await processWhatsAppPost(rawBody, sigHeader);
    } catch (err) {
      log.error({ err }, "Error processing WhatsApp webhook");
    }
    return;
  }

  res.setHeader("Allow", "GET,POST");
  res.status(405).json({ error: "Method not allowed" });
}

// ─── GET: Meta verification handshake ────────────────────────────────────────

async function handleVerification(
  req: VercelRequest,
  res: VercelResponse,
  log: import("pino").Logger,
): Promise<void> {
  const q = req.query as Record<string, string | string[] | undefined>;
  const mode = pickQuery(q["hub.mode"]);
  const token = pickQuery(q["hub.verify_token"]);
  const challenge = pickQuery(q["hub.challenge"]);

  if (mode !== "subscribe" || !token) {
    res.status(400).send("Invalid mode");
    return;
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.whatsappVerifyToken, token),
  });

  if (!tenant) {
    log.warn("WhatsApp verify token mismatch");
    res.status(403).send("Verification token mismatch");
    return;
  }

  res.status(200).send(challenge ?? "");
}

// ─── POST: HMAC-verified async fan-out ───────────────────────────────────────

async function processWhatsAppPost(
  rawBody: Buffer,
  sigHeader: string | undefined,
): Promise<void> {
  const log = logger.child({ webhook: "whatsapp" });

  if (!sigHeader || !sigHeader.startsWith("sha256=")) {
    log.warn("WhatsApp webhook missing/invalid signature header");
    return;
  }

  const sigHex = sigHeader.slice("sha256=".length);
  const valid = verifyHmacSha256(rawBody, sigHex, env.WA_APP_SECRET, "hex");
  if (!valid) {
    log.warn("WhatsApp webhook HMAC verification failed");
    return;
  }

  let body: WhatsAppPayload;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as WhatsAppPayload;
  } catch (err) {
    log.error({ err }, "WhatsApp webhook JSON parse failed");
    return;
  }

  const sends: Array<Promise<unknown>> = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.whatsappPhoneNumberId, phoneNumberId),
      });
      if (!tenant) {
        log.warn(
          { phoneNumberId },
          "No tenant found for WhatsApp phone number ID",
        );
        continue;
      }

      try {
        await enforce(limits.perWebhookSource(), `wa:${tenant.id}`);
      } catch (err) {
        log.warn({ tenantId: tenant.id, err }, "WhatsApp webhook rate limited");
        continue;
      }

      for (const msg of value.messages ?? []) {
        sends.push(
          sendEvent({
            name: "whatsapp/message.received",
            data: {
              tenantId: tenant.id,
              raw: { ...msg, _phoneNumberId: phoneNumberId } as Record<
                string,
                unknown
              >,
            },
          }),
        );
      }

      for (const status of value.statuses ?? []) {
        sends.push(
          sendEvent({
            name: "whatsapp/status.updated",
            data: {
              tenantId: tenant.id,
              raw: { ...status, _phoneNumberId: phoneNumberId } as Record<
                string,
                unknown
              >,
            },
          }),
        );
      }
    }
  }

  // Fire all Inngest sends in parallel; failures shouldn't block Meta retries
  // but we do want them in the logs.
  const results = await Promise.allSettled(sends);
  for (const r of results) {
    if (r.status === "rejected") {
      log.error(
        { reason: r.reason },
        "Failed to enqueue WhatsApp Inngest event",
      );
    }
  }
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function pickQuery(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
