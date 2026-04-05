import { describe, expect, it } from 'vitest';
import { formatColumns, type ColumnRow } from '@/scripts/generate-database-types';

describe('generate database types helpers', () => {
  it('preserves nullability in generated row types', () => {
    const columns: ColumnRow[] = [
      {
        table_name: 'example_table',
        column_name: 'nullable_text',
        udt_name: 'text',
        is_nullable: true,
        has_default: false,
        is_identity: false,
        is_generated: false,
      },
      {
        table_name: 'example_table',
        column_name: 'required_flag',
        udt_name: 'bool',
        is_nullable: false,
        has_default: false,
        is_identity: false,
        is_generated: false,
      },
    ];

    const rowShape = formatColumns(columns, new Map(), 'Row');

    expect(rowShape).toContain('nullable_text: string | null');
    expect(rowShape).toContain('required_flag: boolean');
  });
});
