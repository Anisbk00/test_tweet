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
// Use $queryRaw instead of $executeRawUnsafe since PRAGMA returns results in SQLite
if (process.env.NODE_ENV !== 'production') {
  db.$queryRaw`PRAGMA journal_mode=WAL;`.catch(() => {})
  db.$queryRaw`PRAGMA busy_timeout=5000;`.catch(() => {})
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
