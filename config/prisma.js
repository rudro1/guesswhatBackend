import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

/** Reuse one client per Node process (dev HMR + production) to avoid exhausting DB connections. */
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

globalForPrisma.prisma = prisma;

export default prisma;
