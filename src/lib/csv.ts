/**
 * A small, dependency-free CSV parser and menu-row mapper.
 *
 * Restaurant owners export menus from spreadsheets, Square, Toast, or type one
 * by hand. That means quoted fields, embedded commas and newlines, a header
 * row whose column names vary wildly, and the odd stray blank line. We handle
 * all of that here so the callers only ever see clean, typed rows.
 */

/** Parse RFC-4180-ish CSV text into an array of string cells per row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Normalize newlines and strip a UTF-8 BOM if Excel left one.
  const s = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row if the file didn't end in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty (blank lines between sections).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export type ParsedMenuRow = {
  name: string;
  price: string;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  available: boolean;
  featured: boolean;
};

export type CsvMappingResult = {
  rows: ParsedMenuRow[];
  /** Human-readable problems, one per skipped row, for surfacing to the owner. */
  warnings: string[];
};

/** Loosely match a header to a canonical column. */
function classifyHeader(h: string): keyof ParsedMenuRow | null {
  const k = h.toLowerCase().replace(/[^a-z]/g, "");
  if (["name", "item", "itemname", "title", "product"].includes(k)) return "name";
  if (["price", "cost", "amount", "priceusd", "price$"].includes(k)) return "price";
  if (["category", "section", "group", "menu", "type"].includes(k)) return "category";
  if (["description", "desc", "details", "notes"].includes(k)) return "description";
  if (
    ["image", "imageurl", "imagelink", "photo", "photourl", "picture", "img", "imgurl"].includes(k)
  )
    return "imageUrl";
  if (["available", "instock", "active", "instock", "enabled"].includes(k)) return "available";
  if (["featured", "popular", "highlight"].includes(k)) return "featured";
  return null;
}

function truthy(v: string): boolean {
  return ["1", "true", "yes", "y", "available", "in stock", "instock", "active"].includes(
    v.trim().toLowerCase()
  );
}

function falsy(v: string): boolean {
  return ["0", "false", "no", "n", "unavailable", "out", "out of stock", "86", "inactive"].includes(
    v.trim().toLowerCase()
  );
}

/**
 * Map raw CSV text to typed menu rows. Uses the header row to find columns;
 * if no recognizable header exists, falls back to positional
 * name,price,category,description,imageUrl.
 */
export function mapMenuCsv(text: string): CsvMappingResult {
  const grid = parseCsv(text);
  const warnings: string[] = [];
  if (grid.length === 0) return { rows: [], warnings: ["The file was empty."] };

  const header = grid[0].map((h) => classifyHeader(h));
  const hasHeader = header.some((h) => h !== null);

  // Column index → field.
  const cols: Partial<Record<keyof ParsedMenuRow, number>> = {};
  if (hasHeader) {
    header.forEach((field, i) => {
      if (field && cols[field] === undefined) cols[field] = i;
    });
  } else {
    // Positional fallback.
    cols.name = 0;
    cols.price = 1;
    cols.category = 2;
    cols.description = 3;
    cols.imageUrl = 4;
  }

  if (cols.name === undefined) {
    return {
      rows: [],
      warnings: [
        "Couldn't find a name column. Add a header row with at least 'name' and 'price'.",
      ],
    };
  }

  const dataRows = hasHeader ? grid.slice(1) : grid;
  const rows: ParsedMenuRow[] = [];

  dataRows.forEach((cells, idx) => {
    const at = (f: keyof ParsedMenuRow) => {
      const i = cols[f];
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };

    const name = at("name");
    if (!name) return; // silently skip fully blank name rows

    const priceRaw = at("price");
    if (!priceRaw || !/[0-9]/.test(priceRaw)) {
      warnings.push(`Row ${idx + 1} (“${name}”): missing or invalid price - skipped.`);
      return;
    }

    const availRaw = at("available");
    const featRaw = at("featured");
    const imageUrl = at("imageUrl");

    rows.push({
      name: name.slice(0, 120),
      price: priceRaw,
      category: at("category") || null,
      description: at("description") || null,
      imageUrl: imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : null,
      available: availRaw ? !falsy(availRaw) || truthy(availRaw) : true,
      featured: featRaw ? truthy(featRaw) : false,
    });

    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      warnings.push(`Row ${idx + 1} (“${name}”): image link isn't a valid http(s) URL - ignored.`);
    }
  });

  return { rows, warnings };
}

/** The header we hand back on export, and the template we offer for download. */
export const MENU_CSV_HEADER = [
  "name",
  "price",
  "category",
  "description",
  "image_url",
  "available",
  "featured",
] as const;

/** Quote a single CSV cell when it contains a comma, quote, or newline. */
export function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

// ---------------------------------------------------------------------------
// Customer list import
// ---------------------------------------------------------------------------

export type ParsedCustomerRow = {
  phone: string;
  name: string | null;
  email: string | null;
  /** Free-text from the source file. Parsed, kept for display, never trusted. */
  notes: string | null;
};

export type CustomerMappingResult = {
  rows: ParsedCustomerRow[];
  warnings: string[];
  /**
   * Rows whose phone couldn't be made sense of. Counted separately from
   * `warnings` because "you gave me 400 rows and 380 had no usable number"
   * is a different conversation from "one row was odd" — an owner exporting
   * from the wrong system needs to be told the file is wrong, not handed a
   * list of 380 individual complaints.
   */
  unusable: number;
  /**
   * What each column of the file was understood to be, in file order.
   *
   * Reported rather than kept internal so the import preview can show it. The
   * most expensive import mistake is a column read as the wrong field — a
   * loyalty-card number landing in `phone` produces a list of plausible
   * numbers belonging to other people, and nothing downstream can detect it.
   * Showing the mapping before the write is the only place that's catchable.
   */
  columns: { header: string; mappedTo: keyof ParsedCustomerRow | null }[];
  /** Data rows in the file, before anything was rejected or merged. */
  totalRows: number;
};

function classifyCustomerHeader(h: string): keyof ParsedCustomerRow | null {
  const k = h.toLowerCase().replace(/[^a-z]/g, "");
  if (["phone", "phonenumber", "mobile", "cell", "cellphone", "tel", "telephone", "number", "contact", "msisdn"].includes(k))
    return "phone";
  if (["name", "customer", "customername", "fullname", "firstname", "contactname", "client"].includes(k))
    return "name";
  if (["email", "emailaddress", "mail", "e"].includes(k)) return "email";
  if (["notes", "note", "comment", "comments", "tags", "tag"].includes(k)) return "notes";
  return null;
}

// Deliberately permissive — same reasoning as the address check in
// lib/support.ts. This value is stored for the owner's reference and is never
// a delivery target (nothing in this product sends email), so a strict RFC
// pattern would reject real addresses to protect against nothing.
const EMAILISH = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/**
 * Map raw CSV text to typed customer rows.
 *
 * Header detection is loose because the files come from everywhere — Square,
 * Toast, Mailchimp, a POS report, or a spreadsheet somebody typed by hand.
 * The positional fallback assumes `name,phone` rather than `phone,name`,
 * because every hand-typed contact list observed in the wild starts with the
 * person.
 *
 * Note what this does *not* parse: anything resembling consent. There is no
 * `opted_in` column and adding one would be a mistake — see the header comment
 * in `lib/customer-import.ts`.
 */
export function mapCustomerCsv(text: string): CustomerMappingResult {
  const grid = parseCsv(text);
  const warnings: string[] = [];
  if (grid.length === 0)
    return { rows: [], warnings: ["The file was empty."], unusable: 0, columns: [], totalRows: 0 };

  const header = grid[0].map((h) => classifyCustomerHeader(h));
  const hasHeader = header.some((h) => h !== null);

  const cols: Partial<Record<keyof ParsedCustomerRow, number>> = {};
  if (hasHeader) {
    header.forEach((field, i) => {
      if (field && cols[field] === undefined) cols[field] = i;
    });
  } else {
    cols.name = 0;
    cols.phone = 1;
    cols.email = 2;
  }

  // Reported for the preview. Without a header row the file is positional, so
  // the "header" shown is the position — which is what the owner needs to see
  // to notice that column 2 isn't the phone number.
  const columns: CustomerMappingResult["columns"] = hasHeader
    ? grid[0].map((h, i) => ({
        header: h,
        // Only the *first* column claiming a field wins, matching `cols` above,
        // so a file with two "email" columns doesn't claim both were used.
        mappedTo: header[i] && cols[header[i]!] === i ? header[i] : null,
      }))
    : (grid[0] ?? []).map((_, i) => ({
        header: `Column ${i + 1}`,
        mappedTo: i === 0 ? ("name" as const) : i === 1 ? ("phone" as const) : i === 2 ? ("email" as const) : null,
      }));

  if (cols.phone === undefined) {
    return {
      rows: [],
      warnings: [
        "Couldn't find a phone column. Add a header row with at least 'phone' — that's the only column this needs.",
      ],
      unusable: 0,
      columns,
      totalRows: hasHeader ? grid.length - 1 : grid.length,
    };
  }

  const dataRows = hasHeader ? grid.slice(1) : grid;
  const rows: ParsedCustomerRow[] = [];
  let unusable = 0;

  dataRows.forEach((cells) => {
    const at = (f: keyof ParsedCustomerRow) => {
      const i = cols[f];
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };

    const rawPhone = at("phone");
    if (!rawPhone) {
      unusable++;
      return;
    }

    // Normalisation happens here rather than at write time so the dedupe below
    // compares the same shape the database stores — `(555) 010-1234` and
    // `+15550101234` are one customer, and an import that creates both has
    // split somebody's order history in half.
    const phone = normalizePhoneForImport(rawPhone);
    if (!phone) {
      unusable++;
      return;
    }

    const email = at("email");

    rows.push({
      phone,
      name: at("name").slice(0, 120) || null,
      email: email && EMAILISH.test(email) ? email.slice(0, 200) : null,
      notes: at("notes").slice(0, 300) || null,
    });
  });

  if (unusable > 0) {
    warnings.push(
      unusable === 1
        ? "1 row had no usable phone number and was skipped."
        : `${unusable} rows had no usable phone number and were skipped.`
    );
  }

  return { rows, warnings, unusable, columns, totalRows: dataRows.length };
}

/**
 * Phone normalisation for imports.
 *
 * Intentionally a copy of the rule in `lib/money.ts#normalizePhone` rather
 * than an import: `csv.ts` is pure and has no server-only dependencies, and
 * that is what lets it be unit tested without a database. The two are covered
 * by the same test file so they can't drift apart unnoticed.
 */
export function normalizePhoneForImport(input: string): string | null {
  // Strip a leading `+` before counting digits so `+1 555 010 1234` and
  // `1-555-010-1234` land identically. Excel also loves turning phone numbers
  // into `1.5550101234E+10`; that shape has no valid reading, so it falls
  // through to null rather than being guessed at.
  if (/e\+?\d/i.test(input)) return null;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** The header we offer as the customer import template. */
export const CUSTOMER_CSV_HEADER = ["name", "phone", "email", "notes"] as const;
