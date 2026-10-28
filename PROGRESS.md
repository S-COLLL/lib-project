# Progress

## Status — 2026-10-28

| Area | State |
|---|---|
| MySQL schema (13 tables, FKs, CHECKs, generated-column unique index) | Done — imported and exercised on MySQL 9.7 |
| Seed (SmartLib demo snapshot in ₹ + Hungarian titles) | Done |
| REST API — 15 routers, 65 endpoints in the SmartLib response format | Done — all endpoints return 200 for admin |
| Circulation rules (eligibility, back-dated issue, return preview, late/damage/lost fines, renewals, reservation hold queue) | Done — tested |
| Fines and payments (partial, discount, waive, receipts, pending confirmation) | Done — tested |
| Hourly maintenance job | Done |
| Frontend: SmartLib UI (16 pages) wired to MySQL | Done — 17 views load with no JS/API errors |
| ₹ currency, Neptun code, issue date + loan length, backup folder + "Back up now" | Done |
| Hungarian / English switch | Done (Settings → Appearance) |
| Responsive at 390 px | Done — 16 pages, no horizontal scroll |
| Automated API regression (26 checks) | 26 / 26 pass |

## Installed on this machine (2026-10-28)

- Database `library_app` created on the local `MySQL97` service (MySQL 9.7.1) with `npm run setup` and seeded with the demo library.
- The app runs with `npm start` at **http://localhost:3001**. `PORT=3001` in `.env`, because port 3000 is used by another Node server on this PC (likely the `smartlib` project).
- Verified on this install: all 5 logins (including by user ID), live dashboard data, and all 16 pages for admin and student with no JavaScript or API errors. The only failed requests are Open Library cover lookups for books without a cover there; the app shows generated covers instead.

## Decisions

- **UI source:** the SmartLib frontend from `smartlib-fresh` (the working build behind the GitHub Pages demo). The copy deployed to GitHub Pages on 2026-10-28 ships an older `api.js`, so the live demo's scripts fail to load and its login form falls back to a plain GET — that is why credentials appeared in the URL. The login forms here use `method="post"` so that cannot happen.
- **Backend:** written fresh for MySQL, reproducing the API contract of SmartLib's in-browser demo backend (`frontend/js/demo/demo-api.js`), so every page works unchanged.
- **Tables:** the 9 core tables of the brief + `authors` (Authors page), `notifications` + `notification_reads` (bell / notifications page) and `settings`. `fine_payments` also stores membership-fee payments (`fine_id` NULL).
- **Members ↔ users:** a member may exist without a login (`user_id` NULL, `ON DELETE SET NULL`), as in SmartLib.
- **Money:** Indian rupees (₹) everywhere, switched from Ft on 2026-10-28. Seed amounts are SmartLib's own ₹ values: late fine ₹10/day; lost = price + ₹50; damage = 30 % of price; membership fee ₹500; dues limit ₹500. PDF exports print "Rs." because jsPDF's built-in fonts lack the ₹ glyph.
- **Codes** (BK0001, MEM0001, TXN00001 …) equal the primary key, so seeded IDs match the SmartLib screenshots; return and receipt numbers use their own sequence.
- **Deleting** a book or member that has history is refused / turned into a suspension, so loans, fines and payments stay auditable.
- **Language:** English default (matches the screenshots); Hungarian is a runtime translation of UI strings only — titles, names and notes stay as entered.
- **Demo mode** (`?demo=1`) still runs the whole app in the browser on SmartLib's original data, for offline demos.
