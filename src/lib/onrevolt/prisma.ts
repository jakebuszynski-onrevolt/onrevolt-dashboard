import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  onrevoltPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.onrevoltPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.onrevoltPrisma = prisma;
}

