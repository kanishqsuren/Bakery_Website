# SweetCrumbs Bakery

The bakery website plus an Express + SQLite backend and an admin CMS.
No frameworks on the front end: plain HTML, CSS and vanilla JavaScript.

## Quick start

```bash
npm install     # once
npm start       # http://localhost:3000
```

| URL | What it is |
| --- | --- |
| `http://localhost:3000/` | the public bakery website |
| `http://localhost:3000/admin/` | the admin CMS |

Sign in to the CMS with the username and password from your `.env` file
(`admin` / `sweetcrumbs123` out of the box). **Change the password** from the
CMS Settings tab before putting this anywhere other than your own machine.

## Layout

```
Bakery_Website/
├─ public/              the website visitors see
│  ├─ index.html        hero, about, menu, order form, contact
│  ├─ style.css
│  ├─ script.js         live total, validation, API calls
│  └─ 404.html
├─ admin/               the CMS (login screen + six tabs)
│  ├─ index.html
│  ├─ admin.css
│  └─ admin.js
├─ server/
│  ├─ server.js         Express app, static files, sessions
│  ├─ db.js             SQLite connection + schema
│  ├─ seed.js           products, site copy and admin user
│  ├─ auth.js           bcrypt login, session guard, login throttle
│  ├─ validate.js       shared input checks
│  └─ routes/
│     ├─ public.js      /api/*
│     └─ admin.js       /api/admin/*
├─ data/bakery.db       created on first run (git-ignored)
└─ .env                 port, session secret, admin credentials
```

## What the CMS manages

- **Dashboard** — new orders, unread messages, live products, total order value.
- **Products** — add, edit, hide, reorder and delete. These rows drive both the
  Menu section and the order dropdown on the public site.
- **Orders** — every order placed on the site, filterable, with a status of
  new / preparing / collected / cancelled.
- **Messages** — everything sent through the contact form, with read/unread.
- **Content** — every heading, paragraph and contact detail on the public site.
- **Settings** — change your own password.

## API

Public (no auth):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/products` | active products in display order |
| GET | `/api/content` | site copy as key/value |
| POST | `/api/orders` | place an order |
| POST | `/api/messages` | send a contact message |

Admin (session cookie required, except `login`):

| Method | Path |
| --- | --- |
| POST | `/api/admin/login`, `/api/admin/logout`, `/api/admin/password` |
| GET | `/api/admin/me`, `/api/admin/stats` |
| GET POST PUT DELETE | `/api/admin/products`, `/api/admin/products/:id` |
| POST | `/api/admin/products/reorder` |
| GET PATCH DELETE | `/api/admin/orders`, `/api/admin/orders/:id` |
| GET PATCH DELETE | `/api/admin/messages`, `/api/admin/messages/:id` |
| GET PUT | `/api/admin/content` |

## Notes on how it behaves

- **The server owns prices.** An order request sends a product id and a
  quantity; the unit price and the total are read from the database, so a
  tampered request cannot change what something costs.
- **Orders keep their own copy** of the product name and price, so deleting a
  product later does not corrupt past orders.
- **Both forms validate twice** — in the browser for fast feedback, and again on
  the server, which is the check that counts.
- **The CMS never uses `innerHTML`** for stored data, so a customer's name or
  message cannot inject markup into the admin pages.
- **If the server is unreachable**, the website still renders (the menu markup
  ships in `index.html`), but placing an order shows an error rather than a
  fake confirmation.

## Scripts

```bash
npm start              # run the server
npm run dev            # run with --watch (restarts on file changes)
npm run seed           # fill in anything missing, leave existing rows alone
npm run reset-db       # reset products, content and the admin password
node server/seed.js --force --wipe-all   # the above, and delete orders/messages
```

## Before deploying anywhere public

1. Set a long random `SESSION_SECRET` in `.env`.
2. Change `ADMIN_PASSWORD`, or change the password from the Settings tab.
3. Run with `NODE_ENV=production` behind HTTPS — the session cookie is marked
   `secure` in production and will not be sent over plain HTTP.
4. Back up `data/bakery.db`; it holds every order and message.
