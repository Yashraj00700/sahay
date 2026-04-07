import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// For migrations (single connection)
export const migrationClient = postgres(connectionString, { max: 1 })

// For queries (connection pool)
const queryClient = postgres(connectionString, {
  max: 20,                // max pool size
  idle_timeout: 20,       // close idle connections after 20s
  connect_timeout: 10,    // fail if can't connect in 10s
})

export const db = drizzle(queryClient, { schema, logger: process.env.NODE_ENV === 'development' })

export * from './schema'
export { schema }
