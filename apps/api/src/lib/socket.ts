// ─── Socket.io Singleton ─────────────────────────────────────────────────────
// Holds the global Socket.io Server instance so that routes, workers,
// and services can emit events without circular imports back to index.ts.
//
// Usage in routes/services:
//   import { getIO } from '../lib/socket'
//   getIO()?.to(`tenant:${tenantId}`).emit('conversation:updated', data)
//
// Usage in index.ts (during server startup):
//   import { setIO } from '../lib/socket'
//   setIO(ioServerInstance)

import type { Server } from 'socket.io'

let _io: Server | null = null

export function setIO(io: Server): void {
  _io = io
}

export function getIO(): Server | null {
  return _io
}
