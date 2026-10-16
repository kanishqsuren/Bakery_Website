"use strict";

/**
 * SweetCrumbs Bakery server.
 *
 * Serves the public site from /public, the admin CMS from /admin, and a JSON
 * API under /api. Start it with `npm start`, then open http://localhost:3000.
 */

require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");

const { DB_PATH } = require("./db");
const { seed } = require("./seed");
const { requireAdmin } = require("./auth");
const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ADMIN_DIR = path.join(__dirname, "..", "admin");

/* ------------------------------------------------------------ middleware -- */

// Needed for correct req.ip behind a reverse proxy (and for secure cookies).
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(express.json({ limit: "64kb" }));

app.use(function (req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});

if (!process.env.SESSION_SECRET && IS_PROD) {
  console.error("Refusing to start: set SESSION_SECRET in .env before running in production.");
  process.exit(1);
}

app.use(session({
  name: "sweetcrumbs.sid",
  secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // 'strict' keeps the admin cookie off cross-site requests, which is what
    // stops a third-party page from driving the admin API as you.
    sameSite: "strict",
    secure: IS_PROD,
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

/* ---------------------------------------------------------------- routes -- */

app.use("/api", publicRoutes);
app.use("/api/admin", adminRoutes);

// The CMS shell itself is public (it is just a login screen until you sign in),
// but every byte of data behind it comes from the guarded /api/admin routes.
app.use("/admin", express.static(ADMIN_DIR, { extensions: ["html"] }));

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  setHeaders: function (res, filePath) {
    // The site is edited live from the CMS, so don't let the browser cache the
    // shell. Hashed assets would be the better answer on a real deployment.
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache");
  }
}));

app.get("/healthz", function (req, res) {
  res.json({ ok: true, uptime: process.uptime() });
});

/* -------------------------------------------------------------- fallback -- */

app.use("/api", function (req, res) {
  res.status(404).json({ ok: false, error: "No such endpoint." });
});

app.use(function (req, res) {
  res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"), function (err) {
    if (err) res.status(404).type("txt").send("Not found");
  });
});

// Four arguments: Express treats this as the error handler.
app.use(function (err, req, res, next) {
  console.error(err);
  if (res.headersSent) return next(err);
  const payload = { ok: false, error: "Something went wrong on our side." };
  if (!IS_PROD) payload.detail = String(err && err.message);
  res.status(500).json(payload);
});

/* ----------------------------------------------------------------- start -- */

function start() {
  const result = seed({ force: false });

  const server = app.listen(PORT, function () {
    console.log("");
    console.log("  SweetCrumbs Bakery is running");
    console.log("  ------------------------------------------");
    console.log("  Website:  http://localhost:" + PORT + "/");
    console.log("  Admin:    http://localhost:" + PORT + "/admin/");
    console.log("  Database: " + DB_PATH);
    console.log("  Products: " + result.products + "   Admin user: " + result.admin.username);
    console.log("");
  });

  ["SIGINT", "SIGTERM"].forEach(function (signal) {
    process.on(signal, function () {
      server.close(function () { process.exit(0); });
    });
  });

  return server;
}

if (require.main === module) start();

module.exports = { app, start };
