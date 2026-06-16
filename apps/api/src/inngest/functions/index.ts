// Barrel of every Inngest function the API registers with the
// serve() endpoint. The serve() endpoint (api/inngest.ts) imports
// `allFunctions` from here and hands it to inngest's `serve({ ... })`.
//
// To add a new function:
//   1. Drop a file in this folder.
//   2. Export the createFunction(...) result as a named const.
//   3. Add it to the `allFunctions` array below.

import { whatsappIncoming } from "./whatsapp-incoming";
import { instagramIncoming } from "./instagram-incoming";
import { webchatIncoming } from "./webchat-incoming";
import { aiRespond } from "./ai-respond";
import { aiEmbed } from "./ai-embed";
import { whatsappOutgoing } from "./whatsapp-outgoing";
import { instagramOutgoing } from "./instagram-outgoing";
import { shopifySync } from "./shopify-sync";
import { notificationsPush } from "./notifications-push";
import { proactiveMessage } from "./proactive-message";

import {
  shopifyOrdersCreated,
  shopifyOrdersUpdated,
} from "./shopify-orders-created";
import { shopifyOrdersCancelled } from "./shopify-orders-cancelled";
import { shopifyOrdersFulfilled } from "./shopify-orders-fulfilled";
import {
  shopifyCustomersCreated,
  shopifyCustomersUpdated,
} from "./shopify-customers";
import {
  shopifyProductsCreated,
  shopifyProductsUpdated,
  shopifyProductsDeleted,
} from "./shopify-products";
import { shopifyAppUninstalled } from "./shopify-app-uninstalled";
import { shopifyCustomersDataRequest } from "./shopify-customers-data-request";
import { shopifyCustomersRedact } from "./shopify-customers-redact";
import { shopifyShopRedact } from "./shopify-shop-redact";

import { waSessionExpiry } from "./cron/wa-session-expiry";
import { analyticsRollup } from "./cron/analytics-rollup";
import { kbRefresh } from "./cron/kb-refresh";

export {
  whatsappIncoming,
  instagramIncoming,
  webchatIncoming,
  aiRespond,
  aiEmbed,
  whatsappOutgoing,
  instagramOutgoing,
  shopifySync,
  notificationsPush,
  proactiveMessage,
  shopifyOrdersCreated,
  shopifyOrdersUpdated,
  shopifyOrdersCancelled,
  shopifyOrdersFulfilled,
  shopifyCustomersCreated,
  shopifyCustomersUpdated,
  shopifyProductsCreated,
  shopifyProductsUpdated,
  shopifyProductsDeleted,
  shopifyAppUninstalled,
  shopifyCustomersDataRequest,
  shopifyCustomersRedact,
  shopifyShopRedact,
  waSessionExpiry,
  analyticsRollup,
  kbRefresh,
};

/**
 * Single source of truth: every function the serve() endpoint should
 * register. Order doesn't matter functionally, but we group by domain
 * so dashboards stay readable.
 */
export const allFunctions = [
  // Channel inbound
  whatsappIncoming,
  instagramIncoming,
  webchatIncoming,
  // AI
  aiRespond,
  aiEmbed,
  // Channel outbound
  whatsappOutgoing,
  instagramOutgoing,
  // Notifications + scheduled sends
  notificationsPush,
  proactiveMessage,
  // Shopify webhooks (live deltas)
  shopifyOrdersCreated,
  shopifyOrdersUpdated,
  shopifyOrdersCancelled,
  shopifyOrdersFulfilled,
  shopifyCustomersCreated,
  shopifyCustomersUpdated,
  shopifyProductsCreated,
  shopifyProductsUpdated,
  shopifyProductsDeleted,
  shopifyAppUninstalled,
  shopifyCustomersDataRequest,
  shopifyCustomersRedact,
  shopifyShopRedact,
  // Shopify pull sync (cron / on-demand)
  shopifySync,
  // Cron jobs
  waSessionExpiry,
  analyticsRollup,
  kbRefresh,
] as const;

// Backwards-compat: the older `functions` name some consumers might still use.
export const functions = allFunctions;
