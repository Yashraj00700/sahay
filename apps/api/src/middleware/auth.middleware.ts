import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'
import { db, agents, tenants } from '@sahay/db'
import { eq, and } from 'drizzle-orm'

export interface JWTPayload {
  agentId: string
  tenantId: string
  role: string
  email: string
}

// Attach to request: verified agent + tenant
declare module 'fastify' {
  interface FastifyRequest {
    agent: {
      id: string
      tenantId: string
      role: string
      email: string
      name: string
    }
    tenant: {
      id: string
      shopifyDomain: string
      plan: string
      aiPersonaName: string
      aiLanguage: string
      aiTone: string
      aiConfidenceThreshold: string
    }
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const payload = await request.jwtVerify<JWTPayload>()

    // Load agent from DB to get fresh data
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, payload.agentId),
        eq(agents.tenantId, payload.tenantId),
        eq(agents.isActive, true)
      ),
    })

    if (!agent) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Agent not found or inactive',
      })
    }

    const tenant = await db.query.tenants.findFirst({
      where: and(
        eq(tenants.id, payload.tenantId),
        eq(tenants.isActive, true)
      ),
    })

    if (!tenant) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Tenant not found or inactive',
      })
    }

    // Attach to request for downstream use
    request.agent = {
      id: agent.id,
      tenantId: agent.tenantId,
      role: agent.role,
      email: agent.email,
      name: agent.name,
    }

    request.tenant = {
      id: tenant.id,
      shopifyDomain: tenant.shopifyDomain,
      plan: tenant.plan,
      aiPersonaName: tenant.aiPersonaName ?? 'Sahay',
      aiLanguage: tenant.aiLanguage ?? 'hinglish',
      aiTone: tenant.aiTone ?? 'warm',
      aiConfidenceThreshold: tenant.aiConfidenceThreshold ?? '0.75',
    }
  } catch (err) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    })
  }
}

// Role-based access
export function requireRole(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.agent) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' })
    }
    if (!allowedRoles.includes(request.agent.role)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `This action requires one of these roles: ${allowedRoles.join(', ')}`,
      })
    }
  }
}
