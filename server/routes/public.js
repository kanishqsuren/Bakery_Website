"use strict";

/**
 * Public API consumed by the bakery website itself.
 *
 *   GET  /api/products   active products, in display order
 *   GET  /api/content    site copy as a flat key/value object
 *   POST /api/orders     place an order (stored in the database)
 *   POST /api/messages   send a contact message (stored in the database)
 */

const express = require("express");
const { db } = require("../db");
const { cleanString, parseWholeNumber, isEmail, validator } = require("../validate");

const router = express.Router();

const MAX_QUANTITY = 999;

function activeProducts() {
  return db
    .prepare(
      "SELECT id, name, price, description, emoji " +
      "FROM products WHERE active = 1 ORDER BY sort_order, id"
    )
    .all();
}

router.get("/products", function (req, res) {
  res.json({ ok: true, products: activeProducts() });
});

router.get("/content", function (req, res) {
  const rows = db.prepare("SELECT key, value FROM content").all();
  const content = {};
  rows.forEach(function (row) { content[row.key] = row.value; });
  res.json({ ok: true, content: content });
});

/**
 * Place an order.
 *
 * The price and the total are always recalculated from the database row, so a
 * tampered-with request body cannot buy a cake for one rupee.
 */
router.post("/orders", function (req, res) {
  const body = req.body || {};
  const v = validator();

  const customerName = cleanString(body.customerName, 80);
  if (customerName === "") v.fail("customerName", "Please enter your name.");

  const quantity = parseWholeNumber(body.quantity, 1, MAX_QUANTITY);
  if (quantity === null) {
    v.fail("quantity", "Quantity must be a whole number between 1 and " + MAX_QUANTITY + ".");
  }

  const productId = parseWholeNumber(body.productId, 1, Number.MAX_SAFE_INTEGER);
  let product = null;

  if (productId === null) {
    v.fail("product", "Please choose a product.");
  } else {
    product = db
      .prepare("SELECT id, name, price FROM products WHERE id = ? AND active = 1")
      .get(productId);
    if (!product) v.fail("product", "That product is no longer available.");
  }

  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });

  const total = product.price * quantity;

  const result = db
    .prepare(
      "INSERT INTO orders (customer_name, product_id, product_name, unit_price, quantity, total) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(customerName, product.id, product.name, product.price, quantity, total);

  res.status(201).json({
    ok: true,
    order: {
      id: result.lastInsertRowid,
      customerName: customerName,
      productName: product.name,
      unitPrice: product.price,
      quantity: quantity,
      total: total
    }
  });
});

router.post("/messages", function (req, res) {
  const body = req.body || {};
  const v = validator();

  const name = cleanString(body.name, 80);
  if (name === "") v.fail("name", "Please enter your name.");

  const email = cleanString(body.email, 254);
  if (email === "") {
    v.fail("email", "Please enter your email address.");
  } else if (!isEmail(email)) {
    v.fail("email", "Please enter a valid email address.");
  }

  const message = cleanString(body.message, 2000);
  if (message === "") v.fail("message", "Please write a short message.");

  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });

  const result = db
    .prepare("INSERT INTO messages (name, email, message) VALUES (?, ?, ?)")
    .run(name, email, message);

  res.status(201).json({ ok: true, message: { id: result.lastInsertRowid, name: name } });
});

module.exports = router;
