"use strict";

/**
 * Seeds the database with the six products, the site copy and the admin user.
 *
 *   npm run seed          fills in anything missing, leaves existing rows alone
 *   npm run reset-db      wipes products/content/admin and re-seeds (keeps orders
 *                         and messages unless you pass --wipe-all)
 *
 * The product names, prices and descriptions below are copied verbatim from the
 * original hand-written menu cards in public/index.html.
 */

require("dotenv").config();

const bcrypt = require("bcryptjs");
const { db, DB_PATH } = require("./db");

const PRODUCTS = [
  {
    name: "Chocolate Cake",
    price: 450,
    description: "Three layers of dark cocoa sponge with a silky chocolate ganache.",
    emoji: "\u{1F370}"
  },
  {
    name: "Butter Croissant",
    price: 90,
    description: "Folded by hand over two days for a flaky, buttery crumb.",
    emoji: "\u{1F950}"
  },
  {
    name: "Blueberry Muffin",
    price: 120,
    description: "Soft vanilla muffin packed with juicy blueberries and a sugar crust.",
    emoji: "\u{1F9C0}"
  },
  {
    name: "Chocolate Chip Cookies",
    price: 150,
    description: "Crisp at the edges, chewy in the middle, full of chocolate chunks.",
    emoji: "\u{1F36A}"
  },
  {
    name: "Strawberry Cupcake",
    price: 100,
    description: "Light sponge topped with fresh strawberry buttercream swirls.",
    emoji: "\u{1F9C1}"
  },
  {
    name: "Sourdough Bread",
    price: 180,
    description: "Slow-fermented naturally leavened loaf with a deep, crackly crust.",
    emoji: "\u{1F35E}"
  }
];

const CONTENT = {
  site_title: "SweetCrumbs Bakery",

  hero_heading: "Freshly Baked, Made with Love",
  hero_text:
    "At SweetCrumbs Bakery, we bake small batches of bread, cakes, and pastries " +
    "every morning using simple ingredients and a lot of care.",
  hero_button: "Explore Our Bakery",

  about_heading: "About Us",
  about_text:
    "SweetCrumbs Bakery is a small neighbourhood bakery run by a family of bakers. " +
    "We started with one oven and one recipe, and we still believe the best baking " +
    "is slow, honest, and shared with friends.",

  menu_heading: "Our Freshly Baked Favourites",
  menu_text:
    "Baked fresh every morning in small batches. Here are the treats our " +
    "neighbours keep coming back for.",

  order_heading: "Order Your Favourites",
  order_text:
    "Pick a treat, tell us how many, and we’ll show you the total straight away. " +
    "We will have it boxed and waiting at the counter.",
  order_note:
    "No payment is taken online — you pay when you collect your order at the shop.",

  contact_heading: "Get in Touch",
  contact_text:
    "Planning a custom cake or a bulk order? Drop by the shop, call us, " +
    "or leave a note below.",
  contact_note:
    "We read every message at the bakery and usually reply within a day.",

  bakery_name: "SweetCrumbs Bakery",
  contact_email: "hello@sweetcrumbs.example",
  contact_phone: "+91 98765 43210",
  contact_address: "12, Bakery Street, Chennai, Tamil Nadu",
  contact_hours: "Monday to Saturday, 9:00 AM to 8:00 PM",

  footer_text: "SweetCrumbs Bakery © 2026. All rights reserved."
};

function seedProducts(force) {
  if (force) db.prepare("DELETE FROM products").run();

  const insert = db.prepare(`
    INSERT INTO products (name, price, description, emoji, sort_order, active)
    VALUES (@name, @price, @description, @emoji, @sort_order, 1)
    ON CONFLICT (name) DO NOTHING
  `);

  const run = db.transaction(function (rows) {
    rows.forEach(function (row, index) {
      insert.run(Object.assign({}, row, { sort_order: index + 1 }));
    });
  });

  run(PRODUCTS);
  return db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
}

function seedContent(force) {
  const stmt = force
    ? db.prepare("INSERT INTO content (key, value) VALUES (?, ?) " +
                 "ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    : db.prepare("INSERT INTO content (key, value) VALUES (?, ?) " +
                 "ON CONFLICT (key) DO NOTHING");

  const run = db.transaction(function (entries) {
    entries.forEach(function (pair) { stmt.run(pair[0], pair[1]); });
  });

  run(Object.entries(CONTENT));
  return db.prepare("SELECT COUNT(*) AS n FROM content").get().n;
}

function seedAdmin(force) {
  const username = (process.env.ADMIN_USERNAME || "admin").trim();
  const password = process.env.ADMIN_PASSWORD || "sweetcrumbs123";

  const existing = db.prepare("SELECT id FROM admin_users WHERE username = ?").get(username);

  if (existing && !force) return { username: username, created: false };

  const hash = bcrypt.hashSync(password, 12);

  if (existing) {
    db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(hash, existing.id);
    return { username: username, created: false, updated: true };
  }

  db.prepare("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)").run(username, hash);
  return { username: username, created: true };
}

function seed(options) {
  const force = Boolean(options && options.force);

  if (options && options.wipeAll) {
    db.prepare("DELETE FROM orders").run();
    db.prepare("DELETE FROM messages").run();
  }

  const products = seedProducts(force);
  const content = seedContent(force);
  const admin = seedAdmin(force);

  return { products: products, content: content, admin: admin };
}

module.exports = { seed, PRODUCTS, CONTENT };

if (require.main === module) {
  const force = process.argv.includes("--force");
  const wipeAll = process.argv.includes("--wipe-all");
  const result = seed({ force: force, wipeAll: wipeAll });

  console.log("Database: " + DB_PATH);
  console.log("Products: " + result.products);
  console.log("Content keys: " + result.content);
  console.log(
    "Admin user: " + result.admin.username +
    (result.admin.created ? " (created)" : result.admin.updated ? " (password reset)" : " (already existed)")
  );
  if (result.admin.created || result.admin.updated) {
    console.log("Admin password: taken from ADMIN_PASSWORD in your .env file");
  }
}
