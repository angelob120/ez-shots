/**
 * Stand-in for lib/prisma in unit tests.
 *
 * The pure logic in lib/orders — the state machine and the refund arithmetic —
 * is worth testing on its own, but importing it drags in a real PrismaClient
 * that wants a database. This stub satisfies the import so those functions can
 * be exercised without one. Any test that actually touches `prisma` here will
 * fail loudly rather than quietly pretending to work.
 */

const explode = (): never => {
  throw new Error("This test touched the database. Only pure functions belong here.");
};

export const prisma: unknown = new Proxy({}, { get: explode });
