/**
 * A tiny in-memory stand-in for the parts of Prisma that lib/orders touches.
 *
 * The concurrency bugs this exists to test are not database bugs — they are
 * read-then-write gaps in our own code, where two callers both act on a
 * snapshot that stopped being true. Reproducing them needs interleaving, not
 * Postgres, so this fake models the one property that matters: `updateMany`
 * applies its WHERE and its write as a single indivisible step, exactly as a
 * conditional UPDATE does. Everything else is the least code that keeps
 * lib/orders running.
 *
 * Deliberately not a general Prisma emulator. If a test needs a feature this
 * doesn't have, add it here rather than reaching for a real database — the
 * moment these tests need a server they stop being run.
 */

type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;

  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND" || key === "OR" || key === "NOT") {
      throw new Error(`prisma-memory: ${key} is not implemented`);
    }

    const value = row[key];

    // Prisma treats an unset column as NULL, so `resolvedAt: null` must match a
    // row that never set it. Without this, undefined !== null hides every fresh
    // refund from the retry sweep's query.
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
      continue;
    }

    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).includes(value)) return false;
      if ("not" in c && value === c.not) return false;
      if ("lt" in c && !((value as Date) < (c.lt as Date))) return false;
      if ("gt" in c && !((value as Date) > (c.gt as Date))) return false;
      // Nested relation filters (order: { restaurantId }) are resolved by the
      // caller seeding a flattened column instead; see seedRefund.
      continue;
    }

    if (value !== cond) return false;
  }

  return true;
}

function applyData(row: Row, data: Row): void {
  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val === "object" && !(val instanceof Date)) {
      const op = val as Row;
      if ("increment" in op) {
        row[key] = (row[key] as number) + (op.increment as number);
        continue;
      }
      if ("decrement" in op) {
        row[key] = (row[key] as number) - (op.decrement as number);
        continue;
      }
      if ("set" in op) {
        row[key] = op.set;
        continue;
      }
    }
    row[key] = val;
  }
}

let seq = 0;

class Table {
  rows: Row[] = [];

  async findFirst(args: { where?: Row; orderBy?: Row } = {}) {
    const hits = this.rows.filter((r) => matches(r, args.where));
    return hits[0] ? { ...hits[0] } : null;
  }

  async findUnique(args: { where: Row }) {
    return this.findFirst(args);
  }

  async findMany(args: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, args.where)).map((r) => ({ ...r }));
  }

  async create(args: { data: Row }) {
    const row: Row = { id: `row_${++seq}`, createdAt: new Date(), ...args.data };
    this.rows.push(row);
    return { ...row };
  }

  async update(args: { where: Row; data: Row }) {
    const row = this.rows.find((r) => matches(r, args.where));
    if (!row) throw new Error("prisma-memory: update matched no row");
    applyData(row, args.data);
    return { ...row };
  }

  /**
   * The important one. The filter and the write happen with no await between
   * them, so a second caller can never slip in behind a stale read — which is
   * the whole guarantee the optimistic locks in lib/orders depend on.
   */
  async updateMany(args: { where: Row; data: Row }) {
    const hits = this.rows.filter((r) => matches(r, args.where));
    for (const row of hits) applyData(row, args.data);
    return { count: hits.length };
  }

  async count(args: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, args.where)).length;
  }

  async deleteMany(args: { where?: Row } = {}) {
    const keep = this.rows.filter((r) => !matches(r, args.where));
    const count = this.rows.length - keep.length;
    this.rows = keep;
    return { count };
  }
}

class MemoryPrisma {
  order = new Table();
  orderItem = new Table();
  orderEvent = new Table();
  orderIssue = new Table();
  refund = new Table();
  customer = new Table();
  restaurant = new Table();

  /**
   * Runs the callback against this same client. No rollback — every test here
   * asserts on the committed end state, and a fake that pretended to have
   * transactions would be lying about the only thing worth testing.
   */
  async $transaction<T>(arg: ((tx: MemoryPrisma) => Promise<T>) | Promise<unknown>[]): Promise<T | unknown[]> {
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg(this);
  }

  reset() {
    for (const t of [
      this.order,
      this.orderItem,
      this.orderEvent,
      this.orderIssue,
      this.refund,
      this.customer,
      this.restaurant,
    ]) {
      t.rows = [];
    }
  }
}

export const prisma = new MemoryPrisma();
