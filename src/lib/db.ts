import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Create Prisma client - works with both SQLite and PostgreSQL
// For Vercel: use PostgreSQL (DATABASE_URL=postgresql://...)
// For local dev: use SQLite (DATABASE_URL=file:./dev.db)
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

// SQLite-specific optimizations (only for local dev with SQLite)
if (process.env.NODE_ENV !== 'production') {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.startsWith('file:')) {
    db.$queryRaw`PRAGMA journal_mode=WAL;`.catch(() => {})
    db.$queryRaw`PRAGMA busy_timeout=5000;`.catch(() => {})
  }
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
