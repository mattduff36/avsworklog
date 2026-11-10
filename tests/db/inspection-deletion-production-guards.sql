-- Actual production account-merge function definitions supplied with the review.
-- Fixture prerequisites are empty; no production records are included.
CREATE OR REPLACE FUNCTION private.account_merge_actor_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$ BEGIN
      IF auth.uid()='ac56d65a-271e-4687-b463-5508088c9478'::uuid OR EXISTS (SELECT 1 FROM private.account_merge_retired WHERE source_id=auth.uid()) THEN
        RAISE EXCEPTION 'Retired account cannot write' USING ERRCODE='42501';
      END IF;
      RETURN NULL;
    END $function$;

CREATE OR REPLACE FUNCTION private.account_merge_assignment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
    DECLARE col text; val text; previous text; incoming jsonb; prior jsonb;
      authorized private.account_merge_runs%ROWTYPE; expected_profile jsonb; expected_changes jsonb; allowed_audit boolean;
    BEGIN
      incoming:=to_jsonb(NEW); prior:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
      IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='profiles' AND TG_OP='UPDATE'
        AND incoming->>'id'='ac56d65a-271e-4687-b463-5508088c9478' AND prior->>'deleted_at' IS NOT NULL
        AND (incoming->>'role_id' IS NOT NULL OR incoming->>'super_admin' IS DISTINCT FROM 'false') THEN
        RAISE EXCEPTION 'Retired profile authority cannot return' USING ERRCODE='42501';
      END IF;
      -- The real service-role profile transition records its own transaction for the nested native audit only.
      IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='profiles' AND TG_OP='UPDATE'
        AND incoming->>'id'='ac56d65a-271e-4687-b463-5508088c9478' AND auth.uid() IS NULL AND auth.role()='service_role' THEN
        SELECT * INTO authorized FROM private.account_merge_runs
          WHERE source_id='ac56d65a-271e-4687-b463-5508088c9478'::uuid AND phase='fence-pending-auth';
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
          AND (val='ac56d65a-271e-4687-b463-5508088c9478' OR EXISTS (SELECT 1 FROM private.account_merge_retired WHERE source_id::text=val)) THEN
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
      IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='external_documents' THEN FOR val IN SELECT jsonb_array_elements_text(COALESCE(NULLIF(incoming->'shared_with','null'::jsonb),'[]'::jsonb)) LOOP
        IF (val='ac56d65a-271e-4687-b463-5508088c9478' OR EXISTS (SELECT 1 FROM private.account_merge_retired WHERE source_id::text=val)) AND NOT COALESCE(NULLIF(prior->'shared_with','null'::jsonb),'[]'::jsonb) ? val THEN
          RAISE EXCEPTION 'Retired operational assignment denied' USING ERRCODE='42501';
        END IF;
      END LOOP; END IF;
IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='reminder_actions' THEN val:=incoming->'metadata'->>'submitted_by'; previous:=prior->'metadata'->>'submitted_by';
        IF pg_input_is_valid(val,'uuid') THEN val:=val::uuid::text; END IF;
        IF pg_input_is_valid(previous,'uuid') THEN previous:=previous::uuid::text; END IF;
        IF val IS NOT NULL AND val IS DISTINCT FROM previous AND (val='ac56d65a-271e-4687-b463-5508088c9478' OR EXISTS (SELECT 1 FROM private.account_merge_retired WHERE source_id::text=val)) THEN
          allowed_audit:=false;
          IF NOT COALESCE(allowed_audit,false) THEN
            RAISE EXCEPTION 'Retired operational assignment denied' USING ERRCODE='42501';
          END IF;
        END IF; END IF;
IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='audit_log' THEN val:=CASE WHEN incoming->>'table_name'='profiles' THEN incoming->>'record_id' END; previous:=CASE WHEN prior->>'table_name'='profiles' THEN prior->>'record_id' END;
        IF pg_input_is_valid(val,'uuid') THEN val:=val::uuid::text; END IF;
        IF pg_input_is_valid(previous,'uuid') THEN previous:=previous::uuid::text; END IF;
        IF val IS NOT NULL AND val IS DISTINCT FROM previous AND (val='ac56d65a-271e-4687-b463-5508088c9478' OR EXISTS (SELECT 1 FROM private.account_merge_retired WHERE source_id::text=val)) THEN
          allowed_audit:=false;
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
          END IF;
          IF NOT COALESCE(allowed_audit,false) THEN
            RAISE EXCEPTION 'Retired operational assignment denied' USING ERRCODE='42501';
          END IF;
        END IF; END IF;
      IF TG_TABLE_SCHEMA='storage' THEN
        IF ('ac56d65a-271e-4687-b463-5508088c9478'=ANY(string_to_array(NEW.name,'/')) OR EXISTS (SELECT 1 FROM private.account_merge_retired
          WHERE source_id::text=ANY(string_to_array(NEW.name,'/'))))
          AND (TG_OP='INSERT' OR NEW.name IS DISTINCT FROM OLD.name) THEN
          RAISE EXCEPTION 'Retired storage path denied' USING ERRCODE='42501';
        END IF;
      END IF;
      RETURN NEW;
    END $function$;
