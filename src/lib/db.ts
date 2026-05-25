import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

// Enable WAL mode for better SQLite concurrency
if (process.env.NODE_ENV !== 'production') {
  db.$executeRawUnsafe('PRAGMA journal_mode=WAL;').catch(() => {})
  db.$executeRawUnsafe('PRAGMA busy_timeout=5000;').catch(() => {})
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
