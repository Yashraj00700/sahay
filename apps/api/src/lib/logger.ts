import pino from 'pino'
import { env } from './env'

const isProd = env.NODE_ENV === 'production'
const isTest = env.NODE_ENV === 'test'

export const logger = pino({
  level: isTest ? 'silent' : isProd ? 'info' : 'debug',
  base: { service: 'sahay-api' },
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.passwordHash',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }),
})
