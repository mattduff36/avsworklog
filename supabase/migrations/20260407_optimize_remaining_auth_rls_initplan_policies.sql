BEGIN;

DROP POLICY IF EXISTS "Admins can delete absence module settings" ON public.absence_module_settings;
CREATE POLICY "Admins can delete absence module settings" ON public.absence_module_settings FOR DELETE TO authenticated USING ((SELECT is_actor_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS "Admins can insert absence module settings" ON public.absence_module_settings;
CREATE POLICY "Admins can insert absence module settings" ON public.absence_module_settings FOR INSERT TO authenticated WITH CHECK ((SELECT is_actor_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS "Admins can update absence module settings" ON public.absence_module_settings;
CREATE POLICY "Admins can update absence module settings" ON public.absence_module_settings FOR UPDATE TO authenticated USING ((SELECT is_actor_admin((SELECT auth.uid())))) WITH CHECK ((SELECT is_actor_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Users can delete own account switch settings" ON public.account_switch_settings;
CREATE POLICY "Users can delete own account switch settings" ON public.account_switch_settings FOR DELETE TO authenticated USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can insert own account switch settings" ON public.account_switch_settings;
CREATE POLICY "Users can insert own account switch settings" ON public.account_switch_settings FOR INSERT TO authenticated WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can update own account switch settings" ON public.account_switch_settings;
CREATE POLICY "Users can update own account switch settings" ON public.account_switch_settings FOR UPDATE TO authenticated USING (profile_id = (SELECT auth.uid())) WITH CHECK (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can view own account switch settings" ON public.account_switch_settings;
CREATE POLICY "Users can view own account switch settings" ON public.account_switch_settings FOR SELECT TO authenticated USING (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can insert own error notification preferences" ON public.admin_error_notification_prefs;
CREATE POLICY "Admins can insert own error notification preferences" ON public.admin_error_notification_prefs FOR INSERT TO authenticated WITH CHECK ((user_id = (SELECT auth.uid())) AND ((SELECT effective_has_role_name('admin'::text)) OR (SELECT effective_is_super_admin()) OR (SELECT effective_is_manager_admin())));
DROP POLICY IF EXISTS "Admins can update own error notification preferences" ON public.admin_error_notification_prefs;
CREATE POLICY "Admins can update own error notification preferences" ON public.admin_error_notification_prefs FOR UPDATE TO authenticated USING ((user_id = (SELECT auth.uid())) AND ((SELECT effective_has_role_name('admin'::text)) OR (SELECT effective_is_super_admin()) OR (SELECT effective_is_manager_admin())));
DROP POLICY IF EXISTS "Admins can view own error notification preferences" ON public.admin_error_notification_prefs;
CREATE POLICY "Admins can view own error notification preferences" ON public.admin_error_notification_prefs FOR SELECT TO authenticated USING ((user_id = (SELECT auth.uid())) AND ((SELECT effective_has_role_name('admin'::text)) OR (SELECT effective_is_super_admin()) OR (SELECT effective_is_manager_admin())));
DROP POLICY IF EXISTS "Super admins can view all error notification preferences" ON public.admin_error_notification_prefs;
CREATE POLICY "Super admins can view all error notification preferences" ON public.admin_error_notification_prefs FOR SELECT TO authenticated USING ((SELECT effective_is_super_admin()));

DROP POLICY IF EXISTS "Managers can manage all inspection photos" ON public.inspection_photos;
CREATE POLICY "Managers can manage all inspection photos" ON public.inspection_photos FOR ALL TO authenticated USING ((SELECT effective_is_manager_admin()) AND NOT (SELECT effective_is_workshop_team())) WITH CHECK ((SELECT effective_is_manager_admin()) AND NOT (SELECT effective_is_workshop_team()));
DROP POLICY IF EXISTS "Supervisors can view all inspection photos" ON public.inspection_photos;
CREATE POLICY "Supervisors can view all inspection photos" ON public.inspection_photos FOR SELECT TO authenticated USING ((SELECT effective_is_supervisor()) AND ((SELECT effective_has_module_permission('inspections'::text)) OR (SELECT effective_has_module_permission('plant-inspections'::text)) OR (SELECT effective_has_module_permission('hgv-inspections'::text))));
DROP POLICY IF EXISTS "Users can manage own inspection photos" ON public.inspection_photos;
CREATE POLICY "Users can manage own inspection photos" ON public.inspection_photos FOR ALL TO authenticated USING ((EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_photos.inspection_id AND vi.user_id = (SELECT auth.uid()))) OR (EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_photos.inspection_id AND pi.user_id = (SELECT auth.uid()))) OR (EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_photos.inspection_id AND hi.user_id = (SELECT auth.uid()))));
DROP POLICY IF EXISTS "Workshop can view all inspection photos" ON public.inspection_photos;
CREATE POLICY "Workshop can view all inspection photos" ON public.inspection_photos FOR SELECT TO authenticated USING ((SELECT effective_is_workshop_team()) AND (((SELECT effective_has_module_permission('inspections'::text)) AND EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_photos.inspection_id)) OR ((SELECT effective_has_module_permission('plant-inspections'::text)) AND EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_photos.inspection_id)) OR ((SELECT effective_has_module_permission('hgv-inspections'::text)) AND EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_photos.inspection_id))));

DROP POLICY IF EXISTS "Managers can create recipients" ON public.message_recipients;
CREATE POLICY "Managers can create recipients" ON public.message_recipients FOR INSERT TO authenticated WITH CHECK ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Managers can update recipients" ON public.message_recipients;
CREATE POLICY "Managers can update recipients" ON public.message_recipients FOR UPDATE TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Managers can view all recipients" ON public.message_recipients;
CREATE POLICY "Managers can view all recipients" ON public.message_recipients FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Users can update their recipients" ON public.message_recipients;
CREATE POLICY "Users can update their recipients" ON public.message_recipients FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Super admins can update all notification preferences" ON public.notification_preferences;
CREATE POLICY "Super admins can update all notification preferences" ON public.notification_preferences FOR UPDATE TO authenticated USING ((SELECT effective_is_super_admin()));
DROP POLICY IF EXISTS "Super admins can view all notification preferences" ON public.notification_preferences;
CREATE POLICY "Super admins can view all notification preferences" ON public.notification_preferences FOR SELECT TO authenticated USING ((SELECT effective_is_super_admin()));
DROP POLICY IF EXISTS "Users can update own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can update own notification preferences" ON public.notification_preferences FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can view own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can view own notification preferences" ON public.notification_preferences FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "notification_preferences_insert" ON public.notification_preferences;
CREATE POLICY "notification_preferences_insert" ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK ((user_id = (SELECT auth.uid())) OR (SELECT effective_is_super_admin()) OR (SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Authenticated users can view active document types" ON public.project_document_types;
CREATE POLICY "Authenticated users can view active document types" ON public.project_document_types FOR SELECT TO authenticated USING ((is_active = true) OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
DROP POLICY IF EXISTS "Managers can create document types" ON public.project_document_types;
CREATE POLICY "Managers can create document types" ON public.project_document_types FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
DROP POLICY IF EXISTS "Managers can delete document types" ON public.project_document_types;
CREATE POLICY "Managers can delete document types" ON public.project_document_types FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
DROP POLICY IF EXISTS "Managers can update document types" ON public.project_document_types;
CREATE POLICY "Managers can update document types" ON public.project_document_types FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));

DROP POLICY IF EXISTS "Managers can create favourites" ON public.project_favourites;
CREATE POLICY "Managers can create favourites" ON public.project_favourites FOR INSERT TO authenticated WITH CHECK ((user_id = (SELECT auth.uid())) AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
DROP POLICY IF EXISTS "Users can delete own favourites" ON public.project_favourites;
CREATE POLICY "Users can delete own favourites" ON public.project_favourites FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can view own favourites" ON public.project_favourites;
CREATE POLICY "Users can view own favourites" ON public.project_favourites FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Employees can sign their assignments" ON public.rams_assignments;
CREATE POLICY "Employees can sign their assignments" ON public.rams_assignments FOR UPDATE TO authenticated USING (employee_id = (SELECT auth.uid())) WITH CHECK (employee_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Managers can create assignments" ON public.rams_assignments;
CREATE POLICY "Managers can create assignments" ON public.rams_assignments FOR INSERT TO authenticated WITH CHECK ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Managers can update assignments" ON public.rams_assignments;
CREATE POLICY "Managers can update assignments" ON public.rams_assignments FOR UPDATE TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Managers can view all assignments" ON public.rams_assignments;
CREATE POLICY "Managers can view all assignments" ON public.rams_assignments FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can delete any timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Managers can delete any timesheet entries" ON public.timesheet_entries FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
DROP POLICY IF EXISTS "Managers can insert any timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Managers can insert any timesheet entries" ON public.timesheet_entries FOR INSERT TO authenticated WITH CHECK ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Managers can update all entries" ON public.timesheet_entries;
CREATE POLICY "Managers can update all entries" ON public.timesheet_entries FOR UPDATE TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Managers can update all timesheet entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Managers can view all timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Managers can view all timesheet entries" ON public.timesheet_entries FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Users can delete own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can delete own timesheet entries" ON public.timesheet_entries FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM timesheets WHERE timesheets.id = timesheet_entries.timesheet_id AND timesheets.user_id = (SELECT auth.uid()) AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text, 'submitted'::text])));
DROP POLICY IF EXISTS "Users can insert own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can insert own timesheet entries" ON public.timesheet_entries FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM timesheets WHERE timesheets.id = timesheet_entries.timesheet_id AND timesheets.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Users can update own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can update own timesheet entries" ON public.timesheet_entries FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM timesheets WHERE timesheets.id = timesheet_entries.timesheet_id AND timesheets.user_id = (SELECT auth.uid()) AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text]))) WITH CHECK (EXISTS (SELECT 1 FROM timesheets WHERE timesheets.id = timesheet_entries.timesheet_id AND timesheets.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Users can view own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can view own timesheet entries" ON public.timesheet_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM timesheets WHERE timesheets.id = timesheet_entries.timesheet_id AND timesheets.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Managers and admins can delete any timesheet" ON public.timesheets;
CREATE POLICY "Managers and admins can delete any timesheet" ON public.timesheets FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
DROP POLICY IF EXISTS "Managers can create timesheets for any user" ON public.timesheets;
CREATE POLICY "Managers can create timesheets for any user" ON public.timesheets FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
DROP POLICY IF EXISTS "Managers can update all timesheets" ON public.timesheets;
DROP POLICY IF EXISTS "Managers can update timesheets" ON public.timesheets;
CREATE POLICY "Managers can update timesheets" ON public.timesheets FOR UPDATE TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Managers can view all timesheets" ON public.timesheets;
CREATE POLICY "Managers can view all timesheets" ON public.timesheets FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Users can create own timesheets" ON public.timesheets;
CREATE POLICY "Users can create own timesheets" ON public.timesheets FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can update own timesheets" ON public.timesheets;
CREATE POLICY "Users can update own timesheets" ON public.timesheets FOR UPDATE TO authenticated USING ((user_id = (SELECT auth.uid())) AND (status = ANY (ARRAY['draft'::text, 'rejected'::text]))) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can view own timesheets" ON public.timesheets;
CREATE POLICY "Users can view own timesheets" ON public.timesheets FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own page visits" ON public.user_page_visits;
CREATE POLICY "Users can delete own page visits" ON public.user_page_visits FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can insert own page visits" ON public.user_page_visits;
CREATE POLICY "Users can insert own page visits" ON public.user_page_visits FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can view own page visits" ON public.user_page_visits;
CREATE POLICY "Users can view own page visits" ON public.user_page_visits FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Managers and admins can create template versions" ON public.workshop_attachment_template_versions;
CREATE POLICY "Managers and admins can create template versions" ON public.workshop_attachment_template_versions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = (SELECT auth.uid()) AND r.is_manager_admin = true));
DROP POLICY IF EXISTS "Managers and admins can delete template versions" ON public.workshop_attachment_template_versions;
CREATE POLICY "Managers and admins can delete template versions" ON public.workshop_attachment_template_versions FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = (SELECT auth.uid()) AND r.is_manager_admin = true));
DROP POLICY IF EXISTS "Managers and admins can update template versions" ON public.workshop_attachment_template_versions;
CREATE POLICY "Managers and admins can update template versions" ON public.workshop_attachment_template_versions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = (SELECT auth.uid()) AND r.is_manager_admin = true)) WITH CHECK (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = (SELECT auth.uid()) AND r.is_manager_admin = true));

DROP POLICY IF EXISTS "Authors and managers can delete comments" ON public.workshop_task_comments;
CREATE POLICY "Authors and managers can delete comments" ON public.workshop_task_comments FOR DELETE TO authenticated USING ((author_id = (SELECT auth.uid())) OR (SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Authors and managers can update comments" ON public.workshop_task_comments;
CREATE POLICY "Authors and managers can update comments" ON public.workshop_task_comments FOR UPDATE TO authenticated USING ((author_id = (SELECT auth.uid())) OR (SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Workshop users can create own comments" ON public.workshop_task_comments;
CREATE POLICY "Workshop users can create own comments" ON public.workshop_task_comments FOR INSERT TO authenticated WITH CHECK ((author_id = (SELECT auth.uid())) AND EXISTS (SELECT 1 FROM actions a WHERE a.id = workshop_task_comments.task_id AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text]) AND (SELECT effective_has_module_permission('workshop-tasks'::text))));
DROP POLICY IF EXISTS "Workshop users can read comments for workshop tasks" ON public.workshop_task_comments;
CREATE POLICY "Workshop users can read comments for workshop tasks" ON public.workshop_task_comments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM actions a WHERE a.id = workshop_task_comments.task_id AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text]) AND (SELECT effective_has_module_permission('workshop-tasks'::text))));

DROP POLICY IF EXISTS "Managers can manage absence carryovers" ON public.absence_allowance_carryovers;
CREATE POLICY "Managers can manage absence carryovers" ON public.absence_allowance_carryovers FOR ALL TO authenticated USING ((SELECT effective_is_manager_admin())) WITH CHECK ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Managers can view all absence carryovers" ON public.absence_allowance_carryovers;
DROP POLICY IF EXISTS "Users can view own absence carryovers" ON public.absence_allowance_carryovers;
CREATE POLICY "Users can view own absence carryovers" ON public.absence_allowance_carryovers FOR SELECT TO authenticated USING ((SELECT auth.uid()) = profile_id);

DROP POLICY IF EXISTS "Admins can manage absence secondary exceptions" ON public.absence_secondary_permission_exceptions;
CREATE POLICY "Admins can manage absence secondary exceptions" ON public.absence_secondary_permission_exceptions FOR ALL TO authenticated USING ((SELECT is_actor_admin((SELECT auth.uid())))) WITH CHECK ((SELECT is_actor_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS "Users can view own absence secondary exceptions" ON public.absence_secondary_permission_exceptions;
CREATE POLICY "Users can view own absence secondary exceptions" ON public.absence_secondary_permission_exceptions FOR SELECT TO authenticated USING (((SELECT auth.uid()) = profile_id) OR (SELECT is_actor_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Absence viewers can read scoped archived absences" ON public.absences_archive;
CREATE POLICY "Absence viewers can read scoped archived absences" ON public.absences_archive FOR SELECT TO authenticated USING (can_actor_access_absence_request((SELECT auth.uid()), profile_id));
DROP POLICY IF EXISTS "Users can view own archived absences" ON public.absences_archive;
CREATE POLICY "Users can view own archived absences" ON public.absences_archive FOR SELECT TO authenticated USING ((SELECT auth.uid()) = profile_id);

DROP POLICY IF EXISTS "Users can insert own account switch audit events" ON public.account_switch_audit_events;
CREATE POLICY "Users can insert own account switch audit events" ON public.account_switch_audit_events FOR INSERT TO authenticated WITH CHECK (actor_profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can view own account switch audit events" ON public.account_switch_audit_events;
CREATE POLICY "Users can view own account switch audit events" ON public.account_switch_audit_events FOR SELECT TO authenticated USING ((profile_id = (SELECT auth.uid())) OR (actor_profile_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can view own account switch device credentials" ON public.account_switch_device_credentials;
CREATE POLICY "Users can view own account switch device credentials" ON public.account_switch_device_credentials FOR SELECT TO authenticated USING (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own account switch devices" ON public.account_switch_devices;
CREATE POLICY "Users can view own account switch devices" ON public.account_switch_devices FOR SELECT TO authenticated USING (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can create error report updates" ON public.error_report_updates;
CREATE POLICY "Admins can create error report updates" ON public.error_report_updates FOR INSERT TO authenticated WITH CHECK ((SELECT effective_has_module_permission('error-reports'::text)));
DROP POLICY IF EXISTS "Admins can view all error report updates" ON public.error_report_updates;
CREATE POLICY "Admins can view all error report updates" ON public.error_report_updates FOR SELECT TO authenticated USING ((SELECT effective_has_module_permission('error-reports'::text)));
DROP POLICY IF EXISTS "Users can view updates on own error reports" ON public.error_report_updates;
CREATE POLICY "Users can view updates on own error reports" ON public.error_report_updates FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM error_reports er WHERE er.id = error_report_updates.error_report_id AND er.created_by = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can update error reports" ON public.error_reports;
CREATE POLICY "Admins can update error reports" ON public.error_reports FOR UPDATE TO authenticated USING ((SELECT effective_has_module_permission('error-reports'::text)));
DROP POLICY IF EXISTS "Admins can view all error reports" ON public.error_reports;
CREATE POLICY "Admins can view all error reports" ON public.error_reports FOR SELECT TO authenticated USING ((SELECT effective_has_module_permission('error-reports'::text)));
DROP POLICY IF EXISTS "Authenticated users can create error reports" ON public.error_reports;
CREATE POLICY "Authenticated users can create error reports" ON public.error_reports FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can view own error reports" ON public.error_reports;
CREATE POLICY "Users can view own error reports" ON public.error_reports FOR SELECT TO authenticated USING (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can manage hgv_categories" ON public.hgv_categories;
CREATE POLICY "Admins can manage hgv_categories" ON public.hgv_categories FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role_id IN (SELECT roles.id FROM roles WHERE roles.name = 'admin'::text)));

DROP POLICY IF EXISTS "Admins can manage hgvs" ON public.hgvs;
CREATE POLICY "Admins can manage hgvs" ON public.hgvs FOR ALL TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "All users can view active hgvs" ON public.hgvs;
CREATE POLICY "All users can view active hgvs" ON public.hgvs FOR SELECT TO authenticated USING ((status = 'active'::text) OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role_id IN (SELECT roles.id FROM roles WHERE roles.is_manager_admin = true)));

DROP POLICY IF EXISTS "Admins can manage hierarchy change log" ON public.org_hierarchy_change_log;
CREATE POLICY "Admins can manage hierarchy change log" ON public.org_hierarchy_change_log FOR ALL TO authenticated USING ((SELECT is_actor_admin((SELECT auth.uid())))) WITH CHECK ((SELECT is_actor_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS "Managers can read hierarchy change log" ON public.org_hierarchy_change_log;
CREATE POLICY "Managers can read hierarchy change log" ON public.org_hierarchy_change_log FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Admins can manage team feature modes" ON public.org_team_feature_modes;
CREATE POLICY "Admins can manage team feature modes" ON public.org_team_feature_modes FOR ALL TO authenticated USING ((SELECT is_actor_admin((SELECT auth.uid())))) WITH CHECK ((SELECT is_actor_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS "Managers can read team feature modes" ON public.org_team_feature_modes;
CREATE POLICY "Managers can read team feature modes" ON public.org_team_feature_modes FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Admins can manage org teams" ON public.org_teams;
CREATE POLICY "Admins can manage org teams" ON public.org_teams FOR ALL TO authenticated USING ((SELECT is_actor_admin((SELECT auth.uid())))) WITH CHECK ((SELECT is_actor_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS "Managers can read org teams" ON public.org_teams;
CREATE POLICY "Managers can read org teams" ON public.org_teams FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Only admins can manage permission modules" ON public.permission_modules;
CREATE POLICY "Only admins can manage permission modules" ON public.permission_modules FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON r.id = p.role_id WHERE p.id = (SELECT auth.uid()) AND (r.is_super_admin = true OR r.name = 'admin'::text))) WITH CHECK (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON r.id = p.role_id WHERE p.id = (SELECT auth.uid()) AND (r.is_super_admin = true OR r.name = 'admin'::text)));

DROP POLICY IF EXISTS "Admins can manage reporting lines" ON public.profile_reporting_lines;
CREATE POLICY "Admins can manage reporting lines" ON public.profile_reporting_lines FOR ALL TO authenticated USING ((SELECT is_actor_admin((SELECT auth.uid())))) WITH CHECK ((SELECT is_actor_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS "Managers can read reporting lines" ON public.profile_reporting_lines;
CREATE POLICY "Managers can read reporting lines" ON public.profile_reporting_lines FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Admins can manage team memberships" ON public.profile_team_memberships;
CREATE POLICY "Admins can manage team memberships" ON public.profile_team_memberships FOR ALL TO authenticated USING ((SELECT is_actor_admin((SELECT auth.uid())))) WITH CHECK ((SELECT is_actor_admin((SELECT auth.uid()))));
DROP POLICY IF EXISTS "Managers can read team memberships" ON public.profile_team_memberships;
CREATE POLICY "Managers can read team memberships" ON public.profile_team_memberships FOR SELECT TO authenticated USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Only admins can manage team module permissions" ON public.team_module_permissions;
CREATE POLICY "Only admins can manage team module permissions" ON public.team_module_permissions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON r.id = p.role_id WHERE p.id = (SELECT auth.uid()) AND (r.is_super_admin = true OR r.name = 'admin'::text))) WITH CHECK (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON r.id = p.role_id WHERE p.id = (SELECT auth.uid()) AND (r.is_super_admin = true OR r.name = 'admin'::text)));

DROP POLICY IF EXISTS "Only admins can manage timesheet type exceptions" ON public.timesheet_type_exceptions;
CREATE POLICY "Only admins can manage timesheet type exceptions" ON public.timesheet_type_exceptions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON r.id = p.role_id WHERE p.id = (SELECT auth.uid()) AND (r.is_super_admin = true OR r.name = 'admin'::text))) WITH CHECK (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON r.id = p.role_id WHERE p.id = (SELECT auth.uid()) AND (r.is_super_admin = true OR r.name = 'admin'::text)));
DROP POLICY IF EXISTS "Users can read timesheet type exceptions" ON public.timesheet_type_exceptions;
CREATE POLICY "Users can read timesheet type exceptions" ON public.timesheet_type_exceptions FOR SELECT TO authenticated USING ((profile_id = (SELECT auth.uid())) OR (SELECT effective_has_module_permission('approvals'::text)) OR (SELECT effective_has_module_permission('admin-users'::text)) OR (SELECT effective_has_module_permission('admin-settings'::text)));

DROP POLICY IF EXISTS "Admins can manage vehicles" ON public.vans;
CREATE POLICY "Admins can manage vehicles" ON public.vans FOR ALL TO authenticated USING ((SELECT effective_is_manager_admin()));
DROP POLICY IF EXISTS "Users can add vans" ON public.vans;
CREATE POLICY "Users can add vans" ON public.vans FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Workshop users can create schema snapshots" ON public.workshop_attachment_schema_snapshots;
CREATE POLICY "Workshop users can create schema snapshots" ON public.workshop_attachment_schema_snapshots FOR INSERT TO authenticated WITH CHECK ((created_by = (SELECT auth.uid())) AND EXISTS (SELECT 1 FROM workshop_task_attachments wta JOIN actions a ON a.id = wta.task_id WHERE wta.id = workshop_attachment_schema_snapshots.attachment_id AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text]) AND (SELECT effective_has_module_permission('workshop-tasks'::text))));
DROP POLICY IF EXISTS "Workshop users can read schema snapshots" ON public.workshop_attachment_schema_snapshots;
CREATE POLICY "Workshop users can read schema snapshots" ON public.workshop_attachment_schema_snapshots FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM workshop_task_attachments wta JOIN actions a ON a.id = wta.task_id WHERE wta.id = workshop_attachment_schema_snapshots.attachment_id AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text]) AND (SELECT effective_has_module_permission('workshop-tasks'::text))));

DROP POLICY IF EXISTS "Managers and admins can manage template fields" ON public.workshop_attachment_template_fields;
CREATE POLICY "Managers and admins can manage template fields" ON public.workshop_attachment_template_fields FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = (SELECT auth.uid()) AND r.is_manager_admin = true)) WITH CHECK (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = (SELECT auth.uid()) AND r.is_manager_admin = true));

DROP POLICY IF EXISTS "Managers and admins can manage template sections" ON public.workshop_attachment_template_sections;
CREATE POLICY "Managers and admins can manage template sections" ON public.workshop_attachment_template_sections FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = (SELECT auth.uid()) AND r.is_manager_admin = true)) WITH CHECK (EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = (SELECT auth.uid()) AND r.is_manager_admin = true));

DO $$
DECLARE
  anchor_count integer;
BEGIN
  SELECT count(*)
  INTO anchor_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = ANY (ARRAY[
      'Users can view own account switch settings',
      'Super admins can view all error notification preferences',
      'Managers can update document types',
      'Managers can view all assignments',
      'Users can view own timesheet entries',
      'Users can view own timesheets',
      'Users can view own page visits',
      'Users can view own absence carryovers',
      'Users can view own error reports',
      'Managers can read org teams',
      'Managers and admins can manage template sections'
    ]);

  IF anchor_count <> 11 THEN
    RAISE EXCEPTION 'Expected 11 anchor policies after remaining RLS remediation, found %', anchor_count;
  END IF;
END $$;

COMMIT;
