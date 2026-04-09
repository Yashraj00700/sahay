import { Redis } from 'ioredis'

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'

// Main Redis client (for app usage)
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
})

redis.on('error', (err) => {
  console.error('Redis connection error:', err)
})

redis.on('connect', () => {
  console.log('✅ Redis connected')
})

// ─── Typed Redis Helpers ──────────────────────────────────────

// Agent online status
export async function setAgentOnline(tenantId: string, agentId: string): Promise<void> {
  await redis.hset(`tenant:${tenantId}:agents:online`, agentId, Date.now().toString())
  await redis.expire(`tenant:${tenantId}:agents:online`, 300) // 5 min TTL
}

export async function setAgentOffline(tenantId: string, agentId: string): Promise<void> {
  await redis.hdel(`tenant:${tenantId}:agents:online`, agentId)
}

export async function getOnlineAgents(tenantId: string): Promise<string[]> {
  const result = await redis.hkeys(`tenant:${tenantId}:agents:online`)
  return result
}

// Conversation session window (WhatsApp 24h)
export async function setSessionWindow(conversationId: string, expiresAt: Date): Promise<void> {
  const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000)
  if (ttlSeconds > 0) {
    await redis.set(`session:${conversationId}`, expiresAt.toISOString(), 'EX', ttlSeconds)
  }
}

export async function getSessionExpiry(conversationId: string): Promise<Date | null> {
  const val = await redis.get(`session:${conversationId}`)
  return val ? new Date(val) : null
}

export async function isSessionActive(conversationId: string): Promise<boolean> {
  const expiry = await getSessionExpiry(conversationId)
  return expiry !== null && expiry > new Date()
}

// AI response caching (semantic cache)
export async function cacheAIResponse(
  tenantId: string,
  cacheKey: string,
  response: string,
  ttlSeconds = 300
): Promise<void> {
  await redis.setex(`ai:cache:${tenantId}:${cacheKey}`, ttlSeconds, response)
}

export async function getCachedAIResponse(tenantId: string, cacheKey: string): Promise<string | null> {
  return redis.get(`ai:cache:${tenantId}:${cacheKey}`)
}

// Typing indicators (short TTL)
export async function setTypingIndicator(
  conversationId: string,
  senderId: string,
  type: 'agent' | 'ai' | 'customer'
): Promise<void> {
  await redis.setex(`typing:${conversationId}:${type}:${senderId}`, 5, '1')
}

export async function clearTypingIndicator(
  conversationId: string,
  senderId: string,
  type: 'agent' | 'ai' | 'customer'
): Promise<void> {
  await redis.del(`typing:${conversationId}:${type}:${senderId}`)
}
