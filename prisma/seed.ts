import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const photo = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=900`;

const MENU: Array<{
  name: string;
  desc: string;
  price: number;
  category: string;
  color: string;
  img: number | null;
  featured?: boolean;
}> = [
  { name: "Margherita", desc: "San marzano, fresh mozzarella, basil", price: 16, category: "Classics", color: "#D84F3F", img: 14590497, featured: true },
  { name: "Pepperoni Plus", desc: "Double pepperoni, mozzarella, oregano", price: 18, category: "Classics", color: "#B53A2C", img: 803290, featured: true },
  { name: "Diavola", desc: "Spicy soppressata, chili oil, mozzarella", price: 19, category: "Classics", color: "#C9372B", img: 10875202 },
  { name: "Funghi Tartufo", desc: "Cremini, truffle oil, parmigiano", price: 21, category: "Specials", color: "#6B4A2A", img: 774487, featured: true },
  { name: "Burrata Estate", desc: "Burrata, cherry tomato, basil oil", price: 22, category: "Specials", color: "#E3A547", img: 19681747 },
  { name: "Bianca", desc: "Ricotta, mozzarella, rosemary, garlic", price: 17, category: "Specials", color: "#D6C295", img: 708587 },
  { name: "Caesar, Rebuilt", desc: "Little gem, anchovy, crouton, lemon", price: 12, category: "Sides", color: "#7AA35C", img: 12557608 },
  { name: "Meatballs", desc: "Three, pomodoro, grana, ciabatta", price: 11, category: "Sides", color: "#A63A26", img: 7813574 },
  { name: "Italian Cola", desc: "Brio chinotto, ice, lemon", price: 4, category: "Drinks", color: "#4A3A2A", img: null },
  { name: "Limonata", desc: "Sicilian lemon, sparkling", price: 5, category: "Drinks", color: "#E0B84A", img: null },
];

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@hearth.app";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "hearth-admin-2026";
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@angelos.com";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "angelos-2026";

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      name: "EZ Orders Admin",
      role: "ADMIN",
    },
  });

  const restaurant = await prisma.restaurant.upsert({
    where: { slug: "angelos-pizza" },
    update: {},
    create: {
      slug: "angelos-pizza",
      name: "Angelo's Pizza",
      tagline: "Wood-fired, downtown, since 1998",
      heroUrl: photo(1146760),
      accentColor: "#3ddc84",
      address: "118 Elm St",
      city: "Detroit, MI 48226",
      phone: "(313) 555-0118",
      hours: "11:00 AM – 11:00 PM",
    },
  });

  await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      passwordHash: await bcrypt.hash(ownerPassword, 10),
      name: "Angelo",
      role: "OWNER",
      restaurantId: restaurant.id,
    },
  });

  const categoryNames = ["Classics", "Specials", "Sides", "Drinks"];
  const categories = new Map<string, string>();

  for (const [i, name] of categoryNames.entries()) {
    const c = await prisma.menuCategory.upsert({
      where: { restaurantId_name: { restaurantId: restaurant.id, name } },
      update: { sort: i },
      create: { restaurantId: restaurant.id, name, sort: i },
    });
    categories.set(name, c.id);
  }

  const existingItems = await prisma.menuItem.count({ where: { restaurantId: restaurant.id } });
  if (existingItems === 0) {
    for (const [i, m] of MENU.entries()) {
      const item = await prisma.menuItem.create({
        data: {
          restaurantId: restaurant.id,
          categoryId: categories.get(m.category) ?? null,
          name: m.name,
          description: m.desc,
          priceCts: Math.round(m.price * 100),
          imageUrl: m.img ? photo(m.img) : null,
          color: m.color,
          featured: Boolean(m.featured),
          sort: i,
        },
      });

      // Give the first item both shapes of modifier group, so a fresh install
      // demonstrates a required single-choice and an optional multi-choice
      // without anyone having to build one by hand first.
      if (i === 0) {
        await prisma.modifierGroup.create({
          data: {
            menuItemId: item.id,
            name: "Size",
            minSelect: 1,
            maxSelect: 1,
            sort: 0,
            options: {
              create: [
                { name: "Regular", priceDeltaCts: 0, isDefault: true, sort: 0 },
                { name: "Large", priceDeltaCts: 250, sort: 1 },
              ],
            },
          },
        });

        await prisma.modifierGroup.create({
          data: {
            menuItemId: item.id,
            name: "Add-ons",
            minSelect: 0,
            maxSelect: 3,
            sort: 1,
            options: {
              create: [
                { name: "Extra cheese", priceDeltaCts: 150, sort: 0 },
                { name: "Bacon", priceDeltaCts: 200, sort: 1 },
                { name: "Avocado", priceDeltaCts: 250, sort: 2 },
                { name: "No onions", priceDeltaCts: 0, sort: 3 },
              ],
            },
          },
        });
      }
    }
  }

  // The three done-for-you reordering templates, published and adoptable. An
  // owner who chooses "run it for me" needs these to exist; see
  // lib/reorder-templates.ts and docs/reorder-dfy.md.
  const { seedReorderTemplates } = await import("../src/lib/reorder-templates");
  const reorderSeed = await seedReorderTemplates();

  console.log("Seed complete.");
  console.log(`  Reorder templates: ${reorderSeed.seeded}`);
  console.log(`  Admin: ${adminEmail} / ${adminPassword}`);
  console.log(`  Owner: ${ownerEmail} / ${ownerPassword}`);
  console.log(`  Store: /r/${restaurant.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
