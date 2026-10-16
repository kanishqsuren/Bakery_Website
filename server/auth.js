"use strict";

/**
 * Admin authentication: bcrypt password check, session guard, and a small
 * in-memory throttle so the login form cannot be brute-forced in a loop.
 */

const bcrypt = require("bcryptjs");
const { db } = require("./db");

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
const attempts = new Map(); // key -> { count, firstAt }

function throttleKey(req) {
  return req.ip || "unknown";
}

function isLockedOut(req) {
  const entry = attempts.get(throttleKey(req));
  if (!entry) return false;

  if (Date.now() - entry.firstAt > LOCKOUT_MS) {
    attempts.delete(throttleKey(req));
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(req) {
  const key = throttleKey(req);
  const entry = attempts.get(key);

  if (!entry || Date.now() - entry.firstAt > LOCKOUT_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearFailures(req) {
  attempts.delete(throttleKey(req));
}

/**
 * Returns the admin row when the credentials match, otherwise null.
 * Runs a dummy hash comparison for unknown usernames so that a wrong username
 * and a wrong password take about the same amount of time.
 */
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.7OTt3TzRNAb1hsRvJ8X9D5kOtLQiNfW";

function verifyCredentials(username, password) {
  const user = db
    .prepare("SELECT id, username, password_hash FROM admin_users WHERE username = ?")
    .get(username);

  if (!user) {
    bcrypt.compareSync(password, DUMMY_HASH);
    return null;
  }

  return bcrypt.compareSync(password, user.password_hash)
    ? { id: user.id, username: user.username }
    : null;
}

function changePassword(adminId, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(hash, adminId);
}

/** Route guard: every /api/admin route except login sits behind this. */
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ ok: false, error: "Please sign in to continue." });
}

module.exports = {
  verifyCredentials,
  changePassword,
  requireAdmin,
  isLockedOut,
  recordFailure,
  clearFailures,
  LOCKOUT_MS
};
