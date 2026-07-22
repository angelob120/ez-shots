/**
 * In-memory Prisma stand-in for the SMS seam tests.
 *
 * Smaller in scope than prisma-memory.ts and separate from it on purpose: the
 * questions here are about consent and destination resolution, which need
 * compound-key lookups (`restaurantId_phone`) that the order tests never make.
 * Merging them would mean each stub carrying the other's shape.
 *
 * Same rule applies: if a test needs something this doesn't do, add it here
 * rather than reaching for a real database. These tests stop being run the
 * moment they need a server.
 */

type Row = Record<string, unknown>;

const customers: Row[] = [];
const messages: Row[] = [];
const restaurants: Row[] = [];
const suspensions: Row[] = [];

let seq = 0;

export function reset() {
  customers.length = 0;
  messages.length = 0;
  restaurants.length = 0;
  suspensions.length = 0;
  seq = 0;
}

/** A live service suspension for a tenant — see lib/entitlements.ts. */
export function seedSuspension(row: Row): Row {
  const s = {
    id: `susp_${++seq}`,
    service: "SMS",
    reason: null,
    internalNote: null,
    suspendedAt: new Date(),
    suspendedBy: null,
    liftedAt: null,
    liftedBy: null,
    ...row,
  };
  suspensions.push(s);
  return s;
}

export function seedCustomer(row: Row): Row {
  const c = {
    id: `cust_${++seq}`,
    name: null,
    email: null,
    optInStatus: "UNKNOWN",
    optOutAt: null,
    cohort: "TREATMENT",
    ...row,
  };
  customers.push(c);
  return c;
}

export function seedRestaurant(row: Row): Row {
  const r = { id: `rest_${++seq}`, name: "Test", phone: null, smsFrom: null, ...row };
  restaurants.push(r);
  return r;
}

/** Every Message row written, in order. The assertions all live here. */
export function written(): Row[] {
  return messages;
}

function findCustomer(where: Row): Row | null {
  if (typeof where.id === "string") {
    return customers.find((c) => c.id === where.id) ?? null;
  }
  const compound = where.restaurantId_phone as Row | undefined;
  if (compound) {
    return (
      customers.find(
        (c) => c.restaurantId === compound.restaurantId && c.phone === compound.phone
      ) ?? null
    );
  }
  throw new Error(`prisma-sms: unsupported customer lookup ${JSON.stringify(where)}`);
}

export const prisma = {
  customer: {
    async findUnique({ where }: { where: Row }) {
      return findCustomer(where);
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const c = findCustomer(where);
      if (!c) throw new Error("prisma-sms: customer not found");
      Object.assign(c, data);
      return c;
    },
  },

  restaurant: {
    async findUnique({ where }: { where: Row }) {
      if (typeof where.id === "string") return restaurants.find((r) => r.id === where.id) ?? null;
      if (typeof where.smsFrom === "string") {
        return restaurants.find((r) => r.smsFrom === where.smsFrom) ?? null;
      }
      throw new Error(`prisma-sms: unsupported restaurant lookup ${JSON.stringify(where)}`);
    },
  },

  // Enough of the suspension table for the gate in queueMessage and the retry
  // sweep. `liftedAt: null` is the only shape either one asks for.
  serviceSuspension: {
    async findFirst({ where }: { where: Row }) {
      return (
        suspensions.find(
          (s) =>
            s.restaurantId === where.restaurantId &&
            s.service === where.service &&
            s.liftedAt === null
        ) ?? null
      );
    },
    async findMany({ where }: { where: Row }) {
      return suspensions.filter(
        (s) => s.restaurantId === where.restaurantId && (where.liftedAt !== null || s.liftedAt === null)
      );
    },
    async create({ data }: { data: Row }) {
      return seedSuspension(data);
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const hit = suspensions.filter(
        (s) =>
          s.restaurantId === where.restaurantId && s.service === where.service && s.liftedAt === null
      );
      hit.forEach((s) => Object.assign(s, data));
      return { count: hit.length };
    },
  },

  message: {
    async create({ data }: { data: Row }) {
      const m = { id: `msg_${++seq}`, createdAt: new Date(), attempts: 0, retryable: null, ...data };
      messages.push(m);
      return m;
    },
    async findMany({ where }: { where?: Row } = {}) {
      // The only filters the retry sweep asks for: status, retryable and an
      // optional restaurantId. Enough to answer "what's still worth re-sending".
      return messages.filter((m) => {
        if (!where) return true;
        for (const [k, v] of Object.entries(where)) {
          if (m[k] !== v) return false;
        }
        return true;
      });
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const m = messages.find((row) => row.id === where.id);
      if (!m) throw new Error("prisma-sms: message not found");
      for (const [k, v] of Object.entries(data)) {
        // Mirror prisma-memory's applyData for the one operator the sweep uses.
        if (v !== null && typeof v === "object" && !(v instanceof Date) && "increment" in (v as Row)) {
          m[k] = (m[k] as number) + ((v as Row).increment as number);
        } else {
          m[k] = v;
        }
      }
      return m;
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const hit = messages.filter((m) => m.providerRef === where.providerRef);
      hit.forEach((m) => Object.assign(m, data));
      return { count: hit.length };
    },
  },
};
