import pg from 'pg';

const { Client } = pg;

/**
 * Atomically generates the next quote reference for a given requester.
 * Format: NNNN-XX where NNNN starts at 6000 per requester and XX is their initials.
 *
 * Uses a direct PostgreSQL query so increment + return is atomic.
 */
export async function generateQuoteReference(initials: string): Promise<string> {
  const key = initials.toUpperCase().slice(0, 10);
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error('Missing database connection string for quote number generation');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Atomic allocate: one SQL statement handles insert-or-increment and returns issued number.
    const result = await client.query<{ issued_number: number }>(
      `
      WITH upsert AS (
        INSERT INTO quote_sequences (requester_initials, next_number)
        VALUES ($1, 6001)
        ON CONFLICT (requester_initials)
        DO UPDATE
        SET
          next_number = quote_sequences.next_number + 1,
          updated_at = NOW()
        RETURNING next_number
      )
      SELECT
        CASE
          WHEN next_number = 6001 THEN 6000
          ELSE next_number - 1
        END AS issued_number
      FROM upsert
      `,
      [key]
    );

    const issued = result.rows[0]?.issued_number;
    if (typeof issued !== 'number') {
      throw new Error('Failed to allocate quote sequence number');
    }

    return `${issued}-${key}`;
  } finally {
    await client.end();
  }
}

/**
 * Derives initials from a full name, e.g. "George Healey" -> "GH".
 */
export function getInitialsFromName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return 'XX';
  const first = parts[0]?.[0] || '';
  const last = parts[parts.length - 1]?.[0] || '';
  return (first + last).toUpperCase();
}
