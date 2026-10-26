-- UPKK Pro — skema D1. Selamat dijalankan berulang kali.

CREATE TABLE IF NOT EXISTS subjects (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  jawi TEXT,
  upkk_code TEXT,
  assessment TEXT,
  mcq INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  stream TEXT DEFAULT 'KAFA',          -- KAFA (kebangsaan) | SRA (Selangor)
  sk TEXT,                             -- kod standard kandungan (diisi ustaz)
  is_basic INTEGER DEFAULT 0,          -- perkara asas (Bahagian A)
  mcq INTEGER DEFAULT 1,
  verified INTEGER DEFAULT 0,          -- 1 = disahkan ustaz padan DSKP
  sort INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  stream TEXT DEFAULT 'KAFA',
  level TEXT DEFAULT 'ingat',          -- ingat | faham | aplikasi
  stem TEXT NOT NULL,
  opt_a TEXT NOT NULL, opt_b TEXT NOT NULL, opt_c TEXT NOT NULL, opt_d TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('A','B','C','D')),
  explanation TEXT,
  source_ref TEXT,
  origin TEXT DEFAULT 'agent',         -- agent | seed | manual | mcp
  status TEXT DEFAULT 'pending',       -- pending | approved | rejected
  qa_score REAL,
  qa_report TEXT,                      -- JSON laporan semua agen
  batch_id TEXT,
  reviewer TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  served INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  user_flags INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_q_status_subject ON questions(status, subject);
CREATE INDEX IF NOT EXISTS idx_q_topic ON questions(topic_id, status);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  stream TEXT DEFAULT 'KAFA',
  plan TEXT DEFAULT 'free',            -- free | pro
  parent_phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS licenses (
  code TEXT PRIMARY KEY,
  plan TEXT DEFAULT 'pro',
  note TEXT,
  used_by TEXT,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  chosen TEXT,
  is_correct INTEGER NOT NULL,
  ms INTEGER,
  mode TEXT DEFAULT 'practice',        -- practice | exam
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_att_user_subject ON attempts(user_id, subject);
CREATE INDEX IF NOT EXISTS idx_att_user_q ON attempts(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_att_user_day ON attempts(user_id, created_at);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  question_ids TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  score INTEGER,
  total INTEGER
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  subject TEXT,
  topic_id TEXT,
  requested INTEGER,
  generated INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  rejected INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running',
  log TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL,
  user_id TEXT,
  reason TEXT,
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  subject TEXT,
  topic_id TEXT,
  kind TEXT,                           -- textbook | notes | pastpaper
  title TEXT,
  r2_key TEXT,
  chunks INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
