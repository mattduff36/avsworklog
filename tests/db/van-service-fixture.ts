export interface FixtureDb {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export const ID = {
  vanCategory: '10000000-0000-4000-8000-000000000001',
  hgvCategory: '10000000-0000-4000-8000-000000000002',
  plantCategory: '10000000-0000-4000-8000-000000000003',
  vanWorkshop: '10000000-0000-4000-8000-000000000011',
  hgvWorkshop: '10000000-0000-4000-8000-000000000012',
  plantWorkshop: '10000000-0000-4000-8000-000000000013',
  vanTemplate: '10000000-0000-4000-8000-000000000021',
  hgvTemplateA: '10000000-0000-4000-8000-000000000022',
  hgvTemplateB: '10000000-0000-4000-8000-000000000023',
  plantTemplate: '10000000-0000-4000-8000-000000000024',
  otherTemplate: '10000000-0000-4000-8000-000000000025',
  vanVersion: '10000000-0000-4000-8000-000000000031',
  hgvVersionA: '10000000-0000-4000-8000-000000000032',
  fullStep: '10000000-0000-4000-8000-000000000041',
  hgvStep1: '10000000-0000-4000-8000-000000000042',
  hgvStep2: '10000000-0000-4000-8000-000000000043',
  plantStep: '10000000-0000-4000-8000-000000000044',
  fullLink: '10000000-0000-4000-8000-000000000051',
  hgvLink: '10000000-0000-4000-8000-000000000052',
  vmAmbiguous: '10000000-0000-4000-8000-000000000061',
  vmNull: '10000000-0000-4000-8000-000000000062',
  vmExplicit: '10000000-0000-4000-8000-000000000063',
  vmHgv: '10000000-0000-4000-8000-000000000064',
  vanAsset: '10000000-0000-4000-8000-000000000071',
  vanAssetNull: '10000000-0000-4000-8000-000000000072',
  vanAssetExplicit: '10000000-0000-4000-8000-000000000073',
  hgvAsset: '10000000-0000-4000-8000-000000000074',
  attachNull: '10000000-0000-4000-8000-000000000081',
  attachNamed: '10000000-0000-4000-8000-000000000082',
  attachInconsistent: '10000000-0000-4000-8000-000000000083',
  snapNamed: '10000000-0000-4000-8000-000000000084',
  snapInconsistent: '10000000-0000-4000-8000-000000000085',
  responseNamed: '10000000-0000-4000-8000-000000000086',
  eventAmbiguous: '10000000-0000-4000-8000-000000000091',
  taskOpen: '10000000-0000-4000-8000-0000000000a1',
  taskDone: '10000000-0000-4000-8000-0000000000a2',
  subcat: '10000000-0000-4000-8000-0000000000b1',
  engineSection: '10000000-0000-4000-8000-0000000000c1',
  drivetrainSection: '10000000-0000-4000-8000-0000000000c2',
  bodySection: '10000000-0000-4000-8000-0000000000c3',
  equipmentSection: '10000000-0000-4000-8000-0000000000c4',
  signoffSection: '10000000-0000-4000-8000-0000000000c5',
  oilField: '10000000-0000-4000-8000-0000000000d1',
} as const;

export const SOURCE_FIELDS: Array<{ key: string; section: string; required?: boolean }> = [
  { key: 'engine_oil_and_filter', section: ID.engineSection },
  { key: 'change_fuel_filter', section: ID.engineSection },
  { key: 'change_air_filter', section: ID.engineSection },
  { key: 'change_pollan_filter', section: ID.engineSection },
  { key: 'condition_of_all_belts', section: ID.engineSection },
  { key: 'engine_transmission_mountings', section: ID.engineSection },
  { key: 'oil_leaks', section: ID.engineSection },
  { key: 'fuel_tanks_and_systems', section: ID.engineSection },
  { key: 'cooling_systems', section: ID.engineSection },
  { key: 'change_spark_plugs', section: ID.engineSection },
  { key: 'gearbox_an_filter_change', section: ID.drivetrainSection },
  { key: 'check_brakes_front_and_rear', section: ID.drivetrainSection },
  { key: 'check_all_suspension_components_for_any_wear', section: ID.drivetrainSection },
  { key: 'check_seering_for_any_wear', section: ID.drivetrainSection },
  { key: 'check_tyres', section: ID.bodySection, required: true },
  { key: 'road_wheels_and_hubs', section: ID.bodySection },
  { key: 'check_all_lights_and_horn', section: ID.bodySection },
  { key: 'check_washers_and_wipers', section: ID.bodySection },
  { key: 'check_interior_and_exterior_including_mirrors', section: ID.bodySection },
  { key: 'check_for_any_fault_codes', section: ID.bodySection },
  { key: 'exhaust_systems', section: ID.bodySection },
  { key: 'check_first_aid_kit_dates', section: ID.equipmentSection },
  { key: 'check_fire_extinguisher', section: ID.equipmentSection, required: true },
  { key: 'vehicle_trailer_coupling', section: ID.equipmentSection },
  { key: 'technician_signature', section: ID.signoffSection },
];

export async function createFixtureSchema(pg: FixtureDb): Promise<void> {
  await pg.exec(`
    CREATE TYPE public.workshop_attachment_template_version_status AS ENUM ('draft', 'published', 'archived');
    CREATE TYPE public.workshop_attachment_field_type AS ENUM (
      'marking_code', 'text', 'long_text', 'number', 'date', 'yes_no', 'signature'
    );
    CREATE TABLE public.workshop_attachment_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(200) NOT NULL,
      description text,
      is_active boolean DEFAULT true,
      applies_to text[],
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz
    );
    CREATE TABLE public.workshop_attachment_template_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id uuid NOT NULL REFERENCES public.workshop_attachment_templates(id),
      version_number integer NOT NULL,
      status public.workshop_attachment_template_version_status NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz
    );
    CREATE TABLE public.workshop_attachment_template_sections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version_id uuid NOT NULL REFERENCES public.workshop_attachment_template_versions(id),
      section_key varchar(120) NOT NULL,
      title varchar(200) NOT NULL,
      description text,
      sort_order integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.workshop_attachment_template_fields (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      section_id uuid NOT NULL REFERENCES public.workshop_attachment_template_sections(id),
      field_key varchar(120) NOT NULL,
      label varchar(500) NOT NULL,
      help_text text,
      field_type public.workshop_attachment_field_type NOT NULL,
      is_required boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      options_json jsonb,
      validation_json jsonb
    );
    CREATE TABLE public.workshop_task_attachments (
      id uuid PRIMARY KEY,
      task_id uuid NOT NULL,
      template_id uuid NOT NULL REFERENCES public.workshop_attachment_templates(id),
      status text NOT NULL DEFAULT 'pending',
      template_name_snapshot text
    );
    CREATE TABLE public.workshop_attachment_schema_snapshots (
      id uuid PRIMARY KEY,
      attachment_id uuid NOT NULL UNIQUE REFERENCES public.workshop_task_attachments(id),
      template_version_id uuid,
      snapshot_json jsonb NOT NULL
    );
    CREATE TABLE public.workshop_attachment_field_responses (
      id uuid PRIMARY KEY,
      attachment_id uuid NOT NULL REFERENCES public.workshop_task_attachments(id),
      section_key varchar(120) NOT NULL,
      field_key varchar(120) NOT NULL,
      response_value text,
      response_json jsonb
    );
    CREATE TABLE public.workshop_task_categories (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      applies_to text NOT NULL
    );
    CREATE TABLE public.workshop_task_subcategories (
      id uuid PRIMARY KEY,
      category_id uuid NOT NULL,
      name text NOT NULL
    );
    CREATE TABLE public.actions (
      id uuid PRIMARY KEY,
      status text,
      workshop_category_id uuid,
      workshop_subcategory_id uuid,
      van_id uuid,
      hgv_id uuid,
      plant_id uuid
    );
    CREATE TABLE public.maintenance_categories (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      description text,
      config_key text,
      workshop_category_id uuid,
      period_value integer,
      period_unit text,
      applies_to text[],
      is_active boolean DEFAULT true
    );
    CREATE TABLE public.workshop_category_attachment_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id uuid NOT NULL,
      template_id uuid NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      compact_label text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (category_id, template_id)
    );
    CREATE TABLE public.service_rotation_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      maintenance_category_id uuid NOT NULL,
      position integer NOT NULL,
      attachment_template_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (maintenance_category_id, position)
    );
    CREATE TABLE public.vehicle_maintenance (
      id uuid PRIMARY KEY,
      van_id uuid,
      hgv_id uuid,
      plant_id uuid,
      current_mileage integer,
      last_service_mileage integer,
      next_service_mileage integer,
      current_hours integer,
      last_service_hours integer,
      next_service_hours integer,
      last_service_template_id uuid,
      next_service_template_id uuid,
      next_service_rotation_step_id uuid,
      notes text
    );
    CREATE TABLE public.asset_service_events (
      id uuid PRIMARY KEY,
      van_id uuid,
      hgv_id uuid,
      plant_id uuid,
      maintenance_category_id uuid NOT NULL,
      completed_template_id uuid,
      completed_template_name text,
      next_template_id uuid,
      next_template_name text,
      notes text,
      completion_meter integer,
      resulting_due_meter integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function seedReady(pg: FixtureDb, options?: {
  omitKey?: string;
  periodValue?: number | null;
  extraRotation?: boolean;
  conflictingBasic?: boolean;
  skipVanTemplate?: boolean;
}): Promise<void> {
  const period = options?.periodValue === undefined ? 'NULL' : options.periodValue === null ? 'NULL' : String(options.periodValue);
  await pg.exec(`
    INSERT INTO public.workshop_task_categories (id, name, applies_to) VALUES
      ('${ID.vanWorkshop}', 'Service (Van)', 'van'),
      ('${ID.hgvWorkshop}', 'Service (HGV)', 'hgv'),
      ('${ID.plantWorkshop}', 'Service (Plant)', 'plant');
    INSERT INTO public.workshop_task_subcategories (id, category_id, name) VALUES
      ('${ID.subcat}', '${ID.vanWorkshop}', 'Interim service');
    INSERT INTO public.maintenance_categories (
      id, name, description, config_key, workshop_category_id, period_value, period_unit, applies_to, is_active
    ) VALUES
      ('${ID.vanCategory}', 'Service', 'Van service due', 'service_van', '${ID.vanWorkshop}', ${period}, 'miles', ARRAY['van'], true),
      ('${ID.hgvCategory}', 'Service', 'HGV service due', 'service_hgv', '${ID.hgvWorkshop}', 25000, 'km', ARRAY['hgv'], true),
      ('${ID.plantCategory}', 'Service', 'Plant service due', 'service_plant', '${ID.plantWorkshop}', 250, 'hours', ARRAY['plant'], true);
    INSERT INTO public.workshop_attachment_templates (id, name, description, is_active, applies_to) VALUES
      ('${ID.hgvTemplateA}', 'Basic Service A (HGV)', 'hgv a', true, ARRAY['hgv']),
      ('${ID.hgvTemplateB}', 'Full Service (HGV)', 'hgv full', true, ARRAY['hgv']),
      ('${ID.plantTemplate}', 'Plant Service / Inspection', 'plant', true, ARRAY['plant']),
      ('${ID.otherTemplate}', 'Other Van Choice', 'explicit', true, ARRAY['van']);
  `);

  if (!options?.skipVanTemplate) {
    await pg.exec(`
      INSERT INTO public.workshop_attachment_templates (id, name, description, is_active, applies_to)
      VALUES ('${ID.vanTemplate}', 'Van Service', 'Historic van checklist', true, ARRAY['van']);
      INSERT INTO public.workshop_attachment_template_versions (id, template_id, version_number, status)
      VALUES
        ('${ID.vanVersion}', '${ID.vanTemplate}', 3, 'published'),
        ('${ID.hgvVersionA}', '${ID.hgvTemplateA}', 1, 'published');
      INSERT INTO public.workshop_attachment_template_sections (id, version_id, section_key, title, description, sort_order) VALUES
        ('${ID.engineSection}', '${ID.vanVersion}', 'engine_service', 'Engine and Fluids', 'Engine servicing, fluid levels, and filter changes.', 1),
        ('${ID.drivetrainSection}', '${ID.vanVersion}', 'drivetrain_brakes', 'Drivetrain and Brakes', 'Transmission, braking, and steering checks.', 2),
        ('${ID.bodySection}', '${ID.vanVersion}', 'electrical_body', 'Electrical and Body', 'Lighting, electrical, and bodywork checks.', 3),
        ('${ID.equipmentSection}', '${ID.vanVersion}', 'fitted_equipment', 'Fitted equipment', 'Fitted equipment when present.', 4),
        ('${ID.signoffSection}', '${ID.vanVersion}', 'documentation_signoff', 'Documentation and Sign-Off', 'Do not copy this sign-off section.', 5);
    `);

    const fields = SOURCE_FIELDS.filter((field) => field.key !== options?.omitKey);
    const values = fields.map((field, index) => {
      const id = field.key === 'engine_oil_and_filter' ? ID.oilField : `10000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`;
      const fieldType = field.key === 'technician_signature' ? 'signature' : 'marking_code';
      const required = field.required ? 'true' : 'false';
      return `(
        '${id}', '${field.section}', '${field.key}', 'Label ${field.key}', 'Help for ${field.key}',
        '${fieldType}', ${required}, ${index + 1},
        '{"code":"${field.key}"}'::jsonb, '{"require_note_for":["attention"]}'::jsonb
      )`;
    }).join(',');
    await pg.exec(`
      INSERT INTO public.workshop_attachment_template_fields (
        id, section_id, field_key, label, help_text, field_type, is_required, sort_order, options_json, validation_json
      ) VALUES ${values};
    `);

    const rotationValues = options?.extraRotation
      ? `('${ID.fullStep}', '${ID.vanCategory}', 1, '${ID.vanTemplate}'),
         ('${ID.plantStep}', '${ID.vanCategory}', 2, '${ID.otherTemplate}'),
         ('${ID.hgvStep1}', '${ID.hgvCategory}', 1, '${ID.hgvTemplateA}'),
         ('${ID.hgvStep2}', '${ID.hgvCategory}', 2, '${ID.hgvTemplateB}')`
      : `('${ID.fullStep}', '${ID.vanCategory}', 1, '${ID.vanTemplate}'),
         ('${ID.hgvStep1}', '${ID.hgvCategory}', 1, '${ID.hgvTemplateA}'),
         ('${ID.hgvStep2}', '${ID.hgvCategory}', 2, '${ID.hgvTemplateB}'),
         ('${ID.plantStep}', '${ID.plantCategory}', 1, '${ID.plantTemplate}')`;

    await pg.exec(`
      INSERT INTO public.service_rotation_steps (id, maintenance_category_id, position, attachment_template_id)
      VALUES ${rotationValues};
      INSERT INTO public.workshop_category_attachment_templates (id, category_id, template_id, sort_order, compact_label)
      VALUES
        ('${ID.fullLink}', '${ID.vanWorkshop}', '${ID.vanTemplate}', 1, NULL),
        ('${ID.hgvLink}', '${ID.hgvWorkshop}', '${ID.hgvTemplateA}', 1, 'Basic A');
      INSERT INTO public.vehicle_maintenance (
        id, van_id, hgv_id, plant_id, current_mileage, last_service_mileage, next_service_mileage,
        last_service_template_id, next_service_template_id, next_service_rotation_step_id, notes
      ) VALUES
        ('${ID.vmAmbiguous}', '${ID.vanAsset}', NULL, NULL, 1000, 9000, 19000,
         '${ID.vanTemplate}', '${ID.vanTemplate}', '${ID.fullStep}', 'fleet note without a person'),
        ('${ID.vmNull}', '${ID.vanAssetNull}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('${ID.vmExplicit}', '${ID.vanAssetExplicit}', NULL, NULL, 50, 60, 70,
         '${ID.otherTemplate}', '${ID.otherTemplate}', NULL, NULL),
        ('${ID.vmHgv}', NULL, '${ID.hgvAsset}', NULL, 5, 15, 25,
         '${ID.hgvTemplateA}', '${ID.hgvTemplateA}', '${ID.hgvStep1}', 'hgv stays');
      INSERT INTO public.workshop_task_attachments (id, task_id, template_id, status, template_name_snapshot) VALUES
        ('${ID.attachNull}', '${ID.taskOpen}', '${ID.vanTemplate}', 'pending', NULL),
        ('${ID.attachNamed}', '${ID.taskOpen}', '${ID.vanTemplate}', 'completed', 'Historic Van Service Label'),
        ('${ID.attachInconsistent}', '${ID.taskOpen}', '${ID.vanTemplate}', 'pending', 'Van Service');
      INSERT INTO public.workshop_attachment_schema_snapshots (id, attachment_id, template_version_id, snapshot_json) VALUES
        ('${ID.snapNamed}', '${ID.attachNamed}', '${ID.vanVersion}', '{"keep":"historical-van"}'::jsonb),
        ('${ID.snapInconsistent}', '${ID.attachInconsistent}', '${ID.hgvVersionA}', '{"keep":"wrong-version"}'::jsonb);
      INSERT INTO public.workshop_attachment_field_responses (
        id, attachment_id, section_key, field_key, response_value, response_json
      ) VALUES (
        '${ID.responseNamed}', '${ID.attachNamed}', 'engine_service', 'engine_oil_and_filter', 'HISTORIC_OK', '{"frozen":true}'::jsonb
      );
      INSERT INTO public.asset_service_events (
        id, van_id, maintenance_category_id, completed_template_id, completed_template_name,
        next_template_id, next_template_name, notes, completion_meter, resulting_due_meter
      ) VALUES (
        '${ID.eventAmbiguous}', '${ID.vanAsset}', '${ID.vanCategory}', '${ID.vanTemplate}', 'Van Service',
        '${ID.vanTemplate}', 'Van Service', 'latest ambiguous note', 9000, 19000
      );
      INSERT INTO public.actions (id, status, workshop_category_id, workshop_subcategory_id, van_id) VALUES
        ('${ID.taskOpen}', 'pending', '${ID.vanWorkshop}', '${ID.subcat}', '${ID.vanAsset}'),
        ('${ID.taskDone}', 'completed', '${ID.vanWorkshop}', '${ID.subcat}', '${ID.vanAsset}');
    `);
  }

  if (options?.conflictingBasic) {
    await pg.exec(`
      INSERT INTO public.workshop_attachment_templates (id, name, description, is_active, applies_to)
      VALUES ('20000000-0000-4000-8000-000000000001', 'Basic Service A (Van)', 'wrong', true, ARRAY['van']);
      INSERT INTO public.workshop_attachment_template_versions (id, template_id, version_number, status)
      VALUES ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 1, 'published');
      INSERT INTO public.workshop_attachment_template_sections (id, version_id, section_key, title, description, sort_order)
      VALUES ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'wrong', 'Wrong', 'Wrong', 1);
      INSERT INTO public.workshop_attachment_template_fields (
        id, section_id, field_key, label, field_type, is_required, sort_order
      ) VALUES (
        '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003',
        'wrong_field', 'Wrong', 'marking_code', false, 1
      );
    `);
  }
}

