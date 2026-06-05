import { createHash } from 'crypto';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import {
  buildProfileNameIndex,
  matchTrainingPersonToProfile,
  normalizeTrainingPersonName,
  parseTrainingDate,
  type ProfileNameRow,
} from '../lib/utils/training-import';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const importFile = 'data/training-data/cursor_ready_training_import.json';
const dryRun = process.argv.includes('--dry-run');

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

interface TrainingImportPackage {
  metadata?: {
    sourceWorkbook?: string;
    importantRules?: string[];
    counts?: Record<string, number>;
  };
  employees?: TrainingEmployeeImport[];
  qualificationCatalogue?: TrainingQualificationImport[];
  employeeTrainingRecords?: TrainingRecordImport[];
  workbookNotes?: TrainingWorkbookNoteImport[];
  likelyMiscNotes?: TrainingWorkbookNoteImport[];
  cpcsColourStatusKey?: Record<string, { status?: string; meaning?: string }>;
}

interface TrainingEmployeeImport {
  employeeKey?: string;
  employeeNameRaw?: string;
  dateOfBirths?: unknown[];
  sourceSheets?: unknown[];
  recordCount?: number;
}

interface TrainingQualificationImport {
  qualificationKey?: string;
  qualificationRaw?: string;
  canonicalName?: string;
  validationStatus?: string;
  validationNotes?: string;
  sourceSheets?: unknown[];
  recordCount?: number;
}

interface TrainingRecordImport {
  id?: string;
  additionalComments?: unknown;
  approved?: unknown;
  cardNumber?: unknown;
  cardTypeOrStatus?: unknown;
  colourFormattingIgnored?: unknown;
  colourFormattingRule?: unknown;
  comments?: unknown;
  cpcsSourceFillColours?: unknown[];
  cpcsStatusFromColourKey?: unknown[];
  cpcsStatusMeaning?: unknown[];
  dateOfBirth?: unknown;
  employeeNameRaw?: string;
  expiryDate?: unknown;
  issueDate?: unknown;
  qualificationCanonicalProposed?: string;
  qualificationGroup?: string;
  qualificationKey?: string;
  qualificationRaw?: string;
  qualificationValidationStatus?: string;
  rebooked?: unknown;
  relationship?: string;
  sourceRow?: number;
  sourceSheet?: string;
}

interface TrainingWorkbookNoteImport {
  sheet?: string;
  cell?: string;
  row?: number;
  column?: number;
  value?: unknown;
  fill?: unknown;
  reason?: string;
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'TRUE' || value === 1 || value === '1';
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asStringOrNull(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function fallbackQualificationStatus(value: string | undefined): string {
  return value?.trim() || 'needs_manual_review';
}

function normalizeQualificationKey(value: unknown): string {
  return asStringOrNull(value) || '';
}

function getProfileMatchKey(record: TrainingRecordImport): string {
  return normalizeTrainingPersonName(record.employeeNameRaw);
}

async function main() {
  const rawImport = readFileSync(resolve(process.cwd(), importFile), 'utf-8');
  const importHash = createHash('sha256').update(rawImport).digest('hex');
  const payload = JSON.parse(rawImport) as TrainingImportPackage;
  const employees = payload.employees || [];
  const qualifications = payload.qualificationCatalogue || [];
  const records = payload.employeeTrainingRecords || [];
  const workbookNotes = payload.workbookNotes || [];
  const likelyMiscNotes = payload.likelyMiscNotes || [];

  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    const { rows: profileRows } = await client.query<ProfileNameRow>(`
      SELECT id, full_name
      FROM public.profiles
      WHERE full_name IS NOT NULL
    `);
    const profileNameIndex = buildProfileNameIndex(profileRows);

    const { rows: batchRows } = await client.query<{ id: string }>(
      `
        INSERT INTO public.training_import_batches (
          source_file,
          source_hash,
          imported_at,
          record_count,
          people_count,
          qualification_count,
          workbook_note_count,
          likely_misc_note_count,
          rules,
          metadata
        )
        VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8::JSONB, $9::JSONB)
        ON CONFLICT (source_hash) DO UPDATE
        SET imported_at = NOW(),
            record_count = EXCLUDED.record_count,
            people_count = EXCLUDED.people_count,
            qualification_count = EXCLUDED.qualification_count,
            workbook_note_count = EXCLUDED.workbook_note_count,
            likely_misc_note_count = EXCLUDED.likely_misc_note_count,
            rules = EXCLUDED.rules,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        RETURNING id
      `,
      [
        payload.metadata?.sourceWorkbook || 'Copy of TRAINING MATRIX 2022 ONWARDS_ (003).xlsx',
        importHash,
        records.length,
        employees.length,
        qualifications.length,
        workbookNotes.length,
        likelyMiscNotes.length,
        JSON.stringify({
          importantRules: payload.metadata?.importantRules || [],
          cpcsColourStatusKey: payload.cpcsColourStatusKey || {},
        }),
        JSON.stringify(payload.metadata || {}),
      ]
    );
    const importBatchId = batchRows[0]?.id;
    if (!importBatchId) {
      throw new Error('Failed to create or update training import batch');
    }

    const personIdByKey = new Map<string, string>();
    for (const employee of employees) {
      const employeeKey = normalizeTrainingPersonName(asStringOrNull(employee.employeeKey) || asStringOrNull(employee.employeeNameRaw));
      const employeeNameRaw = asStringOrNull(employee.employeeNameRaw) || employeeKey;
      if (!employeeKey || !employeeNameRaw) continue;

      const match = matchTrainingPersonToProfile(employeeNameRaw, profileNameIndex);
      const { rows } = await client.query<{ id: string }>(
        `
          INSERT INTO public.training_people (
            employee_key,
            employee_name_raw,
            profile_id,
            profile_match_status,
            profile_match_notes,
            date_of_births,
            source_sheets,
            record_count
          )
          VALUES ($1, $2, $3, $4, $5, $6::TEXT[], $7::TEXT[], $8)
          ON CONFLICT (employee_key) DO UPDATE
          SET employee_name_raw = EXCLUDED.employee_name_raw,
              profile_id = EXCLUDED.profile_id,
              profile_match_status = EXCLUDED.profile_match_status,
              profile_match_notes = EXCLUDED.profile_match_notes,
              date_of_births = EXCLUDED.date_of_births,
              source_sheets = EXCLUDED.source_sheets,
              record_count = EXCLUDED.record_count,
              updated_at = NOW()
          RETURNING id
        `,
        [
          employeeKey,
          employeeNameRaw,
          match.profileId,
          match.status,
          match.notes,
          ensureStringArray(employee.dateOfBirths),
          ensureStringArray(employee.sourceSheets),
          employee.recordCount || 0,
        ]
      );

      personIdByKey.set(employeeKey, rows[0].id);
    }

    const qualificationIdByKey = new Map<string, string>();
    for (const qualification of qualifications) {
      const qualificationKey = normalizeQualificationKey(qualification.qualificationKey || qualification.qualificationRaw);
      const qualificationRaw = asStringOrNull(qualification.qualificationRaw) || qualificationKey;
      const canonicalName = asStringOrNull(qualification.canonicalName) || qualificationRaw;
      if (!qualificationKey || !qualificationRaw) continue;

      const { rows } = await client.query<{ id: string }>(
        `
          INSERT INTO public.training_qualifications (
            qualification_key,
            qualification_raw,
            canonical_name,
            validation_status,
            validation_notes,
            source_sheets,
            record_count
          )
          VALUES ($1, $2, $3, $4, $5, $6::TEXT[], $7)
          ON CONFLICT (qualification_key) DO UPDATE
          SET qualification_raw = EXCLUDED.qualification_raw,
              canonical_name = EXCLUDED.canonical_name,
              validation_status = EXCLUDED.validation_status,
              validation_notes = EXCLUDED.validation_notes,
              source_sheets = EXCLUDED.source_sheets,
              record_count = EXCLUDED.record_count,
              updated_at = NOW()
          RETURNING id
        `,
        [
          qualificationKey,
          qualificationRaw,
          canonicalName,
          fallbackQualificationStatus(qualification.validationStatus),
          asStringOrNull(qualification.validationNotes),
          ensureStringArray(qualification.sourceSheets),
          qualification.recordCount || 0,
        ]
      );

      qualificationIdByKey.set(qualificationKey, rows[0].id);
    }

    for (const record of records) {
      const sourceRecordId = record.id?.trim();
      const qualificationKey = normalizeQualificationKey(record.qualificationKey || record.qualificationRaw);
      const employeeKey = getProfileMatchKey(record);
      if (!sourceRecordId || !qualificationKey) continue;

      const issueDate = parseTrainingDate(record.issueDate);
      const expiryDate = parseTrainingDate(record.expiryDate);
      const dateOfBirth = parseTrainingDate(record.dateOfBirth);
      const qualificationRaw = asStringOrNull(record.qualificationRaw) || qualificationKey;
      const canonicalProposed = asStringOrNull(record.qualificationCanonicalProposed) || qualificationRaw;
      const validationStatus = fallbackQualificationStatus(record.qualificationValidationStatus);

      await client.query(
        `
          INSERT INTO public.training_records (
            source_record_id,
            import_batch_id,
            person_id,
            qualification_id,
            employee_name_raw,
            qualification_raw,
            qualification_canonical_proposed,
            qualification_validation_status,
            qualification_group,
            relationship,
            card_number,
            card_type_or_status,
            approved,
            issue_date,
            issue_raw,
            expiry_date,
            expiry_raw,
            date_of_birth,
            date_of_birth_raw,
            comments,
            additional_comments,
            rebooked,
            cpcs_statuses,
            cpcs_status_meanings,
            cpcs_source_fill_colours,
            colour_formatting_ignored,
            colour_formatting_rule,
            source_sheet,
            source_row
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18, $19, $20,
            $21, $22, $23::TEXT[], $24::TEXT[], $25::TEXT[],
            $26, $27, $28, $29
          )
          ON CONFLICT (source_record_id) DO UPDATE
          SET import_batch_id = EXCLUDED.import_batch_id,
              person_id = EXCLUDED.person_id,
              qualification_id = EXCLUDED.qualification_id,
              employee_name_raw = EXCLUDED.employee_name_raw,
              qualification_raw = EXCLUDED.qualification_raw,
              qualification_canonical_proposed = EXCLUDED.qualification_canonical_proposed,
              qualification_validation_status = EXCLUDED.qualification_validation_status,
              qualification_group = EXCLUDED.qualification_group,
              relationship = EXCLUDED.relationship,
              card_number = EXCLUDED.card_number,
              card_type_or_status = EXCLUDED.card_type_or_status,
              approved = EXCLUDED.approved,
              issue_date = EXCLUDED.issue_date,
              issue_raw = EXCLUDED.issue_raw,
              expiry_date = EXCLUDED.expiry_date,
              expiry_raw = EXCLUDED.expiry_raw,
              date_of_birth = EXCLUDED.date_of_birth,
              date_of_birth_raw = EXCLUDED.date_of_birth_raw,
              comments = EXCLUDED.comments,
              additional_comments = EXCLUDED.additional_comments,
              rebooked = EXCLUDED.rebooked,
              cpcs_statuses = EXCLUDED.cpcs_statuses,
              cpcs_status_meanings = EXCLUDED.cpcs_status_meanings,
              cpcs_source_fill_colours = EXCLUDED.cpcs_source_fill_colours,
              colour_formatting_ignored = EXCLUDED.colour_formatting_ignored,
              colour_formatting_rule = EXCLUDED.colour_formatting_rule,
              source_sheet = EXCLUDED.source_sheet,
              source_row = EXCLUDED.source_row,
              updated_at = NOW()
        `,
        [
          sourceRecordId,
          importBatchId,
          personIdByKey.get(employeeKey) || null,
          qualificationIdByKey.get(qualificationKey) || null,
          asStringOrNull(record.employeeNameRaw),
          qualificationRaw,
          canonicalProposed,
          validationStatus,
          asStringOrNull(record.qualificationGroup),
          asStringOrNull(record.relationship),
          asStringOrNull(record.cardNumber),
          asStringOrNull(record.cardTypeOrStatus),
          asStringOrNull(record.approved),
          issueDate.date,
          issueDate.raw,
          expiryDate.date,
          expiryDate.raw,
          dateOfBirth.date,
          dateOfBirth.raw,
          asStringOrNull(record.comments),
          asStringOrNull(record.additionalComments),
          asStringOrNull(record.rebooked),
          ensureStringArray(record.cpcsStatusFromColourKey),
          ensureStringArray(record.cpcsStatusMeaning),
          ensureStringArray(record.cpcsSourceFillColours),
          asBoolean(record.colourFormattingIgnored),
          asStringOrNull(record.colourFormattingRule),
          record.sourceSheet?.trim() || 'Unknown',
          record.sourceRow || 0,
        ]
      );
    }

    await client.query('DELETE FROM public.training_workbook_notes WHERE import_batch_id = $1', [importBatchId]);
    const noteRows: Array<TrainingWorkbookNoteImport & { noteType: 'workbook_note' | 'likely_misc_note' }> = [
      ...workbookNotes.map((note) => ({ ...note, noteType: 'workbook_note' as const })),
      ...likelyMiscNotes.map((note) => ({ ...note, noteType: 'likely_misc_note' as const })),
    ];

    for (const note of noteRows) {
      const value = asStringOrNull(note.value);
      if (!value) continue;

      await client.query(
        `
          INSERT INTO public.training_workbook_notes (
            import_batch_id,
            note_type,
            source_sheet,
            cell_address,
            source_row,
            source_column,
            note_value,
            fill_colour,
            reason
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          importBatchId,
          note.noteType,
          note.sheet?.trim() || 'Unknown',
          note.cell?.trim() || 'Unknown',
          note.row || null,
          note.column || null,
          value,
          asStringOrNull(note.fill),
          asStringOrNull(note.reason),
        ]
      );
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Training data import dry run completed');
    } else {
      await client.query('COMMIT');
      console.log('Training data import completed');
    }

    console.log(`People: ${employees.length}`);
    console.log(`Qualifications: ${qualifications.length}`);
    console.log(`Records: ${records.length}`);
    console.log(`Notes: ${noteRows.length}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
