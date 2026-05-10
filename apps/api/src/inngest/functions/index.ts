// Barrel of every Inngest function the API registers with the
// serve() endpoint. The serve() endpoint (TBD: apps/api/api/inngest.ts
// once we adopt the Vercel structure) imports `functions` from here
// and hands it straight to inngest's `serve({ client, functions })`.
//
// To add a new function:
//   1. Drop a file in this folder.
//   2. Export the createFunction(...) result as a named const.
//   3. Add it to the `functions` array below.
//   4. If it's replacing one of the stubs, remove that stub from
//      `_stub.ts`.

import { whatsappIncoming } from './whatsapp-incoming'
import { stubFunctions } from './_stub'

export { whatsappIncoming } from './whatsapp-incoming'
export { stubFunctions } from './_stub'

export const functions = [whatsappIncoming, ...stubFunctions] as const
