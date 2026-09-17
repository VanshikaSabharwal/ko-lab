import { PrismaClient } from "@prisma/client";

/**
 * A single PrismaClient reused across hot reloads.
 *
 * Next.js re-evaluates modules on every dev hot-reload, so a bare
 * `new PrismaClient()` leaked a fresh client — and a fresh connection pool —
 * each time a route file changed. After a few reloads the database is at its
 * connection limit and every query waits for a free slot, which is why simple
 * lookups could take seconds in development.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
