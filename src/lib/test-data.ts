/**
 * Test / demo data for local development.
 *
 * Powers the admin "Testing tools" card: one button seeds a fully-populated
 * demo restaurant, another downloads a sample menu CSV. This is a dev
 * convenience — remove the UI card (and this module) before launch.
 */

import { MENU_CSV_HEADER, toCsvRow } from "@/lib/csv";

/** A sample menu with placeholder photo URLs (rehosted on import). */
const SAMPLE_ROWS: string[][] = [
  // name, price, category, description, image_url, available, featured
  ["Margherita Pizza", "16.00", "Featured", "San Marzano tomato, fresh mozzarella, basil", "https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=800&q=80", "yes", "yes"],
  ["Smash Burger", "13.50", "Featured", "Double patty, American cheese, house sauce", "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80", "yes", "yes"],
  ["Pepperoni Pizza", "17.00", "Mains", "Cup-and-char pepperoni, mozzarella", "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&q=80", "yes", "no"],
  ["Grilled Chicken Bowl", "14.00", "Mains", "Charred chicken, rice, greens, tahini", "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=80", "yes", "no"],
  ["Steak Frites", "24.00", "Mains", "Seared sirloin, herb butter, fries", "https://images.unsplash.com/photo-1600891964092-4316c288032e?w=800&q=80", "yes", "no"],
  ["Caesar Salad", "11.50", "Sides", "Romaine, parmesan, house dressing", "https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=800&q=80", "yes", "no"],
  ["Garlic Fries", "6.00", "Sides", "Crispy fries, garlic, parsley", "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&q=80", "yes", "no"],
  ["Onion Rings", "6.50", "Sides", "Beer-battered, buttermilk ranch", "https://images.unsplash.com/photo-1639024471283-03518883512d?w=800&q=80", "yes", "no"],
  ["Iced Latte", "4.50", "Drinks", "Double shot, cold milk, ice", "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=800&q=80", "yes", "no"],
  ["Lemonade", "3.50", "Drinks", "Fresh-squeezed, lightly sweet", "https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=800&q=80", "yes", "no"],
  ["Chocolate Chip Cookie", "3.00", "Desserts", "Warm, gooey, sea salt", "https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=800&q=80", "yes", "no"],
  ["New York Cheesecake", "7.50", "Desserts", "Graham crust, berry compote", "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=800&q=80", "yes", "false"],
];

/** The sample menu as CSV text — used for seeding and the download button. */
export function sampleMenuCsv(): string {
  return [toCsvRow([...MENU_CSV_HEADER]), ...SAMPLE_ROWS.map(toCsvRow)].join("\n") + "\n";
}

/** Fields for a demo restaurant, keyed off a short random token for uniqueness. */
export function demoRestaurantFields(token: string) {
  return {
    name: `Test Kitchen ${token.toUpperCase()}`,
    slug: `test-kitchen-${token}`,
    ownerEmail: `owner+${token}@test.hearth`,
    ownerPassword: "test-pass-2026",
    accentColor: "#3b82f6",
    tagline: "A demo restaurant for testing.",
    address: "118 Elm St",
    city: "Detroit, MI 48226",
    phone: "(313) 555-0118",
    hours: "11:00 AM – 11:00 PM",
    aboutTitle: "About us",
    aboutBody:
      "This is a seeded demo restaurant. Everything here is sample data for testing the ordering flow, menu, and branding.",
    logoUrl: "/test-menu/_logo.svg",
    heroUrl: "/test-menu/_hero.svg",
  };
}

/** Short random token, e.g. "a7f3". */
export function randomToken(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * A full sample menu using OFFLINE images bundled in /public/test-menu — no
 * network needed, so seeding is instant. Ordered by category for a realistic
 * spread. `image` is a static path served directly (no rehost required).
 */
export type SeedItem = {
  category: string;
  name: string;
  price: number; // dollars
  description: string;
  image: string; // path under /public
  featured?: boolean;
};

export const SEED_MENU: SeedItem[] = [
  { category: "Starters", name: "Garlic Bread", price: 6.0, description: "Toasted sourdough, roasted garlic butter, parsley", image: "/test-menu/garlic-bread.svg" },
  { category: "Starters", name: "Mozzarella Sticks", price: 8.5, description: "Hand-breaded, marinara dip", image: "/test-menu/mozzarella-sticks.svg" },
  { category: "Starters", name: "Buffalo Wings", price: 11.0, description: "Six wings, house buffalo, blue cheese", image: "/test-menu/buffalo-wings.svg", featured: true },
  { category: "Mains", name: "Margherita Pizza", price: 16.0, description: "San Marzano, fresh mozzarella, basil", image: "/test-menu/margherita-pizza.svg", featured: true },
  { category: "Mains", name: "Smash Burger", price: 13.5, description: "Double patty, American cheese, house sauce", image: "/test-menu/smash-burger.svg", featured: true },
  { category: "Mains", name: "Grilled Salmon", price: 22.0, description: "Atlantic salmon, lemon butter, greens", image: "/test-menu/grilled-salmon.svg" },
  { category: "Mains", name: "Pasta Carbonara", price: 17.0, description: "Guanciale, pecorino, black pepper", image: "/test-menu/pasta-carbonara.svg" },
  { category: "Mains", name: "Steak Frites", price: 24.0, description: "Seared sirloin, herb butter, fries", image: "/test-menu/steak-frites.svg" },
  { category: "Sides", name: "French Fries", price: 5.0, description: "Crispy, sea salt", image: "/test-menu/french-fries.svg" },
  { category: "Sides", name: "Caesar Salad", price: 9.5, description: "Romaine, parmesan, house dressing", image: "/test-menu/caesar-salad.svg" },
  { category: "Sides", name: "Onion Rings", price: 6.5, description: "Beer-battered, buttermilk ranch", image: "/test-menu/onion-rings.svg" },
  { category: "Drinks", name: "Iced Latte", price: 4.5, description: "Double shot, cold milk, ice", image: "/test-menu/iced-latte.svg" },
  { category: "Drinks", name: "Lemonade", price: 3.5, description: "Fresh-squeezed, lightly sweet", image: "/test-menu/lemonade.svg" },
  { category: "Drinks", name: "Cola", price: 3.0, description: "Ice cold, refillable", image: "/test-menu/cola.svg" },
  { category: "Desserts", name: "New York Cheesecake", price: 7.5, description: "Graham crust, berry compote", image: "/test-menu/cheesecake.svg" },
  { category: "Desserts", name: "Chocolate Cake", price: 8.0, description: "Warm, molten center, sea salt", image: "/test-menu/chocolate-cake.svg" },
];

/** Distinct category names in menu order. */
export const SEED_CATEGORIES = Array.from(new Set(SEED_MENU.map((i) => i.category)));
