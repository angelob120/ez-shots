/**
 * In-memory Prisma stand-in for the invite tests.
 *
 * Separate from the SMS and order doubles for the same reason they're separate
 * from each other: the questions here are about single-use claims and
 * transactional rollback, which need `$transaction` to actually roll back. The
 * other stubs don't model that, and bolting it on would make every unrelated
 * test carry the machinery.
 *
 * The one property the tests genuinely depend on is that `updateMany` is
 * atomic with respect to its WHERE — the same property `prisma-memory.ts`
 * provides for the optimistic locks in lib/orders.ts, and the only thing
 * making a redemption single-use.
 */

type Row = Record<string, unknown>;

let invites: Row[] = [];
let users: Row[] = [];
let restaurants: Row[] = [];
let seq = 0;
let queue: Promise<void> = Promise.resolve();

export function reset() {
  invites = [];
  users = [];
  restaurants = [];
  seq = 0;
  queue = Promise.resolve();
}

export function seedRestaurant(row: Row = {}): Row {
  const r = { id: `rest_${++seq}`, name: "Angelo's Pizza", ...row };
  restaurants.push(r);
  return r;
}

export function seedUser(row: Row): Row {
  const u = { id: `user_${++seq}`, role: "OWNER", restaurantId: null, name: null, ...row };
  users.push(u);
  return u;
}

export function allInvites() {
  return invites;
}
export function allUsers() {
  return users;
}

/** Shallow WHERE matcher covering the shapes lib/invites.ts actually uses. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as Record<string, unknown>;
      if ("gt" in cond) return (row[k] as Date) > (cond.gt as Date);
      if ("lt" in cond) return (row[k] as Date) < (cond.lt as Date);
      if ("not" in cond) return row[k] !== cond.not;
      return false;
    }
    return row[k] === v;
  });
}

/**
 * Attach the `restaurant` relation. `lookupInvite` selects through it to get
 * the tenant's name for the redemption page, so a stub that returns a bare row
 * would fail on a shape the real client handles.
 */
function withRestaurant(row: Row | null): Row | null {
  if (!row) return null;
  return { ...row, restaurant: restaurants.find((r) => r.id === row.restaurantId) ?? null };
}

function makeClient(store: { invites: Row[]; users: Row[] }) {
  return {
    invite: {
      async create({ data }: { data: Row }) {
        const row = {
          id: `inv_${++seq}`,
          createdAt: new Date(),
          redeemedAt: null,
          redeemedById: null,
          revokedAt: null,
          createdById: null,
          role: "OWNER",
          ...data,
        };
        store.invites.push(row);
        return row;
      },
      async findUnique({ where }: { where: Row }) {
        return withRestaurant(store.invites.find((i) => matches(i, where)) ?? null);
      },
      async findMany({ where }: { where?: Row } = {}) {
        return store.invites.filter((i) => (where ? matches(i, where) : true));
      },
      async updateMany({ where, data }: { where: Row; data: Row }) {
        const hits = store.invites.filter((i) => matches(i, where));
        for (const h of hits) Object.assign(h, data);
        return { count: hits.length };
      },
      async update({ where, data }: { where: Row; data: Row }) {
        const hit = store.invites.find((i) => matches(i, where));
        if (!hit) throw new Error("Record not found");
        Object.assign(hit, data);
        return hit;
      },
    },
    user: {
      async findUnique({ where }: { where: Row }) {
        return store.users.find((u) => matches(u, where)) ?? null;
      },
      async create({ data }: { data: Row }) {
        // The real unique constraint on email is load-bearing in redeemInvite's
        // error path, so the double enforces it too.
        if (store.users.some((u) => u.email === data.email)) {
          throw new Error("Unique constraint failed on the fields: (`email`)");
        }
        const row = { id: `user_${++seq}`, name: null, ...data };
        store.users.push(row);
        return row;
      },
      async count({ where }: { where: Row }) {
        return store.users.filter((u) => matches(u, where)).length;
      },
    },
  };
}

export const prisma = {
  get invite() {
    return makeClient({ invites, users }).invite;
  },
  get user() {
    return makeClient({ invites, users }).user;
  },
  restaurant: {
    async findUnique({ where }: { where: Row }) {
      return restaurants.find((r) => matches(r, where)) ?? null;
    },
  },

  /**
   * Transactions, with the two properties the invite tests actually depend on.
   *
   * **Rollback.** A callback that throws leaves the store as it found it.
   * Without this, the "user creation fails partway" case would leave the invite
   * consumed with no account behind it — precisely the bug the transaction in
   * `redeemInvite` exists to prevent, so a stub that can't roll back can't test
   * it.
   *
   * **Serialization.** Transactions run one at a time. Real concurrent
   * redemptions are serialized by Postgres taking a row lock on the conditional
   * UPDATE; here the queue stands in for that. It matters because JS
   * interleaves at every await: without it, three `Promise.all` redemptions all
   * snapshot the store before any of them commits, and the second one's
   * rollback would erase the first one's success — the stub would report zero
   * winners for a race that in reality has exactly one.
   */
  async $transaction<T>(fn: (tx: ReturnType<typeof makeClient>) => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const snapshotInvites = invites.map((r) => ({ ...r }));
      const snapshotUsers = users.map((r) => ({ ...r }));
      try {
        return await fn(makeClient({ invites, users }));
      } catch (err) {
        invites = snapshotInvites;
        users = snapshotUsers;
        throw err;
      }
    });
    // Keep the chain alive whichever way this one goes, or one failed
    // transaction would wedge every later one.
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  },
};
