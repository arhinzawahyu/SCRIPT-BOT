// ponytail: neon serverless saja, upgrade ke pool saat traffic naik
import { neon } from "@neondatabase/serverless";

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diisi");
  return neon(url);
}

// Lazy default export: neon() baru dipanggil saat query pertama,
// jadi `next build` tanpa DATABASE_URL tetap lolos.
const sql: any = new Proxy(function () {}, {
  apply(_t, _this, args) {
    return (getSql() as any)(...args);
  },
});
export default sql;

let schemaReady: Promise<void> | undefined;

export function initDb() {
  if (!schemaReady) {
    schemaReady = createSchema().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

async function createSchema() {
  const s = getSql();
  await s`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await s`
    CREATE TABLE IF NOT EXISTS media_items (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('viewonce','status','delete')),
      media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video','audio','text')),
      sender TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT 'image/jpeg',
      s3_key TEXT,
      size_bytes INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await s`ALTER TABLE media_items ADD COLUMN IF NOT EXISTS s3_key TEXT`;
  await s`ALTER TABLE media_items ADD COLUMN IF NOT EXISTS size_bytes INT NOT NULL DEFAULT 0`;
  await s`CREATE INDEX IF NOT EXISTS idx_media_created ON media_items (created_at DESC)`;
  await s`
    CREATE TABLE IF NOT EXISTS login_codes (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      code_hash TEXT NOT NULL DEFAULT '',
      code_box TEXT NOT NULL DEFAULT '',
      expires_at TIMESTAMPTZ NOT NULL,
      sent BOOLEAN NOT NULL DEFAULT FALSE,
      sent_at TIMESTAMPTZ,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await s`ALTER TABLE login_codes ADD COLUMN IF NOT EXISTS code_hash TEXT NOT NULL DEFAULT ''`;
  await s`ALTER TABLE login_codes ADD COLUMN IF NOT EXISTS code_box TEXT NOT NULL DEFAULT ''`;
  await s`CREATE INDEX IF NOT EXISTS idx_login_codes_user ON login_codes (username, created_at DESC)`;
}
