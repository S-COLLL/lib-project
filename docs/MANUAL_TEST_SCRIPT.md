# Manual test script

Run on freshly seeded data (`npm run seed:mysql`, `npm start`). UI steps use the browser; API steps use curl (`B=http://localhost:3000/api`, `$A` = admin token, `$S` = student token from `POST $B/auth/login`).

| ID | Test | Steps | Expected | Result (2026-10-28) |
|---|---|---|---|---|
| T01 | Login by email | Sign in as `admin@library.com` / `Admin@123` | Dashboard opens | Pass |
| T02 | Login by user ID | Sign in with `1` / `Admin@123` | Dashboard opens | Pass |
| T03 | Wrong password | Valid email, wrong password | 401 "Invalid email or password" | Pass |
| T03b | Empty login | `POST /auth/login {}` | 400 from express-validator | Pass |
| T04 | No token | `GET /books` without header | 401 | Pass |
| T05 | Student deletes a book | `DELETE /books/BK0001` with student token | 403, book unchanged | Pass |
| T06 | Student sees own fines only | `GET /fines` as student | Only MEM0001 rows | Pass |
| T06b | Student opens another member | `GET /members/MEM0002` as student | 403 | Pass |
| T07 | Back-dated issue | Issue Books → member MEM0016, book BK0040, Issue date = today − 18, Loan length 14 days | Loan created as **Overdue** | Pass |
| T08 | Late-fee preview | Return Books → search the transaction | Shows 4 days late, **₹40** (4 × ₹10) | Pass |
| T09 | Return 4 days late | Confirm return (Good) | Late Fine ₹40 created; copy back on shelf | Pass |
| T10 | Dues limit | Add a ₹500 manual charge to MEM0016, then issue another book to MEM0016 | Refused: ₹540 pending fines above the ₹500 limit | Pass |
| T11 | Partial payment | Pay ₹20 of the ₹40 late fine | Fine **Partially Paid**, ₹20 remaining, receipt number | Pass |
| T12 | Overpayment | Pay ₹9,999 on the same fine | 400 "exceeds the remaining balance" | Pass |
| T13 | Renew overdue loan | Renew TXN00010 | Refused | Pass |
| T14 | Reservation hold | Return a copy of BK0035 (Zero to One) | First waiting reservation becomes **Available**, 3-day hold, "Reservation ready" notification | Pass |
| T15 | Lost book | Issue BK0041 then return as Lost | Fine = price ₹749 + ₹50 = **₹799**; lost copies +1 | Pass |
| T16 | Book limit | Set max books = current + 1, issue twice | Second issue refused "(limit n)" | Pass |
| T17 | Settings validation | `PUT /settings {"finePerDay":-1}` | 400 | Pass |
| T18 | Student changes settings | `PUT /settings` as student | 403 | Pass |
| T19 | Duplicate ISBN | Add a book with ISBN 9780062315007 | 409 | Pass |
| T20 | Invalid ISBN | ISBN `12345` | 400, error shown under the field | Pass |
| T21 | Add book + new author + exact location | "A Pál utcai fiúk", Molnár Ferenc, Shelf C rack 1 row A pos 1 | Author auto-created, location `C · R01 · A01`, accents intact | Pass |
| T22 | Delete book without history | Delete the book from T21 | Deleted | Pass |
| T23 | SQL injection | Search `' OR 1=1 --` | 0 results, no error | Pass |
| T24 | Backup | Settings → Library policy → Back up now | JSON dump of 13 tables in the backup folder | Pass |
| U01 | All pages render | Open all 16 pages as admin and as student | No console or API errors | Pass |
| U02 | 390 px layout | Resize to 390 px | No horizontal scroll on any page | Pass |
| U03 | Hungarian | Settings → Appearance → Language → Magyar | UI in Hungarian, data unchanged; switch back restores English | Pass |
| U04 | Theme | Light / Dark / System tiles | Theme applied and remembered | Pass |
