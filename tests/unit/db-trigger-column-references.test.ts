import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { extractTriggerColumnReferences } from '../../scripts/db-trigger-column-references';

const extract = (source: string, schema = 'public') =>
  [...extractTriggerColumnReferences(source, schema)].sort();

describe('trigger column references', () => {
  it('keeps real missing public columns available to fail schema validation', () => {
    const source = `BEGIN
      NEW.present := OLD.present;
      IF TG_TABLE_SCHEMA = 'storage' THEN
        IF NEW.name IS DISTINCT FROM OLD.name THEN
          RAISE EXCEPTION 'storage only';
        END IF;
      END IF;
      NEW.removed_public_column := OLD.another_missing_column;
      RETURN NEW;
    END;`;
    const existingColumns = new Set(['present']);
    const missing = extract(source).filter((column) => !existingColumns.has(column));
    expect(missing).toEqual(['another_missing_column', 'removed_public_column']);
    expect(extract(source)).toEqual([
      'another_missing_column', 'present', 'removed_public_column',
    ]);
  });

  it('excludes nested storage-only names for public, but checks them for storage', () => {
    const source = `DECLARE incoming jsonb; prior jsonb;
    BEGIN
      incoming := to_jsonb(NEW);
      prior := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
      FOREACH col IN ARRAY TG_ARGV LOOP
        IF incoming->>col IS NOT NULL THEN
          IF TG_OP = 'UPDATE' THEN
            PERFORM OLD.public_column;
          ELSE
            PERFORM NEW.public_column;
          END IF;
        END IF;
      END LOOP;
      IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'profiles' THEN
        PERFORM NEW.public_column;
      END IF;
      IF TG_TABLE_SCHEMA='storage' THEN
        IF ('retired-id'=ANY(string_to_array(NEW.name,'/')) OR EXISTS (
          SELECT 1 FROM retired WHERE source_id=ANY(string_to_array(NEW.name,'/'))
        )) AND (TG_OP='INSERT' OR NEW.name IS DISTINCT FROM OLD.name) THEN
          RAISE EXCEPTION 'Retired storage path denied';
        END IF;
      END IF;
      RETURN NEW;
    END;`;
    expect(extract(source)).toEqual(['public_column']);
    expect(extract(source, 'storage')).toEqual(['name', 'public_column']);
  });

  it('checks same-schema branches, outside references, and IF condition references', () => {
    expect(extract(`BEGIN
      IF TG_TABLE_SCHEMA = 'public' THEN PERFORM NEW.missing; END IF;
      IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.storage_only; END IF;
      IF NEW.condition_column IS NOT NULL THEN PERFORM OLD.body_column; END IF;
      PERFORM OLD.outside;
    END;`)).toEqual(['body_column', 'condition_column', 'missing', 'outside']);
  });

  it('handles nested guards without ending the outer exclusion early', () => {
    expect(extract(`BEGIN
      IF TG_TABLE_SCHEMA = 'storage' THEN
        PERFORM NEW.before_nested;
        IF unknown_predicate THEN
          PERFORM NEW.nested;
        ELSE
          PERFORM OLD.nested_alternative;
        END IF;
        PERFORM OLD.after_nested;
      END IF;
      PERFORM NEW.reachable;
    END;`)).toEqual(['reachable']);
  });

  it('excludes a pure nested guard inside an otherwise reachable unknown IF', () => {
    expect(extract(`BEGIN
      IF unknown_predicate THEN
        IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.storage_only; END IF;
        PERFORM NEW.reachable;
      END IF;
    END;`)).toEqual(['reachable']);
  });

  it.each([
    "TG_TABLE_SCHEMA = 'storage' OR NEW.flag",
    "TG_TABLE_SCHEMA = 'storage' AND NEW.flag",
    "TG_TABLE_SCHEMA <> 'public'",
    "TG_TABLE_SCHEMA = compute_schema()",
    "lower(TG_TABLE_SCHEMA) = 'storage'",
    "'storage' = TG_TABLE_SCHEMA",
    "TG_TABLE_SCHEMA = E'storage'",
    'TG_TABLE_SCHEMA = $$storage$$',
    'unknown_predicate',
  ])('retains references for unknown or non-pure predicate %s', (condition) => {
    expect(extract(`BEGIN IF ${condition} THEN PERFORM NEW.missing; END IF; END;`))
      .toContain('missing');
  });

  it.each([
    "ELSE PERFORM OLD.alternative;",
    "ELSIF TG_TABLE_SCHEMA = 'public' THEN PERFORM OLD.alternative;",
    "ELSIF unknown_predicate THEN PERFORM OLD.alternative; ELSE PERFORM NEW.last;",
  ])('does not infer reachability across alternatives: %s', (alternative) => {
    const columns = extract(`BEGIN
      IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.first;
      ${alternative}
      END IF;
    END;`);
    expect(columns).toContain('first');
    expect(columns).toContain('alternative');
  });

  it('does not apply an exclusion from one sibling IF to another', () => {
    expect(extract(`BEGIN
      IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.hidden; END IF;
      IF unknown_predicate THEN PERFORM NEW.visible; END IF;
    END;`)).toEqual(['visible']);
  });

  it('accepts case-insensitive keywords, comments, whitespace and outer parentheses', () => {
    expect(extract(`begin
      if ((tg_table_schema /* THEN OLD.fake */ = 'storage')) then
        perform NeW.hidden;
      end if;
      perform oLd.visible;
    end;`)).toEqual(['fake', 'visible']);
  });

  it('compares schema literals case-sensitively and handles doubled quotes', () => {
    expect(extract(`BEGIN
      IF TG_TABLE_SCHEMA = 'Public' THEN PERFORM NEW.other; END IF;
      IF TG_TABLE_SCHEMA = 'pub''lic' THEN PERFORM OLD.quoted; END IF;
    END;`)).toEqual([]);
    expect(extract("IF TG_TABLE_SCHEMA = 'pub''lic' THEN PERFORM NEW.quoted; END IF;", "pub'lic"))
      .toEqual(['quoted']);
  });

  it('never interprets misleading strings, dollar strings, identifiers or comments as control flow', () => {
    expect(extract(`BEGIN
      PERFORM 'IF TG_TABLE_SCHEMA=''storage'' THEN NEW.fake; END IF;';
      PERFORM E'escaped\\' END IF; OLD.fake';
      PERFORM $$ IF TG_TABLE_SCHEMA='storage' THEN OLD.fake; $$;
      PERFORM $tag$ END IF; NEW.fake $other$ $tag$;
      PERFORM "IF TG_TABLE_SCHEMA = 'storage' THEN NEW.fake";
      -- END IF; NEW.fake
      /* IF TG_TABLE_SCHEMA='storage' THEN /* END IF; */ OLD.fake; */
      PERFORM NEW.visible;
      IF TG_TABLE_SCHEMA = 'storage' THEN
        PERFORM 'END IF;'; PERFORM OLD.hidden;
      END IF;
      PERFORM NEW.after_guard;
    END;`)).toEqual(['after_guard', 'fake', 'visible']);
  });

  it('preserves existing scanning of references in reachable strings and comments', () => {
    expect(extract(`BEGIN
      EXECUTE 'SELECT NEW.dynamic_column';
      -- OLD.comment_column
      IF TG_TABLE_SCHEMA = 'storage' THEN
        EXECUTE $$ SELECT NEW.storage_column $$;
      END IF;
    END;`)).toEqual(['comment_column', 'dynamic_column']);
  });

  it('does not treat an opaque token containing a parenthesis as syntax', () => {
    expect(extract(`BEGIN
      IF TG_TABLE_SCHEMA = 'storage' OR '(' = ')' THEN PERFORM NEW.missing; END IF;
    END;`)).toEqual(['missing']);
  });

  it('distinguishes SQL CASE and PL/pgSQL CASE/LOOP/BEGIN nesting from IF alternatives', () => {
    expect(extract(`BEGIN
      IF TG_TABLE_SCHEMA = 'storage' THEN
        BEGIN
          FOR item IN SELECT CASE WHEN active THEN 1 ELSE 2 END LOOP
            CASE item WHEN 1 THEN PERFORM NEW.hidden; ELSE PERFORM OLD.hidden; END CASE;
          END LOOP;
        END;
      END IF;
      IF CASE WHEN NEW.flag THEN true ELSE false END THEN PERFORM OLD.visible; END IF;
    END;`)).toEqual(['flag', 'visible']);
  });

  it('accepts a function-final END without a semicolon and labeled nested blocks', () => {
    expect(extract(`BEGIN
      <<inner_block>> BEGIN
        <<items>> LOOP EXIT; END LOOP items;
        IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.hidden; END IF;
      END inner_block;
      PERFORM NEW.visible;
    END`)).toEqual(['visible']);
  });

  it.each([
    "DECLARE TG_TABLE_SCHEMA text := 'storage'; BEGIN",
    'DECLARE "tg_table_schema" text; BEGIN',
    "BEGIN TG_TABLE_SCHEMA := 'storage';",
    "BEGIN TG_TABLE_SCHEMA = 'storage';",
    'BEGIN SELECT schema_name INTO TG_TABLE_SCHEMA FROM settings;',
  ])('does not trust a potentially shadowed or reassigned schema variable: %s', (prefix) => {
    expect(extract(`${prefix}
      IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF;
    END;`)).toContain('missing');
  });

  it('excludes comments immediately after THEN as part of the unreachable body', () => {
    expect(extract(`BEGIN IF TG_TABLE_SCHEMA = 'storage' THEN
      -- NEW.hidden
      /* OLD.also_hidden */
    END IF; PERFORM NEW.visible; END;`)).toEqual(['visible']);
  });

  it('abandons earlier exclusions too if the schema variable may later be assigned', () => {
    expect(extract(`BEGIN
      IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF;
      TG_TABLE_SCHEMA := 'storage';
    END;`)).toEqual(['missing']);
  });

  it.each([
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END LOOP;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF",
    "IF TG_TABLE_SCHEMA = 'storage'; THEN PERFORM NEW.missing; END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; ELSE ELSE END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM (NEW.missing; END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing]; END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; BEGIN",
    "IF TG_TABLE_SCHEMA = 'storage' THEN LOOP PERFORM NEW.missing; END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN LOOP PERFORM NEW.missing; END LOOP END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN CASE WHEN true THEN PERFORM NEW.missing; END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN BEGIN PERFORM NEW.missing; END END IF;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; BEGIN EXCEPTION WHEN others THEN NULL; END;",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; /* unterminated",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; 'unterminated",
    'IF TG_TABLE_SCHEMA = \'storage\' THEN PERFORM NEW.missing; END IF; "unterminated',
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; $tag$unterminated",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; $invalid-tag$",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; U&'unsupported'",
    "IF TG_TABLE_SCHEMA = 'storage' THEN PERFORM NEW.missing; END IF; 'ambiguous\\'quote'",
  ])('fails closed for malformed or unsupported source: %s', (source) => {
    expect(extract(source)).toContain('missing');
  });
});

describe('db:validate wiring (offline)', () => {
  const source = readFileSync(resolve(process.cwd(), 'scripts', 'db-validate.ts'), 'utf8');

  it('uses schema-aware extraction and still reports missing columns as errors', () => {
    expect(source).toContain("extractTriggerColumnReferences(fn_body, 'public')");
    expect(source).not.toContain('fn_body.matchAll');
    expect(source).toMatch(/for \(const col of refs\)[\s\S]*?if \(!tableCols\.has\(col\)\)[\s\S]*?severity: 'ERROR'/);
  });

  it('requires verified TLS and supports only an optional trusted CA', () => {
    expect(source).toContain('rejectUnauthorized: true');
    expect(source).toContain('ca: process.env.SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM');
    expect(source).not.toContain('rejectUnauthorized: false');
    expect(source).not.toContain('checkServerIdentity');
  });
});
