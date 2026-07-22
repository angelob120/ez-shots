import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { SectionTitle } from "@/components/hearth/ui";
import MenuManager from "./MenuManager";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const { restaurantId } = await requireOwner();

  const [categories, items] = await Promise.all([
    prisma.menuCategory.findMany({ where: { restaurantId }, orderBy: { sort: "asc" } }),
    prisma.menuItem.findMany({
      where: { restaurantId },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      include: {
        modifierGroups: {
          orderBy: { sort: "asc" },
          include: { options: { orderBy: [{ sort: "asc" }, { name: "asc" }] } },
        },
        links: { orderBy: { sort: "asc" } },
      },
    }),
  ]);

  return (
    <>
      <SectionTitle
        title="Menu"
        subtitle="What customers see on your ordering page. Toggling an item off hides it immediately."
      />
      <MenuManager
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        items={items.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          price: (i.priceCts / 100).toFixed(2),
          salePrice: i.salePriceCts != null ? (i.salePriceCts / 100).toFixed(2) : null,
          imageUrl: i.imageUrl,
          color: i.color,
          categoryId: i.categoryId,
          available: i.available,
          featured: i.featured,
          sort: i.sort,
          groups: i.modifierGroups.map((g) => ({
            id: g.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options.map((o) => ({
              id: o.id,
              name: o.name,
              priceDelta: (o.priceDeltaCts / 100).toFixed(2),
              isDefault: o.isDefault,
              available: o.available,
            })),
          })),
          links: i.links.map((l) => ({ id: l.id, linkedItemId: l.linkedItemId, kind: l.kind })),
        }))}
      />
    </>
  );
}
