-- Library Management App (SmartLib UI) — MySQL 8 schema, InnoDB, utf8mb4
-- Import with:  mysql -u root -p < database/mysql/schema.sql

CREATE DATABASE IF NOT EXISTS library_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE library_app;
SET NAMES utf8mb4;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS notification_reads, notifications, fine_payments, fines, reservations, loans,
  books, shelves, categories, authors, members, users, settings;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  user_id        INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  email          VARCHAR(190) NOT NULL UNIQUE,
  password_hash  VARCHAR(100) NOT NULL,
  role           ENUM('admin','librarian','staff','student') NOT NULL DEFAULT 'student',
  avatar         MEDIUMTEXT,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  search_history JSON,
  last_login     DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE members (
  member_id          INT AUTO_INCREMENT PRIMARY KEY,
  member_code        VARCHAR(20) UNIQUE,
  user_id            INT NULL UNIQUE,
  name               VARCHAR(120) NOT NULL,
  email              VARCHAR(190) NOT NULL UNIQUE,
  phone              VARCHAR(30),
  neptun_code        CHAR(6) NULL UNIQUE,
  profile_photo      MEDIUMTEXT,
  department         VARCHAR(120) NOT NULL DEFAULT '',
  course             VARCHAR(120) NOT NULL DEFAULT '',
  year               VARCHAR(40) NOT NULL DEFAULT '',
  membership_type    VARCHAR(20) NOT NULL DEFAULT 'Student',
  membership_start   DATETIME NOT NULL,
  membership_expiry  DATETIME NOT NULL,
  status             ENUM('Active','Expired','Suspended') NOT NULL DEFAULT 'Active',
  expiry_notified    TINYINT(1) NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_members_dates CHECK (membership_expiry > membership_start)
) ENGINE=InnoDB;

CREATE TABLE authors (
  author_id     INT AUTO_INCREMENT PRIMARY KEY,
  author_code   VARCHAR(20) UNIQUE,
  name          VARCHAR(150) NOT NULL UNIQUE,
  biography     TEXT,
  country       VARCHAR(80) NOT NULL DEFAULT '',
  profile_image MEDIUMTEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE categories (
  category_id    INT AUTO_INCREMENT PRIMARY KEY,
  category_code  VARCHAR(20) UNIQUE,
  name           VARCHAR(80) NOT NULL UNIQUE,
  description    VARCHAR(255) NOT NULL DEFAULT '',
  icon           VARCHAR(16) NOT NULL DEFAULT '📚',
  subcategories  JSON,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE shelves (
  shelf_id       INT AUTO_INCREMENT PRIMARY KEY,
  code           VARCHAR(3) NOT NULL UNIQUE,
  name           VARCHAR(60) NOT NULL,
  floor          TINYINT NOT NULL,
  section        VARCHAR(60) NOT NULL,
  racks          TINYINT NOT NULL DEFAULT 4,
  rows_per_rack  TINYINT NOT NULL DEFAULT 4,
  category_id    INT NULL,
  capacity       INT NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'Active',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shelves_category FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE SET NULL,
  CONSTRAINT chk_shelves_capacity CHECK (capacity > 0 AND racks > 0 AND rows_per_rack BETWEEN 1 AND 26)
) ENGINE=InnoDB;

CREATE TABLE books (
  book_id           INT AUTO_INCREMENT PRIMARY KEY,
  book_code         VARCHAR(20) UNIQUE,
  title             VARCHAR(255) NOT NULL,
  isbn              VARCHAR(13) NOT NULL UNIQUE,
  author_id         INT NOT NULL,
  category_id       INT NOT NULL,
  publisher         VARCHAR(150) NOT NULL DEFAULT '',
  publication_date  DATE NULL,
  edition           VARCHAR(60) NOT NULL DEFAULT '1st',
  language          VARCHAR(40) NOT NULL DEFAULT 'English',
  subcategory       VARCHAR(80) NOT NULL DEFAULT '',
  description       TEXT,
  cover_image       MEDIUMTEXT,
  pages             INT NOT NULL DEFAULT 0,
  price             DECIMAL(10,2) NOT NULL DEFAULT 0,
  purchase_price    DECIMAL(10,2) NOT NULL DEFAULT 0,
  current_value     DECIMAL(10,2) NOT NULL DEFAULT 0,
  quantity          INT NOT NULL DEFAULT 1,
  available_copies  INT NOT NULL DEFAULT 0,
  issued_copies     INT NOT NULL DEFAULT 0,
  reserved_copies   INT NOT NULL DEFAULT 0,
  lost_copies       INT NOT NULL DEFAULT 0,
  damaged_copies    INT NOT NULL DEFAULT 0,
  status            VARCHAR(20) NOT NULL DEFAULT 'Available',
  times_borrowed    INT NOT NULL DEFAULT 0,
  shelf_id          INT NULL,
  rack              CHAR(2),
  shelf_row         CHAR(1),
  position          CHAR(3),
  added_by          INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_books_author FOREIGN KEY (author_id) REFERENCES authors(author_id),
  CONSTRAINT fk_books_category FOREIGN KEY (category_id) REFERENCES categories(category_id),
  CONSTRAINT fk_books_shelf FOREIGN KEY (shelf_id) REFERENCES shelves(shelf_id) ON DELETE SET NULL,
  CONSTRAINT fk_books_added_by FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_books_copies CHECK (
    quantity >= 1 AND available_copies >= 0 AND available_copies <= quantity
    AND issued_copies >= 0 AND reserved_copies >= 0 AND lost_copies >= 0 AND damaged_copies >= 0),
  CONSTRAINT chk_books_price CHECK (price >= 0 AND purchase_price >= 0 AND current_value >= 0)
) ENGINE=InnoDB;
CREATE INDEX idx_books_title ON books(title);
CREATE INDEX idx_books_created ON books(created_at);

CREATE TABLE loans (
  loan_id            INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id     VARCHAR(20) UNIQUE,
  member_id          INT NOT NULL,
  book_id            INT NOT NULL,
  issued_by          INT NULL,
  issue_date         DATETIME NOT NULL,
  due_date           DATETIME NOT NULL,
  renewal_count      INT NOT NULL DEFAULT 0,
  status             ENUM('Issued','Overdue','Returned','Damaged','Lost') NOT NULL DEFAULT 'Issued',
  fine_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_soon_notified  TINYINT(1) NOT NULL DEFAULT 0,
  overdue_notified   TINYINT(1) NOT NULL DEFAULT 0,
  return_code        VARCHAR(20) UNIQUE,
  return_date        DATETIME NULL,
  return_condition   ENUM('Good','Damaged','Lost') NULL,
  days_overdue       INT NOT NULL DEFAULT 0,
  late_fine          DECIMAL(10,2) NOT NULL DEFAULT 0,
  damage_charge      DECIMAL(10,2) NOT NULL DEFAULT 0,
  lost_charge        DECIMAL(10,2) NOT NULL DEFAULT 0,
  remarks            VARCHAR(255) NOT NULL DEFAULT '',
  processed_by       INT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_loans_member FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE RESTRICT,
  CONSTRAINT fk_loans_book FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE RESTRICT,
  CONSTRAINT fk_loans_issued_by FOREIGN KEY (issued_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_loans_processed_by FOREIGN KEY (processed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_loans_dates CHECK (due_date > issue_date AND (return_date IS NULL OR return_date >= issue_date))
) ENGINE=InnoDB;
CREATE INDEX idx_loans_status ON loans(status);
CREATE INDEX idx_loans_issue_date ON loans(issue_date);

CREATE TABLE reservations (
  reservation_id    INT AUTO_INCREMENT PRIMARY KEY,
  reservation_code  VARCHAR(20) UNIQUE,
  member_id         INT NOT NULL,
  book_id           INT NOT NULL,
  reservation_date  DATETIME NOT NULL,
  queue_position    INT NOT NULL DEFAULT 0,
  expiry_date       DATETIME NULL,
  available_since   DATETIME NULL,
  status            ENUM('Waiting','Available','Collected','Cancelled','Expired') NOT NULL DEFAULT 'Waiting',
  created_by        INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- At most one active (Waiting/Available) reservation per member and book. NULLs never clash in a UNIQUE index.
  active_reservation_status VARCHAR(10)
    GENERATED ALWAYS AS (IF(status IN ('Waiting','Available'), 'active', NULL)) VIRTUAL,
  CONSTRAINT uq_active_book_member_reservation UNIQUE (book_id, member_id, active_reservation_status),
  CONSTRAINT fk_res_member FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE,
  CONSTRAINT fk_res_book FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE,
  CONSTRAINT fk_res_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE fines (
  fine_id          INT AUTO_INCREMENT PRIMARY KEY,
  fine_code        VARCHAR(20) UNIQUE,
  member_id        INT NOT NULL,
  loan_id          INT NULL,
  book_id          INT NULL,
  transaction_ref  VARCHAR(20) NULL,
  type             VARCHAR(30) NOT NULL,
  description      VARCHAR(255) NOT NULL DEFAULT '',
  days_overdue     INT NOT NULL DEFAULT 0,
  rate_per_day     DECIMAL(10,2) NOT NULL DEFAULT 0,
  original_amount  DECIMAL(10,2) NOT NULL,
  discount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
  waived_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
  status           ENUM('Pending','Partially Paid','Paid','Waived') NOT NULL DEFAULT 'Pending',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fines_member FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE RESTRICT,
  CONSTRAINT fk_fines_loan FOREIGN KEY (loan_id) REFERENCES loans(loan_id) ON DELETE SET NULL,
  CONSTRAINT fk_fines_book FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE SET NULL,
  CONSTRAINT chk_fines_amounts CHECK (
    original_amount > 0 AND discount >= 0 AND paid_amount >= 0 AND waived_amount >= 0
    AND discount + paid_amount + waived_amount <= original_amount)
) ENGINE=InnoDB;

CREATE TABLE fine_payments (
  payment_id       INT AUTO_INCREMENT PRIMARY KEY,
  payment_code     VARCHAR(20) UNIQUE,
  receipt_no       VARCHAR(20) UNIQUE,
  member_id        INT NOT NULL,
  fine_id          INT NULL,
  transaction_ref  VARCHAR(20) NULL,
  reason           VARCHAR(255) NOT NULL,
  amount           DECIMAL(10,2) NOT NULL,
  payment_date     DATETIME NOT NULL,
  method           ENUM('Cash','UPI','Card','Bank Transfer') NOT NULL DEFAULT 'Cash',
  status           ENUM('Paid','Partially Paid','Pending','Waived') NOT NULL DEFAULT 'Paid',
  reference        VARCHAR(60) NOT NULL DEFAULT '',
  notes            VARCHAR(255) NOT NULL DEFAULT '',
  received_by      INT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_member FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE RESTRICT,
  CONSTRAINT fk_pay_fine FOREIGN KEY (fine_id) REFERENCES fines(fine_id) ON DELETE RESTRICT,
  CONSTRAINT fk_pay_received_by FOREIGN KEY (received_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_pay_amount CHECK (amount > 0)
) ENGINE=InnoDB;
CREATE INDEX idx_pay_date ON fine_payments(payment_date);

CREATE TABLE notifications (
  notification_id  INT AUTO_INCREMENT PRIMARY KEY,
  audience         ENUM('all','staff','member') NOT NULL DEFAULT 'staff',
  member_id        INT NULL,
  type             VARCHAR(20) NOT NULL DEFAULT 'system',
  title            VARCHAR(150) NOT NULL,
  message          VARCHAR(500) NOT NULL,
  link             VARCHAR(255) NOT NULL DEFAULT '',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_member FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX idx_notif_created ON notifications(created_at);

CREATE TABLE notification_reads (
  notification_id INT NOT NULL,
  user_id         INT NOT NULL,
  read_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, user_id),
  CONSTRAINT fk_nr_notif FOREIGN KEY (notification_id) REFERENCES notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_nr_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE settings (
  setting_key    VARCHAR(40) PRIMARY KEY,
  setting_value  VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

INSERT INTO settings (setting_key, setting_value) VALUES
  ('libraryName', 'SmartLib Central Library'),
  ('finePerDay', '500'),
  ('loanDays', '14'),
  ('maxRenewals', '2'),
  ('maxBooksPerMember', '5'),
  ('maxPendingFine', '500'),
  ('reservationHoldDays', '3'),
  ('reservationValidityDays', '30'),
  ('lostProcessingFee', '500'),
  ('damageChargePercent', '30'),
  ('membershipFee', '2000'),
  ('dueSoonDays', '2'),
  ('backupPath', './backups');
