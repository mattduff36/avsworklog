import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import pg from 'pg';

const { Client } = pg;

interface TableRow {
  table_name: string;
  table_type: 'BASE TABLE' | 'VIEW';
}

export interface ColumnRow {
  table_name: string;
  column_name: string;
  udt_name: string;
  is_nullable: boolean;
  has_default: boolean;
  is_identity: boolean;
  is_generated: boolean;
}

interface EnumRow {
  enum_name: string;
  enum_value: string;
}

interface RelationshipRow {
  table_name: string;
  foreign_key_name: string;
  columns: string[] | string;
  referenced_relation: string;
  referenced_columns: string[] | string;
}

interface CheckConstraintRow {
  table_name: string;
  definition: string;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

function formatUnion(values: string[]): string {
  return values.length > 0
    ? values
        .map((value) => (/^-?\d+(\.\d+)?$/.test(value) ? value : quoteLiteral(value)))
        .join(' | ')
    : 'never';
}

function indent(level: number, text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${'  '.repeat(level)}${line}` : line))
    .join('\n');
}

function mapBaseType(baseType: string, enums: Map<string, string[]>): string {
  if (enums.has(baseType)) {
    return formatUnion(enums.get(baseType) || []);
  }

  if (
    [
      'uuid',
      'text',
      'varchar',
      'bpchar',
      'citext',
      'name',
      'date',
      'time',
      'timetz',
      'timestamp',
      'timestamptz',
      'interval',
      'bytea',
      'inet',
      'cidr',
      'macaddr',
      'tsvector',
    ].includes(baseType)
  ) {
    return 'string';
  }

  if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'money', 'oid'].includes(baseType)) {
    return 'number';
  }

  if (baseType === 'bool') {
    return 'boolean';
  }

  if (baseType === 'json' || baseType === 'jsonb' || baseType === 'record' || baseType === 'unknown') {
    return 'Json';
  }

  if (baseType === 'void') {
    return 'undefined';
  }

  return 'string';
}

function mapColumnType(column: ColumnRow, enums: Map<string, string[]>): string {
  const isArray = column.udt_name.startsWith('_');
  const baseType = isArray ? column.udt_name.slice(1) : column.udt_name;
  const mapped = mapBaseType(baseType, enums);

  if (!isArray) {
    return mapped;
  }

  return mapped.includes(' | ') ? `(${mapped})[]` : `${mapped}[]`;
}

export function formatColumns(
  columns: ColumnRow[],
  enums: Map<string, string[]>,
  kind: 'Row' | 'Insert' | 'Update'
): string {
  return columns
    .map((column) => {
      const tsType = mapColumnType(column, enums);
      const nullableType = column.is_nullable ? `${tsType} | null` : tsType;

      if (kind === 'Row') {
        return `${column.column_name}: ${nullableType}`;
      }

      if (kind === 'Insert') {
        const optional = column.is_identity || column.is_generated || column.has_default || column.is_nullable;
        const insertType = column.is_generated ? 'never' : nullableType;
        return `${column.column_name}${optional ? '?' : ''}: ${insertType}`;
      }

      return `${column.column_name}?: ${column.is_generated ? 'never' : nullableType}`;
    })
    .join('\n');
}

function parseCheckConstraintUnion(definition: string): { column: string; values: string[] } | null {
  const normalized = definition.replace(/\s+/g, ' ');
  const columnMatch =
    normalized.match(/CHECK \(\((?:\(([\w]+)\)::text|([\w]+)) = ANY \(/i) ||
    normalized.match(/CHECK \(\(\(\(([\w]+)\)::text = ANY \(/i);

  const column = columnMatch?.[1] || columnMatch?.[2];
  if (!column) {
    return null;
  }

  const arrayMatch = normalized.match(/ARRAY\[(.+?)\]/i);
  if (!arrayMatch) {
    return null;
  }

  const rawValues = arrayMatch[1];
  const stringValues = [...rawValues.matchAll(/'([^']*)'/g)].map((match) => match[1]);
  if (stringValues.length > 0) {
    return { column, values: stringValues };
  }

  const numericValues = rawValues
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^-?\d+(\.\d+)?$/.test(value));

  if (numericValues.length > 0) {
    return { column, values: numericValues };
  }

  return null;
}

function normalizeArray(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value
    .replace(/^\{/, '')
    .replace(/\}$/, '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function main() {
  config({ path: resolve(process.cwd(), '.env.local'), quiet: true });
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const tablesResult = await client.query<TableRow>(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY table_name;
    `);

    const columnsResult = await client.query<ColumnRow>(`
      SELECT
        table_name,
        column_name,
        udt_name,
        (is_nullable = 'YES') AS is_nullable,
        (column_default IS NOT NULL) AS has_default,
        (identity_generation IS NOT NULL) AS is_identity,
        (is_generated <> 'NEVER') AS is_generated
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);

    const enumsResult = await client.query<EnumRow>(`
      SELECT
        t.typname AS enum_name,
        e.enumlabel AS enum_value
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder;
    `);

    const relationshipsResult = await client.query<RelationshipRow>(`
      SELECT
        tc.table_name,
        tc.constraint_name AS foreign_key_name,
        ARRAY_AGG(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
        ccu.table_name AS referenced_relation,
        ARRAY_AGG(ccu.column_name ORDER BY kcu.ordinal_position) AS referenced_columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
       AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
       AND rc.unique_constraint_schema = ccu.constraint_schema
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
      GROUP BY tc.table_name, tc.constraint_name, ccu.table_name
      ORDER BY tc.table_name, tc.constraint_name;
    `);

    const checkConstraintsResult = await client.query<CheckConstraintRow>(`
      SELECT
        conrelid::regclass::text AS table_name,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype = 'c'
        AND connamespace = 'public'::regnamespace
      ORDER BY conrelid::regclass::text, conname;
    `);

    const enums = new Map<string, string[]>();
    for (const row of enumsResult.rows) {
      const values = enums.get(row.enum_name) || [];
      values.push(row.enum_value);
      enums.set(row.enum_name, values);
    }

    const columnsByTable = new Map<string, ColumnRow[]>();
    for (const row of columnsResult.rows) {
      const columns = columnsByTable.get(row.table_name) || [];
      columns.push(row);
      columnsByTable.set(row.table_name, columns);
    }

    const relationshipsByTable = new Map<string, RelationshipRow[]>();
    for (const row of relationshipsResult.rows) {
      const relationships = relationshipsByTable.get(row.table_name) || [];
      relationships.push(row);
      relationshipsByTable.set(row.table_name, relationships);
    }

    const checkConstraintUnions = new Map<string, string[]>();
    for (const row of checkConstraintsResult.rows) {
      const parsed = parseCheckConstraintUnion(row.definition);
      if (!parsed) {
        continue;
      }

      checkConstraintUnions.set(`${row.table_name}.${parsed.column}`, parsed.values);
    }

    const tables = tablesResult.rows.filter((row) => row.table_type === 'BASE TABLE');
    const views = tablesResult.rows.filter((row) => row.table_type === 'VIEW');

    const lines: string[] = [];
    lines.push('export type Json =');
    lines.push('  | string');
    lines.push('  | number');
    lines.push('  | boolean');
    lines.push('  | null');
    lines.push('  | { [key: string]: Json | undefined }');
    lines.push('  | Json[]');
    lines.push('');
    lines.push('export type Database = {');
    lines.push(indent(1, "__InternalSupabase: {\n  PostgrestVersion: '12'\n}"));
    lines.push(indent(1, 'public: {'));
    lines.push(indent(2, 'Tables: {'));

    for (const table of tables) {
      const columns = columnsByTable.get(table.table_name) || [];
      const relationships = relationshipsByTable.get(table.table_name) || [];
      const typedColumns = columns.map((column) => {
        const checkValues = checkConstraintUnions.get(`${table.table_name}.${column.column_name}`);
        if (!checkValues) {
          return column;
        }

        return {
          ...column,
          udt_name: `${column.udt_name.startsWith('_') ? '_' : ''}check__${table.table_name}__${column.column_name}`,
        };
      });

      for (const column of typedColumns) {
        const checkValues = checkConstraintUnions.get(`${table.table_name}.${column.column_name}`);
        if (checkValues) {
          enums.set(column.udt_name, checkValues);
        }
      }

      lines.push(indent(3, `${table.table_name}: {`));
      lines.push(indent(4, 'Row: {'));
      lines.push(indent(5, formatColumns(typedColumns, enums, 'Row')));
      lines.push(indent(4, '}'));
      lines.push(indent(4, 'Insert: {'));
      lines.push(indent(5, formatColumns(typedColumns, enums, 'Insert')));
      lines.push(indent(4, '}'));
      lines.push(indent(4, 'Update: {'));
      lines.push(indent(5, formatColumns(typedColumns, enums, 'Update')));
      lines.push(indent(4, '}'));
      lines.push(indent(4, 'Relationships: ['));

      for (const relationship of relationships) {
        const columns = normalizeArray(relationship.columns);
        const referencedColumns = normalizeArray(relationship.referenced_columns);
        lines.push(indent(5, '{'));
        lines.push(indent(6, `foreignKeyName: ${quoteLiteral(relationship.foreign_key_name)}`));
        lines.push(indent(6, `columns: [${columns.map(quoteLiteral).join(', ')}]`));
        lines.push(indent(6, 'isOneToOne: false'));
        lines.push(indent(6, `referencedRelation: ${quoteLiteral(relationship.referenced_relation)}`));
        lines.push(indent(6, `referencedColumns: [${referencedColumns.map(quoteLiteral).join(', ')}]`));
        lines.push(indent(5, '},'));
      }

      lines.push(indent(4, ']'));
      lines.push(indent(3, '}'));
    }

    lines.push(indent(2, '}'));
    lines.push(indent(2, 'Views: {'));

    if (views.length === 0) {
      lines.push(indent(3, '[_ in never]: never'));
    } else {
      for (const view of views) {
        const columns = columnsByTable.get(view.table_name) || [];
        lines.push(indent(3, `${view.table_name}: {`));
        lines.push(indent(4, 'Row: {'));
        lines.push(indent(5, formatColumns(columns, enums, 'Row')));
        lines.push(indent(4, '}'));
        lines.push(indent(4, 'Relationships: []'));
        lines.push(indent(3, '}'));
      }
    }

    lines.push(indent(2, '}'));
    lines.push(indent(2, 'Functions: {'));
    lines.push(indent(3, '[_ in never]: never'));
    lines.push(indent(2, '}'));
    lines.push(indent(2, 'Enums: {'));

    if (enums.size === 0) {
      lines.push(indent(3, '[_ in never]: never'));
    } else {
      for (const [enumName, values] of [...enums.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
        lines.push(indent(3, `${enumName}: ${formatUnion(values)}`));
      }
    }

    lines.push(indent(2, '}'));
    lines.push(indent(2, 'CompositeTypes: {'));
    lines.push(indent(3, '[_ in never]: never'));
    lines.push(indent(2, '}'));
    lines.push(indent(1, '}'));
    lines.push('}');
    lines.push('');

    writeFileSync(resolve(process.cwd(), 'types/database.ts'), `${lines.join('\n')}`);
    console.log(`Generated database types for ${tables.length} tables and ${views.length} views.`);
  } finally {
    await client.end();
  }
}

const entryFilePath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentFilePath = fileURLToPath(import.meta.url);

if (entryFilePath === currentFilePath) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
