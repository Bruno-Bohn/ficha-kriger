import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('ERRO: variavel de ambiente DATABASE_URL nao definida (string de conexao do Neon).');
  process.exit(1);
}

// Neon exige SSL; localmente (postgres proprio) desliga se for localhost.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheets (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL DEFAULT 'Sem nome',
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
