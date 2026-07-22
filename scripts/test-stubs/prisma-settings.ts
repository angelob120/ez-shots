/**
 * In-memory Prisma stand-in for the payment-mode guard tests.
 *
 * Only the singleton `PlatformSetting` row, because that's the whole surface
 * `resolveModeState` touches. `failUpdates` exists to prove the one property
 * that's easy to get wrong: a database that refuses the write-back must not
 * take checkout down with it — the returned mode is what matters, and the row
 * catches up later.
 */

type Row = Record<string, unknown>;

let setting: Row | null = null;
export let failUpdates = false;

export function reset() {
  setting = null;
  failUpdates = false;
}

export function seedSetting(row: Row) {
  setting = {
    id: "singleton",
    paymentMode: "STUB",
    modeExpiresAt: null,
    modeRevertTo: null,
    modeRevertedAt: null,
    testModeEnabled: false,
    updatedById: null,
    ...row,
  };
  return setting;
}

export function currentSetting() {
  return setting;
}

export function setFailUpdates(v: boolean) {
  failUpdates = v;
}

export const prisma = {
  platformSetting: {
    async findUnique() {
      return setting;
    },
    async update({ data }: { data: Row }) {
      if (failUpdates) throw new Error("simulated database failure");
      if (!setting) throw new Error("Record not found");
      Object.assign(setting, data);
      return setting;
    },
    async upsert({ create, update }: { create: Row; update: Row }) {
      if (failUpdates) throw new Error("simulated database failure");
      if (!setting) setting = { ...create };
      else Object.assign(setting, update);
      return setting;
    },
  },
};
