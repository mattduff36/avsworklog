import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

interface RouteParams {
  params: Promise<{ id: string }>;
}

type DynamicDbClient = Awaited<ReturnType<typeof createClient>>;

interface SchemaFieldInput {
  field_key?: string;
  label: string;
  help_text?: string | null;
  field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature';
  is_required?: boolean;
  sort_order?: number;
  options_json?: Record<string, unknown> | null;
  validation_json?: Record<string, unknown> | null;
}

interface SchemaSectionInput {
  section_key?: string;
  title: string;
  description?: string | null;
  sort_order?: number;
  fields: SchemaFieldInput[];
}

function toKey(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 110);

  if (normalized.length === 0) return fallback;
  return normalized;
}

interface LoadedSchemaField {
  field_key?: string;
  label?: string;
  help_text?: string | null;
  field_type?: SchemaFieldInput['field_type'];
  is_required?: boolean;
  sort_order?: number;
  options_json?: Record<string, unknown> | null;
  validation_json?: Record<string, unknown> | null;
}

interface LoadedSchemaSection {
  id: string;
  section_key?: string;
  title?: string;
  description?: string | null;
  sort_order?: number;
  fields: LoadedSchemaField[];
}

async function loadTemplateSchema(db: DynamicDbClient, templateId: string) {
  const { data: versions, error: versionsError } = await db
    .from('workshop_attachment_template_versions')
    .select('*')
    .eq('template_id', templateId)
    .order('version_number', { ascending: false });

  if (versionsError) throw versionsError;
  if (!versions || versions.length === 0) return { version: null, sections: [] };

  const publishedVersion = versions.find((version: { status: string }) => version.status === 'published');
  const activeVersion = publishedVersion || versions[0];

  const { data: sections, error: sectionsError } = await db
    .from('workshop_attachment_template_sections')
    .select('*')
    .eq('version_id', activeVersion.id)
    .order('sort_order', { ascending: true });

  if (sectionsError) throw sectionsError;

  const sectionIds = (sections || []).map((section: { id: string }) => section.id);
  let fields: Array<Record<string, unknown>> = [];
  if (sectionIds.length > 0) {
    const { data: fieldRows, error: fieldsError } = await db
      .from('workshop_attachment_template_fields')
      .select('*')
      .in('section_id', sectionIds)
      .order('sort_order', { ascending: true });

    if (fieldsError) throw fieldsError;
    fields = fieldRows || [];
  }

  const typedSections = (sections || []) as Array<Record<string, unknown> & { id: string }>;
  const typedFields = fields as Array<Record<string, unknown> & { section_id?: string }>;

  return {
    version: activeVersion,
    sections: typedSections.map((section) => ({
      id: section.id,
      section_key: typeof section.section_key === 'string' ? section.section_key : undefined,
      title: typeof section.title === 'string' ? section.title : undefined,
      description: typeof section.description === 'string' ? section.description : null,
      sort_order: Number(section.sort_order || 0),
      fields: typedFields
        .filter((field) => field.section_id === section.id)
        .map((field) => ({
          field_key: typeof field.field_key === 'string' ? field.field_key : undefined,
          label: typeof field.label === 'string' ? field.label : undefined,
          help_text: typeof field.help_text === 'string' ? field.help_text : null,
          field_type: field.field_type as SchemaFieldInput['field_type'] | undefined,
          is_required: Boolean(field.is_required),
          sort_order: Number(field.sort_order || 0),
          options_json: (field.options_json as Record<string, unknown> | null) || null,
          validation_json: (field.validation_json as Record<string, unknown> | null) || null,
        })),
    })) as LoadedSchemaSection[],
  };
}

/**
 * GET /api/workshop-tasks/attachments/templates/[id]/schema
 * Returns active schema version with sections and fields.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: templateId } = await params;
    const supabase = await createClient();
    const db = supabase;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: template, error: templateError } = await db
      .from('workshop_attachment_templates')
      .select('id, name')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const schema = await loadTemplateSchema(db, templateId);

    return NextResponse.json({
      success: true,
      template,
      version: schema.version,
      sections: schema.sections,
    });
  } catch (error) {
    const { id: templateId } = await params;
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/templates/[id]/schema',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/templates/${templateId}/schema`,
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/workshop-tasks/attachments/templates/[id]/schema
 * Creates a new template schema version.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: templateId } = await params;
    const supabase = await createClient();
    const db = supabase;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageWorkshopTasks = await canEffectiveRoleAccessModule('workshop-tasks');
    if (!canManageWorkshopTasks) {
      return NextResponse.json(
        { error: 'Forbidden: Workshop Tasks access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const cloneFromTemplateId = typeof body.clone_from_template_id === 'string' ? body.clone_from_template_id : null;
    const requestedStatus: 'draft' | 'published' | 'archived' =
      body.status === 'draft' || body.status === 'archived' ? body.status : 'published';

    const { data: template, error: templateError } = await db
      .from('workshop_attachment_templates')
      .select('id, name')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    let sectionsInput: SchemaSectionInput[] = [];

    if (cloneFromTemplateId) {
      const sourceSchema = await loadTemplateSchema(db, cloneFromTemplateId);

      if (sourceSchema.sections.length > 0) {
        sectionsInput = sourceSchema.sections.map((section, sectionIndex) => ({
          section_key: typeof section.section_key === 'string' ? section.section_key : `section_${sectionIndex + 1}`,
          title: typeof section.title === 'string' ? section.title : `Section ${sectionIndex + 1}`,
          description: typeof section.description === 'string' ? section.description : null,
          sort_order: Number(section.sort_order || sectionIndex + 1),
          fields: Array.isArray(section.fields)
            ? (section.fields as Array<Record<string, unknown>>).map((field, fieldIndex) => ({
                field_key: typeof field.field_key === 'string' ? field.field_key : `field_${fieldIndex + 1}`,
                label: typeof field.label === 'string' ? field.label : `Field ${fieldIndex + 1}`,
                help_text: typeof field.help_text === 'string' ? field.help_text : null,
                field_type: (field.field_type as SchemaFieldInput['field_type']) || 'text',
                is_required: Boolean(field.is_required),
                sort_order: Number(field.sort_order || fieldIndex + 1),
                options_json: (field.options_json as Record<string, unknown> | null) || null,
                validation_json: (field.validation_json as Record<string, unknown> | null) || null,
              }))
            : [],
        }));
      } else {
        return NextResponse.json(
          { error: 'Selected template has no schema sections to clone' },
          { status: 400 }
        );
      }
    } else if (Array.isArray(body.sections)) {
      sectionsInput = body.sections as SchemaSectionInput[];
    }

    if (!Array.isArray(sectionsInput) || sectionsInput.length === 0) {
      return NextResponse.json(
        { error: 'At least one section is required to create a schema version' },
        { status: 400 }
      );
    }

    if (sectionsInput.some((section) => !Array.isArray(section.fields) || section.fields.length === 0)) {
      return NextResponse.json(
        { error: 'Each section must contain at least one field' },
        { status: 400 }
      );
    }

    const invalidSectionIndex = sectionsInput.findIndex((section) => !(section.title || '').trim());
    if (invalidSectionIndex !== -1) {
      return NextResponse.json(
        { error: `Section ${invalidSectionIndex + 1} title is required` },
        { status: 400 }
      );
    }

    const { data: maxVersionRows, error: maxVersionError } = await db
      .from('workshop_attachment_template_versions')
      .select('version_number')
      .eq('template_id', templateId)
      .order('version_number', { ascending: false })
      .limit(1);

    if (maxVersionError) {
      throw maxVersionError;
    }

    const currentMaxVersion = maxVersionRows && maxVersionRows.length > 0
      ? Number((maxVersionRows[0] as { version_number: number }).version_number)
      : 0;
    const nextVersion = currentMaxVersion + 1;

    const shouldPublish = requestedStatus === 'published';
    const initialVersionStatus: 'draft' | 'published' | 'archived' = shouldPublish
      ? 'draft'
      : requestedStatus;

    const { data: createdVersion, error: versionError } = await db
      .from('workshop_attachment_template_versions')
      .insert({
        template_id: templateId,
        version_number: nextVersion,
        status: initialVersionStatus,
        created_by: user.id,
      } as never)
      .select('*')
      .single();

    if (versionError || !createdVersion) {
      throw versionError || new Error('Failed to create schema version');
    }

    for (let sectionIndex = 0; sectionIndex < sectionsInput.length; sectionIndex += 1) {
      const section = sectionsInput[sectionIndex];
      const sectionKey = toKey(section.section_key || section.title || `section_${sectionIndex + 1}`, `section_${sectionIndex + 1}`);
      const sectionTitle = (section.title || '').trim();

      const { data: createdSection, error: sectionError } = await db
        .from('workshop_attachment_template_sections')
        .insert({
          version_id: createdVersion.id,
          section_key: sectionKey,
          title: sectionTitle,
          description: section.description?.trim() || null,
          sort_order: section.sort_order ?? sectionIndex + 1,
        } as never)
        .select('*')
        .single();

      if (sectionError || !createdSection) {
        throw sectionError || new Error('Failed to create section');
      }

      const usedFieldKeys = new Set<string>();
      const fieldRows = section.fields.map((field, fieldIndex) => {
        const fallbackKey = `field_${fieldIndex + 1}`;
        let fieldKey = toKey(field.field_key || field.label || fallbackKey, fallbackKey);
        while (usedFieldKeys.has(fieldKey)) fieldKey = `${fieldKey}_${fieldIndex + 1}`;
        usedFieldKeys.add(fieldKey);

        return {
          section_id: createdSection.id,
          field_key: fieldKey,
          label: (field.label || '').trim() || `Field ${fieldIndex + 1}`,
          help_text: field.help_text?.trim() || null,
          field_type: field.field_type || 'text',
          is_required: Boolean(field.is_required),
          sort_order: field.sort_order ?? fieldIndex + 1,
          options_json: field.options_json || null,
          validation_json: field.validation_json || null,
        };
      });

      const { error: fieldsError } = await db
        .from('workshop_attachment_template_fields')
        .insert(fieldRows as never);

      if (fieldsError) {
        throw fieldsError;
      }
    }

    if (shouldPublish) {
      // Publish the new version first so we never end up with zero published versions.
      const { error: publishVersionError } = await db
        .from('workshop_attachment_template_versions')
        .update({ status: 'published' } as never)
        .eq('id', createdVersion.id);

      if (publishVersionError) {
        throw publishVersionError;
      }

      const { error: archivePublishedError } = await db
        .from('workshop_attachment_template_versions')
        .update({ status: 'archived' } as never)
        .eq('template_id', templateId)
        .eq('status', 'published')
        .neq('id', createdVersion.id);

      if (archivePublishedError) {
        throw archivePublishedError;
      }
    }

    const schema = await loadTemplateSchema(db, templateId);
    return NextResponse.json({
      success: true,
      version: schema.version,
      sections: schema.sections,
    }, { status: 201 });
  } catch (error) {
    const { id: templateId } = await params;
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/templates/[id]/schema',
      additionalData: {
        endpoint: `POST /api/workshop-tasks/attachments/templates/${templateId}/schema`,
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
