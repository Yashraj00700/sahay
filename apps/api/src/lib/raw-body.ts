import type { VercelRequest } from '@vercel/node'

/**
 * Read the raw request body as a Buffer. Required for HMAC-signed webhooks
 * (WhatsApp, Instagram, Shopify) where the signature is computed over the
 * raw bytes BEFORE JSON parsing.
 *
 * Functions using this MUST disable Vercel's automatic body parser:
 *   export const config = { api: { bodyParser: false } }
 */
export async function readRawBody(req: VercelRequest): Promise<Buffer> {
  if (Buffer.isBuffer((req as unknown as { body?: unknown }).body)) {
    return (req as unknown as { body: Buffer }).body
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

export const parseJson = <T = unknown>(buf: Buffer): T => JSON.parse(buf.toString('utf8')) as T
