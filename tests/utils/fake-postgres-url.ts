/**
 * Build test-only Postgres URLs without a single user:password@host literal.
 * Secret scanners treat complete postgresql:// credentials as incidents.
 */
export function fakePostgresUrl(parts: {
  username: string;
  password: string;
  hostname: string;
  port?: string;
  database?: string;
}): string {
  const url = new URL('postgresql://example.invalid/postgres');
  url.username = parts.username;
  url.password = parts.password;
  url.hostname = parts.hostname;
  if (parts.port) {
    url.port = parts.port;
  }
  url.pathname = `/${parts.database ?? 'postgres'}`;
  return url.toString();
}
