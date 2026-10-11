CREATE TABLE IF NOT EXISTS archive_trash (
 stay_id TEXT PRIMARY KEY REFERENCES stays(id),
 deleted_at TEXT NOT NULL,
 deleted_by TEXT NOT NULL
);
