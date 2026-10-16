"use strict";

/**
 * Small validation helpers shared by the public and admin routes.
 *
 * Every one of these runs on the server even when the browser has already
 * checked the same thing, because the browser's copy can be bypassed.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/** Whole number within [min, max], rejecting "3.5", "1e3", "" and NaN. */
function parseWholeNumber(value, min, max) {
  const raw = typeof value === "number" ? String(value) : cleanString(value, 20);
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}

function isEmail(value) {
  return EMAIL_RE.test(value) && value.length <= 254;
}

/**
 * Collects field errors in the same shape the front-end forms expect:
 *   { ok: false, errors: { customerName: "Please enter your name." } }
 */
function validator() {
  const errors = {};
  return {
    fail: function (field, message) {
      if (!errors[field]) errors[field] = message;
      return this;
    },
    get errors() { return errors; },
    get ok() { return Object.keys(errors).length === 0; }
  };
}

module.exports = { cleanString, parseWholeNumber, isEmail, validator };
