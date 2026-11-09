#!/usr/bin/env tsx
/** Dedicated, operator-configured consolidation. Importing this file never connects. */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const uuid = z.string().uuid().transform((v) => v.toLowerCase());
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const MINIMUM_DRAIN_SECONDS = 960;
export const ConfigSchema = z.object({
  version: z.literal(1), runId: uuid, sourceId: uuid, targetId: uuid,
  projectRef: z.string().regex(/^[a-z0-9]{8,40}$/u),
  sourceEmail: z.string().email().toLowerCase(), targetEmail: z.string().email().toLowerCase(),
  schemaHash: digest, sourceProfileHash: digest, targetProfileHash: digest,
  employeeId: z.string().min(1).max(40),
  duplicates: z.array(z.object({ source: uuid, target: uuid }).strict()).length(7),
  targetAdjustmentId: uuid,
  expectedSourceAbsences: z.number().int().positive(),
  expectedHolidayKeys: z.number().int().nonnegative(),
  expectedPermissionOverrides: z.number().int().nonnegative(),
  holidayYears: z.array(z.object({ year: z.number().int().min(2000).max(2100),
    used: z.number().nonnegative(), carryIn: z.literal(0), balance: z.number() }).strict()).min(1),
  backupPath: z.string().min(1), receiptPath: z.string().min(1),
  backupProtectionReviewed: z.literal(true),
}).strict().superRefine((c, ctx) => {
  if (c.sourceEmail === c.targetEmail || c.sourceEmail === 'admin@mpdee.co.uk')
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Distinct non-system emails required' });
  if (c.sourceId === c.targetId || c.runId === c.sourceId || c.runId === c.targetId)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Distinct identities required' });
  if (new Set(c.duplicates.flatMap((d) => [d.source, d.target])).size !== 14)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate approval IDs overlap' });
  if (new Set(c.holidayYears.map((y) => y.year)).size !== c.holidayYears.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Years overlap' });
});
export type MergeConfig = z.infer<typeof ConfigSchema>;
export type Mode = 'inspect' | 'fence' | 'merge' | 'verify' | 'retire-auth';
type Row = Record<string, unknown>;
type StoredRow = { raw: string; data: Row; token?: string };
type Table = { schema: string; name: string; columns: string[]; types: string[]; primary_key: string[]; partition: boolean };
type FK = { schema: string; table: string; columns: string[]; parent_schema: string;
  parent_table: string; parent_columns: string[] };
type Catalog = { tables: Table[]; fks: FK[]; hash: string };
type Mutation = { table: string; before: StoredRow; after: Row | null; kind: string; afterRaw?: string };
type OperationalReference =
  | { table: string; column: string; kind: 'uuid-array'; policy: 'reject' }
  | { table: string; column: string; kind: 'json-uuid'; key: string; policy: 'move' }
  | { table: string; column: string; kind: 'conditional-uuid'; condition: string; equals: string; policy: 'move' };
// These live, source-audited non-FK references are identity links; historical JSON is not.
export const OPERATIONAL_REFERENCES: readonly OperationalReference[] = [
  {table:'public.external_documents',column:'shared_with',kind:'uuid-array',policy:'reject'},
  {table:'public.reminder_actions',column:'metadata',key:'submitted_by',kind:'json-uuid',policy:'move'},
  {table:'public.audit_log',column:'record_id',condition:'table_name',equals:'profiles',kind:'conditional-uuid',policy:'move'},
];
function operationalReferences(table: string): readonly OperationalReference[] {
  return OPERATIONAL_REFERENCES.filter((r)=>r.table===table);
}
function operationalPredicate(r: OperationalReference): string {
  const value=`t.${ident(r.column)}`;
  if(r.kind==='uuid-array') return `${value} && $1::uuid[]`;
  if(r.kind==='conditional-uuid') return `(t.${ident(r.condition)}='${r.equals}' AND ${value}=ANY($1::uuid[]))`;
  const text=`${value}->>'${r.key}'`;
  return `CASE WHEN pg_input_is_valid(${text},'uuid') THEN (${text})::uuid END=ANY($1::uuid[])`;
}
function assignmentRequired(cat: Catalog,t: Table): boolean {
  return identityColumns(cat,t).length>0 || operationalReferences(keyOf(t)).length>0 || t.schema==='storage';
}
export class MergeError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'MergeError'; }
}
function requireThat(value: unknown, code: string): asserts value {
  if (!value) throw new MergeError(code);
}
export function hash(value: unknown): string {
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : typeof value === 'string' ? value : canonical(value)).digest('hex');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function without(row: Row, columns: string[]): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !columns.includes(k)));
}
export function profileHash(row: Row): string { return hash(without(row, ['updated_at'])); }
export function configHash(config: MergeConfig): string { return hash(ConfigSchema.parse(config)); }
function ident(value: string): string {
  requireThat(/^[a-z_][a-z0-9_]*$/u.test(value), 'UNSAFE_CATALOG_IDENTIFIER');
  return `"${value}"`;
}
function qualified(key: string): string {
  const parts = key.split('.'); requireThat(parts.length === 2, 'UNSAFE_TABLE');
  return parts.map(ident).join('.');
}
const keyOf = (t: Table) => `${t.schema}.${t.name}`;
const INTERNAL = ['account_merge_runs', 'account_merge_provenance', 'account_merge_retired'];
const CONTACT_FIELDS = ['phone_number', 'emergency_contact_name', 'emergency_contact_phone',
  'emergency_contact_relationship', 'secondary_emergency_contact_name', 'secondary_emergency_contact_phone',
  'secondary_emergency_contact_relationship', 'employer_profile_notes', 'avatar_url'];

// Source-backed identity references only. A new/nonzero dependency requires code review, not config.
export const MOVE: Readonly<Record<string, readonly string[]>> = {
  absences: ['profile_id', 'created_by', 'approved_by', 'processed_by'],
  absences_archive: ['profile_id', 'created_by', 'approved_by', 'processed_by', 'archived_by'],
  absence_financial_year_archives: ['archived_by'],
  absence_financial_year_closures: ['closed_by'],
  absence_financial_year_close_snapshots: ['snapshot_taken_by', 'restored_by'],
  absence_financial_year_close_snapshot_rows: ['profile_id', 'generated_by'],
  actions: ['created_by', 'logged_by'], audit_log: ['user_id'], error_logs: ['user_id'],
  inventory_user_locations: ['user_id'], messages: ['sender_id'],
  message_recipients: ['user_id'], plant_inspections: ['user_id'],
  profile_fleet_assignments: ['user_id'], profile_reporting_lines: ['profile_id', 'manager_profile_id'],
  profile_team_memberships: ['profile_id'], reminder_actions: ['created_by', 'resolved_by'],
  timesheets: ['user_id', 'reviewed_by', 'manager_approved_by'], training_people: ['profile_id'],
  user_page_visits: ['user_id'], user_usage_events: ['user_id'], user_usage_sessions: ['user_id'],
  van_inspections: ['user_id'], webauthn_audit_events: ['profile_id', 'actor_profile_id'],
  sensitive_pin_audit_events: ['profile_id', 'actor_profile_id'],
};
const RETIRE: Readonly<Record<string, readonly string[]>> = {
  app_auth_sessions: ['profile_id'], webauthn_credentials: ['profile_id'],
  webauthn_challenges: ['profile_id'], webauthn_devices: ['profile_id'],
  webauthn_prompt_preferences: ['profile_id'], profile_sensitive_pins: ['profile_id'],
  sensitive_pin_unlocks: ['profile_id'], sensitive_pin_verification_tokens: ['profile_id'],
  user_module_permissions: ['user_id'], employee_work_shifts: ['profile_id'],
  absence_allowance_carryovers: ['profile_id', 'generated_by'],
};
// Unclassified incoming references (including organisation managers) must be zero for the source.

export function validateConnection(value: string | undefined, ref: string, port: string): URL {
  requireThat(value && port === '5432', 'SESSION_CONNECTION_REQUIRED');
  let url: URL;
  try { url = new URL(value); } catch { throw new MergeError('INVALID_CONNECTION'); }
  requireThat(['postgres:', 'postgresql:'].includes(url.protocol) && url.port === '5432'
    && !url.search && !url.hash && url.pathname === '/postgres' && !!url.password,
  'SESSION_CONNECTION_REQUIRED');
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === `db.${ref}.supabase.co` && user === 'postgres';
  const session = /^[a-z0-9.-]+\.pooler\.supabase\.com$/u.test(url.hostname) && user === `postgres.${ref}`;
  requireThat(direct || session, 'CONNECTION_TARGET_MISMATCH');
  return url;
}
export type CliOptions = { configPath: string; mode: Mode; live: boolean; apply: boolean;
  confirmTarget?: string; confirmPort?: string };
export function parseCli(argv: string[]): CliOptions {
  const values = new Map<string, string>(); const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--live', '--apply'].includes(arg)) {
      requireThat(!flags.has(arg), 'DUPLICATE_ARGUMENT'); flags.add(arg);
    } else {
      requireThat(['--config', '--mode', '--confirm-target', '--confirm-port'].includes(arg), 'UNKNOWN_ARGUMENT');
      requireThat(!values.has(arg) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'INVALID_ARGUMENT');
      values.set(arg, argv[++i]);
    }
  }
  const mode = values.get('--mode') ?? 'inspect';
  requireThat(['inspect', 'fence', 'merge', 'verify', 'retire-auth'].includes(mode), 'INVALID_MODE');
  requireThat(values.has('--config'), 'CONFIG_REQUIRED');
  requireThat(!(flags.has('--apply') && (mode === 'inspect' || flags.has('--live'))), 'CONFLICTING_MODE');
  requireThat(!flags.has('--live') || mode === 'inspect', 'LIVE_INSPECT_ONLY');
  return { configPath: values.get('--config')!, mode: mode as Mode, live: flags.has('--live'),
    apply: flags.has('--apply'), confirmTarget: values.get('--confirm-target'), confirmPort: values.get('--confirm-port') };
}

export async function readCatalog(db: Client): Promise<Catalog> {
  const tables = (await db.query<Table>(`SELECT n.nspname AS schema, c.relname AS name,
    array_agg(a.attname::text ORDER BY a.attnum) AS columns,
    array_agg(format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum) AS types,
    c.relispartition AS partition, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
    ARRAY(SELECT a2.attname::text FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY u(num,ord)
      JOIN pg_attribute a2 ON a2.attrelid=c.oid AND a2.attnum=u.num
      WHERE i.indrelid=c.oid AND i.indisprimary ORDER BY u.ord) AS primary_key
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE (n.nspname IN ('public','private') OR (n.nspname='storage' AND c.relname='objects'))
      AND c.relkind IN ('r','p') AND (n.nspname<>'private' OR c.relname <> ALL($1::text[]))
    GROUP BY c.oid,n.nspname,c.relname,c.relispartition,c.relrowsecurity,c.relforcerowsecurity ORDER BY 1,2`, [INTERNAL])).rows;
  const foreign = await db.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private') AND c.relkind='f'`);
  requireThat(foreign.rowCount === 0, 'FOREIGN_OPERATIONAL_TABLE_UNSUPPORTED');
  const fks = (await db.query<FK>(`SELECT n.nspname AS schema,c.relname AS table,
    ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY u(num,ord)
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.num ORDER BY u.ord) AS columns,
    pn.nspname AS parent_schema,pc.relname AS parent_table,
    ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY u(num,ord)
      JOIN pg_attribute a ON a.attrelid=pc.oid AND a.attnum=u.num ORDER BY u.ord) AS parent_columns
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class pc ON pc.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pc.relnamespace
    WHERE k.contype='f'
    ORDER BY n.nspname,c.relname,k.conname`)).rows;
  requireThat(!fks.some((f) => ((f.parent_schema === 'public' && f.parent_table === 'profiles')
    || (f.parent_schema === 'auth' && f.parent_table === 'users' && f.schema !== 'auth'))
    && !tables.some((t) => t.schema === f.schema && t.name === f.table)), 'EXTERNAL_IDENTITY_DEPENDENCY_UNSUPPORTED');
  const definitions = (await db.query<{ definition: string }>(`SELECT definition FROM (
    SELECT n.nspname||'.'||c.relname||':'||pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','private','storage') AND (n.nspname<>'private' OR c.relname <> ALL($1::text[]))
    UNION ALL SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','private','storage') AND (n.nspname<>'private' OR c.relname <> ALL($1::text[]))
    UNION ALL SELECT pg_get_triggerdef(t.oid)||t.tgenabled::text||pg_get_functiondef(t.tgfoid)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname IN ('public','private','storage')
        AND t.tgname NOT IN ('account_merge_actor','account_merge_assignment')
        AND (n.nspname<>'private' OR c.relname <> ALL($1::text[]))
    UNION ALL SELECT n.nspname||'.'||c.relname||'.'||p.polname||':'||p.polcmd::text||':'||p.polpermissive::text
      ||':'||p.polroles::text||':'||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')
      ||':'||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),'') FROM pg_policy p
      JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','private','storage') AND p.polname<>'account_merge_retired_actor'
        AND (n.nspname<>'private' OR c.relname <> ALL($1::text[]))
    UNION ALL SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.prokind='f'
        AND NOT (n.nspname='private' AND p.proname IN ('account_merge_actor_guard','account_merge_assignment_guard'))
    ) d ORDER BY definition`, [INTERNAL])).rows;
  return { tables, fks, hash: hash({ tables, fks, definitions }) };
}
function identityColumns(catalog: Catalog, table: Table): string[] {
  const columns = catalog.fks.filter((f) => f.schema === table.schema && f.table === table.name
    && ((f.parent_schema === 'public' && f.parent_table === 'profiles')
      || (f.parent_schema === 'auth' && f.parent_table === 'users')))
    .flatMap((f) => f.columns.filter((_, i) => f.parent_columns[i] === 'id'));
  if (keyOf(table) === 'public.profiles') columns.push('id');
  return [...new Set(columns)].sort();
}
function tupleTokenSql(alias='t'): string {
  // An unchanged physical MVCC tuple cannot change its bytes. EXCLUSIVE locks also exclude vacuum/rewrites.
  return `md5(${alias}.tableoid::text||':'||${alias}.ctid::text||':'||${alias}.xmin::text)`;
}
async function rows(db: Client, table: string, predicate = 'true', values: unknown[] = []): Promise<StoredRow[]> {
  return (await db.query<{ raw: string; token: string }>(
    `SELECT to_jsonb(t)::text AS raw,${tupleTokenSql()} AS token FROM ${qualified(table)} t WHERE ${predicate}`, values))
    .rows.map(({ raw,token }) => ({ raw,token,data:JSON.parse(raw) as Row }));
}
async function profiles(db: Client, c: MergeConfig): Promise<StoredRow[]> {
  return rows(db, 'public.profiles', 'id=ANY($1::uuid[])', [[c.sourceId, c.targetId]]);
}
async function assertDependencies(db: Client, cat: Catalog, c: MergeConfig): Promise<void> {
  for(const ref of OPERATIONAL_REFERENCES) {
    const table=cat.tables.find((t)=>keyOf(t)===ref.table);
    const expected=ref.kind==='uuid-array'?'uuid[]':ref.kind==='json-uuid'?'jsonb':'uuid';
    requireThat(table && table.types[table.columns.indexOf(ref.column)]===expected
      && (ref.kind!=='conditional-uuid' || table.columns.includes(ref.condition)),
    `OPERATIONAL_REFERENCE_SCHEMA_DRIFT:${ref.table}.${ref.column}`);
    if(ref.policy==='reject') requireThat(!(await db.query(
      `SELECT 1 FROM ${qualified(ref.table)} t WHERE ${operationalPredicate(ref)} LIMIT 1`,[[c.sourceId]])).rowCount,
    `UNAPPROVED_OPERATIONAL_REFERENCE:${ref.table}.${ref.column}`);
  }
  for (const t of cat.tables) {
    for (const column of identityColumns(cat, t)) {
      if (keyOf(t) === 'public.profiles' && column === 'id') continue;
      const classified = t.schema === 'public' && [...(MOVE[t.name] ?? []), ...(RETIRE[t.name] ?? [])].includes(column);
      if (!classified) {
        const result = await db.query(`SELECT 1 FROM ${qualified(keyOf(t))} WHERE ${ident(column)}=$1 LIMIT 1`, [c.sourceId]);
        requireThat(!result.rowCount, `UNCLASSIFIED_SOURCE_DEPENDENCY:${keyOf(t)}.${column}`);
      }
    }
    for (const column of t.schema === 'public' ? [...(MOVE[t.name] ?? []), ...(RETIRE[t.name] ?? [])] : []) {
      if (t.columns.includes(column)) requireThat(identityColumns(cat, t).includes(column), `IDENTITY_FK_MISSING:${t.name}.${column}`);
    }
  }
}
async function allHashes(db: Client, cat: Catalog): Promise<Record<string, string[]>> {
  const sql = cat.tables.filter((t) => !t.partition).map((t) =>
    `SELECT '${keyOf(t)}' AS table_name, COALESCE(array_agg(h ORDER BY h),ARRAY[]::text[]) AS hashes
      FROM (SELECT ${tupleTokenSql()} AS h FROM ${qualified(keyOf(t))} t) hashes`).join(' UNION ALL ');
  const found = await db.query<{table_name:string;hashes:string[]}>(sql);
  return Object.fromEntries(found.rows.map((r) => [r.table_name,r.hashes]));
}
async function materializeMutations(db: Client,plan: Mutation[]): Promise<void> {
  const needed=plan.filter((m)=>m.after && !m.afterRaw);
  if(!needed.length)return;
  const values=needed.map((m)=>{
    const patch:Row=Object.fromEntries(Object.entries(m.after!).filter(([k,v])=>canonical(v)!==canonical(m.before.data[k])));
    let submittedBy:string|null=null;
    if(Object.hasOwn(patch,'metadata')) {
      const before=m.before.data.metadata as Row,after=m.after!.metadata as Row;
      requireThat(m.table==='public.reminder_actions' && before && after
        && typeof after.submitted_by==='string'
        && hash(without(before,['submitted_by']))===hash(without(after,['submitted_by'])),
      'UNAPPROVED_JSON_MUTATION');
      submittedBy=after.submitted_by;delete patch.metadata;
    }
    return `{"before":${m.before.raw},"patch":${JSON.stringify(patch)},"submitted_by":${JSON.stringify(submittedBy)}}`;
  });
  // Preserve untouched PostgreSQL numeric scale and exact JSON numbers; only approved fields are overlaid.
  const found=(await db.query<{n:string;raw:string}>(`SELECT n::text AS n,
    (CASE WHEN value->>'submitted_by' IS NOT NULL THEN
      jsonb_set((value->'before')||(value->'patch'),'{metadata,submitted_by}',to_jsonb(value->>'submitted_by'),false)
      ELSE (value->'before')||(value->'patch') END)::text AS raw
    FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY p(value,n) ORDER BY p.n`,
  [`[${values.join(',')}]`])).rows;
  requireThat(found.length===needed.length,'EXPECTED_RAW_ROW_MISSING');
  found.forEach((r,i)=>{
    const actual=JSON.parse(r.raw) as Row;
    const mismatches=Object.keys(needed[i].after!).filter((key)=>canonical(actual[key])!==canonical(needed[i].after![key]));
    requireThat(Number(r.n)===i+1 && mismatches.length===0,`EXPECTED_RAW_ROW_MISMATCH:${needed[i].table}.${mismatches.join('.')}`);
    needed[i].afterRaw=r.raw;
  });
}
async function plannedHashes(db: Client, plan: {before?:StoredRow;after:Row|null;afterRaw?:string}[]): Promise<{old:string|null;next:string|null}[]> {
  if (!plan.length) return [];
  const payload=plan.map((m)=>{
    requireThat(m.after===null || typeof m.afterRaw==='string','EXPECTED_RAW_ROW_REQUIRED');
    return `{"before":${m.before?.raw??'null'},"after":${m.after===null?'null':m.afterRaw}}`;
  });
  return (await db.query<{old:string|null;next:string|null}>(`SELECT
    CASE WHEN value->'before' <> 'null'::jsonb THEN md5(((value->'before')-'updated_at')::text) END AS old,
    CASE WHEN value->'after' <> 'null'::jsonb THEN md5(((value->'after')-'updated_at')::text) END AS next
    FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY p(value,n) ORDER BY n`,
  [`[${payload.join(',')}]`])).rows;
}

export type BackupReceipt = { snapshotHash: string; ciphertextHash: string; algorithm: 'aes-256-gcm'; path: string };
export type Snapshot = { version: 1; phase: Mode; runId: string; configHash: string; schemaHash: string;
  rows: Record<string, string[]>; tableHashes: Record<string, string[]> };
export type AuthAdapter = {
  banSource: (sourceId: string) => Promise<void>;
  retireProfile: (sourceId: string, before: Row, retired: Row) => Promise<void>;
  sourceIsBanned: (sourceId: string) => Promise<boolean>;
  deleteSource: (sourceId: string) => Promise<void>;
  sourceExists: (sourceId: string) => Promise<boolean>;
};
export type Dependencies = { backup: (snapshot: Snapshot) => Promise<BackupReceipt>;
  auth: AuthAdapter; afterMutation?: () => Promise<void> };
export type Receipt = { runId: string; configHash: string; phase: string; snapshotHash: string | null };

export async function validateExternalPath(file: string, repository: string): Promise<string> {
  requireThat(path.isAbsolute(file), 'BACKUP_PATH_NOT_ABSOLUTE');
  const parent = await fs.realpath(path.dirname(file)); const root = await fs.realpath(repository);
  const resolved = path.join(parent, path.basename(file));
  const relative = path.relative(root, resolved);
  requireThat(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'BACKUP_INSIDE_REPOSITORY');
  const stat = await fs.lstat(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  requireThat(!stat, 'BACKUP_PATH_ALREADY_EXISTS');
  return resolved;
}
export function encryptSnapshot(snapshot: Snapshot, key: Buffer): Buffer {
  requireThat(key.length === 32, 'BACKUP_KEY_REQUIRED');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const aad = Buffer.from(`${snapshot.configHash}:${snapshot.phase}:${snapshot.runId}`);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(snapshot), 'utf8'), cipher.final()]);
  return Buffer.from(JSON.stringify({ version: 1, algorithm: 'aes-256-gcm', aad: aad.toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') }));
}
export function encryptedFileBackup(basePath: string, key: Buffer, repository: string): Dependencies['backup'] {
  return async (snapshot) => {
    const file = await validateExternalPath(`${basePath}.${snapshot.phase}.${randomBytes(8).toString('hex')}.enc`, repository);
    const ciphertext = encryptSnapshot(snapshot, key);
    const handle = await fs.open(file, 'wx', 0o600);
    try { await handle.writeFile(ciphertext); await handle.sync(); } finally { await handle.close(); }
    requireThat(hash(await fs.readFile(file)) === hash(ciphertext), 'BACKUP_READBACK_FAILED');
    return { path: file, snapshotHash: hash(snapshot), ciphertextHash: hash(ciphertext), algorithm: 'aes-256-gcm' };
  };
}
async function capture(db: Client, cat: Catalog, c: MergeConfig, phase: Mode, deps: Dependencies,
  tableHashes?: Record<string,string[]>): Promise<BackupReceipt> {
  requireThat(typeof deps.backup === 'function', 'BACKUP_CALLBACK_REQUIRED');
  const captured: Record<string, string[]> = {};
  for (const t of cat.tables.filter((t) => !t.partition)) {
    const cols = identityColumns(cat, t);
    const predicates = cols.map((col) => `${ident(col)}::text=ANY($1::text[])`);
    predicates.push(...operationalReferences(keyOf(t)).map(operationalPredicate));
    if (predicates.length) captured[keyOf(t)] = (await rows(db, keyOf(t), predicates.join(' OR '), [[c.sourceId, c.targetId]])).map((r) => r.raw);
  }
  captured['auth.users'] = (await rows(db, 'auth.users', 'id=ANY($1::uuid[])', [[c.sourceId, c.targetId]])).map((r) => r.raw);
  // Auth-internal dependencies are recovery material only; only the supported Auth API retires them.
  const authTables = (await db.query<{ name: string; columns: string[] }>(`SELECT c.relname AS name,
    array_agg(a.attname::text) AS columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='auth' AND c.relkind='r' AND c.relname<>'users' GROUP BY c.relname`)).rows;
  for (const t of authTables) {
    const col = t.columns.includes('user_id') ? 'user_id' : t.columns.includes('profile_id') ? 'profile_id' : null;
    if (col) captured[`auth.${t.name}`] = (await rows(db, `auth.${t.name}`, `${ident(col)}::text=$1`, [c.sourceId])).map((r) => r.raw);
    if (t.name === 'audit_log_entries' && t.columns.includes('payload'))
      captured[`auth.${t.name}`] = (await rows(db, `auth.${t.name}`, `position($1 in payload::text)>0`, [c.sourceId])).map((r) => r.raw);
  }
  const snapshot: Snapshot = { version: 1, phase, runId: c.runId, configHash: configHash(c), schemaHash: cat.hash,
    rows: captured, tableHashes: tableHashes ?? await allHashes(db, cat) };
  const receipt = await deps.backup(snapshot);
  requireThat(receipt && receipt.snapshotHash === hash(snapshot) && /^[a-f0-9]{64}$/u.test(receipt.ciphertextHash)
    && receipt.algorithm === 'aes-256-gcm' && path.isAbsolute(receipt.path), 'BACKUP_NOT_DURABLE');
  const relative = path.relative(await fs.realpath(REPOSITORY_ROOT),
    path.join(await fs.realpath(path.dirname(receipt.path)), path.basename(receipt.path)));
  requireThat(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'BACKUP_INSIDE_REPOSITORY');
  return receipt;
}
async function lockAndValidate(db: Client, c: MergeConfig): Promise<Catalog> {
  const idle = await db.query<{ idle: boolean }>(`SELECT xact_start=query_start AS idle FROM pg_stat_activity WHERE pid=pg_backend_pid()`);
  requireThat(idle.rows[0].idle, 'RUNNER_REQUIRES_IDLE_CLIENT');
  await db.query('BEGIN');
  try {
    await db.query(`SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='60s'; SET LOCAL transaction_timeout='180s'`);
    requireThat((await db.query<{ actor: string | null }>('SELECT auth.uid() AS actor')).rows[0].actor === null, 'NON_JWT_MAINTENANCE_REQUIRED');
    const cat = await readCatalog(db);
    const keys = [...cat.tables.filter((t) => !t.partition).map(keyOf), 'auth.users'];
    if ((await db.query(`SELECT to_regclass('private.account_merge_runs') AS t`)).rows[0].t)
      keys.push(...INTERNAL.map((name) => `private.${name}`));
    for (const key of [...new Set(keys)].sort()) await db.query(`LOCK TABLE ${qualified(key)} IN EXCLUSIVE MODE`);
    const locked = await readCatalog(db);
    requireThat(locked.hash === cat.hash && locked.hash === c.schemaHash, 'SCHEMA_DRIFT');
    await assertDependencies(db, locked, c);
    return locked;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
function expectedRetiredProfile(s: Row): Row {
  requireThat(s.source_before && typeof s.source_before === 'object' && typeof s.fence_deleted_at === 'string',
    'RETIREMENT_PREIMAGE_REQUIRED');
  return {...s.source_before as Row, deleted_at:s.fence_deleted_at,role_id:null,super_admin:false};
}
async function validateIdentities(db: Client, c: MergeConfig, retired?: Row): Promise<void> {
  const p = await profiles(db, c);
  const source = p.find((r) => r.data.id === c.sourceId); const target = p.find((r) => r.data.id === c.targetId);
  requireThat(source && target && profileHash(source.data) === (retired ? profileHash(retired) : c.sourceProfileHash)
    && profileHash(target.data) === c.targetProfileHash, 'PROFILE_FINGERPRINT_MISMATCH');
  requireThat(source.data.employee_id === c.employeeId && !target.data.employee_id && !target.data.deleted_at
    && (retired ? !!source.data.deleted_at && source.data.role_id === null && source.data.super_admin === false : !source.data.deleted_at)
    && !source.data.is_system_account && !target.data.is_system_account
    && Number(source.data.annual_holiday_allowance_days) === 28 && Number(target.data.annual_holiday_allowance_days) === 28,
  'UNSUPPORTED_PROFILE_STATE');
  requireThat((await db.query(`SELECT id FROM auth.users WHERE (id=$1 AND lower(email)=$3) OR (id=$2 AND lower(email)=$4)`,
    [c.sourceId,c.targetId,c.sourceEmail,c.targetEmail])).rowCount===2,'AUTH_IDENTITY_EMAIL_MISMATCH');
}
async function initializeState(db: Client): Promise<void> {
  await db.query(`CREATE SCHEMA IF NOT EXISTS private;
    CREATE TABLE IF NOT EXISTS private.account_merge_runs (
      run_id uuid PRIMARY KEY, source_id uuid NOT NULL UNIQUE, target_id uuid NOT NULL,
      config_hash text NOT NULL, phase text NOT NULL, snapshot_hash text,
      final_hashes jsonb, scoped_hashes jsonb, target_hash text, fence_hash text NOT NULL, maintenance_xid text, retirement_xid text,
      source_before jsonb NOT NULL, fence_deleted_at text NOT NULL, fenced_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS private.account_merge_retired (
      source_id uuid PRIMARY KEY, run_id uuid NOT NULL, retired_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS private.account_merge_provenance (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL,
      source_id uuid NOT NULL, target_id uuid NOT NULL, table_name text NOT NULL,
      row_hash text NOT NULL, operation text NOT NULL, original jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now());
    REVOKE ALL ON private.account_merge_runs, private.account_merge_retired,
      private.account_merge_provenance FROM PUBLIC;
    REVOKE ALL ON SEQUENCE private.account_merge_provenance_id_seq FROM PUBLIC;
    ALTER TABLE private.account_merge_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.account_merge_retired ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.account_merge_provenance ENABLE ROW LEVEL SECURITY;`);
  const roles = (await db.query<{ name: string }>(`SELECT rolname AS name FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`)).rows;
  for (const role of roles) {
    for (const table of INTERNAL) await db.query(`REVOKE ALL ON private.${ident(table)} FROM ${ident(role.name)}`);
    await db.query(`REVOKE ALL ON SEQUENCE private.account_merge_provenance_id_seq FROM ${ident(role.name)}`);
  }
}
async function state(db: Client, c: MergeConfig): Promise<Row | null> {
  if (!(await db.query(`SELECT to_regclass('private.account_merge_runs') AS t`)).rows[0].t) return null;
  const result = await db.query<Row>('SELECT * FROM private.account_merge_runs WHERE source_id=$1 OR run_id=$2', [c.sourceId, c.runId]);
  requireThat(result.rows.length <= 1, 'RUN_ID_CONFLICT');
  const found = result.rows[0];
  if (found) requireThat(found.run_id === c.runId && found.target_id === c.targetId && found.config_hash === configHash(c), 'RECEIPT_CONFIG_MISMATCH');
  return found ?? null;
}
function redactionPaths(value: unknown,prefix:string[]=[]): string[][] {
  if(Array.isArray(value))return value.flatMap((entry,i)=>redactionPaths(entry,[...prefix,String(i)]));
  if(value!==null && typeof value==='object')return Object.entries(value).flatMap(([key,entry])=>
    /password|secret|token|pin_hash|pin_salt|public_key|credential_id/iu.test(key)
      ? [[...prefix,key]] : redactionPaths(entry,[...prefix,key]));
  return [];
}
function provenanceEntry(m: Mutation): string {
  const secretTable = Object.hasOwn(RETIRE, m.table.split('.')[1])
    && !['employee_work_shifts','user_module_permissions','absence_allowance_carryovers'].includes(m.table.split('.')[1]);
  const original = secretTable ? JSON.stringify({id:m.before.data.id??null,profile_id:m.before.data.profile_id??null,retired:true})
    : m.before.raw;
  return `{"table_name":${JSON.stringify(m.table)},"row_hash":${JSON.stringify(hash(m.before.raw))},
    "operation":${JSON.stringify(m.kind)},"original":${original},
    "redactions":${JSON.stringify(secretTable?[]:redactionPaths(m.before.data))}}`;
}
async function provenanceBatch(db: Client,c: MergeConfig,plan: Mutation[]): Promise<void> {
  if(!plan.length) return;
  await db.query(`WITH RECURSIVE scrubbed AS (
    SELECT value AS entry,value->'original' AS original,0 AS step
      FROM jsonb_array_elements($4::jsonb) p(value)
    UNION ALL
    SELECT entry,original #- ARRAY(SELECT jsonb_array_elements_text(entry->'redactions'->step)),step+1
      FROM scrubbed WHERE step<jsonb_array_length(entry->'redactions')
    )
    INSERT INTO private.account_merge_provenance
      (run_id,source_id,target_id,table_name,row_hash,operation,original)
    SELECT $1,$2,$3,entry->>'table_name',entry->>'row_hash',entry->>'operation',original
      FROM scrubbed WHERE step=jsonb_array_length(entry->'redactions')`,
  [c.runId,c.sourceId,c.targetId,`[${plan.map(provenanceEntry).join(',')}]`]);
}
async function provenance(db: Client,c: MergeConfig,m: Mutation): Promise<void> {
  await provenanceBatch(db,c,[m]);
}


function operationalAssignmentSql(c: MergeConfig): string {
  return OPERATIONAL_REFERENCES.map((ref)=>{
    const [schema,table]=ref.table.split('.');
    const blocked=`(val='${c.sourceId}' OR EXISTS (SELECT 1 FROM private.account_merge_retired WHERE source_id::text=val))`;
    let body:string;
    if(ref.kind==='uuid-array') {
      body=`FOR val IN SELECT jsonb_array_elements_text(COALESCE(NULLIF(incoming->'${ref.column}','null'::jsonb),'[]'::jsonb)) LOOP
        IF ${blocked} AND NOT COALESCE(NULLIF(prior->'${ref.column}','null'::jsonb),'[]'::jsonb) ? val THEN
          RAISE EXCEPTION 'Retired operational assignment denied' USING ERRCODE='42501';
        END IF;
      END LOOP;`;
    } else {
      const current=ref.kind==='json-uuid'?`incoming->'${ref.column}'->>'${ref.key}'`:
        `CASE WHEN incoming->>'${ref.condition}'='${ref.equals}' THEN incoming->>'${ref.column}' END`;
      const previous=ref.kind==='json-uuid'?`prior->'${ref.column}'->>'${ref.key}'`:
        `CASE WHEN prior->>'${ref.condition}'='${ref.equals}' THEN prior->>'${ref.column}' END`;
      body=`val:=${current}; previous:=${previous};
        IF pg_input_is_valid(val,'uuid') THEN val:=val::uuid::text; END IF;
        IF pg_input_is_valid(previous,'uuid') THEN previous:=previous::uuid::text; END IF;
        IF val IS NOT NULL AND val IS DISTINCT FROM previous AND ${blocked} THEN
          ${ref.kind==='conditional-uuid'?`allowed_audit:=false;
          IF TG_OP='INSERT' AND auth.uid() IS NULL AND pg_trigger_depth()>1 AND incoming->>'user_id' IS NULL THEN
            SELECT * INTO authorized FROM private.account_merge_runs WHERE source_id::text=val AND
              ((phase='fence-pending-auth' AND retirement_xid=pg_current_xact_id()::text)
                OR (phase='fenced' AND maintenance_xid=pg_current_xact_id()::text));
            IF FOUND THEN
              expected_profile:=authorized.source_before || jsonb_build_object(
                'deleted_at',authorized.fence_deleted_at::timestamptz,'role_id',NULL,'super_admin',false);
              IF authorized.phase='fence-pending-auth' AND incoming->>'action'='updated' THEN
                SELECT COALESCE(jsonb_object_agg(k,jsonb_build_object('old',authorized.source_before->k,'new',expected_profile->k)),'{}'::jsonb)
                  INTO expected_changes FROM jsonb_object_keys(expected_profile) k
                  WHERE k NOT IN ('created_at','updated_at') AND authorized.source_before->k IS DISTINCT FROM expected_profile->k;
                allowed_audit:=incoming->'changes'=expected_changes;
              ELSIF authorized.phase='fenced' AND incoming->>'action'='updated' THEN
                expected_changes:=jsonb_build_object('employee_id',jsonb_build_object('old',authorized.source_before->'employee_id','new',NULL));
                allowed_audit:=incoming->'changes'=expected_changes;
              ELSIF authorized.phase='fenced' AND incoming->>'action'='deleted' THEN
                expected_profile:=expected_profile || jsonb_build_object('employee_id',NULL);
                SELECT jsonb_object_agg(k,jsonb_build_object('old',expected_profile->k)) INTO expected_changes
                  FROM jsonb_object_keys(expected_profile) k WHERE k NOT IN ('created_at','updated_at');
                allowed_audit:=incoming->'changes'=expected_changes;
              END IF;
            END IF;
          END IF;`:'allowed_audit:=false;'}
          IF NOT COALESCE(allowed_audit,false) THEN
            RAISE EXCEPTION 'Retired operational assignment denied' USING ERRCODE='42501';
          END IF;
        END IF;`;
    }
    return `IF TG_TABLE_SCHEMA='${schema}' AND TG_TABLE_NAME='${table}' THEN ${body} END IF;`;
  }).join('\n');
}

async function installFence(db: Client, cat: Catalog, c: MergeConfig): Promise<void> {
  // Literal source guards also fence transactions whose MVCC snapshot predates the tombstone.
  await db.query(`CREATE OR REPLACE FUNCTION private.account_merge_actor_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,private AS $$ BEGIN
      IF auth.uid()='${c.sourceId}'::uuid OR EXISTS (SELECT 1 FROM private.account_merge_retired WHERE source_id=auth.uid()) THEN
        RAISE EXCEPTION 'Retired account cannot write' USING ERRCODE='42501';
      END IF;
      RETURN NULL;
    END $$;
    CREATE OR REPLACE FUNCTION private.account_merge_assignment_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,private AS $$
    DECLARE col text; val text; previous text; incoming jsonb; prior jsonb;
      authorized private.account_merge_runs%ROWTYPE; expected_profile jsonb; expected_changes jsonb; allowed_audit boolean;
    BEGIN
      incoming:=to_jsonb(NEW); prior:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
      IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='profiles' AND TG_OP='UPDATE'
        AND incoming->>'id'='${c.sourceId}' AND prior->>'deleted_at' IS NOT NULL
        AND (incoming->>'role_id' IS NOT NULL OR incoming->>'super_admin' IS DISTINCT FROM 'false') THEN
        RAISE EXCEPTION 'Retired profile authority cannot return' USING ERRCODE='42501';
      END IF;
      -- The real service-role profile transition records its own transaction for the nested native audit only.
      IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='profiles' AND TG_OP='UPDATE'
        AND incoming->>'id'='${c.sourceId}' AND auth.uid() IS NULL AND auth.role()='service_role' THEN
        SELECT * INTO authorized FROM private.account_merge_runs
          WHERE source_id='${c.sourceId}'::uuid AND phase='fence-pending-auth';
        IF FOUND THEN
          expected_profile:=authorized.source_before || jsonb_build_object(
            'deleted_at',authorized.fence_deleted_at::timestamptz,'role_id',NULL,'super_admin',false);
          IF prior-'updated_at'=authorized.source_before-'updated_at'
            AND incoming-'updated_at'=expected_profile-'updated_at' THEN
            UPDATE private.account_merge_runs SET retirement_xid=pg_current_xact_id()::text WHERE run_id=authorized.run_id;
          END IF;
        END IF;
      END IF;
      FOREACH col IN ARRAY COALESCE(TG_ARGV,ARRAY[]::text[]) LOOP
        val := incoming->>col;
        previous := prior->>col;
        IF val IS NOT NULL AND (TG_OP='INSERT' OR val IS DISTINCT FROM previous)
          AND (val='${c.sourceId}' OR EXISTS (SELECT 1 FROM private.account_merge_retired WHERE source_id::text=val)) THEN
          IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='absence_allowance_carryovers' AND col='profile_id'
            AND auth.uid() IS NULL AND pg_trigger_depth()>1
            AND to_jsonb(NEW)->>'auto_generated'='true'
            AND to_jsonb(NEW)->>'generation_source'='absence-year-end-carryover'
            AND to_jsonb(NEW)->>'generated_by' IS NULL
            AND EXISTS (SELECT 1 FROM private.account_merge_runs r JOIN private.account_merge_retired s
              ON r.run_id=s.run_id AND r.source_id=s.source_id WHERE r.source_id::text=val
              AND r.phase='fenced' AND r.maintenance_xid=pg_current_xact_id()::text) THEN
            CONTINUE;
          END IF;
          RAISE EXCEPTION 'Retired account assignment denied' USING ERRCODE='42501';
        END IF;
      END LOOP;
      ${operationalAssignmentSql(c)}
      IF TG_TABLE_SCHEMA='storage' THEN
        IF ('${c.sourceId}'=ANY(string_to_array(NEW.name,'/')) OR EXISTS (SELECT 1 FROM private.account_merge_retired
          WHERE source_id::text=ANY(string_to_array(NEW.name,'/'))))
          AND (TG_OP='INSERT' OR NEW.name IS DISTINCT FROM OLD.name) THEN
          RAISE EXCEPTION 'Retired storage path denied' USING ERRCODE='42501';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION private.account_merge_actor_guard(), private.account_merge_assignment_guard() FROM PUBLIC;`);
  await db.query('INSERT INTO private.account_merge_retired (source_id,run_id) VALUES ($1,$2)', [c.sourceId, c.runId]);
  for (const table of cat.tables) {
    const key = qualified(keyOf(table));
    await db.query(`CREATE TRIGGER account_merge_actor BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON ${key}
      FOR EACH STATEMENT EXECUTE FUNCTION private.account_merge_actor_guard()`);
    const cols = identityColumns(cat, table);
    if (table.schema === 'storage') {
      for (const col of ['owner', 'owner_id']) if (table.columns.includes(col)) cols.push(col);
    }
    if (!table.partition && assignmentRequired(cat,table)) {
      const args = [...new Set(cols)].map((s) => `'${s}'`).join(',');
      await db.query(`CREATE TRIGGER account_merge_assignment BEFORE INSERT OR UPDATE ON ${key}
        FOR EACH ROW EXECUTE FUNCTION private.account_merge_assignment_guard(${args})`);
    }
  }
  const storage = cat.tables.find((t) => keyOf(t) === 'storage.objects');
  requireThat(storage && storage.columns.includes('name'), 'STORAGE_SCHEMA_REQUIRES_PARENT_STEP');
  const rls = await db.query<{ enabled: boolean }>(`SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='storage.objects'::regclass`);
  requireThat(rls.rows[0].enabled, 'STORAGE_RLS_REQUIRED');
  await db.query(`CREATE POLICY account_merge_retired_actor ON storage.objects AS RESTRICTIVE FOR ALL TO PUBLIC
    USING (auth.uid() IS DISTINCT FROM '${c.sourceId}'::uuid)
    WITH CHECK (auth.uid() IS DISTINCT FROM '${c.sourceId}'::uuid)`);
}
async function fenceHash(db: Client): Promise<string> {
  const definitions=(await db.query<{definition:string}>(`SELECT definition FROM (
    SELECT pg_get_triggerdef(t.oid)||t.tgenabled::text||pg_get_functiondef(t.tgfoid) AS definition
      FROM pg_trigger t WHERE t.tgname LIKE 'account_merge_%'
    UNION ALL SELECT p.polname||':'||p.polpermissive::text||':'||p.polcmd::text||':'||p.polroles::text
      ||':'||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')||':'||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),'')
      FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polname LIKE 'account_merge_%'
    ) d ORDER BY definition`)).rows;
  return hash(definitions);
}
async function assertFence(db: Client, cat: Catalog, c: MergeConfig): Promise<void> {
  const saved=await db.query<{fence_hash:string}>('SELECT fence_hash FROM private.account_merge_runs WHERE run_id=$1',[c.runId]);
  requireThat(saved.rows[0]?.fence_hash===await fenceHash(db),'FENCE_DEFINITION_DRIFT');
  const retired = await db.query('SELECT 1 FROM private.account_merge_retired WHERE source_id=$1 AND run_id=$2', [c.sourceId, c.runId]);
  requireThat(retired.rowCount === 1, 'SOURCE_NOT_FENCED');
  for (const t of cat.tables) {
    const count = await db.query<{ n: string }>(`SELECT count(*) AS n FROM pg_trigger
      WHERE tgrelid=$1::regclass AND tgname=ANY($2::text[]) AND tgenabled='O'`,
    [keyOf(t), ['account_merge_actor', 'account_merge_assignment']]);
    const assignment = assignmentRequired(cat,t);
    requireThat(Number(count.rows[0].n) === (assignment ? 2 : 1), `FENCE_DRIFT:${keyOf(t)}`);
  }
  requireThat((await db.query(`SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass
    AND polname='account_merge_retired_actor' AND NOT polpermissive`)).rowCount === 1, 'STORAGE_FENCE_MISSING');
}
async function assertNoStorage(db: Client, cat: Catalog, c: MergeConfig): Promise<void> {
  const t = cat.tables.find((t) => keyOf(t) === 'storage.objects');
  requireThat(t && t.columns.includes('name'), 'STORAGE_SCHEMA_REQUIRES_PARENT_STEP');
  const predicates = ['owner', 'owner_id'].filter((col) => t.columns.includes(col)).map((col) => `${ident(col)}::text=$1`);
  predicates.push(`$1=ANY(string_to_array(name,'/'))`);
  requireThat((await db.query(`SELECT 1 FROM storage.objects WHERE ${predicates.join(' OR ')} LIMIT 1`, [c.sourceId])).rowCount === 0,
    'SOURCE_STORAGE_REQUIRES_PARENT_STEP');
}
async function noIncoming(db: Client, cat: Catalog, table: string, selected: StoredRow[]): Promise<void> {
  if (!selected.length) return;
  const [schema, name] = table.split('.');
  for (const fk of cat.fks.filter((f) => f.parent_schema === schema && f.parent_table === name)) {
    const joins = fk.columns.map((col, i) => `child.${ident(col)}=parent.${ident(fk.parent_columns[i])}`).join(' AND ');
    const found = await db.query(`SELECT 1 FROM ${qualified(`${fk.schema}.${fk.table}`)} child
      JOIN ${qualified(table)} parent ON ${joins}
      WHERE to_jsonb(parent)=ANY(SELECT value FROM jsonb_array_elements($1::jsonb)) LIMIT 1`,
    [`[${selected.map((r) => r.raw).join(',')}]`]);
    requireThat(found.rowCount === 0, `INCOMING_REFERENCE:${table}`);
  }
}
async function affected(db: Client, cat: Catalog, c: MergeConfig): Promise<Record<string, StoredRow[]>> {
  const found: Record<string, StoredRow[]> = {};
  for (const t of cat.tables.filter((t) => !t.partition && t.schema === 'public')) {
    const cols = [...(MOVE[t.name] ?? []), ...(RETIRE[t.name] ?? [])].filter((col) => t.columns.includes(col));
    const predicates = cols.map((col) => `${ident(col)}::text=ANY($1::text[])`);
    predicates.push(...operationalReferences(keyOf(t)).map(operationalPredicate));
    if (predicates.length) found[keyOf(t)] = await rows(db, keyOf(t), predicates.join(' OR '), [[c.sourceId]]);
  }
  return found;
}
// Preserve source usage history while retiring its authentication sessions.
const SESSION_HISTORY_TABLES: readonly string[] = ['public.user_usage_events','public.user_usage_sessions'];
const duplicateFields = ['reason_id','date','end_date','duration_days','is_half_day','half_day_session','is_bank_holiday'];
async function buildPlan(db: Client, cat: Catalog, c: MergeConfig): Promise<Mutation[]> {
  const data = await affected(db, cat, c); const plan: Mutation[] = [];
  for(const table of SESSION_HISTORY_TABLES) {
    const definition=cat.tables.find((t)=>keyOf(t)===table);
    requireThat(definition && definition.types[definition.columns.indexOf('app_session_id')]==='uuid'
      && cat.fks.some((f)=>`${f.schema}.${f.table}`===table && f.columns.length===1
        && f.columns[0]==='app_session_id' && f.parent_schema==='public'
        && f.parent_table==='app_auth_sessions' && f.parent_columns.length===1 && f.parent_columns[0]==='id'),
    'SESSION_HISTORY_SCHEMA_CHANGED');
    const nullable=await db.query('SELECT NOT attnotnull AS nullable FROM pg_attribute WHERE attrelid=$1::regclass AND attname=$2 AND NOT attisdropped',
      [table,'app_session_id']);
    requireThat(nullable.rows.length===1 && nullable.rows[0].nullable===true,'SESSION_HISTORY_SCHEMA_CHANGED');
  }
  const sourceSessionIds=new Set((data['public.app_auth_sessions']??[])
    .filter((r)=>r.data.profile_id===c.sourceId).map((r)=>r.data.id));
  const absenceRows = data['public.absences'] ?? [];
  requireThat(absenceRows.filter((r) => r.data.profile_id === c.sourceId).length === c.expectedSourceAbsences, 'ABSENCE_COUNT_CHANGED');
  const duplicates = await rows(db, 'public.absences', 'id=ANY($1::uuid[])', [c.duplicates.map((d) => d.target)]);
  requireThat(duplicates.length === c.duplicates.length, 'DUPLICATE_ROWS_MISSING');
  for (const pair of c.duplicates) {
    const source = absenceRows.find((r) => r.data.id === pair.source); const target = duplicates.find((r) => r.data.id === pair.target);
    requireThat(source && target && source.data.profile_id === c.sourceId && target.data.profile_id === c.targetId
      && duplicateFields.every((k) => canonical(source.data[k]) === canonical(target.data[k]))
      && source.data.status==='processed' && ['approved','processed'].includes(String(target.data.status)), 'DUPLICATE_APPROVAL_MISMATCH');
    plan.push({ table: 'public.absences', before: target, after: null, kind: 'approved-target-duplicate' });
  }
  await noIncoming(db, cat, 'public.absences', duplicates);
  const carryovers = await rows(db, 'public.absence_allowance_carryovers', 'profile_id=ANY($1::uuid[])', [[c.sourceId,c.targetId]]);
  const adjustment = carryovers.find((r) => r.data.id === c.targetAdjustmentId);
  requireThat(carryovers.length === 1 && adjustment && adjustment.data.profile_id === c.targetId
    && Number(adjustment.data.carried_days) === -17 && adjustment.data.generation_source === 'admin-user-onboarding-adjustment',
  'UNEXPECTED_INITIAL_CARRYOVERS');
  await noIncoming(db, cat, 'public.absence_allowance_carryovers', carryovers);
  const snapshotTable = cat.tables.find((t) => t.name === 'absence_financial_year_close_snapshot_rows');
  requireThat(snapshotTable, 'UNDO_CLOSE_SCHEMA_MISSING');
  requireThat(!(await db.query(`SELECT 1 FROM public.absence_financial_year_close_snapshot_rows
    WHERE carryover_id=$1 OR profile_id=$2 LIMIT 1`, [c.targetAdjustmentId,c.sourceId])).rowCount,
  'UNDO_CLOSE_SNAPSHOT_REQUIRES_REVIEW');
  plan.push({ table:'public.absence_allowance_carryovers',before:adjustment,after:null,kind:'discard-onboarding-adjustment' });
  const overrides = data['public.user_module_permissions'] ?? [];
  requireThat(overrides.length === c.expectedPermissionOverrides, 'PERMISSION_COUNT_CHANGED');
  const sourceShift = data['public.employee_work_shifts'] ?? [];
  const targetShift = await rows(db,'public.employee_work_shifts','profile_id=$1',[c.targetId]);
  requireThat(sourceShift.length === 1 && targetShift.length === 1
    && hash(without(sourceShift[0].data,['id','profile_id','created_at','updated_at']))
      === hash(without(targetShift[0].data,['id','profile_id','created_at','updated_at'])), 'WORK_SHIFT_MISMATCH');
  let keyCount = 0;
  for (const [table, selected] of Object.entries(data)) {
    const name = table.split('.')[1];
    for (const before of selected) {
      if (name === 'absence_allowance_carryovers') continue;
      if (Object.hasOwn(RETIRE, name)) {
        plan.push({ table,before,after:null,kind:name === 'user_module_permissions' ? 'discard-source-permission' : 'retire-source-only' });
        continue;
      }
      const after = { ...before.data };
      let kind=name === 'message_recipients' ? 'same-id-recipient' : 'identity-transfer';
      for (const col of MOVE[name] ?? []) if (after[col] === c.sourceId) after[col] = c.targetId;
      if(SESSION_HISTORY_TABLES.includes(table) && before.data.app_session_id!==null) {
        requireThat(before.data.user_id===c.sourceId && after.user_id===c.targetId
          && typeof before.data.app_session_id==='string' && sourceSessionIds.has(before.data.app_session_id),
        'SESSION_HISTORY_OWNER_MISMATCH');
        after.app_session_id=null;kind='detach-retired-session-history';
      }
      if (name === 'audit_log' && after.table_name === 'profiles' && after.record_id === c.sourceId) after.record_id = c.targetId;
      if (name === 'reminder_actions') {
        const ref=operationalReferences(table).find((r)=>r.kind==='json-uuid')!;
        const selected=(await db.query(`SELECT 1 FROM ${qualified(table)} t WHERE t.id=$2 AND ${operationalPredicate(ref)}`,[[c.sourceId],after.id])).rowCount;
        if(selected) {
          requireThat((after.metadata as Row | undefined)?.submitted_by===c.sourceId
            && after.workflow_key==='plant_legacy_missing_site','UNKNOWN_OPERATIONAL_JSON');
          after.metadata={...(after.metadata as Row),submitted_by:c.targetId};
        }
      }
      if (['absences','absences_archive'].includes(name) && typeof after.holiday_key === 'string'
        && after.holiday_key.includes(c.sourceId)) {
        requireThat(after.holiday_key === `uk-bank-holiday:england-and-wales:${c.sourceId}:${after.date}`,
          'NONCANONICAL_HOLIDAY_KEY');
        after.holiday_key = `uk-bank-holiday:england-and-wales:${c.targetId}:${after.date}`; keyCount++;
      }
      if (name === 'profile_reporting_lines' && after.profile_id === after.manager_profile_id) {
        requireThat(before.data.profile_id === c.sourceId && before.data.manager_profile_id === c.targetId
          && before.data.valid_to === null, 'UNAPPROVED_REPORTING_SELF_LOOP');
        plan.push({table,before,after:null,kind:'remove-active-self-loop'}); continue;
      }
      if (name === 'message_recipients') {
        const message = (await rows(db,'public.messages','id=$1',[before.data.message_id]))[0];
        requireThat(message && !message.data.daily_allocation_labour_item_id && !message.data.daily_allocation_publication_id,
          'ALLOCATION_RECIPIENT_REQUIRES_REVIEW');
        await noIncoming(db,cat,table,[before]);
      }
      plan.push({ table,before,after,kind });
    }
  }
  requireThat(keyCount === c.expectedHolidayKeys,'HOLIDAY_KEY_COUNT_CHANGED');
  return plan;
}

async function applyMutation(db: Client, c: MergeConfig, m: Mutation): Promise<void> {
  await materializeMutations(db,[m]);
  await provenance(db,c,m);
  if (!m.after || m.kind === 'same-id-recipient') {
    const deleted = await db.query(`DELETE FROM ${qualified(m.table)} t WHERE ${m.before.data.id !== undefined ? `t.id=(jsonb_populate_record(NULL::${qualified(m.table)},$1::jsonb)).id AND ` : ''}to_jsonb(t)=$1::jsonb`,[m.before.raw]);
    requireThat(deleted.rowCount === 1, 'DELETE_PREIMAGE_CHANGED');
  }
  if (m.kind === 'same-id-recipient') {
    await db.query(`INSERT INTO ${qualified(m.table)} SELECT (jsonb_populate_record(NULL::${qualified(m.table)},$1::jsonb)).*`,
      [m.afterRaw]);
  } else if (m.after) {
    const changed = Object.keys(m.after).filter((col) => canonical(m.after![col]) !== canonical(m.before.data[col]));
    requireThat(changed.length > 0, 'EMPTY_MUTATION');
    const updated = await db.query(`UPDATE ${qualified(m.table)} t SET ${changed.map((col) =>
      `${ident(col)}=(jsonb_populate_record(NULL::${qualified(m.table)},$2::jsonb)).${ident(col)}`).join(',')}
      WHERE ${m.before.data.id !== undefined ? `t.id=(jsonb_populate_record(NULL::${qualified(m.table)},$1::jsonb)).id AND ` : ''}to_jsonb(t)=$1::jsonb`,[m.before.raw,m.afterRaw]);
    requireThat(updated.rowCount === 1,'UPDATE_PREIMAGE_CHANGED');
  }
}
function rowKey(cat: Catalog,table: string,row: Row): Row {
  const keys=cat.tables.find((t)=>keyOf(t)===table)?.primary_key;
  requireThat(keys?.length && keys.every((k)=>row[k]!==undefined && row[k]!==null),'PRIMARY_KEY_REQUIRED');
  return Object.fromEntries(keys.map((k)=>[k,row[k]]));
}
function keyJoin(cat: Catalog,table: string,json: string): string {
  const keys=cat.tables.find((t)=>keyOf(t)===table)?.primary_key;
  requireThat(keys?.length,'PRIMARY_KEY_REQUIRED');
  return keys.map((k)=>`t.${ident(k)}=(jsonb_populate_record(NULL::${qualified(table)},${json})).${ident(k)}`).join(' AND ');
}
async function applyMutations(db: Client,cat: Catalog,c: MergeConfig,plan: Mutation[]): Promise<void> {
  await materializeMutations(db,plan);
  // Group same-table/column operations so a large audit history never becomes thousands of network round trips/full scans.
  const groups=new Map<string,{table:string;kind:string;columns:string[];items:Mutation[]}>();
  for(const m of plan) {
    const columns=m.after ? Object.keys(m.after).filter((k)=>canonical(m.after![k])!==canonical(m.before.data[k])).sort() : [];
    requireThat(!m.after || columns.length>0,'EMPTY_MUTATION');
    rowKey(cat,m.table,m.before.data);
    const key=canonical([m.table,m.kind,columns]);
    if(!groups.has(key)) groups.set(key,{table:m.table,kind:m.kind,columns,items:[]});
    groups.get(key)!.items.push(m);
  }
  for(const group of groups.values()) {
    const {table,kind,columns,items}=group;
    await provenanceBatch(db,c,items);
    const input=`[${items.map((m)=>`{"before":${m.before.raw},"after":${m.afterRaw??'null'}}`).join(',')}]`;
    const join=keyJoin(cat,table,"p.value->'before'");
    if(!items[0].after || kind==='same-id-recipient') {
      const removed=await db.query(`DELETE FROM ${qualified(table)} t USING jsonb_array_elements($1::jsonb) p(value)
        WHERE ${join} AND to_jsonb(t)=p.value->'before'`,[input]);
      requireThat(removed.rowCount===items.length,'DELETE_PREIMAGE_CHANGED');
    }
    if(kind==='same-id-recipient') {
      const inserted=await db.query(`INSERT INTO ${qualified(table)}
        SELECT * FROM jsonb_populate_recordset(NULL::${qualified(table)},$1::jsonb)`,
      [`[${items.map((m)=>m.afterRaw).join(',')}]`]);
      requireThat(inserted.rowCount===items.length,'RECIPIENT_REINSERT_FAILED');
    } else if(items[0].after) {
      const changed=await db.query(`UPDATE ${qualified(table)} t SET
        ${columns.map((col)=>`${ident(col)}=(jsonb_populate_record(NULL::${qualified(table)},p.value->'after')).${ident(col)}`).join(',')}
        FROM jsonb_array_elements($1::jsonb) p(value) WHERE ${join} AND to_jsonb(t)=p.value->'before'`,[input]);
      requireThat(changed.rowCount===items.length,'UPDATE_PREIMAGE_CHANGED');
    }
  }
}
type RowProof = {table:string;key:Row;expected:string|null};
async function scopedProof(db: Client,cat: Catalog,plan: Mutation[],generatedCarryovers: StoredRow[],newAudit: StoredRow[]): Promise<RowProof[]> {
  const additions=[...generatedCarryovers.map((r)=>({table:'public.absence_allowance_carryovers',after:r.data,afterRaw:r.raw})),
    ...newAudit.map((r)=>({table:'public.audit_log',after:r.data,afterRaw:r.raw}))];
  const hashes=await plannedHashes(db,[...plan,...additions]);
  const proof:RowProof[]=[];
  plan.forEach((m,i)=>{
    const beforeKey=rowKey(cat,m.table,m.before.data);
    const afterKey=m.after ? rowKey(cat,m.table,m.after) : beforeKey;
    if(m.after && canonical(beforeKey)!==canonical(afterKey)) proof.push({table:m.table,key:beforeKey,expected:null});
    proof.push({table:m.table,key:afterKey,expected:hashes[i].next});
  });
  additions.forEach((m,i)=>proof.push({table:m.table,key:rowKey(cat,m.table,m.after),expected:hashes[plan.length+i].next}));
  const unique=new Map(proof.map((p)=>[canonical([p.table,p.key]),p]));
  requireThat(unique.size===proof.length,'DUPLICATE_SCOPED_PROOF');
  return proof;
}
async function verifyScopedProof(db: Client,cat: Catalog,value: unknown): Promise<void> {
  requireThat(Array.isArray(value) && value.length>0,'SCOPED_PROOF_REQUIRED');
  const groups=new Map<string,RowProof[]>();
  for(const p of value as RowProof[]) {
    requireThat(typeof p.table==='string' && p.key && (p.expected===null || /^[a-f0-9]{32}$/u.test(p.expected)),
      'INVALID_SCOPED_PROOF');
    requireThat(canonical(rowKey(cat,p.table,p.key))===canonical(p.key),'INVALID_SCOPED_PROOF');
    if(!groups.has(p.table)) groups.set(p.table,[]);
    groups.get(p.table)!.push(p);
  }
  for(const [table,proof] of groups) {
    const actual=(await db.query<{n:string;h:string|null}>(`SELECT p.n::text AS n,md5((to_jsonb(t)-'updated_at')::text) AS h
      FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY p(value,n)
      LEFT JOIN ${qualified(table)} t ON ${keyJoin(cat,table,"p.value->'key'")} ORDER BY p.n`,[JSON.stringify(proof)])).rows;
    requireThat(actual.length===proof.length && actual.every((r,i)=>Number(r.n)===i+1 && r.h===proof[i].expected),
      `POSTCOMMIT_RECORD_CHANGED:${table}`);
  }
}

async function checkDeleteClosure(db: Client, cat: Catalog, c: MergeConfig, plan: Mutation[]): Promise<void> {
  for (const m of plan.filter((m) => !m.after)) {
    const [schema,name] = m.table.split('.');
    for (const f of cat.fks.filter((f) => f.parent_schema===schema && f.parent_table===name)) {
      const childTable = `${f.schema}.${f.table}`;
      const handledChildren = plan.filter((child) => child.table===childTable && (!child.after
        || (m.table==='public.app_auth_sessions' && m.before.data.profile_id===c.sourceId
          && SESSION_HISTORY_TABLES.includes(childTable) && f.columns.length===1 && f.columns[0]==='app_session_id'
          && f.parent_columns.length===1 && f.parent_columns[0]==='id'
          && child.kind==='detach-retired-session-history' && child.before.data.user_id===c.sourceId
          && child.after.user_id===c.targetId && child.before.data.app_session_id===m.before.data.id
          && child.after.app_session_id===null))).map((child) => child.before.raw);
      const joins = f.columns.map((col,i) => `child.${ident(col)}=parent.${ident(f.parent_columns[i])}`).join(' AND ');
      const result = await db.query(`SELECT 1 FROM ${qualified(childTable)} child JOIN ${qualified(m.table)} parent ON ${joins}
        WHERE to_jsonb(parent)=$1::jsonb
        AND NOT (to_jsonb(child)=ANY(SELECT value FROM jsonb_array_elements($2::jsonb))) LIMIT 1`,
      [m.before.raw,`[${handledChildren.join(',')}]`]);
      requireThat(result.rowCount===0,`DELETE_HAS_SURVIVING_DEPENDENT:${m.table}`);
    }
  }
}
async function assertHolidayTotals(db: Client,c: MergeConfig): Promise<void> {
  for (const y of c.holidayYears) {
    const result = await db.query<{ used: string }>(`SELECT COALESCE(sum(a.duration_days),0) AS used FROM (
      SELECT profile_id,date,reason_id,status,duration_days FROM public.absences
      UNION ALL SELECT profile_id,date,reason_id,status,duration_days FROM public.absences_archive
      ) a JOIN public.absence_reasons r ON r.id=a.reason_id WHERE a.profile_id=$1
      AND lower(r.name)='annual leave' AND a.status IN ('approved','processed')
      AND a.date>=make_date($2,4,1) AND a.date<make_date($2+1,4,1)`,[c.targetId,y.year]);
    requireThat(Number(result.rows[0].used)===y.used && 28+y.carryIn-y.used===y.balance,'HOLIDAY_CONSERVATION_FAILED');
  }
}
async function reconcileCarryovers(db: Client,cat: Catalog,c: MergeConfig): Promise<StoredRow[]> {
  const source = await rows(db,'public.absence_allowance_carryovers','profile_id=$1',[c.sourceId]);
  const closed = (await db.query<{ year: number }>('SELECT financial_year_start_year AS year FROM public.absence_financial_year_closures ORDER BY 1')).rows.map((r)=>r.year);
  for (const row of source) {
    requireThat(row.data.auto_generated===true && row.data.generation_source==='absence-year-end-carryover'
      && row.data.generated_by===null && Number(row.data.carried_days)===28
      && Number(row.data.financial_year_start_year)===Number(row.data.source_financial_year_start_year)+1
      && closed.includes(Number(row.data.source_financial_year_start_year)),'UNEXPECTED_SOURCE_CARRYOVER_SIDE_EFFECT');
    await noIncoming(db,cat,'public.absence_allowance_carryovers',[row]);
    await applyMutation(db,c,{table:'public.absence_allowance_carryovers',before:row,after:null,kind:'remove-transfer-side-effect'});
  }
  for (const year of c.holidayYears.filter((y)=>closed.includes(y.year)).sort((a,b)=>a.year-b.year)) {
    const result = await db.query<{ days: string }>('SELECT public.recalculate_financial_year_carryover_for_profile($1,$2,NULL) AS days',[year.year,c.targetId]);
    requireThat(Number(result.rows[0].days)===year.balance,'CARRYOVER_RECONCILIATION_FAILED');
  }
  const target = await rows(db,'public.absence_allowance_carryovers','profile_id=$1',[c.targetId]);
  for (const row of target) {
    const year = c.holidayYears.find((y)=>y.year===Number(row.data.source_financial_year_start_year) && closed.includes(y.year));
    requireThat(year && year.balance!==0 && Number(row.data.carried_days)===year.balance
      && Number(row.data.financial_year_start_year)===year.year+1 && row.data.auto_generated===true
      && row.data.generation_source==='absence-year-end-carryover' && row.data.generated_by===null
      && row.data.id!==c.targetAdjustmentId,'UNEXPECTED_TARGET_CARRYOVER');
  }
  return target;
}
async function assertExpectedHashes(db: Client,cat: Catalog,before: Record<string,string[]>,plan: Mutation[],
  generatedCarryovers: StoredRow[],newAudit: StoredRow[]): Promise<Record<string,string[]>> {
  const expected=new Map(Object.entries(before).map(([table,values])=>{
    const counts=new Map<string,number>();
    for(const h of values) counts.set(h,(counts.get(h)??0)+1);
    return [table,counts] as const;
  }));
  for(const mutation of plan) {
    const counts=expected.get(mutation.table),token=mutation.before.token;
    requireThat(counts && token,'MISSING_BEFORE_TUPLE');
    const n=counts.get(token)??0;requireThat(n>0,'MISSING_BEFORE_HASH');
    if(n===1) counts.delete(token);else counts.set(token,n-1);
  }
  const additions=[...plan.filter((m)=>m.after).map((m)=>({table:m.table,after:m.after!,afterRaw:m.afterRaw})),
    ...generatedCarryovers.map((r)=>({table:'public.absence_allowance_carryovers',after:r.data,afterRaw:r.raw})),
    ...newAudit.map((r)=>({table:'public.audit_log',after:r.data,afterRaw:r.raw}))];
  const hashes=await plannedHashes(db,additions);
  const groups=new Map<string,{key:Row;expected:string}[]>();
  additions.forEach((m,i)=>{
    if(!groups.has(m.table))groups.set(m.table,[]);
    requireThat(hashes[i].next,'MISSING_EXPECTED_BYTES');
    groups.get(m.table)!.push({key:rowKey(cat,m.table,m.after),expected:hashes[i].next!});
  });
  for(const [table,proof] of groups) {
    const found=(await db.query<{n:string;h:string|null;token:string|null}>(`SELECT p.n::text AS n,
      md5((to_jsonb(t)-'updated_at')::text) AS h,${tupleTokenSql()} AS token
      FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY p(value,n)
      LEFT JOIN ${qualified(table)} t ON ${keyJoin(cat,table,"p.value->'key'")} ORDER BY p.n`,
    [JSON.stringify(proof)])).rows;
    requireThat(found.length===proof.length && found.every((r,i)=>Number(r.n)===i+1 && r.h===proof[i].expected && r.token),
      `UNEXPECTED_BUSINESS_BYTES:${table}`);
    const counts=expected.get(table);requireThat(counts,'UNKNOWN_MUTATED_TABLE');
    for(const row of found)counts.set(row.token!,(counts.get(row.token!)??0)+1);
  }
  const after=await allHashes(db,cat);
  for(const [table,counts] of expected) {
    const values=[...counts].flatMap(([h,n])=>Array<string>(n).fill(h)).sort();
    requireThat(hash(values)===hash(after[table]),`UNEXPECTED_BUSINESS_BYTES:${table}`);
  }
  return after;
}
async function acceptAuditSideEffects(db: Client,c: MergeConfig,plan: Mutation[],beforeIds: string[]): Promise<StoredRow[]> {
  const created = await rows(db,'public.audit_log','NOT (id::text=ANY($1::text[]))',[beforeIds]);
  const accepted: StoredRow[] = [];
  for (const row of created) {
    const candidates = plan.filter((m)=>m.table===`public.${row.data.table_name}` && m.before.data.id===row.data.record_id);
    requireThat(row.data.user_id===null && candidates.length>0 && ['created','updated','deleted'].includes(String(row.data.action)),
      'UNEXPECTED_AUDIT_SIDE_EFFECT');
    const changes = row.data.changes as Record<string,{old?:unknown;new?:unknown}>;
    requireThat(changes && typeof changes==='object','UNEXPECTED_AUDIT_SHAPE');
    for (const [col,change] of Object.entries(changes)) {
      const profilePasswordFlag=row.data.table_name==='profiles' && col==='must_change_password'
        && Object.entries(change).every(([key,value])=>['old','new'].includes(key) && (value===null || typeof value==='boolean'));
      requireThat(profilePasswordFlag || !/password|secret|token|pin_hash|pin_salt|public_key|credential_id/iu.test(col),
        'AUDIT_WOULD_COPY_SECRET');
      requireThat(candidates.some((m)=>
        (!Object.hasOwn(change,'old') || canonical(change.old)===canonical(m.before.data[col])
          || (m.table==='public.profiles' && m.before.data.id===c.sourceId && col==='employee_id' && change.old===null))
        && (!Object.hasOwn(change,'new') || canonical(change.new)===canonical(m.after?.[col])
          || (m.table==='public.profiles' && m.before.data.id===c.sourceId && col==='employee_id' && change.new===null))),
      'AUDIT_DELTA_MISMATCH');
    }
    if (row.data.table_name==='profiles' && row.data.record_id===c.sourceId) {
      const after = {...row.data,record_id:c.targetId};
      const mutation:Mutation={table:'public.audit_log',before:row,after,kind:'generated-profile-audit-link'};
      await applyMutation(db,c,mutation);
      accepted.push({raw:mutation.afterRaw!,data:after});
    } else accepted.push(row);
  }
  return accepted;
}
async function zeroSourceReferences(db: Client,cat: Catalog,c: MergeConfig,includeAuditLinks=true): Promise<void> {
  for (const t of cat.tables.filter((t)=>!t.partition)) {
    for (const col of identityColumns(cat,t)) {
      if (keyOf(t)==='public.profiles' && col==='id') continue;
      requireThat(!(await db.query(`SELECT 1 FROM ${qualified(keyOf(t))} WHERE ${ident(col)}=$1 LIMIT 1`,[c.sourceId])).rowCount,
        `SOURCE_REFERENCE_REMAINS:${keyOf(t)}.${col}`);
    }
  }
  for(const ref of OPERATIONAL_REFERENCES) {
    if(!includeAuditLinks && ref.kind==='conditional-uuid') continue;
    requireThat(!(await db.query(`SELECT 1 FROM ${qualified(ref.table)} t WHERE ${operationalPredicate(ref)} LIMIT 1`,[[c.sourceId]])).rowCount,
      `SOURCE_OPERATIONAL_REFERENCE_REMAINS:${ref.table}.${ref.column}`);
  }
}
async function verifyCommitted(db: Client,cat: Catalog,c: MergeConfig,s: Row): Promise<void> {
  requireThat(['merged','verified','retired'].includes(String(s.phase)),'DATA_MERGE_NOT_COMMITTED');
  requireThat(!(await rows(db,'public.profiles','id=$1',[c.sourceId])).length,'SOURCE_PROFILE_REMAINS');
  const target = (await rows(db,'public.profiles','id=$1',[c.targetId]))[0];
  requireThat(target && profileHash(target.data)===s.target_hash,'TARGET_PROFILE_CHANGED');
  await verifyScopedProof(db,cat,s.scoped_hashes);
  await zeroSourceReferences(db,cat,c); await assertNoStorage(db,cat,c); await assertFence(db,cat,c); await assertHolidayTotals(db,c);
}
function receipt(c: MergeConfig,s: Row): Receipt {
  return {runId:c.runId,configHash:configHash(c),phase:String(s.phase),snapshotHash:typeof s.snapshot_hash==='string'?s.snapshot_hash:null};
}
export async function fence(db: Client,config: MergeConfig,deps: Dependencies): Promise<Receipt> {
  const c=ConfigSchema.parse(config); let begun=false; let pending:Row;
  try {
    const cat=await lockAndValidate(db,c); begun=true; const existing=await state(db,c);
    if(existing) {
      await assertFence(db,cat,c);
      if(existing.phase==='fenced') {
        await validateIdentities(db,c,expectedRetiredProfile(existing));
        requireThat((await db.query('SELECT 1 FROM auth.users WHERE id=$1 AND banned_until>now()',[c.sourceId])).rowCount===1,'AUTH_BAN_REQUIRED');
      }
      await db.query('COMMIT');begun=false;
      if(existing.phase!=='fence-pending-auth') return receipt(c,existing);
      pending=existing;
    } else {
      await validateIdentities(db,c);await assertNoStorage(db,cat,c);
      const plan=await buildPlan(db,cat,c);await checkDeleteClosure(db,cat,c,plan);
      for(const m of plan) rowKey(cat,m.table,m.before.data);
      const source=(await profiles(db,c)).find((r)=>r.data.id===c.sourceId)!;
      const beforeHashes=await allHashes(db,cat);
      const backup=await capture(db,cat,c,'fence',deps,beforeHashes);
      await initializeState(db);await installFence(db,cat,c);
      const timestamp=(await db.query<{now:string}>(`SELECT to_jsonb(clock_timestamp()) #>> '{}' AS now`)).rows[0].now;
      const revocations:Mutation[]=[];
      for(const name of ['app_auth_sessions','webauthn_credentials','webauthn_devices']) {
        const table=cat.tables.find((t)=>keyOf(t)===`public.${name}`);
        requireThat(table && table.columns.includes('revoked_at'),'AUTH_RETIREMENT_SCHEMA_UNSUPPORTED');
        for(const before of await rows(db,`public.${name}`,'profile_id=$1 AND revoked_at IS NULL',[c.sourceId]))
          revocations.push({table:`public.${name}`,before,after:{...before.data,revoked_at:timestamp},kind:'source-auth-revocation'});
      }
      await applyMutations(db,cat,c,revocations);
      await assertExpectedHashes(db,cat,beforeHashes,revocations,[],[]);
      await db.query(`INSERT INTO private.account_merge_runs
        (run_id,source_id,target_id,config_hash,phase,snapshot_hash,fence_hash,source_before,fence_deleted_at)
        VALUES ($1,$2,$3,$4,'fence-pending-auth',$5,$6,$7::jsonb,$8)`,
      [c.runId,c.sourceId,c.targetId,configHash(c),backup.snapshotHash,await fenceHash(db),source.raw,timestamp]);
      pending=(await state(db,c))!;
      await db.query('COMMIT');begun=false;
    }
    requireThat(profileHash(pending.source_before as Row)===c.sourceProfileHash,'RETIREMENT_PREIMAGE_MISMATCH');
    // Supported Auth/profile lifecycle APIs run outside SQL locks with the real service credential.
    await deps.auth.banSource(c.sourceId);
    requireThat(await deps.auth.sourceIsBanned(c.sourceId),'AUTH_BAN_UNCONFIRMED');
    await deps.auth.retireProfile(c.sourceId,pending.source_before as Row,expectedRetiredProfile(pending));
    const locked=await lockAndValidate(db,c);begun=true;const current=(await state(db,c))!;
    await assertFence(db,locked,c);
    await validateIdentities(db,c,expectedRetiredProfile(current));
    requireThat((await db.query('SELECT 1 FROM auth.users WHERE id=$1 AND banned_until>now()',[c.sourceId])).rowCount===1,'AUTH_BAN_REQUIRED');
    await db.query(`UPDATE private.account_merge_runs SET phase='fenced',retirement_xid=NULL,fenced_at=COALESCE(fenced_at,clock_timestamp())
      WHERE run_id=$1 AND phase='fence-pending-auth'`,[c.runId]);
    await db.query('COMMIT');begun=false;return {...receipt(c,current),phase:'fenced'};
  } catch(error) {if(begun) await db.query('ROLLBACK');throw error;}
}
export async function merge(db: Client,config: MergeConfig,deps: Dependencies): Promise<Receipt> {
  const c=ConfigSchema.parse(config); let begun=false;
  try {
    const cat=await lockAndValidate(db,c); begun=true; const current=await state(db,c);
    requireThat(current,'FENCE_RECEIPT_REQUIRED'); await assertFence(db,cat,c);
    if (current.phase!=='fenced') { await verifyCommitted(db,cat,c,current); await db.query('COMMIT'); return receipt(c,current); }
    requireThat((await db.query('SELECT 1 FROM auth.users WHERE id=$1 AND banned_until>now()',[c.sourceId])).rowCount===1,'AUTH_BAN_REQUIRED');
    await validateIdentities(db,c,expectedRetiredProfile(current));
    requireThat((await db.query(`SELECT 1 FROM private.account_merge_runs
      WHERE run_id=$1 AND fenced_at IS NOT NULL AND clock_timestamp()>=fenced_at+($2::int*interval '1 second')`,
      [c.runId,MINIMUM_DRAIN_SECONDS])).rowCount===1,'REQUEST_DRAIN_INCOMPLETE');
    await assertNoStorage(db,cat,c);
    const plan=await buildPlan(db,cat,c); await checkDeleteClosure(db,cat,c,plan);
    const p=await profiles(db,c); const source=p.find((r)=>r.data.id===c.sourceId)!; const target=p.find((r)=>r.data.id===c.targetId)!;
    const targetAfter: Row={...target.data,employee_id:c.employeeId};
    for (const field of CONTACT_FIELDS) if ((targetAfter[field]===null || targetAfter[field]==='') && source.data[field]!=null)
      targetAfter[field]=source.data[field];
    const targetMutation: Mutation={table:'public.profiles',before:target,after:targetAfter,kind:'preserve-target-manager'};
    const sourceMutation: Mutation={table:'public.profiles',before:source,after:null,kind:'remove-source-profile-last'};
    const before=await allHashes(db,cat);
    const auditIds=(await db.query<{id:string}>('SELECT id::text AS id FROM public.audit_log')).rows.map((r)=>r.id);
    const backup=await capture(db,cat,c,'merge',deps,before);
    await db.query(`SELECT set_config('app.absence_archive_move','on',true)`);
    await db.query('UPDATE private.account_merge_runs SET maintenance_xid=pg_current_xact_id()::text WHERE run_id=$1',[c.runId]);
    await provenance(db,c,sourceMutation);
    await db.query('UPDATE public.profiles SET employee_id=NULL WHERE id=$1',[c.sourceId]);
    await applyMutation(db,c,targetMutation);
    // Delete approved duplicates first; detach preserved usage history before retiring session parents.
    const rank=(m:Mutation)=>m.kind==='approved-target-duplicate'?0:m.kind==='discard-onboarding-adjustment'?1:
      m.kind==='detach-retired-session-history' || ['sensitive_pin_unlocks','webauthn_prompt_preferences','webauthn_challenges','webauthn_credentials','sensitive_pin_verification_tokens'].includes(m.table.split('.')[1])?2:
      m.table==='public.app_auth_sessions'?3:m.table==='public.webauthn_devices'?4:5;
    await applyMutations(db,cat,c,[...plan].sort((a,b)=>rank(a)-rank(b)));
    const generated=await reconcileCarryovers(db,cat,c); await assertHolidayTotals(db,c);
    await zeroSourceReferences(db,cat,c,false);
    const removed=await db.query('DELETE FROM public.profiles WHERE id=$1',[c.sourceId]);
    requireThat(removed.rowCount===1,'SOURCE_PROFILE_DELETE_FAILED');
    const fullPlan=[...plan,targetMutation,sourceMutation];
    const audit=await acceptAuditSideEffects(db,c,fullPlan,auditIds);
    if(deps.afterMutation) await deps.afterMutation();
    await zeroSourceReferences(db,cat,c);
    const finalHashes=await assertExpectedHashes(db,cat,before,fullPlan,generated,audit);
    const scoped=await scopedProof(db,cat,fullPlan,generated,audit);
    await verifyScopedProof(db,cat,scoped);
    await db.query(`UPDATE private.account_merge_runs SET phase='merged',maintenance_xid=NULL,snapshot_hash=$2,final_hashes=$3::jsonb,target_hash=$4,scoped_hashes=$5::jsonb WHERE run_id=$1`,
      [c.runId,backup.snapshotHash,JSON.stringify(finalHashes),profileHash(targetAfter),JSON.stringify(scoped)]);
    await db.query('COMMIT'); return {runId:c.runId,configHash:configHash(c),phase:'merged',snapshotHash:backup.snapshotHash};
  } catch(error) { if(begun) await db.query('ROLLBACK'); throw error; }
}
export async function verify(db: Client,config: MergeConfig): Promise<Receipt> {
  const c=ConfigSchema.parse(config); let begun=false;
  try {
    const cat=await lockAndValidate(db,c); begun=true; const s=await state(db,c); requireThat(s,'MERGE_RECEIPT_REQUIRED');
    await verifyCommitted(db,cat,c,s);
    if(s.phase!=='retired') { await db.query(`UPDATE private.account_merge_runs SET phase='verified' WHERE run_id=$1`,[c.runId]); s.phase='verified'; }
    await db.query('COMMIT'); return receipt(c,s);
  } catch(error) { if(begun) await db.query('ROLLBACK'); throw error; }
}
export async function retireAuth(db: Client,config: MergeConfig,deps: Dependencies): Promise<Receipt> {
  const c=ConfigSchema.parse(config); let begun=false;
  try {
    const cat=await lockAndValidate(db,c); begun=true; const s=await state(db,c);
    requireThat(s && ['verified','retired'].includes(String(s.phase)),'VERIFIED_MERGE_REQUIRED');
    await verifyCommitted(db,cat,c,s);
    await db.query('COMMIT'); begun=false;
    if(await deps.auth.sourceExists(c.sourceId)) {
      requireThat(await deps.auth.sourceIsBanned(c.sourceId),'AUTH_BAN_REQUIRED');
      await deps.auth.deleteSource(c.sourceId);
    }
    requireThat(!await deps.auth.sourceExists(c.sourceId),'AUTH_DELETE_UNCONFIRMED');
    const finalCat=await lockAndValidate(db,c); begun=true;
    await verifyCommitted(db,finalCat,c,s);
    requireThat(!(await db.query('SELECT 1 FROM auth.users WHERE id=$1',[c.sourceId])).rowCount,'AUTH_DELETE_UNCONFIRMED');
    await db.query(`UPDATE private.account_merge_runs SET phase='retired' WHERE run_id=$1`,[c.runId]); s.phase='retired';
    await db.query('COMMIT'); return receipt(c,s);
  } catch(error) { if(begun) await db.query('ROLLBACK'); throw error; }
}

export type Inspection = { configHash: string; schemaHash: string; sourceProfileHash: string | null;
  targetProfileHash: string | null; tableHashes: Record<string, string>; sourceDependencies: Record<string, number> };
export async function inspect(db: Client, config: MergeConfig): Promise<Inspection> {
  const c = ConfigSchema.parse(config); const cat = await readCatalog(db);
  const p = await profiles(db, c); const all = await allHashes(db, cat);
  const sourceDependencies: Record<string, number> = {};
  for (const t of cat.tables.filter((t) => !t.partition)) {
    for (const col of identityColumns(cat, t)) {
      const n = await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${qualified(keyOf(t))} WHERE ${ident(col)}=$1`, [c.sourceId]);
      sourceDependencies[`${keyOf(t)}.${col}`] = Number(n.rows[0].n);
    }
  }
  for(const ref of OPERATIONAL_REFERENCES) {
    const n=await db.query<{n:string}>(`SELECT count(*) AS n FROM ${qualified(ref.table)} t WHERE ${operationalPredicate(ref)}`,[[c.sourceId]]);
    sourceDependencies[`${ref.table}.${ref.column}${ref.kind==='json-uuid'?'.'+ref.key:''}`]=Number(n.rows[0].n);
  }
  return { configHash: configHash(c), schemaHash: cat.hash,
    sourceProfileHash: p.find((r) => r.data.id === c.sourceId) ? profileHash(p.find((r) => r.data.id === c.sourceId)!.data) : null,
    targetProfileHash: p.find((r) => r.data.id === c.targetId) ? profileHash(p.find((r) => r.data.id === c.targetId)!.data) : null,
    tableHashes: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, hash(v)])), sourceDependencies };
}

export function safeFailure(error: unknown): { error: string } {
  return { error: error instanceof MergeError && /^[A-Z_]+(?::[a-z_.]+)?$/u.test(error.code)
    ? error.code : 'ACCOUNT_MERGE_FAILED' };
}
export function supabaseAuthAdapter(projectRef: string, key: string | undefined): AuthAdapter {
  requireThat(key,'AUTH_ADMIN_KEY_REQUIRED');
  const client=createClient(`https://${projectRef}.supabase.co`,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const admin=client.auth.admin;
  return {
    async banSource(id) { const {error}=await admin.updateUserById(id,{ban_duration:'876000h'}); requireThat(!error,'AUTH_BAN_FAILED'); },
    async retireProfile(id,before,retired) {
      requireThat(id===before.id && id===retired.id && before.deleted_at===null && retired.deleted_at
        && retired.role_id===null && retired.super_admin===false,'INVALID_PROFILE_RETIREMENT');
      const {data:found,error:readError}=await client.from('profiles').select('*').eq('id',id).single();
      requireThat(!readError && found,'PROFILE_RETIREMENT_READ_FAILED');
      if(profileHash(found as Row)===profileHash(retired)) return;
      requireThat(profileHash(found as Row)===profileHash(before),'PROFILE_RETIREMENT_PREIMAGE_CHANGED');
      const {data,error}=await client.from('profiles').update({
        deleted_at:retired.deleted_at,role_id:null,super_admin:false,
      }).eq('id',id).is('deleted_at',null).eq('updated_at',String(before.updated_at)).select('id');
      requireThat(!error && data?.length===1 && data[0].id===id,'PROFILE_RETIREMENT_FAILED');
    },
    async sourceIsBanned(id) {
      const {data,error}=await admin.getUserById(id); requireThat(!error,'AUTH_LOOKUP_FAILED');
      const banned=(data.user as {banned_until?:string}|null)?.banned_until;
      return !!banned && Date.parse(banned)>Date.now();
    },
    async deleteSource(id) { const {error}=await admin.deleteUser(id,false); requireThat(!error,'AUTH_DELETE_FAILED'); },
    async sourceExists(id) {
      const {data,error}=await admin.getUserById(id);
      if(error && (error.status===404 || error.code==='user_not_found')) return false;
      requireThat(!error,'AUTH_LOOKUP_FAILED'); return !!data.user;
    },
  };
}
export async function runCli(argv: string[],env: NodeJS.ProcessEnv=process.env): Promise<Inspection|Receipt|{dryRun:true;mode:Mode;configHash:string}> {
  const options=parseCli(argv);
  requireThat(path.isAbsolute(options.configPath),'CONFIG_PATH_NOT_ABSOLUTE');
  const configFile=await fs.realpath(options.configPath); const root=await fs.realpath(REPOSITORY_ROOT);
  const relative=path.relative(root,configFile);
  requireThat(relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative),'CONFIG_INSIDE_REPOSITORY');
  const stat=await fs.stat(configFile); requireThat(stat.size<1024*1024,'CONFIG_TOO_LARGE');
  const config=ConfigSchema.parse(JSON.parse(await fs.readFile(configFile,'utf8')));
  if(!options.live && !options.apply) return {dryRun:true,mode:options.mode,configHash:configHash(config)};
  requireThat(options.confirmTarget===config.projectRef && options.confirmPort==='5432','EXACT_TARGET_CONFIRMATION_REQUIRED');
  if(options.apply) {
    await validateExternalPath(config.backupPath,root);
    await validateExternalPath(config.receiptPath,root);
  }
  const connection=validateConnection(env.POSTGRES_URL_NON_POOLING,config.projectRef,options.confirmPort);
  const db=new Client({host:connection.hostname,port:5432,user:decodeURIComponent(connection.username),
    password:decodeURIComponent(connection.password),database:'postgres',ssl:{rejectUnauthorized:true},
    connectionTimeoutMillis:10000,application_name:'account-merge-maintenance'});
  await db.connect();
  try {
    if(options.live) {
      await db.query(`BEGIN READ ONLY; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='60s'`);
      try { const result=await inspect(db,config); await db.query('COMMIT'); return result; }
      catch(error) { await db.query('ROLLBACK'); throw error; }
    }
    let result: Receipt;
    if(options.mode==='verify') result=await verify(db,config);
    else {
      requireThat(env.ACCOUNT_MERGE_BACKUP_KEY && /^[A-Za-z0-9+/]{43}=$/u.test(env.ACCOUNT_MERGE_BACKUP_KEY),'BACKUP_KEY_REQUIRED');
      const key=Buffer.from(env.ACCOUNT_MERGE_BACKUP_KEY,'base64'); requireThat(key.length===32,'BACKUP_KEY_REQUIRED');
      const deps: Dependencies={backup:encryptedFileBackup(config.backupPath,key,root),
        auth:supabaseAuthAdapter(config.projectRef,env.SUPABASE_SERVICE_ROLE_KEY)};
      try {
        if(options.mode==='fence') result=await fence(db,config,deps);
        else if(options.mode==='merge') result=await merge(db,config,deps);
        else result=await retireAuth(db,config,deps);
      } finally {key.fill(0);}
    }
    const receiptFile=await validateExternalPath(`${config.receiptPath}.${result.phase}.${randomBytes(8).toString('hex')}.json`,root);
    const output=await fs.open(receiptFile,'wx',0o600);
    try {await output.writeFile(JSON.stringify(result));await output.sync();} finally {await output.close();}
    return result;
  } finally {await db.end();}
}
if(process.argv[1] && path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))) {
  runCli(process.argv.slice(2)).then((result)=>{console.log(JSON.stringify(result));}).catch((error:unknown)=>{
    console.error(JSON.stringify(safeFailure(error)));process.exitCode=1;
  });
}