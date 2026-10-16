"use strict";

/**
 * Admin API. Everything except /login and /me sits behind requireAdmin.
 *
 *   POST   /api/admin/login            sign in
 *   POST   /api/admin/logout           sign out
 *   GET    /api/admin/me               who am I (used to gate the CMS UI)
 *   POST   /api/admin/password         change own password
 *   GET    /api/admin/stats            dashboard counters
 *
 *   GET    /api/admin/products         all products, including inactive
 *   POST   /api/admin/products         create
 *   PUT    /api/admin/products/:id     update
 *   DELETE /api/admin/products/:id     delete
 *   POST   /api/admin/products/reorder move a product up or down
 *
 *   GET    /api/admin/orders           list, newest first, optional ?status=
 *   PATCH  /api/admin/orders/:id       set status
 *   DELETE /api/admin/orders/:id       delete
 *
 *   GET    /api/admin/messages         list, newest first
 *   PATCH  /api/admin/messages/:id     mark read / unread
 *   DELETE /api/admin/messages/:id     delete
 *
 *   GET    /api/admin/content          all keys
 *   PUT    /api/admin/content          save edited keys
 */

const express = require("express");
const { db } = require("../db");
const { cleanString, parseWholeNumber, validator } = require("../validate");
const auth = require("../auth");

const router = express.Router();

const ORDER_STATUSES = ["new", "preparing", "collected", "cancelled"];
const MAX_PRICE = 1000000;

/* -------------------------------------------------------------- session --- */

router.post("/login", function (req, res) {
  if (auth.isLockedOut(req)) {
    return res.status(429).json({
      ok: false,
      error: "Too many failed sign-in attempts. Please wait 10 minutes and try again."
    });
  }

  const username = cleanString((req.body || {}).username, 80);
  const password = typeof (req.body || {}).password === "string" ? req.body.password : "";

  if (username === "" || password === "") {
    return res.status(400).json({ ok: false, error: "Enter both a username and a password." });
  }

  const admin = auth.verifyCredentials(username, password);

  if (!admin) {
    auth.recordFailure(req);
    return res.status(401).json({ ok: false, error: "Incorrect username or password." });
  }

  auth.clearFailures(req);

  // New session id on login so a pre-existing cookie cannot be reused.
  req.session.regenerate(function (err) {
    if (err) return res.status(500).json({ ok: false, error: "Could not start a session." });
    req.session.admin = { id: admin.id, username: admin.username };
    res.json({ ok: true, admin: { username: admin.username } });
  });
});

router.post("/logout", function (req, res) {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(function () {
    res.clearCookie("sweetcrumbs.sid");
    res.json({ ok: true });
  });
});

router.get("/me", function (req, res) {
  if (req.session && req.session.admin) {
    return res.json({ ok: true, admin: { username: req.session.admin.username } });
  }
  res.status(401).json({ ok: false, error: "Not signed in." });
});

// Everything below this line requires a signed-in admin.
router.use(auth.requireAdmin);

router.post("/password", function (req, res) {
  const body = req.body || {};
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!auth.verifyCredentials(req.session.admin.username, current)) {
    return res.status(401).json({ ok: false, errors: { currentPassword: "That is not your current password." } });
  }
  if (next.length < 8) {
    return res.status(400).json({ ok: false, errors: { newPassword: "Use at least 8 characters." } });
  }

  auth.changePassword(req.session.admin.id, next);
  res.json({ ok: true });
});

router.get("/stats", function (req, res) {
  const one = function (sql) { return db.prepare(sql).get().n; };
  res.json({
    ok: true,
    stats: {
      products: one("SELECT COUNT(*) AS n FROM products"),
      activeProducts: one("SELECT COUNT(*) AS n FROM products WHERE active = 1"),
      orders: one("SELECT COUNT(*) AS n FROM orders"),
      newOrders: one("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'"),
      messages: one("SELECT COUNT(*) AS n FROM messages"),
      unreadMessages: one("SELECT COUNT(*) AS n FROM messages WHERE is_read = 0"),
      revenue: db.prepare(
        "SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE status != 'cancelled'"
      ).get().n
    }
  });
});

/* ------------------------------------------------------------- products --- */

function readProduct(body) {
  const v = validator();

  const name = cleanString(body.name, 80);
  if (name === "") v.fail("name", "Give the product a name.");

  const price = parseWholeNumber(body.price, 0, MAX_PRICE);
  if (price === null) v.fail("price", "Price must be a whole number of rupees (0 or more).");

  const description = cleanString(body.description, 500);
  const emoji = cleanString(body.emoji, 8);
  const active = body.active === false || body.active === 0 || body.active === "0" ? 0 : 1;

  return { v: v, row: { name: name, price: price, description: description, emoji: emoji, active: active } };
}

router.get("/products", function (req, res) {
  res.json({
    ok: true,
    products: db.prepare(
      "SELECT id, name, price, description, emoji, sort_order, active, created_at " +
      "FROM products ORDER BY sort_order, id"
    ).all()
  });
});

router.post("/products", function (req, res) {
  const parsed = readProduct(req.body || {});
  if (!parsed.v.ok) return res.status(400).json({ ok: false, errors: parsed.v.errors });

  const nextSort =
    (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS n FROM products").get().n) + 1;

  try {
    const result = db.prepare(
      "INSERT INTO products (name, price, description, emoji, sort_order, active) " +
      "VALUES (@name, @price, @description, @emoji, @sort_order, @active)"
    ).run(Object.assign({}, parsed.row, { sort_order: nextSort }));

    res.status(201).json({
      ok: true,
      product: db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid)
    });
  } catch (err) {
    if (String(err.message).indexOf("UNIQUE") !== -1) {
      return res.status(400).json({ ok: false, errors: { name: "A product with that name already exists." } });
    }
    throw err;
  }
});

router.put("/products/:id", function (req, res) {
  const id = parseWholeNumber(req.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (id === null) return res.status(400).json({ ok: false, error: "Bad product id." });

  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ ok: false, error: "Product not found." });

  const parsed = readProduct(req.body || {});
  if (!parsed.v.ok) return res.status(400).json({ ok: false, errors: parsed.v.errors });

  try {
    db.prepare(
      "UPDATE products SET name = @name, price = @price, description = @description, " +
      "emoji = @emoji, active = @active WHERE id = @id"
    ).run(Object.assign({}, parsed.row, { id: id }));

    res.json({ ok: true, product: db.prepare("SELECT * FROM products WHERE id = ?").get(id) });
  } catch (err) {
    if (String(err.message).indexOf("UNIQUE") !== -1) {
      return res.status(400).json({ ok: false, errors: { name: "A product with that name already exists." } });
    }
    throw err;
  }
});

router.delete("/products/:id", function (req, res) {
  const id = parseWholeNumber(req.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (id === null) return res.status(400).json({ ok: false, error: "Bad product id." });

  const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ ok: false, error: "Product not found." });

  // Past orders keep their product_name and price copies, so history survives.
  res.json({ ok: true });
});

/** Swaps a product's sort_order with its neighbour. body: { id, direction } */
router.post("/products/reorder", function (req, res) {
  const body = req.body || {};
  const id = parseWholeNumber(body.id, 1, Number.MAX_SAFE_INTEGER);
  const direction = body.direction === "up" ? "up" : body.direction === "down" ? "down" : null;

  if (id === null || !direction) {
    return res.status(400).json({ ok: false, error: "Send a product id and a direction." });
  }

  const product = db.prepare("SELECT id, sort_order FROM products WHERE id = ?").get(id);
  if (!product) return res.status(404).json({ ok: false, error: "Product not found." });

  const neighbour = db.prepare(
    direction === "up"
      ? "SELECT id, sort_order FROM products WHERE sort_order < ? ORDER BY sort_order DESC, id DESC LIMIT 1"
      : "SELECT id, sort_order FROM products WHERE sort_order > ? ORDER BY sort_order ASC, id ASC LIMIT 1"
  ).get(product.sort_order);

  if (!neighbour) return res.json({ ok: true, moved: false });

  const swap = db.transaction(function () {
    const update = db.prepare("UPDATE products SET sort_order = ? WHERE id = ?");
    update.run(neighbour.sort_order, product.id);
    update.run(product.sort_order, neighbour.id);
  });
  swap();

  res.json({ ok: true, moved: true });
});

/* --------------------------------------------------------------- orders --- */

router.get("/orders", function (req, res) {
  const status = ORDER_STATUSES.indexOf(String(req.query.status)) !== -1 ? String(req.query.status) : null;

  const orders = status
    ? db.prepare("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC, id DESC").all(status)
    : db.prepare("SELECT * FROM orders ORDER BY created_at DESC, id DESC").all();

  res.json({ ok: true, orders: orders });
});

router.patch("/orders/:id", function (req, res) {
  const id = parseWholeNumber(req.params.id, 1, Number.MAX_SAFE_INTEGER);
  const status = String((req.body || {}).status || "");

  if (id === null) return res.status(400).json({ ok: false, error: "Bad order id." });
  if (ORDER_STATUSES.indexOf(status) === -1) {
    return res.status(400).json({ ok: false, error: "Status must be one of: " + ORDER_STATUSES.join(", ") + "." });
  }

  const result = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
  if (result.changes === 0) return res.status(404).json({ ok: false, error: "Order not found." });

  res.json({ ok: true, order: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) });
});

router.delete("/orders/:id", function (req, res) {
  const id = parseWholeNumber(req.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (id === null) return res.status(400).json({ ok: false, error: "Bad order id." });

  const result = db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ ok: false, error: "Order not found." });

  res.json({ ok: true });
});

/* ------------------------------------------------------------- messages --- */

router.get("/messages", function (req, res) {
  res.json({
    ok: true,
    messages: db.prepare("SELECT * FROM messages ORDER BY created_at DESC, id DESC").all()
  });
});

router.patch("/messages/:id", function (req, res) {
  const id = parseWholeNumber(req.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (id === null) return res.status(400).json({ ok: false, error: "Bad message id." });

  const isRead = (req.body || {}).isRead ? 1 : 0;
  const result = db.prepare("UPDATE messages SET is_read = ? WHERE id = ?").run(isRead, id);
  if (result.changes === 0) return res.status(404).json({ ok: false, error: "Message not found." });

  res.json({ ok: true, message: db.prepare("SELECT * FROM messages WHERE id = ?").get(id) });
});

router.delete("/messages/:id", function (req, res) {
  const id = parseWholeNumber(req.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (id === null) return res.status(400).json({ ok: false, error: "Bad message id." });

  const result = db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ ok: false, error: "Message not found." });

  res.json({ ok: true });
});

/* -------------------------------------------------------------- content --- */

router.get("/content", function (req, res) {
  const rows = db.prepare("SELECT key, value FROM content ORDER BY key").all();
  const content = {};
  rows.forEach(function (row) { content[row.key] = row.value; });
  res.json({ ok: true, content: content });
});

/** Accepts a partial map of key -> value; unknown keys are ignored. */
router.put("/content", function (req, res) {
  const updates = (req.body || {}).content;
  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ ok: false, error: "Send a content object." });
  }

  const known = new Set(db.prepare("SELECT key FROM content").all().map(function (r) { return r.key; }));
  const stmt = db.prepare("UPDATE content SET value = ? WHERE key = ?");
  let saved = 0;

  const run = db.transaction(function (entries) {
    entries.forEach(function (pair) {
      if (!known.has(pair[0]) || typeof pair[1] !== "string") return;
      stmt.run(pair[1].trim().slice(0, 4000), pair[0]);
      saved += 1;
    });
  });
  run(Object.entries(updates));

  res.json({ ok: true, saved: saved });
});

module.exports = router;
