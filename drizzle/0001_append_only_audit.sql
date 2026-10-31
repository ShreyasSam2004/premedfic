-- Append-only enforcement for the audit trail and workflow history.
CREATE OR REPLACE FUNCTION premedfix_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION premedfix_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_transitions_append_only BEFORE UPDATE OR DELETE ON workflow_transitions
  FOR EACH ROW EXECUTE FUNCTION premedfix_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER rule_evaluations_append_only BEFORE UPDATE OR DELETE ON rule_evaluations
  FOR EACH ROW EXECUTE FUNCTION premedfix_forbid_mutation();
