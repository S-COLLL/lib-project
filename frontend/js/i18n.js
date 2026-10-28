// Hungarian UI translation. English (the SmartLib original) is the default; with Hungarian selected
// every UI string is swapped at render time (text nodes and placeholder/title/aria-label attributes).
// Library data — titles, names, notes — is never in the dictionary, so it stays as entered.

const KEY = 'smartlib-lang';
export const LANGS = { en: 'English', hu: 'Magyar' };

export function getLang() {
  try {
    return localStorage.getItem(KEY) === 'hu' ? 'hu' : 'en';
  } catch {
    return 'en';
  }
}
export function setLang(lang) {
  try {
    localStorage.setItem(KEY, lang === 'hu' ? 'hu' : 'en');
  } catch {
    /* ignore */
  }
  location.reload();
}
export const LANG = getLang();
/** Locale for dates and numbers: en-IN keeps the SmartLib look ("28 Oct 2026"); hu-HU for Hungarian. */
export const LOCALE = LANG === 'hu' ? 'hu-HU' : 'en-IN';

const HU = {
  // Shell & navigation
  Overview: 'Áttekintés', Dashboard: 'Irányítópult', Catalogue: 'Katalógus', Books: 'Könyvek', Authors: 'Szerzők', Categories: 'Kategóriák',
  Shelves: 'Polcok', Circulation: 'Kölcsönzés', Members: 'Tagok', 'Issue Books': 'Könyv Kiadása', 'Return Books': 'Könyv Visszavétel',
  'My Loans': 'Kölcsönzéseim', Reservations: 'Foglalások', Finance: 'Pénzügyek', Fines: 'Késedelmi díjak', Payments: 'Befizetések',
  Reports: 'Jelentések', 'Smart Tools': 'Okos eszközök', 'AI Assistant': 'MI asszisztens', Notifications: 'Értesítések', Settings: 'Beállítások',
  'Collapse sidebar': 'Oldalsáv összecsukása', 'AI Library System': 'MI könyvtári rendszer', 'Main navigation': 'Fő navigáció',
  'Search books, authors, ISBN, members…': 'Könyvek, szerzők, ISBN, tagok keresése…', 'Global search': 'Globális keresés',
  'Scan QR / barcode': 'QR / vonalkód beolvasása', 'Scan QR code': 'QR-kód beolvasása', 'Toggle dark mode': 'Sötét mód váltása', 'Toggle theme': 'Téma váltása',
  'Profile menu': 'Profil menü', 'Open menu': 'Menü megnyitása', 'Mark all read': 'Mind olvasott', 'Mark all as read': 'Összes olvasottnak jelölése',
  'View all notifications': 'Összes értesítés', 'My membership': 'Tagságom', 'Sign out': 'Kijelentkezés', 'Member ID:': 'Tag ID:', Demo: 'Demó',
  'Reset demo data': 'Demóadatok visszaállítása', 'You have a new notification': 'Új értesítésed érkezett', 'All caught up': 'Nincs új értesítés',
  'No notifications yet': 'Még nincs értesítés', 'You are all caught up': 'Minden értesítést elolvastál',
  admin: 'admin', librarian: 'könyvtáros', staff: 'munkatárs', student: 'hallgató',

  // Login
  'Welcome back': 'Belépés', 'Sign in to continue to your dashboard.': 'Jelentkezz be a folytatáshoz.', 'Sign in': 'Bejelentkezés',
  'Create account': 'Regisztráció', 'Create your account': 'Fiók létrehozása', 'Students get a library membership instantly.': 'A hallgatók azonnal könyvtári tagságot kapnak.',
  'Email or user ID': 'Felhasználó ID vagy email', Password: 'Jelszó', 'Demo accounts': 'Demó fiókok', 'Full name': 'Teljes név',
  'Confirm password': 'Jelszó megerősítése', 'Exact shelf locations': 'Pontos polchelyek', 'AI library assistant': 'MI könyvtári asszisztens',
  'QR & barcode lookup': 'QR- és vonalkódos keresés', 'Fines & payments in ₹': 'Díjak és befizetések rúpiában',
  'The intelligent way to run your': 'A könyvtárad működtetésének', 'Your session has expired. Please sign in again.': 'A munkamenet lejárt, jelentkezz be újra.',
  'You have been signed out.': 'Sikeresen kijelentkeztél.', 'Passwords do not match': 'A jelszavak nem egyeznek',
  'Invalid email or password': 'Hibás felhasználó ID / email vagy jelszó',

  // Dashboard
  "Here's what's happening in your library today.": 'Íme, mi történik ma a könyvtárban.', 'Browse books': 'Könyvek böngészése', 'Ask AI': 'Kérdezd az MI-t',
  'My loans': 'Kölcsönzéseim', 'Total Books': 'Összes könyv', 'Available Books': 'Elérhető könyvek', 'Issued Books': 'Kikölcsönzött könyvek',
  'Reserved Books': 'Lefoglalt könyvek', 'Overdue Books': 'Lejárt könyvek', 'Total Members': 'Összes tag', 'Active Members': 'Aktív tagok',
  'Total Fines': 'Összes díj', 'Money Collected': 'Befolyt összeg', 'Books Added Recently': 'Nemrég hozzáadott könyvek',
  'Currently with members': 'Jelenleg tagoknál', 'Registered library members': 'Regisztrált tagok', 'Fines & membership fees': 'Díjak és tagdíjak',
  'In the last 30 days': 'Az elmúlt 30 napban', 'My current loans': 'Jelenlegi kölcsönzéseim', 'View all': 'Összes', 'No books issued': 'Nincs kikölcsönzött könyv',
  'Browse the catalogue to find your next read.': 'Böngészd a katalógust a következő olvasmányodért.', 'Books issued': 'Kiadott könyvek',
  'Issued vs returned · last 6 months': 'Kiadva és visszahozva · utolsó 6 hónap', Issued: 'Kiadva', Returned: 'Visszahozva',
  'Category distribution': 'Kategóriák megoszlása', 'Copies per category · click to browse': 'Példányok kategóriánként · kattints a böngészéshez',
  'Monthly fines': 'Havi díjak', 'Fines generated vs money collected (₹)': 'Kiszabott díjak és befizetések (₹)', 'Fines generated': 'Kiszabott díjak',
  'Money collected': 'Befizetések', 'Popular books': 'Népszerű könyvek', 'Most borrowed titles': 'Legtöbbet kölcsönzött címek',
  'Shelf occupancy': 'Polcfoglaltság', 'Capacity used on every shelf': 'Kihasznált kapacitás polconként', 'Low <50%': 'Alacsony <50%', Medium: 'Közepes',
  'High ≥80%': 'Magas ≥80%', Full: 'Tele', '🤖 Recommended for you': '🤖 Neked ajánljuk', 'Explore more': 'Továbbiak',
  'Popular and trending titles across the library': 'Népszerű és felkapott címek a könyvtárban', 'Recent transactions': 'Legutóbbi tranzakciók',
  'Latest issues and returns': 'Legutóbbi kiadások és visszavételek', 'Overdue books': 'Lejárt kölcsönzések', 'Days late · fine so far': 'Késés napokban · eddigi díj',
  'Recent members': 'Új tagok', 'Books added recently': 'Nemrég hozzáadott könyvek', 'All books': 'Összes könyv', 'No overdue books': 'Nincs lejárt kölcsönzés',
  'Line chart of books issued and returned per month': 'Vonaldiagram a havonta kiadott és visszahozott könyvekről',
  'Bar chart of book copies per category': 'Oszlopdiagram a példányokról kategóriánként', 'Bar chart of fines generated and money collected per month': 'Oszlopdiagram a havi díjakról és befizetésekről',
  'Bar chart of the most borrowed books': 'Oszlopdiagram a legtöbbet kölcsönzött könyvekről', 'Popular in the library': 'Népszerű a könyvtárban',
  'Trending pick': 'Felkapott', 'Matches your searches': 'Illik a kereséseidhez', Txn: 'Tranz.', Due: 'Határidő', Accruing: 'Növekvő',
  'You do not have permission to open that page.': 'Nincs jogosultságod az oldal megnyitásához.',

  // Books
  'Books catalogue': 'Könyvkatalógus', 'Search by name, ISBN, author, publisher, category, Book ID, shelf, rack, language…': 'Keresés név, ISBN, szerző, kiadó, kategória, könyv ID, polc, állvány, nyelv alapján…',
  Newest: 'Legújabb', Oldest: 'Legrégebbi', 'Name A–Z': 'Név A–Z', 'Name Z–A': 'Név Z–A', 'Price: Low–High': 'Ár: növekvő', 'Price: High–Low': 'Ár: csökkenő',
  'Most Borrowed': 'Legtöbbet kölcsönzött', All: 'Összes', Available: 'Elérhető', Reserved: 'Lefoglalt', Overdue: 'Lejárt', Lost: 'Elveszett', Damaged: 'Sérült',
  Unavailable: 'Nem elérhető', 'All categories': 'Minden kategória', 'All languages': 'Minden nyelv', 'All floors': 'Minden emelet', 'Status filter': 'Státusz szűrő',
  'Table view': 'Táblázat nézet', 'Grid view': 'Rács nézet', 'Book ID': 'Könyv ID', Cover: 'Borító', 'Book Name': 'Név', 'Book name': 'Könyv neve', Author: 'Író',
  Category: 'Kategória', ISBN: 'ISBN', Total: 'Összes', Price: 'Ár', Shelf: 'Polc', Status: 'Státusz', Actions: 'Műveletek', 'Select all': 'Összes kijelölése',
  'Add book': 'Könyv Hozzáadása', 'Add new book': 'Új könyv hozzáadása', 'Export CSV': 'CSV exportálás', 'No books found': 'Nincs találat', 'Adjust the filters.': 'Módosítsd a szűrőket.',
  'Books that are currently issued will be skipped.': 'A jelenleg kikölcsönzött könyvek kimaradnak.', 'Delete book?': 'Törlöd a könyvet?', 'Delete this book?': 'Törlöd ezt a könyvet?',
  'Book deleted': 'Könyv törölve', 'CSV downloaded': 'CSV letöltve', 'No books yet': 'Még nincs könyv', Move: 'Áthelyezés', Delete: 'Törlés', Edit: 'Szerkesztés', View: 'Megtekintés',
  'Book details': 'Könyv adatai', 'Book information': 'Könyv információk', 'Book location': 'Könyv helye', 'Find book on shelf': 'Könyv keresése a polcon',
  'Find on shelf': 'Megkeresés a polcon', Floor: 'Emelet', Section: 'Szekció', Rack: 'Állvány', Row: 'Sor', Position: 'Pozíció', Edition: 'Kiadás', Pages: 'Oldalszám',
  Language: 'Nyelv', Published: 'Megjelent', 'Times borrowed': 'Kölcsönzések száma', 'Purchase price': 'Beszerzési ár', 'Current value': 'Jelenlegi érték',
  'Date added': 'Hozzáadva', 'Last updated': 'Utoljára frissítve', 'Borrowing status': 'Kölcsönzési állapot', 'Copies currently with members': 'Jelenleg tagoknál lévő példányok',
  'Total copies': 'Összes példány', 'Issue book': 'Könyv kiadása', 'Reserve book': 'Könyv foglalása', 'Your loans of this book': 'A könyv kölcsönzéseid',
  'You may also like': 'Ez is tetszhet', 'QR & barcode': 'QR és vonalkód', 'Book QR & Barcode': 'Könyv QR-kód és vonalkód', Queue: 'Várólista',
  'Move book to another shelf': 'Könyv áthelyezése másik polcra', 'Save book': 'Könyv mentése', Publisher: 'Kiadó', 'Publication date': 'Megjelenés dátuma',
  Subcategory: 'Alkategória', Description: 'Leírás', 'Number of pages': 'Oldalszám', 'Quantity (total copies)': 'Mennyiség (összes példány)',
  'Lost copies': 'Elveszett példányok', 'Damaged copies': 'Sérült példányok', 'Pricing (₹)': 'Árazás (₹)', 'Defaults to price': 'Alapértelmezés: az ár',
  'Exact shelf location': 'Pontos polchely', 'Select shelf…': 'Válassz polcot…', 'Upload cover': 'Borító feltöltése',
  'No cover? One is fetched by ISBN or generated automatically.': 'Nincs borító? ISBN alapján letöltjük vagy automatikusan generáljuk.',
  'New names create an author automatically': 'Új név esetén a szerző automatikusan létrejön', 'Catalogue details, pricing, inventory and exact shelf location': 'Katalógusadatok, árazás, készlet és pontos polchely',
  Inventory: 'Készlet', 'Book not found': 'A könyv nem található', 'No book selected': 'Nincs kiválasztott könyv', Reserve: 'Foglalás',

  // Authors / categories / shelves
  'Search authors…': 'Szerzők keresése…', 'Search authors': 'Szerzők keresése', 'Add author': 'Szerző hozzáadása', 'No authors found': 'Nincs szerző',
  'Author deleted': 'Szerző törölve', 'Author saved': 'Szerző mentve', 'Authors with books cannot be deleted.': 'Könyvvel rendelkező szerző nem törölhető.',
  books: 'könyv', copies: 'példány', loans: 'kölcsönzés', 'Add category': 'Kategória hozzáadása', 'Category deleted': 'Kategória törölve', 'Category saved': 'Kategória mentve',
  'No categories': 'Nincs kategória', 'Only categories without books can be deleted.': 'Csak könyv nélküli kategória törölhető.',
  'Subjects in the collection with live availability.': 'Témakörök a gyűjteményben élő elérhetőséggel.', 'Add shelf': 'Polc hozzáadása',
  'Shelves & library map': 'Polcok és könyvtártérkép', 'All shelves across floors': 'Minden polc az összes emeleten', Floors: 'Emeletek', Capacity: 'Kapacitás',
  Occupied: 'Foglalt', Occupancy: 'Foglaltság', Racks: 'Állványok', 'Shelf management': 'Polckezelés', 'Shelf Occupancy': 'Polcfoglaltság', 'Shelf ID': 'Polc ID',
  'Show on map': 'Mutasd a térképen', 'Select a shelf': 'Válassz polcot', 'Click a shelf on the map to view its details and books.': 'Kattints egy polcra a térképen a részletekért és a könyvekért.',
  'Click any shelf to see its capacity and the books stored there.': 'Kattints bármelyik polcra a kapacitás és a tárolt könyvek megtekintéséhez.',
  'Main entrance · stairs & lift': 'Főbejárat · lépcső és lift', 'Empty shelf': 'Üres polc', 'No shelves yet': 'Még nincs polc', 'No shelves on this floor': 'Ezen az emeleten nincs polc',
  'Only empty shelves can be deleted.': 'Csak üres polc törölhető.',

  // Members
  'Search by name, member ID, email, phone, department…': 'Keresés név, tag ID, email, telefon, tanszék alapján…', 'Add member': 'Tag Hozzáadása',
  'Member ID': 'Tag ID', Name: 'Név', Email: 'Email', Phone: 'Telefon', Department: 'Tanszék', 'Department / Course': 'Tanszék / szak', Course: 'Szak', Year: 'Évfolyam',
  Membership: 'Tagság', 'Membership type': 'Tagság típusa', 'Account status': 'Fiók státusza', 'Membership start': 'Tagság kezdete', 'Membership expiry': 'Tagság lejárata',
  'Neptun code': 'Neptun kód', Active: 'Aktív', Expired: 'Lejárt', Suspended: 'Felfüggesztett', Student: 'Hallgató', Faculty: 'Oktató', Staff: 'Munkatárs', Premium: 'Prémium', Guest: 'Vendég',
  'Expiring soon': 'Hamarosan lejár', 'Highest dues': 'Legnagyobb tartozás', 'Member profile': 'Tag profilja', 'Books issued now': 'Könyvek száma',
  'Books returned': 'Visszahozott könyvek', 'Pending fine': 'Összes díj', 'Total fine paid': 'Befizetett díjak', 'Record payment': 'Befizetés rögzítése',
  'Renew membership': 'Tagság megújítása', 'Current loans': 'Jelenlegi kölcsönzések', History: 'Előzmények', 'No members found': 'Nincs tag', 'No members yet': 'Még nincs tag',
  'Memberships, loans & dues': 'Tagságok, kölcsönzések és tartozások', 'Collect membership fee now (₹500, cash)': 'Tagdíj beszedése most (₹500, készpénz)',
  'Creates a library membership (a login can be added from Settings → Users).': 'Könyvtári tagságot hoz létre (bejelentkezés a Beállítások → Felhasználók menüben adható hozzá).',
  'Enter a valid phone number': 'Adj meg érvényes telefonszámot', 'Upload photo': 'Fotó feltöltése', 'Save changes': 'Adatok mentése',
  'Members with issued books or pending fines cannot be deleted.': 'Kikölcsönzött könyvvel vagy tartozással rendelkező tag nem törölhető.',
  'No membership linked': 'Nincs kapcsolt tagság', 'Your library card, loans, fines and payments.': 'Olvasójegyed, kölcsönzéseid, díjaid és befizetéseid.',
  'View profile': 'Profil megtekintése', 'Nothing here yet': 'Még nincs adat', 'No fines': 'Nincs díj', 'This member has a clean record.': 'A tagnak nincs tartozása.',
  'No payments yet': 'Még nincs befizetés', 'No reservations': 'Nincs foglalás', Never: 'Soha', You: 'Te',

  // Issues & returns
  'Issue books': 'Könyv Kiadása', 'Lend books to members, track due dates and renewals.': 'Könyvek kölcsönzése, határidők és hosszabbítások követése.',
  'Books you have borrowed, due dates and renewals.': 'Kikölcsönzött könyveid, határidők és hosszabbítások.', 'Search transactions': 'Tranzakciók keresése',
  'Transaction ID, member, book…': 'Tranzakció ID, tag, könyv…', 'All statuses': 'Minden státusz', 'Issued from': 'Kiadva ettől', 'From date': 'Kezdő dátum', 'To date': 'Záró dátum',
  From: 'Ettől', To: 'Eddig', Transaction: 'Tranzakció', 'Transaction ID': 'Tranzakció ID', Book: 'Könyv', Member: 'Tag', 'Issued to': 'Kölcsönző', 'Issue date': 'Kölcsönzés Dátuma',
  'Due date': 'Határidő', Renewals: 'Hosszabbítások', 'Issued by': 'Kiadta', Renew: 'Hosszabbítás', 'Renew book': 'Könyv hosszabbítása', Return: 'Visszavétel',
  'Overdue loans cannot be renewed': 'Lejárt kölcsönzés nem hosszabbítható', 'Due soon': 'Hamarosan lejár', 'No transactions yet': 'Még nincs tranzakció',
  'Loan length': 'Kölcsönzés hossza', 'Back-date to record a paper loan': 'Visszadátumozás papíros kölcsönzés rögzítéséhez', 'Select the member and the book': 'Válaszd ki a tagot és a könyvet',
  'Select both a member and a book': 'Válassz tagot és könyvet is', 'Search member by name, ID, Neptun code or email…': 'Tag keresése név, ID, Neptun kód vagy email alapján…',
  'Search book by title, ID, ISBN…': 'Könyv keresése cím, ID, ISBN alapján…', 'Search member…': 'Tag keresése…', 'Search book…': 'Könyv keresése…',
  'Select a member': 'Válassz tagot', 'Return book': 'Könyv Visszavétel', 'Return books': 'Könyv Visszavétel',
  "Find the loan, check the book's condition and the fine is calculated automatically.": 'Keresd meg a kölcsönzést, ellenőrizd a könyv állapotát – a késedelmi díjat a rendszer számolja.',
  'Transaction ID, Member ID, Book ID or ISBN (e.g. TXN00010, MEM0009, BK0011)': 'Tranzakció ID, tag ID, könyv ID vagy ISBN (pl. TXN00010, MEM0009, BK0011)',
  'Search for a transaction, member, book or ISBN, then choose the loan being returned.': 'Keress tranzakciót, tagot, könyvet vagy ISBN-t, majd válaszd ki a visszahozott kölcsönzést.',
  Find: 'Keresés', 'Select a loan': 'Válassz kölcsönzést', 'No active loans found': 'Nincs aktív kölcsönzés', Condition: 'Állapot', Good: 'Jó', 'Return date': 'Visszavétel dátuma',
  'Late fine:': 'Késedelmi díj:', 'Late fine': 'Késedelmi díj', 'Damage charge': 'Sérülési díj', Replacement: 'Pótlás', 'Recent returns': 'Legutóbbi visszavételek',
  'Latest books checked back in': 'Legutóbb visszahozott könyvek', 'Return ID': 'Visszavétel ID', 'Days overdue': 'Késés (nap)', 'No returns yet': 'Még nincs visszavétel',
  'Confirm return': 'Visszavétel Véglegesítése', Remarks: 'Megjegyzés',

  // Reservations
  'Members queue for unavailable books and are notified when a copy is held for them.': 'A tagok várólistára kerülnek, és értesítést kapnak, amikor egy példányt félreteszünk nekik.',
  'New reservation': 'Új foglalás', 'Reservation ID': 'Foglalás ID', 'Reserved on': 'Foglalva', Waiting: 'Várakozik', 'Ready for pickup': 'Átvehető', Collected: 'Átvéve',
  Cancelled: 'Lemondva', 'Cancel reservation': 'Foglalás lemondása', 'Cancel reservation?': 'Lemondod a foglalást?', 'Reservation cancelled': 'Foglalás lemondva',
  'The next member in the queue will be moved up.': 'A várólista következő tagja előrébb lép.',
  'The member joins the waiting queue and is notified as soon as a copy is returned.': 'A tag várólistára kerül, és értesítést kap, amint egy példány visszaérkezik.',

  // Fines & payments
  'Fines & charges': 'Díjak és terhelések', 'Search fines': 'Díjak keresése', 'Fine ID, transaction, member…': 'Díj ID, tranzakció, tag…', 'All types': 'Minden típus',
  'Fine ID': 'Díj ID', Type: 'Típus', 'Transaction / Book': 'Tranzakció / könyv', Details: 'Részletek', Original: 'Eredeti', Discount: 'Kedvezmény', Paid: 'Fizetve',
  Remaining: 'Hátralék', Outstanding: 'Kintlévőség', Pending: 'Függőben', 'Partially paid': 'Részben fizetve', 'Partially Paid': 'Részben fizetve', Waived: 'Elengedve',
  'Total fines generated': 'Összes kiszabott díj', Collected: 'Befizetve', 'Paid by members': 'Tagok által fizetve', 'Discounts & waivers': 'Kedvezmények és elengedések',
  'Written off': 'Leírva', 'No outstanding fines': 'Nincs kintlévő díj', 'All dues are settled.': 'Minden tartozás rendezve.', Pay: 'Fizetés', Waive: 'Elengedés',
  'Waive fine': 'Díj elengedése', 'Apply discount': 'Kedvezmény', 'Add charge': 'Terhelés hozzáadása', 'Charge added': 'Terhelés rögzítve', Amount: 'Összeg', Reason: 'Indok',
  'Fine type': 'Díj típusa', 'Replacement cost, membership fee or other charges': 'Pótlási költség, tagdíj vagy egyéb terhelés', Other: 'Egyéb', Fine: 'Díj',
  'Payment history, receipts and the mock payment gateway (Cash · UPI · Card · Bank Transfer).': 'Befizetések, nyugták és szimulált fizetés (készpénz · UPI · kártya · átutalás).',
  'Search payments': 'Befizetések keresése', 'Payment ID, receipt, member, reason, reference…': 'Befizetés ID, nyugta, tag, indok, hivatkozás…', 'All methods': 'Minden mód',
  'Payment ID': 'Befizetés ID', Method: 'Mód', Receipt: 'Nyugta', Cash: 'Készpénz', Card: 'Kártya', 'Bank Transfer': 'Átutalás', UPI: 'UPI', Date: 'Dátum',
  'Payment history': 'Befizetési előzmények', 'No payments found': 'Nincs befizetés', 'Payment receipt': 'Befizetési nyugta', 'Pending confirmation': 'Megerősítésre vár',
  'Confirm payment received?': 'Megerősíted a befizetést?', 'Mark this bank transfer as received and generate a receipt.': 'Jelöld beérkezettnek az átutalást és állíts ki nyugtát.',
  'Payment successful': 'Sikeres befizetés', Print: 'Nyomtatás',

  // Reports
  'Generate live reports from the database — print, or export as CSV and PDF.': 'Élő jelentések az adatbázisból — nyomtatás vagy exportálás CSV-be és PDF-be.',
  'Books Report': 'Könyvjelentés', 'Full catalogue with stock & location': 'Teljes katalógus készlettel és hellyel', 'Issued Books Report': 'Kiadott könyvek',
  'Books currently with members': 'Jelenleg tagoknál lévő könyvek', 'Returned Books': 'Visszahozott könyvek', 'Check-ins with late days & fines': 'Visszavételek késéssel és díjjal',
  'Overdue Report': 'Lejárt kölcsönzések', 'Late loans and accruing fines': 'Késő kölcsönzések és növekvő díjak', 'Fine Report': 'Díjjelentés',
  'Charges, discounts & balances': 'Terhelések, kedvezmények és egyenlegek', 'Payment Report': 'Befizetési jelentés', 'All payments and receipts': 'Minden befizetés és nyugta',
  'Member Report': 'Tagjelentés', 'Popular Books': 'Népszerű könyvek', 'Top 25 most borrowed titles': 'A 25 legtöbbet kölcsönzött cím', 'All overdue loans': 'Minden lejárt kölcsönzés',
  'Choose a report above': 'Válassz jelentést fent', 'Reports are generated live from the MySQL database.': 'A jelentések élőben készülnek a MySQL adatbázisból.',
  'Select a report': 'Válassz jelentést', 'Select a report first': 'Előbb válassz jelentést', 'No data for this report': 'Nincs adat ehhez a jelentéshez', 'PDF downloaded': 'PDF letöltve',

  // AI assistant
  'AI Library Assistant': 'MI könyvtári asszisztens', 'Ask in plain English — I search the live catalogue, shelves and loans.': 'Kérdezz egyszerűen — élőben keresek a katalógusban, a polcokon és a kölcsönzésekben.',
  'Online · rule-based NLP': 'Online · szabályalapú NLP', 'Ask the assistant': 'Kérdezd az asszisztenst', Ask: 'Kérdezés', 'Quick:': 'Gyors:',
  'Where is The Alchemist?': 'Where is The Alchemist?', 'Which books are overdue?': 'Which books are overdue?',

  // Notifications
  Unread: 'Olvasatlan', 'Send notification': 'Értesítés küldése', 'Notification sent': 'Értesítés elküldve', Send: 'Küldés',

  // Settings
  'Appearance, your profile, library policies and user accounts.': 'Megjelenés, profil, könyvtári szabályzat és felhasználói fiókok.', Appearance: 'Megjelenés',
  'Choose light, dark or match your system. The switch animates smoothly.': 'Válassz világos, sötét vagy a rendszerhez igazodó témát.',
  '☀️ Light': '☀️ Világos', '🌙 Dark': '🌙 Sötét', '💻 System': '💻 Rendszer', Profile: 'Profil', 'Signed in as': 'Bejelentkezve mint', 'Change photo': 'Fotó módosítása',
  'Save profile': 'Profil mentése', 'Membership valid until': 'Tagság érvényes', 'Change password': 'Jelszó módosítása', 'Current password': 'Jelenlegi jelszó',
  'New password': 'Új jelszó', 'Confirm new password': 'Új jelszó megerősítése', 'Update password': 'Jelszó frissítése',
  'Passwords are hashed with bcrypt before being stored.': 'A jelszavakat bcrypt-tel hash-eljük tárolás előtt.', 'Library policy': 'Könyvtári szabályzat',
  'These values drive fine calculation, loan periods and borrowing limits.': 'Ezek az értékek határozzák meg a díjakat, a kölcsönzési időt és a korlátokat.',
  'Current rules (only administrators can change them).': 'Jelenlegi szabályok (csak adminisztrátor módosíthatja).', 'Library name': 'Könyvtár neve',
  'Late fine per day (₹)': 'Késedelmi díj összege naponta (₹)', 'Loan period (days)': 'Kölcsönzési idő (nap)', 'Max renewals': 'Hosszabbítások max. száma',
  'Max books per member': 'Max. könyv tagonként', 'Block borrowing above dues (₹)': 'Kölcsönzés tiltása tartozás felett (₹)', 'Reservation hold (days)': 'Foglalás tartása (nap)',
  'Reservation validity (days)': 'Foglalás érvényessége (nap)', 'Lost book processing fee (₹)': 'Elveszett könyv kezelési díja (₹)', 'Damage charge (% of price)': 'Sérülési díj (az ár %-a)',
  'Annual membership fee (₹)': 'Éves tagdíj (₹)', 'Due-soon reminder (days before)': 'Lejárat előtti emlékeztető (nap)', 'Data backup folder (on the server)': 'Adatok mentési helye (a szerveren)',
  'Folder on the server where “Back up now” writes a JSON dump of every table. Relative paths start at the project folder.': 'A szerver mappája, ahová a „Mentés most” JSON mentést ír minden táblából. A relatív útvonal a projektmappától indul.',
  'Save policy': 'Szabályzat mentése', 'Back up now': 'Mentés most', 'Backup created': 'Mentés elkészült', 'Library policy saved': 'Szabályzat mentve',
  'User accounts': 'Felhasználók', 'Admins, librarians, staff and student logins': 'Adminisztrátorok, könyvtárosok, munkatársak és hallgatók', 'Add user': 'Felhasználó hozzáadása',
  'Add user account': 'Felhasználói fiók hozzáadása', User: 'Felhasználó', Role: 'Szerepkör', 'Last login': 'Utolsó belépés', Disable: 'Letiltás', Enable: 'Engedélyezés',
  'Temporary password': 'Ideiglenes jelszó', 'User created': 'Felhasználó létrehozva', 'Role updated': 'Szerepkör frissítve',
  'Account updated': 'Fiók frissítve', 'Student accounts must use the email of an existing library member.': 'Hallgatói fiókhoz egy meglévő tag email címe szükséges.',
  'Profile updated': 'Profil frissítve', 'Password updated': 'Jelszó frissítve', 'No users': 'Nincs felhasználó',

  // Common
  Cancel: 'Mégse', Close: 'Bezárás', Confirm: 'Megerősítés', Dismiss: 'Bezárás', Success: 'Siker', 'Something went wrong': 'Hiba történt', Notice: 'Értesítés',
  'Heads up': 'Figyelem', Showing: 'Megjelenítve', of: '/', 'Previous page': 'Előző oldal', 'Next page': 'Következő oldal', Sort: 'Rendezés', 'Select…': 'Válassz…',
  'Search books': 'Könyvek keresése', 'Search members': 'Tagok keresése', 'Search loans': 'Kölcsönzések keresése', Retry: 'Újra', Reset: 'Visszaállítás',
  available: 'elérhető', issued: 'kiadva', 'last week': 'múlt héten', 'just now': 'épp most', 'Scan QR / Barcode': 'QR / vonalkód beolvasása',
  'Scan a book or shelf QR code, or type a Book ID, ISBN or Shelf ID.': 'Olvass be könyv- vagy polc QR-kódot, vagy írj be könyv ID-t, ISBN-t vagy polc ID-t.',
  'Starting camera…': 'Kamera indítása…', 'Camera unavailable': 'A kamera nem érhető el', Open: 'Megnyitás',
};

// Templated strings: [pattern, Hungarian replacement]
const PATTERNS = [
  [/^Good (morning|afternoon|evening), (.+)$/, (m, p, n) => `${{ morning: 'Jó reggelt', afternoon: 'Szép napot', evening: 'Jó estét' }[p]}, ${n}!`],
  [/^(\d+) titles in catalogue$/, (m, n) => `${n} cím a katalógusban`],
  [/^(\d+)% of collection on shelf$/, (m, n) => `a gyűjtemény ${n}%-a a polcon`],
  [/^(\d+) waiting in queue$/, (m, n) => `${n} várakozik`],
  [/^(.+) fines accruing$/, (m, a) => `${a} növekvő díj`],
  [/^(\d+) expired or suspended$/, (m, n) => `${n} lejárt vagy felfüggesztett`],
  [/^(.+) outstanding$/, (m, a) => `${a} kintlévőség`],
  [/^(\d+) book titles? match(es)? your filters\.$/, (m, n) => `${n} könyvcím felel meg a szűrőknek.`],
  [/^(\d+) members?$/, (m, n) => `${n} tag`],
  [/^(\d+) charges?$/, (m, n) => `${n} terhelés`],
  [/^(\d+) unpaid charges?$/, (m, n) => `${n} kifizetetlen terhelés`],
  [/^in (\d+) days?$/, (m, n) => `${n} nap múlva`],
  [/^\((\d+) days? left\)$/, (m, n) => `(még ${n} nap)`],
  [/^\(expired (\d+) days? ago\)$/, (m, n) => `(${n} napja lejárt)`],
  [/^(\d+) days? overdue$/, (m, n) => `${n} napja lejárt`],
  [/^(\d+) days? late$/, (m, n) => `${n} nap késés`],
  [/^due today$/, () => 'ma jár le'],
  [/^due in (\d+) days?$/, (m, n) => `${n} nap múlva jár le`],
  [/^Edit (.+)$/, (m, x) => `${x} szerkesztése`],
  [/^Delete (.+)$/, (m, x) => `${x} törlése`],
  [/^View (.+)$/, (m, x) => `${x} megtekintése`],
  [/^Issue book to (.+)$/, (m, x) => `Könyv kiadása: ${x}`],
  [/^Issue (.+)$/, (m, x) => `${x} kiadása`],
  [/^Reserve (.+)$/, (m, x) => `${x} foglalása`],
  [/^Select (.+)$/, (m, x) => `${x} kijelölése`],
  [/^Role for (.+)$/, (m, x) => `${x} szerepköre`],
  [/^Payment history for (.+)$/, (m, x) => `${x} befizetései`],
  [/^Show Shelf (\w+) on map$/, (m, x) => `${x} polc a térképen`],
  [/^Shelf (\w+), (\d+)% full$/, (m, x, p) => `${x} polc, ${p}%-ban tele`],
  [/^Shelf (\w+) — Floor (\d+), (.+) \((\d+) free\)$/, (m, x, f, s, n) => `${x} polc — ${f}. emelet, ${s} (${n} szabad)`],
  [/^Browse (.+) books →$/, (m, x) => `${x} könyvek böngészése →`],
  [/^(.+) · Floor (\d+)$/, (m, x, f) => `${x} · ${f}. emelet`],
  [/^Floor (\d+)$/, (m, f) => `${f}. emelet`],
  [/^Standard loan: (\d+) days · Late fine (.+)\/day$/, (m, d, f) => `Alap kölcsönzési idő: ${d} nap · Késedelmi díj ${f}/nap`],
  [/^(\d+) days$/, (m, n) => `${n} nap`],
  [/^Based on (\d+) borrowed books?, plus what's popular$/, (m, n) => `${n} kölcsönzött könyv és a népszerű címek alapján`],
  [/^Because you read (.+)$/, (m, x) => `Mert ${x} könyveket olvasol`],
  [/^More by (.+)$/, (m, x) => `Még több tőle: ${x}`],
  [/^· last login (.+)$/, (m, x) => `· utolsó belépés ${x}`],
  [/^of (\d+) copies on the shelf — ready to borrow\.$/, (m, n) => `/ ${n} példány a polcon — kölcsönözhető.`],
  [/^— e\.g\. returned (\d+) days late = (.+) × (\d+) =$/, (m, d, f, n) => `— pl. ${d} nap késés = ${f} × ${n} =`],
  [/^Welcome, (.+)!$/, (m, x) => `Üdv, ${x}!`],
  [/^Signed in$/, () => 'Bejelentkezve'],
  [/^Membership (.+) →$/, (m, x) => `Tagság ${x} →`],
];

function translate(text) {
  if (Object.prototype.hasOwnProperty.call(HU, text)) return HU[text];
  for (const [rx, fn] of PATTERNS) {
    const m = text.match(rx);
    if (m) return fn(...m);
  }
  return null;
}

const done = new WeakSet();
function translateTextNode(node) {
  if (done.has(node)) return;
  const raw = node.nodeValue;
  const key = raw.replace(/\s+/g, ' ').trim();
  if (!key || key.length < 2 || !/[A-Za-z]/.test(key)) return;
  const hu = translate(key);
  if (hu !== null && hu !== key) {
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    node.nodeValue = lead + hu + trail;
  }
  done.add(node);
}
const ATTRS = ['placeholder', 'title', 'aria-label'];
function translateAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v) continue;
    const hu = translate(v.trim());
    if (hu !== null && hu !== v) el.setAttribute(a, hu);
  }
}
function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
  if (root.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(root.tagName)) return;
  translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (!['SCRIPT', 'STYLE', 'TEXTAREA'].includes(n.parentElement?.tagName)) translateTextNode(n);
    } else translateAttrs(n);
  }
}

if (LANG === 'hu' && typeof document !== 'undefined') {
  document.documentElement.lang = 'hu';
  const start = () => {
    translateTree(document.body);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach(translateTree);
        else if (r.type === 'characterData') {
          done.delete(r.target);
          translateTextNode(r.target);
        } else if (r.type === 'attributes') translateAttrs(r.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}
