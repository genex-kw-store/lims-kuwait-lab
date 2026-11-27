// db.js - SQLite database layer (better-sqlite3, WAL mode)
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.LIMS_DB || path.join(DATA_DIR, 'lims.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','lab_manager','reception','phlebotomist','technician','accountant')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL, name_ar TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sample_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL, name_ar TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tubes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL, name_ar TEXT NOT NULL,
  color TEXT NOT NULL, cap_color TEXT NOT NULL,
  use_en TEXT, use_ar TEXT
);
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL, name_ar TEXT NOT NULL,
  dept_id INTEGER REFERENCES departments(id),
  sample_type_id INTEGER REFERENCES sample_types(id),
  tube_id INTEGER REFERENCES tubes(id),
  price REAL NOT NULL DEFAULT 0,
  tat_minutes INTEGER NOT NULL DEFAULT 240,
  fasting INTEGER NOT NULL DEFAULT 0,
  prep_note_en TEXT, prep_note_ar TEXT,
  kind TEXT NOT NULL DEFAULT 'numeric' CHECK(kind IN ('numeric','text','calculated')),
  formula TEXT,
  outsourced INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS analytes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'numeric' CHECK(kind IN ('numeric','text')),
  ref_low_male REAL, ref_high_male REAL,
  ref_low_female REAL, ref_high_female REAL,
  ref_low_child REAL, ref_high_child REAL,
  critical_low REAL, critical_high REAL,
  text_hint TEXT
);
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL, name_ar TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS package_tests (
  package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES tests(id),
  PRIMARY KEY (package_id, test_id)
);
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK(gender IN ('male','female')),
  dob TEXT,
  phone TEXT,
  civil_id TEXT,
  portal_code TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, phone TEXT, specialty TEXT,
  discount_percent REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS insurance_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL, coverage_percent REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_no TEXT UNIQUE NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER REFERENCES doctors(id),
  insurance_id INTEGER REFERENCES insurance_contracts(id),
  home_visit INTEGER NOT NULL DEFAULT 0,
  report_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
CREATE TABLE IF NOT EXISTS visit_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES tests(id),
  package_id INTEGER REFERENCES packages(id),
  price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','entered','approved')),
  entered_by INTEGER REFERENCES users(id), entered_at TEXT,
  approved_by INTEGER REFERENCES users(id), approved_at TEXT,
  deducted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vt_visit ON visit_tests(visit_id);
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  tube_id INTEGER NOT NULL REFERENCES tubes(id),
  barcode TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','collected','processing','awaiting_approval','approved')),
  collected_by INTEGER REFERENCES users(id), collected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_samples_visit ON samples(visit_id);
CREATE TABLE IF NOT EXISTS sample_tests (
  sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  visit_test_id INTEGER NOT NULL REFERENCES visit_tests(id) ON DELETE CASCADE,
  PRIMARY KEY (sample_id, visit_test_id)
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_test_id INTEGER NOT NULL REFERENCES visit_tests(id) ON DELETE CASCADE,
  analyte_id INTEGER NOT NULL REFERENCES analytes(id),
  value TEXT,
  flag TEXT CHECK(flag IN (NULL,'L','N','H','CL','CH')),
  UNIQUE(visit_test_id, analyte_id)
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  visit_id INTEGER UNIQUE NOT NULL REFERENCES visits(id),
  subtotal REAL NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  insurance_percent REAL NOT NULL DEFAULT 0,
  insurance_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_by INTEGER REFERENCES users(id), cancelled_at TEXT, cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount REAL NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('cash','knet','transfer','credit')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, name_ar TEXT,
  category TEXT, unit TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  min_quantity REAL NOT NULL DEFAULT 0,
  expiry_date TEXT,
  cost REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS test_materials (
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (test_id, item_id)
);
CREATE TABLE IF NOT EXISTS inventory_txns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  change REAL NOT NULL,
  reason TEXT, ref TEXT, user_id INTEGER,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, category TEXT,
  amount REAL NOT NULL,
  expense_date TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS home_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  address TEXT, area TEXT,
  scheduled_at TEXT NOT NULL,
  technician_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','done','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS qc_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES tests(id),
  analyte_id INTEGER REFERENCES analytes(id),
  level TEXT NOT NULL DEFAULT 'normal',
  value REAL NOT NULL,
  target REAL, sd REAL,
  entry_date TEXT NOT NULL,
  entered_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id INTEGER, username TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT, new_value TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  channel TEXT NOT NULL,
  recipient TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
);
CREATE TABLE IF NOT EXISTS device_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  filename TEXT, rows_imported INTEGER DEFAULT 0, user_id INTEGER
);
`);

module.exports = { db, DB_PATH, DATA_DIR };
