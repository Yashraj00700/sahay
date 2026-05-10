# Audit Log Reference (DPDP / GDPR)

Sahay's `audit_logs` table is the append-only system of record for **who
accessed or modified personal data, when, why, and from where**. It exists
to satisfy DPDP Act Section 9 (Data Fiduciary obligations) and GDPR
Article 30 (Records of Processing Activities) — and is the first table a
DPO will ask to see during an investigation or DPA review.

> Append-only — there is no `updated_at`, and no application code path
> issues `UPDATE` or `DELETE` against this table. Schema fixes ride a
> migration that creates a new row, never mutates an old one.

---

## What gets audited

### Mutations (writes) — already in place

| `action`                       | `resource_type`   | Trigger                                              |
| ------------------------------ | ----------------- | ---------------------------------------------------- |
| `auth.login.success`           | `agent`           | Successful login                                     |
| `auth.login.failed`            | `agent`           | Bad password / locked-out attempt                    |
| `auth.password.reset`          | `agent`           | Password reset completed                             |
| `agent.invite`                 | `agent`           | Invite sent                                          |
| `agent.update` / `agent.delete`| `agent`           | Role / status change                                 |
| `conversation.updated`         | `conversation`    | Status / assignment / tags / urgency change          |
| `settings.ai.updated`          | `tenant_settings` | AI persona / language / tone change                  |
| `settings.channels.updated`    | `tenant_settings` | Channel credential rotation                          |
| `shopify.install`              | `tenant`          | OAuth callback completed                             |

### Reads — added for DPDP §9 / GDPR Art. 30

| `action`                          | `resource_type`         | Endpoint                                       |
| --------------------------------- | ----------------------- | ---------------------------------------------- |
| `data.read.conversation`          | `conversation`          | `GET /api/conversations/:id`                   |
| `data.read.conversation_list`     | `conversation_list`     | `GET /api/conversations`                       |
| `data.read.conversation_messages` | `conversation_messages` | `GET /api/conversations/:id/messages`          |
| `data.read.customer`              | `customer`              | `GET /api/customers/:id` (when route exists)   |
| `data.read.customer_list`         | `customer_list`         | `GET /api/customers`                           |

All read events use `action = 'data.read.<resource_type>'` so a single
`WHERE action LIKE 'data.read.%'` returns the full read trail.

### Explicitly NOT audited

- `GET /api/auth/me` — admin reading their own session, not personal data
- `GET /api/settings/*` — tenant configuration, no PII
- Agent-self reads (e.g. an agent fetching their own profile)
- Failed lookups (404s) — read audits fire **after** a successful DB read

---

## Column / JSONB schema

```
audit_logs (
  id            uuid          pk
  tenant_id     uuid          fk -> tenants
  actor_type    text          'agent' | 'system' | 'ai' | 'api'
  actor_id      uuid          agent.id when actor_type='agent'
  actor_email   text          denormalised for forensic stability
  action        text          dotted, e.g. data.read.conversation
  resource_type text          conversation | customer | agent | ...
  resource_id   uuid          single-resource reads/writes only
  before_state  jsonb         writes only
  after_state   jsonb         writes only
  metadata      jsonb         see schema below
  ip_address    inet
  user_agent    text
  request_id    text          correlates with X-Request-Id header
  created_at    timestamptz
)
```

### `metadata.query` (read events)

The `query` sub-object captures the **shape** of a list/search filter so
analysts can reconstruct what was queried — never the actual PII the
agent typed.

```jsonc
{
  "query": {
    "page": 2,
    "pageSize": 25,
    "status": "open",          // enum filters: pass-through
    "channel": "whatsapp",
    "sortBy": "updatedAt",
    "sortDir": "desc",
    "tier": "vip",
    "hasSearch": true,         // boolean — true if free-text was supplied
    "hasCursor": false,        // boolean — true if a pagination cursor was used
    "messageCount": 42         // for messages reads only
  }
}
```

Redacted at write time (NEVER stored): `search`, `q`, `query`, `phone`,
`email`, `name`, full row payloads. See
`apps/api/src/lib/audit-helpers.ts → redactQueryForAudit`.

### `metadata` (write events)

Free-form per-action object, e.g. for `conversation.updated`:

```jsonc
{
  "status": "resolved",
  "assignedTo": "uuid-of-agent",
  "tags": ["refund", "vip"]
}
```

Writes also populate `before_state` / `after_state` where meaningful.

---

## Retention

- **Recommended retention: 7 years.** DPDP §9 obliges the Data Fiduciary
  to demonstrate compliance for the entire processing lifetime + a
  reasonable buffer; 7 years aligns with most Indian financial / KYC
  retention windows and GDPR's "necessary for the purposes" test for
  accountability evidence.
- **Archival:** after 18 months, move rows to cold storage
  (`audit_logs_archive` partition or S3 Glacier export of the JSONB
  payload). List-read events are high-volume — a busy support team can
  generate 10k+ rows/day — so archival is what makes the 7-year window
  affordable.
- **Deletion:** never `DELETE` selectively. End-of-retention is a full
  partition drop after legal-hold review.

---

## Compliance query cookbook

All queries assume a tenant scope (`WHERE tenant_id = $1`). Add a date
filter for SLA reports.

**1. Who read this customer's data in the last 90 days?**

```sql
SELECT created_at, actor_email, action, ip_address, request_id, metadata
FROM   audit_logs
WHERE  tenant_id    = $1
  AND  resource_id  = $2          -- customer.id or conversation.id
  AND  action       LIKE 'data.read.%'
  AND  created_at  >= now() - interval '90 days'
ORDER  BY created_at DESC;
```

**2. Did *anyone* in this tenant access personal data on a given day?**

```sql
SELECT actor_email,
       count(*)                         AS read_count,
       count(DISTINCT resource_id)      AS distinct_resources
FROM   audit_logs
WHERE  tenant_id   = $1
  AND  action      LIKE 'data.read.%'
  AND  created_at::date = $2
GROUP  BY actor_email
ORDER  BY read_count DESC;
```

**3. Bulk-export / scraping signal: agents pulling >500 customer rows / hr.**

```sql
SELECT actor_email,
       date_trunc('hour', created_at) AS hour,
       count(*)                       AS list_reads
FROM   audit_logs
WHERE  tenant_id  = $1
  AND  action     = 'data.read.customer_list'
  AND  created_at >= now() - interval '7 days'
GROUP  BY actor_email, hour
HAVING count(*) > 500
ORDER  BY hour DESC, list_reads DESC;
```

**4. Article 15 / Section 11 access request — full trail for a data subject.**

```sql
SELECT created_at, actor_type, actor_email, action, resource_type,
       resource_id, ip_address, metadata
FROM   audit_logs
WHERE  tenant_id   = $1
  AND  resource_id IN (
         SELECT id FROM customers     WHERE id = $2
         UNION ALL
         SELECT id FROM conversations WHERE customer_id = $2
       )
ORDER  BY created_at;
```

**5. Failed-login forensics for the lockout window.**

```sql
SELECT created_at, actor_email, ip_address, metadata
FROM   audit_logs
WHERE  action = 'auth.login.failed'
  AND  created_at >= now() - interval '24 hours'
ORDER  BY created_at DESC;
```

---

## Safety rules for adding new audit events

- New writes → call `auditAction({...})` after the DB mutation succeeds.
- New reads  → use a helper from `apps/api/src/lib/audit-helpers.ts` and
  always `void` the call — audit must never block the response.
- **Never** put raw PII (phone, email, name, message body) into
  `metadata`, `before_state`, or `after_state`. Resource IDs only.
- **Never** log secrets — passwords, tokens, API keys, encrypted blobs.
- For high-volume list reads, capture filter *shape* (`hasSearch: true`),
  not values.
