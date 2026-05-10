/**
 * Thin Shopify Admin API client used by webhook fan-out functions, the
 * post-install registration step, and any code that needs to call Shopify
 * after we already have a long-lived access token.
 *
 * Responsibilities:
 *   - Inject the X-Shopify-Access-Token header.
 *   - Honour the X-Shopify-Shop-Api-Call-Limit bucket so we throttle ourselves
 *     before Shopify returns 429.
 *   - Retry on 429 + 5xx with exponential backoff (max 3 attempts).
 *   - Translate non-2xx responses into IntegrationError so callers can rely
 *     on the AppError contract.
 *
 * Intentionally NOT a heavyweight SDK — we want explicit, auditable HTTP
 * behaviour for an integration we run on a 5-second webhook budget.
 */

import { IntegrationError } from '../../lib/errors'
import { logger } from '../../lib/logger'

const SHOPIFY_API_VERSION = '2024-01'

/** Default near-limit threshold. Shopify buckets are typically 40 calls. */
const NEAR_LIMIT_RATIO = 38 / 40

interface RequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

interface RestNamespace {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body: unknown): Promise<T>
  put<T>(path: string, body: unknown): Promise<T>
  delete<T>(path: string): Promise<T>
}

interface GraphqlError {
  message: string
  extensions?: Record<string, unknown>
}

interface GraphqlResponse<T> {
  data?: T
  errors?: ReadonlyArray<GraphqlError>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Parse `X-Shopify-Shop-Api-Call-Limit: <used>/<bucket>` and decide whether
 * we should pause briefly before issuing another call.
 */
function shouldThrottle(header: string | null): { throttle: boolean; ratio: number } {
  if (!header) return { throttle: false, ratio: 0 }
  const [usedStr, bucketStr] = header.split('/')
  const used = Number(usedStr)
  const bucket = Number(bucketStr)
  if (!Number.isFinite(used) || !Number.isFinite(bucket) || bucket <= 0) {
    return { throttle: false, ratio: 0 }
  }
  const ratio = used / bucket
  return { throttle: ratio >= NEAR_LIMIT_RATIO, ratio }
}

export class ShopifyClient {
  readonly shop: string
  private readonly accessToken: string

  constructor(shop: string, accessToken: string) {
    this.shop = shop
    this.accessToken = accessToken
  }

  /** Underlying typed REST helpers. */
  readonly rest: RestNamespace = {
    get: <T>(path: string) => this.request<T>(path, { method: 'GET' }),
    post: <T>(path: string, body: unknown) => this.request<T>(path, { method: 'POST', body }),
    put: <T>(path: string, body: unknown) => this.request<T>(path, { method: 'PUT', body }),
    delete: <T>(path: string) => this.request<T>(path, { method: 'DELETE' }),
  }

  /** Run a GraphQL Admin API operation and return the `data` block typed as T. */
  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const body = variables ? { query, variables } : { query }
    const result = await this.request<GraphqlResponse<T>>(
      `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      { method: 'POST', body },
    )
    if (result.errors && result.errors.length > 0) {
      throw new IntegrationError(
        'shopify',
        `GraphQL error: ${result.errors.map((e) => e.message).join('; ')}`,
        result.errors,
      )
    }
    if (!result.data) {
      throw new IntegrationError('shopify', 'GraphQL response missing data')
    }
    return result.data
  }

  // ─── internal ────────────────────────────────────────────

  private url(path: string): string {
    const normalised = path.startsWith('/') ? path : `/${path}`
    return `https://${this.shop}${normalised}`
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const maxAttempts = 3
    let attempt = 0
    let lastErr: unknown
    while (attempt < maxAttempts) {
      attempt += 1
      try {
        const res = await fetch(this.url(path), {
          method: init.method ?? 'GET',
          headers: {
            'X-Shopify-Access-Token': this.accessToken,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(init.headers ?? {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        })

        // Self-throttle BEFORE returning so the next caller benefits.
        const limitHeader = res.headers.get('x-shopify-shop-api-call-limit')
        const { throttle, ratio } = shouldThrottle(limitHeader)
        if (throttle) {
          logger.debug({ shop: this.shop, ratio }, 'shopify near rate limit; sleeping 500ms')
          await sleep(500)
        }

        if (res.status === 429 || res.status >= 500) {
          const text = await res.text().catch(() => '')
          lastErr = new IntegrationError(
            'shopify',
            `${res.status} on ${path}: ${text.slice(0, 256)}`,
          )
          if (attempt < maxAttempts) {
            const backoff = 250 * 2 ** (attempt - 1)
            logger.warn(
              { shop: this.shop, status: res.status, attempt, backoff },
              'shopify request retrying',
            )
            await sleep(backoff)
            continue
          }
          throw lastErr
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new IntegrationError(
            'shopify',
            `${res.status} on ${path}: ${text.slice(0, 512)}`,
          )
        }

        // 204 No Content is legal for DELETE.
        if (res.status === 204) return undefined as unknown as T
        return (await res.json()) as T
      } catch (err) {
        // IntegrationError on 4xx is terminal; only retry on 429/5xx (handled above)
        // or on transport errors (TypeError from fetch).
        if (err instanceof IntegrationError && !(err.message.includes(' 429 ') || /\b5\d\d\b/.test(err.message))) {
          throw err
        }
        lastErr = err
        if (attempt >= maxAttempts) throw err
        const backoff = 250 * 2 ** (attempt - 1)
        logger.warn({ shop: this.shop, attempt, backoff, err }, 'shopify transport retrying')
        await sleep(backoff)
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new IntegrationError('shopify', 'unknown error after retries')
  }
}

/** Factory mirror — handy when callers prefer not to use `new`. */
export function createClient(shop: string, accessToken: string): ShopifyClient {
  return new ShopifyClient(shop, accessToken)
}

export { SHOPIFY_API_VERSION }
