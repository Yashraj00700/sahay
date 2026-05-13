import { defineHandler } from "../../apps/api/src/lib/handler";
import { env } from "../../apps/api/src/lib/env";

/**
 * GET /api/notifications/vapid-key
 *
 * Public endpoint — returns the server's VAPID public key so the browser
 * can convert it into the `applicationServerKey` Uint8Array required by
 * `pushManager.subscribe()`. The public key is, by design, public; safe
 * to serve unauthenticated.
 *
 * Behaviour matrix:
 *   - VAPID configured            → 200 { publicKey: '<base64url>' }
 *   - Unset, NODE_ENV=production  → 503 (push intentionally off in prod)
 *   - Unset, dev                  → 200 { publicKey: null } so the web
 *                                   client can render a "push disabled"
 *                                   state without throwing.
 */
export default defineHandler(
  (_req, res) => {
    if (!env.VAPID_PUBLIC_KEY) {
      if (env.NODE_ENV === "production") {
        res.status(503).json({
          error: {
            code: "PUSH_NOT_CONFIGURED",
            message: "Web push is not enabled on this server",
          },
        });
        return;
      }
      res.status(200).json({ publicKey: null });
      return;
    }
    res.status(200).json({ publicKey: env.VAPID_PUBLIC_KEY });
  },
  { methods: ["GET"] },
);
