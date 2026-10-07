-- Photo and video bytes in Postgres, since 2026-10-06, by the owner's choice:
-- everything on Railway, in the one database, nothing else to set up.
--
-- A file is one row in storage_objects and its bytes are 8 MB pieces in
-- storage_chunks, so a 2 GB video never has to be one value (bytea stops at
-- 1 GB) and a range request for a video only reads the pieces it needs.
-- server/storage.js (PgStorage) is the only thing that reads or writes these.
CREATE TABLE IF NOT EXISTS storage_objects (
  key         text PRIMARY KEY,
  type        text NOT NULL DEFAULT 'application/octet-stream',
  size        bigint NOT NULL DEFAULT 0,
  chunk_size  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage_chunks (
  key   text NOT NULL REFERENCES storage_objects(key) ON DELETE CASCADE,
  n     integer NOT NULL,
  data  bytea NOT NULL,
  PRIMARY KEY (key, n)
);
-- The bytes are already compressed images and video; Postgres trying to
-- compress them again only costs CPU.
ALTER TABLE storage_chunks ALTER COLUMN data SET STORAGE EXTERNAL;
