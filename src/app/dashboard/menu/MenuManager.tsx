"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  createCategoryAction,
  deleteCategoryAction,
  deleteMenuItemAction,
  importMenuCsvAction,
  reorderMenuItemAction,
  toggleItemAvailabilityAction,
  upsertMenuItemAction,
} from "../actions";
import { Badge, Button, Card, Empty, Field, Input, Select, Textarea, cx } from "@/components/hearth/ui";
import ImageUpload from "@/components/hearth/ImageUpload";
import CsvImport from "@/components/hearth/CsvImport";
import MenuLinkImport from "@/components/hearth/MenuLinkImport";
import {
  previewMenuFromUrlAction,
  previewMenuFromPasteAction,
  commitScrapedMenuAction,
} from "./link-import-actions";
import ModifierEditor, { type GroupRow } from "./ModifierEditor";
import LinkEditor, { type LinkRow } from "./LinkEditor";

export type ItemRow = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  salePrice: string | null;
  imageUrl: string | null;
  color: string | null;
  categoryId: string | null;
  available: boolean;
  featured: boolean;
  sort: number;
  groups: GroupRow[];
  links: LinkRow[];
};

type Category = { id: string; name: string };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Saving…" : label}</Button>;
}

/** Deterministic fallback tile color when an item has no photo. */
function tileColor(seed: string): string {
  const palette = ["#D84F3F", "#C98A2B", "#2F8F6B", "#3A6EA5", "#7A4FB5", "#B5477A"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  return palette[h % palette.length];
}

function Modal({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

function ItemEditor({
  item,
  categories,
  allItems,
  onClose,
}: {
  item: ItemRow | null;
  categories: Category[];
  allItems: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const [state, action] = useFormState(upsertMenuItemAction, undefined);

  return (
    <Modal onClose={onClose} label={item ? "Edit item" : "New item"}>
      <div className="w-full max-w-[620px] rounded-md border border-line bg-surface p-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-ink">{item ? "Edit item" : "New item"}</h3>
          <button onClick={onClose} className="text-[13px] text-dim hover:text-ink">
            Close
          </button>
        </div>

        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={item?.id ?? ""} />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <Input name="name" defaultValue={item?.name ?? ""} required />
            </Field>
            <Field label="Price">
              <Input name="price" defaultValue={item?.price ?? ""} placeholder="16.00" required />
            </Field>
            <Field label="Sale price" hint="Optional. Below price = on sale.">
              <Input name="salePrice" defaultValue={item?.salePrice ?? ""} placeholder="12.00" />
            </Field>
          </div>

          <Field label="Description">
            <Textarea name="description" defaultValue={item?.description ?? ""} placeholder="San marzano, fresh mozzarella, basil" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select name="categoryId" defaultValue={item?.categoryId ?? ""}>
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort order" hint="Lower shows first. Or use the arrows on each card.">
              <Input name="sort" type="number" defaultValue={item?.sort ?? 0} />
            </Field>
            <Field label="Fallback tile color" hint="Shown only when there's no photo.">
              <Input name="color" defaultValue={item?.color ?? ""} placeholder="#D84F3F" />
            </Field>
          </div>

          <ImageUpload
            name="imageUrl"
            kind="ITEM"
            label="Photo"
            hint="Square. Shows on the menu grid and the item screen."
            value={item?.imageUrl ?? ""}
          />

          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-[13px] text-dim">
              <input type="checkbox" name="available" defaultChecked={item?.available ?? true}  />
              Available
            </label>
            <label className="flex items-center gap-2 text-[13px] text-dim">
              <input type="checkbox" name="featured" defaultChecked={item?.featured ?? false}  />
              Featured
            </label>
          </div>

          {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}
          {state?.ok && <p className="text-[12px] text-accent">{state.ok}</p>}

          <div className="flex gap-2 pt-1">
            <Submit label={item ? "Save changes" : "Add item"} />
            <Button type="button" variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        </form>

        {/* Options live outside the item form: they're their own records with
            their own actions, and nesting forms isn't valid HTML. An item has
            to exist before it can have choices attached. */}
        <div className="mt-6 border-t border-line pt-5">
          {item ? (
            <ModifierEditor menuItemId={item.id} groups={item.groups} />
          ) : (
            <p className="text-[12px] text-mute">
              Save this item first, then reopen it to add sizes and add-ons.
            </p>
          )}
        </div>

        {item && (
          <div className="mt-6 border-t border-line pt-5">
            <LinkEditor itemId={item.id} links={item.links} allItems={allItems} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Two ways in, with the link importer first because it is the one that takes
 * twenty seconds. Almost every restaurant arriving here already has its menu
 * typed into DoorDash or Toast; asking them to retype it into a spreadsheet
 * first is asking them to do the work twice.
 */
function ImportModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"link" | "csv">("link");

  return (
    <Modal onClose={onClose} label="Import menu">
      <div className="w-full max-w-[640px] rounded-md border border-line bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-ink">Import menu</h3>
          <button onClick={onClose} className="text-[13px] text-dim hover:text-ink">
            Close
          </button>
        </div>

        <div className="mb-5 flex gap-1 border-b border-line">
          {(
            [
              ["link", "From a delivery app"],
              ["csv", "From a spreadsheet"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                tab === key
                  ? "-mb-px border-b-2 border-accent px-3 py-2 text-[12px] font-medium text-ink"
                  : "-mb-px border-b-2 border-transparent px-3 py-2 text-[12px] text-dim hover:text-ink"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "link" ? (
          <MenuLinkImport
            previewUrlAction={previewMenuFromUrlAction}
            previewPasteAction={previewMenuFromPasteAction}
            commitAction={commitScrapedMenuAction}
            note="Photos are downloaded and hosted on your page automatically."
          />
        ) : (
          <>
            <p className="mb-4 text-[12px] leading-relaxed text-dim">
              Rows are added to your existing menu. New categories are created as needed, and any{" "}
              <span className="text-ink">image links are downloaded and hosted</span> on your page
              automatically.
            </p>
            <CsvImport action={importMenuCsvAction} />
          </>
        )}
      </div>
    </Modal>
  );
}

export default function MenuManager({ categories, items }: { categories: Category[]; items: ItemRow[] }) {
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const grouped = useMemo(
    () =>
      [
        ...categories.map((c) => ({ ...c, items: items.filter((i) => i.categoryId === c.id) })),
        { id: "", name: "Uncategorized", items: items.filter((i) => !i.categoryId) },
      ].filter((g) => g.items.length > 0 || g.id),
    [categories, items]
  );

  const liveCount = items.filter((i) => i.available).length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Add item
        </Button>
        <Button variant="outline" onClick={() => setImporting(true)}>
          Import CSV
        </Button>
        <a
          href="/api/menu/csv"
          className="inline-flex h-9 items-center rounded-sm border border-line2 px-4 text-[13px] font-medium text-ink hover:bg-surface2"
        >
          Export CSV
        </a>

        <div className="ml-auto flex items-center gap-4 text-[12px] text-mute">
          <span>
            <span className="font-mono text-dim">{items.length}</span> items
          </span>
          <span>
            <span className="font-mono text-accent">{liveCount}</span> live
          </span>
          <span>
            <span className="font-mono text-dim">{categories.length}</span> categories
          </span>
        </div>
      </div>

      <form action={createCategoryAction} className="mb-8 flex items-end gap-2">
        <Field label="New category">
          <Input name="name" placeholder="Specials" className="w-44" />
        </Field>
        <Button variant="outline">Add</Button>
      </form>

      {items.length === 0 && categories.length === 0 && (
        <Empty title="Your menu is empty" body="Add an item, import a CSV, or create a category to get started." />
      )}

      <div className="space-y-8">
        {grouped.map((g) => (
          <section key={g.id || "uncat"}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-[14px] font-semibold text-ink">{g.name}</h2>
              <span className="rounded-full border border-line2 px-2 py-0.5 font-mono text-[11px] text-mute">
                {g.items.length}
              </span>
              {g.id && (
                <form action={deleteCategoryAction} className="ml-auto">
                  <input type="hidden" name="id" value={g.id} />
                  <Button size="sm" variant="ghost">
                    Delete category
                  </Button>
                </form>
              )}
            </div>

            {g.items.length === 0 ? (
              <p className="rounded-md border border-dashed border-line2 px-4 py-6 text-center text-[12px] text-mute">
                No items in {g.name} yet.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {g.items.map((it, idx) => (
                  <Card key={it.id} padded={false} className={cx("overflow-hidden", !it.available && "opacity-60")}>
                    <div className="relative">
                      <div
                        className="flex h-28 w-full items-end bg-cover bg-center"
                        style={{
                          background: it.imageUrl
                            ? `url(${it.imageUrl}) center/cover`
                            : it.color || tileColor(it.name),
                        }}
                      >
                        {!it.imageUrl && (
                          <span className="m-2 rounded-sm bg-black/30 px-1.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
                            No photo
                          </span>
                        )}
                      </div>
                      {/* Reorder controls, top-right on the image. */}
                      <div className="absolute right-1.5 top-1.5 flex gap-1">
                        {idx > 0 && (
                          <form action={reorderMenuItemAction}>
                            <input type="hidden" name="id" value={it.id} />
                            <input type="hidden" name="dir" value="up" />
                            <button
                              aria-label="Move up"
                              className="grid h-6 w-6 place-items-center rounded-sm bg-black/45 text-[12px] text-white backdrop-blur-sm hover:bg-black/65"
                            >
                              ↑
                            </button>
                          </form>
                        )}
                        {idx < g.items.length - 1 && (
                          <form action={reorderMenuItemAction}>
                            <input type="hidden" name="id" value={it.id} />
                            <input type="hidden" name="dir" value="down" />
                            <button
                              aria-label="Move down"
                              className="grid h-6 w-6 place-items-center rounded-sm bg-black/45 text-[12px] text-white backdrop-blur-sm hover:bg-black/65"
                            >
                              ↓
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[13px] font-medium text-ink">{it.name}</h3>
                        <span className="flex shrink-0 items-baseline gap-1 font-mono text-[13px]">
                          {it.salePrice ? (
                            <>
                              <span className="text-accent">${it.salePrice}</span>
                              <span className="text-[11px] text-mute line-through">${it.price}</span>
                            </>
                          ) : (
                            <span className="text-dim">${it.price}</span>
                          )}
                        </span>
                      </div>
                      {it.description && (
                        <p className="mt-1 line-clamp-2 text-[12px] text-mute">{it.description}</p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {it.salePrice && <Badge tone="good">On sale</Badge>}
                        {it.featured && <Badge tone="good">Featured</Badge>}
                        {it.groups.length > 0 && (
                          <Badge tone="neutral">
                            {it.groups.reduce((a, gr) => a + gr.options.length, 0)} options
                          </Badge>
                        )}
                        <Badge tone={it.available ? "neutral" : "warn"}>
                          {it.available ? "Available" : "Out of stock"}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(it);
                            setOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <form action={toggleItemAvailabilityAction}>
                          <input type="hidden" name="id" value={it.id} />
                          <Button size="sm" variant="ghost">
                            {it.available ? "86 it" : "Restock"}
                          </Button>
                        </form>
                        <form action={deleteMenuItemAction} className="ml-auto">
                          <input type="hidden" name="id" value={it.id} />
                          <Button size="sm" variant="ghost" aria-label={`Delete ${it.name}`}>
                            ✕
                          </Button>
                        </form>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {open && (
        <ItemEditor
          item={editing}
          categories={categories}
          allItems={items.map((i) => ({ id: i.id, name: i.name }))}
          onClose={() => {
            setOpen(false);
            setEditing(null);
          }}
        />
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </>
  );
}
