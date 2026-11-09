// Both reviewed guards must be enabled with their exact definitions.
// The actor guard also runs on DELETE; it checks retirement and writes no rows.
export const UNEXPECTED_ERROR_LOG_TRIGGERS = `EXISTS (
          SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid=c.oid AND NOT t.tgisinternal
          GROUP BY t.tgrelid
          HAVING COUNT(*) <> 2 OR NOT BOOL_AND(
            t.tgenabled='O' AND (
              (pg_get_triggerdef(t.oid) = 'CREATE TRIGGER account_merge_actor BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON public.error_logs FOR EACH STATEMENT EXECUTE FUNCTION private.account_merge_actor_guard()'
                AND encode(sha256(convert_to(pg_get_functiondef(t.tgfoid), 'UTF8')), 'hex') =
                  '7fd1bc9c44da8af95e6a87dc00e1e0778c60d3edeef697c8864dbafdc6767bd8')
              OR
              (pg_get_triggerdef(t.oid) = 'CREATE TRIGGER account_merge_assignment BEFORE INSERT OR UPDATE ON public.error_logs FOR EACH ROW EXECUTE FUNCTION private.account_merge_assignment_guard(''user_id'')'
                AND encode(sha256(convert_to(pg_get_functiondef(t.tgfoid), 'UTF8')), 'hex') =
                  '8150adb7399f103c39d7ca7132bdc79a47b3df5d18bd1ef0534cf2c99537f8f2')
            )
          )
        )`;
