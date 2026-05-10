# Experiments (A/B testing for AI prompts)

A small harness for splitting traffic between AI system-prompt variants and
measuring outcomes (CSAT, escalation rate, turn count). Tenant-scoped by
default, with an optional global namespace for super_admin-driven defaults.

## Schema overview

Three tables (migration `0003_experiments.sql`):

### `experiments`

| Column        | Type                | Notes                                       |
| ------------- | ------------------- | ------------------------------------------- |
| `id`          | uuid pk             | `gen_random_uuid()`                         |
| `tenant_id`   | uuid (nullable)     | FK → `tenants` ON DELETE CASCADE; `null` = global |
| `key`         | text NOT NULL       | e.g. `system_prompt`                         |
| `description` | text                | optional human-readable note                |
| `variants`    | jsonb NOT NULL      | `[{ name, weight, config }, ...]`            |
| `is_active`   | boolean DEFAULT true|                                             |
| `starts_at`   | timestamptz         | DEFAULT now()                               |
| `ends_at`     | timestamptz         | nullable                                    |
| `created_at`  | timestamptz         |                                             |
| `updated_at`  | timestamptz         |                                             |

Indexes: `(tenant_id, key, is_active)` and `(key, is_active)`.

### `experiment_assignments`

Sticky per subject. The same `(experiment_id, subject_type, subject_id)` is
guaranteed to map to one variant for the lifetime of the experiment.

| Column         | Type             | Notes                                       |
| -------------- | ---------------- | ------------------------------------------- |
| `id`           | uuid pk          |                                             |
| `experiment_id`| uuid NOT NULL    | FK → `experiments` ON DELETE CASCADE        |
| `tenant_id`    | uuid             | denormalised for filtering                  |
| `subject_type` | text NOT NULL    | `conversation` \| `customer` \| `tenant`    |
| `subject_id`   | uuid NOT NULL    |                                             |
| `variant`      | text NOT NULL    | the chosen variant name                     |
| `assigned_at`  | timestamptz      | DEFAULT now()                               |

Unique index on `(experiment_id, subject_type, subject_id)` — also serves as
the `ON CONFLICT` target so concurrent inserts can't double-assign.

### `experiment_outcomes`

Append-only.

| Column         | Type              | Notes                                |
| -------------- | ----------------- | ------------------------------------ |
| `id`           | uuid pk           |                                      |
| `assignment_id`| uuid NOT NULL     | FK → `experiment_assignments`        |
| `metric`       | text NOT NULL     | `csat` \| `resolved` \| `escalated` \| `turn_count` |
| `value`        | numeric(10,4)     | for booleans, store 0 / 1            |
| `recorded_at`  | timestamptz       | DEFAULT now()                        |

## Setting up an experiment

Tenant-scoped, weighted 50/50:

```bash
curl -X POST https://api.example.com/api/admin/experiments \
  -H 'Authorization: Bearer <admin-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "system_prompt",
    "description": "Try a more concise tone",
    "variants": [
      {
        "name": "control",
        "weight": 50,
        "config": {}
      },
      {
        "name": "concise",
        "weight": 50,
        "config": {
          "tone": "professional and concise; no Hinglish examples",
          "extraInstructions": "Keep replies under 60 words."
        }
      }
    ],
    "isActive": true,
    "endsAt": "2026-12-01T00:00:00.000Z"
  }'
```

Supported variant `config` fields (consumed in `agent.ts`):

- `systemPromptOverride` (string) — replaces the entire prompt verbatim.
- `tone` (string) — replaces the rendered tone description line.
- `examples` (string) — appended after the canonical Hinglish examples block.
- `extraInstructions` (string) — appended in its own `## Additional Instructions` block.

Weights do not need to sum to 100 — the harness normalises them (we just
require `sum > 0`).

## Reading results

```bash
curl https://api.example.com/api/admin/experiments/system_prompt/results \
  -H 'Authorization: Bearer <admin-jwt>'
```

Response:

```json
{
  "experiment": { "id": "...", "key": "system_prompt", "tenantId": "...", "isActive": true },
  "results": [
    { "variant": "control",  "n": 142, "csatMean": 4.31, "escalatedRate": 0.18, "turnCountMean": 3.4 },
    { "variant": "concise",  "n": 138, "csatMean": 4.42, "escalatedRate": 0.16, "turnCountMean": 2.9 }
  ]
}
```

`escalatedRate` is `escalations / assignments`. `turnCountMean` is the mean
across recorded turn-count events (one per AI response).

## Recommended sample size

A minimum of **50 assignments per variant** is needed for any meaningful
read on CSAT or escalation rate. Below that, ratios are dominated by noise
(±10% confidence intervals at n=50 for a 20% escalation rate). For
production decisions:

- **CSAT**: 200+ per variant (CSAT has high variance; many reads are blank)
- **Escalation**: 100+ per variant
- **Turn count**: 50+ per variant (lowest variance metric)

## Rollout / rollback workflow

1. **Stage**: create the experiment with `isActive: false` and one variant
   `name: "control"` weighted 100. Verify it appears in the admin list.
2. **Roll out**: PATCH the experiment with `isActive: true` and add the
   treatment variant(s) at the desired split (e.g. 95/5 to start).
3. **Monitor**: check `/api/admin/experiments/<key>/results` daily until
   each variant has the recommended sample.
4. **Promote winner**: re-POST the experiment with the winning variant at
   weight 100 and the loser at weight 0. Existing assignments keep their
   variant (sticky) but new traffic routes to the winner.
5. **Decommission**: set `isActive: false`. Old assignments remain on
   record for analysis but new requests fall through to the default code
   path.
6. **Emergency rollback**: PATCH `isActive: false` immediately. Within one
   request the harness stops returning a variant; the agent uses the
   pre-experiment default behaviour. No deploy required.

## Tenant vs global scope

- **Tenant-scoped** (default): only that tenant's traffic is affected.
  Use for per-customer experiments, brand-voice changes, anything where one
  tenant should not pollute another's metrics.
- **Global** (`tenantId = null`, super_admin only): applies as a fallback
  when no tenant-scoped experiment with the same key is active. Use for
  product-wide changes (new safety rules, model swaps). A tenant-scoped
  experiment with the same key always wins over the global one.
