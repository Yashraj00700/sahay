import { db, auditLogs } from '@sahay/db'
import { logger } from '../lib/logger'

interface AuditActionParams {
  tenantId?: string
  actorType: 'agent' | 'system' | 'ai' | 'api'
  actorId?: string
  actorEmail?: string
  action: string
  resourceType: string
  resourceId?: string
  beforeState?: object
  afterState?: object
  metadata?: object
  ipAddress?: string
  userAgent?: string
  requestId?: string
}

export async function auditAction(params: AuditActionParams): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      tenantId: params.tenantId,
      actorType: params.actorType,
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      beforeState: params.beforeState,
      afterState: params.afterState,
      metadata: params.metadata ?? {},
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      requestId: params.requestId,
    })
  } catch (err) {
    // Audit log failures should never crash the main request
    logger.error({ err }, 'Failed to write audit log')
  }
}
