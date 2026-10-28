# Library Management App
SmartLib

A full-stack library system: catalogue with exact shelf locations, issue / return / renew, reservations with hold queue, automatic late fines (500 Ft/day), payments, reports, a rule-based AI assistant and notifications.

The interface is the SmartLib UI (dark navy / teal / gold, Inter). It is English by default, and Hungarian can be selected in **Settings → Appearance → Language / Nyelv**. Money is shown in **Ft**.

- **Frontend:** HTML5, CSS3, vanilla JavaScript ES modules, Chart.js. No framework, no build step.
- **Backend:** Node.js 18+, Express 4, MySQL 8 (InnoDB, utf8mb4) via `mysql2` with a pool of 10.
- **Security:** JWT (7 days), bcrypt (`bcryptjs`), Helmet, CORS, express-rate-limit, express-validator, `?` placeholders in every query.

## Run locally

```bash
npm install
copy .env.example .env      # then set MYSQL_PASSWORD (and JWT_SECRET)
npm run setup               # creates database library_app (13 tables) + demo library: 41 books, 18 members, 36 loans …
npm start                   # http://localhost:3000
```

`npm run setup` wipes and recreates the database, so run it only for a fresh install. To reload just the demo data, run `npm run seed:mysql`. You can also import `database/mysql/schema.sql` by hand (`mysql -u root -p < database/mysql/schema.sql`).

If port 3000 is busy, set `PORT=3100` (any free port) in `.env`.

## Put it online (Render + Aiven MySQL, free)

1. **Database:** at [aiven.io](https://aiven.io), create a free **MySQL** service. From its *Overview* page, note the Host, Port, User (`avnadmin`) and Password, and copy the **CA certificate** text.
2. **App:** at [render.com](https://render.com), sign in with GitHub, choose **New → Blueprint**, and pick this repository. Render reads `render.yaml` and asks for `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` and `MYSQL_SSL_CA` (paste the whole certificate). Click **Apply**.
3. On the first start, the app creates its tables and demo data by itself (`AUTO_SEED=true`). Your link is `https://lib-project.onrender.com`, or whatever name Render shows.

The free Render plan sleeps after 15 minutes without visitors, so the first page load after a pause takes about a minute. Files written by "Back up now" don't survive a redeploy on Render.

## Demo logins (email or numeric user ID)

| Role | Email | User ID | Password |
|---|---|---|---|
| Admin | admin@library.com | 1 | Admin@123 |
| Librarian | librarian@library.com | 2 | Librarian@123 |
| Staff | staff@library.com | 3 | Staff@123 |
| Student | student@library.com | 4 | Student@123 |

## Environment (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `JWT_SECRET` | Token signing key — the server refuses to start without it |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Database connection (`library_app`) |
| `AUTO_SEED` | `true` creates the tables (if missing) and loads the demo data on startup when the database is empty |
| `MYSQL_SSL_CA` | Cloud MySQL CA certificate: the PEM text, or a path to the `.pem` file. Turns on verified TLS |
| `TRUST_PROXY` | `1` behind a hosting proxy (Render), so rate limiting sees real client addresses |

## Project layout

```
backend/   server.js · config/db.js · routes/ (15 routers) · controllers/ · middleware/ · utils/ (lib, maintenance)
database/  mysql/schema.sql · mysql/seed.js
frontend/  16 HTML pages · css/ · js/ (app shell, api client, i18n, one module per page, demo/ in-browser backend)
docs/      PROJECT_DOCUMENTATION.md · MANUAL_TEST_SCRIPT.md
```

Full design, API and test results: [docs/PROJECT_DOCUMENTATION.md](docs/PROJECT_DOCUMENTATION.md).
