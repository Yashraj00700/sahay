import { serve } from "inngest/express";
import { inngest } from "../apps/api/src/inngest/client";
import { allFunctions } from "../apps/api/src/inngest/functions";
import { env } from "../apps/api/src/lib/env";

export default serve({
  client: inngest,
  functions: allFunctions,
  signingKey: env.INNGEST_SIGNING_KEY,
  servePath: "/api/inngest",
});
