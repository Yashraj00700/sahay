import { db } from '@sahay/db'
import { sql } from 'drizzle-orm'
import { logger } from './logger'

// Refresh analytics materialized views every hour
export function startCrons(): void {
  // Refresh analytics aggregations every 60 minutes
  setInterval(async () => {
    try {
      // Update daily analytics aggregation for yesterday and today
      await db.execute(sql`
        INSERT INTO analytics_daily (tenant_id, date, total_conversations, ai_resolved, human_handled, avg_response_time_s)
        SELECT
          tenant_id,
          DATE(created_at) as date,
          COUNT(*) as total_conversations,
          COUNT(*) FILTER (WHERE routing_decision = 'auto_respond') as ai_resolved,
          COUNT(*) FILTER (WHERE routing_decision IN ('route_to_human', 'route_to_senior')) as human_handled,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at)))::int as avg_response_time_s
        FROM conversations
        WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '2 days'
        GROUP BY tenant_id, DATE(created_at)
        ON CONFLICT (tenant_id, date) DO UPDATE SET
          total_conversations = EXCLUDED.total_conversations,
          ai_resolved = EXCLUDED.ai_resolved,
          human_handled = EXCLUDED.human_handled,
          avg_response_time_s = EXCLUDED.avg_response_time_s,
          updated_at = NOW()
      `)
      logger.info('[Cron] Analytics refresh complete')
    } catch (err) {
      logger.error({ err }, '[Cron] Analytics refresh failed')
    }
  }, 60 * 60 * 1000) // every hour
}
