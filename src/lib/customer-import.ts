import "server-only";

/**
 * Importing a customer list into a tenant's database.
 *
 * ─── The rule this module exists to enforce ───────────────────────────────
 *
 * **An import can never grant messaging consent.** Every row lands as
 * `optInStatus: UNKNOWN`, and there is deliberately no column, flag, option or
 * owner-facing checkbox that changes that. This is the single most important
 * thing in this file and it is not a default to be made configurable later.
 *
 * Three reasons, in ascending order of how much they cost:
 *
 * 1. TCPA consent must be *provable* — who agreed, to what exact wording, and
 *    when. That's why `Customer` carries `optInAt`, `optInSource` and
 *    `optInText` rather than a boolean. A spreadsheet supplies none of it, so
 *    an import marking rows OPTED_IN would be manufacturing evidence of
 *    something that may never have happened.
 * 2. The owner uploading the file frequently doesn't know either. "My old POS
 *    had these numbers" is not consent to be texted by a different business
 *    on a different number, and the person most likely to believe otherwise is
 *    the one clicking import.
 * 3. The failure isn't a fine, it's the number. Texting a cold imported list
 *    produces spam reports, and carriers respond by filtering the *sending
 *    number* — which takes down every legitimate order notification for that
 *    tenant, including to the customers who did opt in. `lib/sms.ts` already
 *    treats a STOP reply as blocking even transactional sends for exactly this
 *    reason. Losing the list to protect the list is the whole point.
 *
 * So the imported rows are a **contact record, not an audience**. They give the
 * owner history and recognition — the storefront can greet a returning
 * customer by name, and the dashboard can show they've ordered before. Consent
 * is only ever written by the checkout flow, where a human ticked a box next
 * to disclosure text we can reproduce.
 *
 * If someone later wants an "I have written consent" attestation path, it
 * needs a lawyer and a place to store the proof, not a checkbox in this
 * function. `docs/customer-import.md` records why it was left out.
 *
 * ─── Everything else ──────────────────────────────────────────────────────
 *
 * Import is **upsert by phone**, never blind create. `[restaurantId, phone]` is
 * unique in the schema, so a second upload of an overlapping file has to be
 * safe — owners re-import constantly, usually because the first attempt was
 * missing a column.
 *
 * Merges never destroy order-derived data. `orderCount`, `lifetimeCts`,
 * `firstOrderAt` and `lastOrderAt` are computed from real trade and a
 * spreadsheet does not get to overwrite them. Name and email fill *gaps* only:
 * a blank cell must not erase a name we learned from a real order.
 */

import { prisma } from "@/lib/prisma";
import { mapCustomerCsv, CUSTOMER_CSV_HEADER, toCsvRow } from "@/lib/csv";
import { displayPhone } from "@/lib/money";
import {
  ensureTag,
  tagCustomers,
  customerWhere,
  type CustomerFilters,
  type TagColor,
} from "@/lib/customers";

export type CustomerImportSummary = {
  ok?: string;
  error?: string;
  created: number;
  updated: number;
  duplicatesInFile: number;
  skipped: number;
  warnings: string[];
  /** The job row, when a real import ran. Absent on a validation failure. */
  jobId?: string;
};

/**
 * What a file *would* do, without doing it.
 *
 * A preview exists because the two ways an import goes wrong are both
 * invisible until afterwards: the wrong column got read as the phone number,
 * or the file is a different list than the owner thought. Both are obvious
 * from five sample rows and a "this will create 0 and update 900" count, and
 * neither is recoverable by staring at a success toast.
 *
 * It runs the same mapper and the same duplicate collapse as the real import —
 * a preview produced by a second code path is a preview of something else.
 */
export type CustomerImportPreview = {
  error?: string;
  /** Which CSV columns were recognised, and as what. */
  columns: { header: string; mappedTo: string | null }[];
  totalRows: number;
  usableRows: number;
  duplicatesInFile: number;
  willCreate: number;
  willUpdate: number;
  unchanged: number;
  /** A handful of mapped rows, so the owner can eyeball the phone column. */
  sample: { name: string | null; phone: string; email: string | null; existing: boolean }[];
  warnings: string[];
};

const EMPTY: Omit<CustomerImportSummary, "ok" | "error"> = {
  created: 0,
  updated: 0,
  duplicatesInFile: 0,
  skipped: 0,
  warnings: [],
};

/**
 * A ceiling on one upload. Not a business rule — a guard against a 200k-row
 * export being processed a row at a time inside a server action that has a
 * request timeout. An owner who genuinely has more than this needs a job
 * queue, and should hit a clear message rather than a silent truncation.
 */
export const MAX_IMPORT_ROWS = 5000;

/**
 * Collapse rows that describe the same person before anything is written.
 *
 * An export with one row per past order is the common shape, so the same
 * customer can appear fifty times. Last non-empty value wins, so the most
 * recently listed spelling of a name is the one kept.
 *
 * Shared by the preview and the real import deliberately: a preview that
 * counts differently from the import it previews is worse than no preview.
 */
function collapseByPhone(rows: ReturnType<typeof mapCustomerCsv>["rows"]) {
  const byPhone = new Map<string, (typeof rows)[number]>();
  let duplicatesInFile = 0;
  for (const row of rows) {
    const prev = byPhone.get(row.phone);
    if (prev) {
      duplicatesInFile++;
      byPhone.set(row.phone, {
        ...prev,
        name: row.name ?? prev.name,
        email: row.email ?? prev.email,
        notes: row.notes ?? prev.notes,
      });
    } else {
      byPhone.set(row.phone, row);
    }
  }
  return { unique: [...byPhone.values()], duplicatesInFile };
}

/**
 * Dry-run a file. Reads, never writes.
 *
 * See `CustomerImportPreview` for why this exists at all. Note it deliberately
 * reports `willUpdate` and `unchanged` separately: "900 rows, 0 new" is the
 * signature of re-importing the same file, which is fine, while "900 rows, 900
 * new" on a tenant that already has 900 customers is the signature of a phone
 * column that didn't match anything — the same file uploaded twice under two
 * different readings of the same column.
 */
export async function previewCustomerCsvText(
  restaurantId: string,
  csvText: string
): Promise<CustomerImportPreview> {
  const mapped = mapCustomerCsv(csvText);
  const columns = mapped.columns.map((c) => ({ header: c.header, mappedTo: c.mappedTo }));

  const empty: CustomerImportPreview = {
    columns,
    totalRows: mapped.totalRows,
    usableRows: 0,
    duplicatesInFile: 0,
    willCreate: 0,
    willUpdate: 0,
    unchanged: 0,
    sample: [],
    warnings: mapped.warnings,
  };

  if (mapped.rows.length === 0) {
    return { ...empty, error: mapped.warnings[0] ?? "No usable rows found in that file." };
  }
  if (mapped.rows.length > MAX_IMPORT_ROWS) {
    return { ...empty, error: tooManyRowsMessage(mapped.rows.length) };
  }

  const { unique, duplicatesInFile } = collapseByPhone(mapped.rows);

  const existing = await prisma.customer.findMany({
    where: { restaurantId, phone: { in: unique.map((r) => r.phone) } },
    select: { phone: true, name: true, email: true },
  });
  const existingByPhone = new Map(existing.map((c: any) => [c.phone as string, c]));

  let willCreate = 0;
  let willUpdate = 0;
  let unchanged = 0;
  for (const row of unique) {
    const prior = existingByPhone.get(row.phone);
    if (!prior) willCreate++;
    else if ((!prior.name && row.name) || (!prior.email && row.email)) willUpdate++;
    else unchanged++;
  }

  return {
    columns,
    totalRows: mapped.totalRows,
    usableRows: unique.length,
    duplicatesInFile,
    willCreate,
    willUpdate,
    unchanged,
    sample: unique.slice(0, 5).map((r) => ({
      name: r.name,
      // Displayed the way the dashboard displays every other number, so the
      // owner is comparing like with like when they check it's the right column.
      phone: displayPhone(r.phone),
      email: r.email,
      existing: existingByPhone.has(r.phone),
    })),
    warnings: mapped.warnings,
  };
}

function tooManyRowsMessage(n: number) {
  return `That file has ${n.toLocaleString()} rows. Please split it into files of ${MAX_IMPORT_ROWS.toLocaleString()} or fewer and upload them one at a time.`;
}

export type ImportOptions = {
  /** Shown in the import history. Never trusted for anything else. */
  filename?: string;
  /**
   * An extra tag to put on every row this file touches, on top of the
   * automatic per-import one — "Toast migration", "catering enquiries".
   */
  tagName?: string;
  tagColor?: TagColor;
};

export async function importCustomerCsvText(
  restaurantId: string,
  csvText: string,
  options: ImportOptions = {}
): Promise<CustomerImportSummary> {
  const { rows, warnings, unusable } = mapCustomerCsv(csvText);

  if (rows.length === 0) {
    return {
      ...EMPTY,
      error: warnings[0] ?? "No usable rows found in that file.",
      warnings,
    };
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    return { ...EMPTY, error: tooManyRowsMessage(rows.length), warnings };
  }

  const { unique, duplicatesInFile } = collapseByPhone(rows);

  // The job row is created *before* any customer, because it's the marker
  // every created row carries. Writing it afterwards would leave a window
  // where rows exist with no job to undo them by — the same reasoning that
  // makes `lib/orders.ts` reserve a refund amount before calling the provider.
  const job = await prisma.customerImportJob.create({
    data: {
      restaurantId,
      filename: options.filename?.slice(0, 200) ?? null,
      duplicatesInFile,
      unusableRows: unusable,
    },
  });

  // Two tags, and they're different things. The automatic one is a system tag
  // naming this upload, so "where did these 900 people come from" has an
  // answer six months from now. The optional one is whatever the owner called
  // the list, and is an ordinary tag they can rename and reuse.
  const autoTag = await ensureTag(
    restaurantId,
    importTagName(options.filename, job.createdAt),
    "accent",
    true
  );
  const extraTag = options.tagName ? await ensureTag(restaurantId, options.tagName, options.tagColor ?? "neutral") : null;

  if (autoTag.ok) {
    await prisma.customerImportJob.update({ where: { id: job.id }, data: { tagId: autoTag.tag.id } });
  }

  // One read for everything already present, rather than a findUnique per row.
  const existing = await prisma.customer.findMany({
    where: { restaurantId, phone: { in: unique.map((r) => r.phone) } },
    select: { id: true, phone: true, name: true, email: true },
  });
  const existingByPhone = new Map(existing.map((c: any) => [c.phone as string, c]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  // Everything the file referred to, existing or new — this is what gets
  // tagged. Tagging only the created rows would mean re-importing a list you
  // already have produces a tag on nobody, which reads as the import failing.
  const touched: string[] = [];

  for (const row of unique) {
    const prior = existingByPhone.get(row.phone);

    try {
      if (!prior) {
        const made = await prisma.customer.create({
          data: {
            restaurantId,
            phone: row.phone,
            name: row.name,
            email: row.email,
            // Stated rather than left to the schema default, because this is
            // the line a future reader needs to see. See the header.
            optInStatus: "UNKNOWN",
            // Written only here, on create. A merge must never set it — see
            // the schema comment on `Customer.importJobId`. This is what makes
            // "rows this job invented" an exact set, and therefore what makes
            // undo safe.
            importJobId: job.id,
          },
          select: { id: true },
        });
        created++;
        touched.push(made.id);
        continue;
      }

      touched.push(prior.id);

      // Fill gaps only. A blank cell in the spreadsheet is an absence of
      // information, not an instruction to forget what we already know.
      const patch: { name?: string; email?: string } = {};
      if (!prior.name && row.name) patch.name = row.name;
      if (!prior.email && row.email) patch.email = row.email;

      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }

      await prisma.customer.update({ where: { id: prior.id }, data: patch });
      updated++;
    } catch {
      // A unique-constraint collision here means a real order created this
      // customer between the read above and this write — which is a customer
      // ordering while their owner uploads a file, i.e. a good day. Their live
      // record is better than the spreadsheet's, so leave it alone.
      skipped++;
    }
  }

  // Tagging is chunked because `createMany` with 5,000 rows in one statement
  // is a parameter count Postgres will refuse.
  for (const tagId of [autoTag.ok ? autoTag.tag.id : null, extraTag?.ok ? extraTag.tag.id : null]) {
    if (!tagId) continue;
    for (let i = 0; i < touched.length; i += 500) {
      await tagCustomers(restaurantId, tagId, touched.slice(i, i + 500), "add");
    }
  }

  await prisma.customerImportJob.update({
    where: { id: job.id },
    data: { created, updated, skipped },
  });

  const bits: string[] = [];
  if (created) bits.push(`${created} new customer${created === 1 ? "" : "s"}`);
  if (updated) bits.push(`${updated} updated`);
  if (skipped) bits.push(`${skipped} already up to date`);
  if (duplicatesInFile) {
    warnings.push(
      `${duplicatesInFile} duplicate row${duplicatesInFile === 1 ? "" : "s"} in the file ${
        duplicatesInFile === 1 ? "was" : "were"
      } merged by phone number.`
    );
  }
  if (!autoTag.ok) {
    // Non-fatal: the customers are in, they just aren't labelled. Said out
    // loud rather than swallowed, because the undo button is weaker without
    // the tag and the owner should know that before they need it.
    warnings.push("Couldn't tag this import — the customers were imported, but aren't grouped.");
  }

  return {
    ...EMPTY,
    ok: bits.length ? `Imported: ${bits.join(", ")}.` : "Nothing to import — every row was already on file.",
    created,
    updated,
    duplicatesInFile,
    skipped,
    warnings,
    jobId: job.id,
  };
}

/**
 * The name of the automatic per-import tag.
 *
 * Dated, because an owner who uploads "customers.csv" three times needs three
 * distinguishable tags — and because the date is the thing they actually
 * remember ("the list I did in March"). Falls back to the date alone when the
 * browser didn't give us a filename.
 */
function importTagName(filename: string | undefined, at: Date): string {
  const date = at.toISOString().slice(0, 10);
  const base = (filename ?? "").replace(/\.csv$/i, "").trim();
  return base ? `Import: ${base.slice(0, 14)} ${date}` : `Import ${date}`;
}

/** One tenant's upload history, newest first. */
export async function listImportJobs(restaurantId: string, take = 20) {
  return prisma.customerImportJob.findMany({
    where: { restaurantId },
    orderBy: { createdAt: "desc" },
    take,
    include: { tag: { select: { id: true, name: true, slug: true } } },
  });
}

export type UndoResult = { ok: true; deleted: number; kept: number } | { ok: false; error: string };

/**
 * Reverse an import.
 *
 * **This deletes only rows the job created, and only those that have never
 * ordered.** Both halves matter and neither is negotiable:
 *
 * - `importJobId` is written on create and never on a merge, so the set is
 *   exactly "people this file invented". An import that filled in a missing
 *   email on a two-year regular did not create them, and undoing it must not
 *   remove them. This is the same contract the simulator's `+1555017` block
 *   and `paymentProvider: "sim"` markers carry, and for the same reason: a
 *   cleanup is only safe if the marker is exact.
 * - Anyone who has ordered since is kept regardless. They stopped being an
 *   imported contact the moment they became a customer, and deleting them
 *   would take an `Order.customerId` with it — which is a hole in the
 *   tenant's own history caused by them tidying up a spreadsheet.
 *
 * The job row survives, with `undoneAt` set. "We imported 900 people and took
 * them back out" is the thing that explains a gap in the list later; deleting
 * the record of it leaves the gap unexplained.
 */
export async function undoImport(restaurantId: string, jobId: string): Promise<UndoResult> {
  const job = await prisma.customerImportJob.findFirst({ where: { id: jobId, restaurantId } });
  if (!job) return { ok: false, error: "That import isn't on your account." };
  if (job.undoneAt) return { ok: false, error: "That import has already been undone." };

  const candidates = await prisma.customer.findMany({
    where: { restaurantId, importJobId: jobId },
    select: { id: true, orderCount: true },
  });

  const deletable = candidates.filter((c: any) => c.orderCount === 0).map((c: any) => c.id);
  const kept = candidates.length - deletable.length;

  let deleted = 0;
  for (let i = 0; i < deletable.length; i += 500) {
    const res = await prisma.customer.deleteMany({
      // The tenant scope and the `orderCount: 0` check are both repeated in
      // the delete rather than trusted from the read above. A customer can
      // place their first order between the two, and the one thing this
      // function must never do is delete somebody with orders attached.
      where: {
        id: { in: deletable.slice(i, i + 500) },
        restaurantId,
        importJobId: jobId,
        orderCount: 0,
      },
    });
    deleted += res.count;
  }

  await prisma.customerImportJob.update({
    where: { id: jobId },
    data: { undoneAt: new Date(), undoneCount: deleted },
  });

  return { ok: true, deleted, kept: kept + (deletable.length - deleted) };
}

/**
 * Serialize a tenant's customer list to CSV for the "Export" button.
 *
 * Takes the same filters the list page does, so "export what I'm looking at"
 * is the same set as what's on screen. An export button that silently ignores
 * the filter bar and dumps everything is how a win-back list of 40 lapsed
 * regulars arrives as 3,000 rows, and the person who mails it has no way to
 * tell from the file that it happened.
 */
export async function exportCustomerCsvText(
  restaurantId: string,
  filters?: CustomerFilters
): Promise<string> {
  const customers = await prisma.customer.findMany({
    where: customerWhere({ ...(filters ?? {}), restaurantId }),
    orderBy: [{ lastOrderAt: "desc" }, { createdAt: "desc" }],
    select: {
      name: true,
      phone: true,
      email: true,
      optInStatus: true,
      orderCount: true,
      lifetimeCts: true,
      lastOrderAt: true,
      tags: { include: { tag: { select: { name: true } } } },
    },
  });

  // The export carries opt-in status as a read-only column even though the
  // import ignores it. An owner asking "who can I actually text" deserves the
  // answer; the round trip not being symmetric is the point, and the header
  // name says so.
  //
  // Tags go in the `notes` column, which the import *does* read — so a list
  // exported, edited in Excel and re-imported keeps its labels as text. They
  // don't round-trip back into real tags, and the header doesn't pretend
  // otherwise.
  const header = [...CUSTOMER_CSV_HEADER, "consent_status_readonly", "orders", "lifetime", "last_order", "tags_readonly"];

  const lines = [toCsvRow(header)];
  for (const c of customers as any[]) {
    const tagNames = (c.tags ?? []).map((l: any) => l.tag.name).join("; ");
    lines.push(
      toCsvRow([
        c.name ?? "",
        displayPhone(c.phone),
        c.email ?? "",
        "",
        c.optInStatus,
        String(c.orderCount),
        (c.lifetimeCts / 100).toFixed(2),
        c.lastOrderAt ? c.lastOrderAt.toISOString().slice(0, 10) : "",
        tagNames,
      ])
    );
  }
  return lines.join("\n");
}

/** The downloadable template. Header plus one illustrative row. */
export function customerCsvTemplate(): string {
  return [
    toCsvRow([...CUSTOMER_CSV_HEADER]),
    toCsvRow(["Jane Doe", "(555) 010-1234", "jane@example.com", "Regular - always orders the special"]),
  ].join("\n");
}
