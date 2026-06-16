import { db, auditLogs } from "@sahay/db";

interface AuditActionParams {
  tenantId?: string;
  actorType: "agent" | "system" | "ai" | "api";
  actorId?: string;
  actorEmail?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  beforeState?: object;
  afterState?: object;
  metadata?: object;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
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
    });
  } catch (err) {
    // Audit log failures should never crash the main request
    console.error("Failed to write audit log:", err);
  }
}

/**
 * Read-event audit metadata.
 *
 * `query` captures the *shape* of a list/search filter (page, pageSize,
 * hasSearch, etc.) so analysts can reconstruct what was queried for DPDP
 * Section 9 / GDPR Article 30 reports — WITHOUT logging the actual PII
 * (phone, email, name) that was filtered on or returned.
 */
export interface AuditReadQuery {
  [key: string]: unknown;
}

interface AuditReadParams {
  tenantId: string;
  actorId?: string;
  actorEmail?: string;
  resourceType: string;
  resourceId?: string;
  query?: AuditReadQuery;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Convenience wrapper that records a personal-data READ.
 *
 * - Sets `action = 'data.read.<resourceType>'` so reads are filterable in
 *   one query (`WHERE action LIKE 'data.read.%'`).
 * - Stores the optional filter shape in `metadata.query`.
 * - Never throws — audit-write failure must not crash the parent request.
 */
export async function auditRead(params: AuditReadParams): Promise<void> {
  await auditAction({
    tenantId: params.tenantId,
    actorType: "agent",
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: `data.read.${params.resourceType}`,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    metadata: { query: params.query ?? {} },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    requestId: params.requestId,
  });
}
