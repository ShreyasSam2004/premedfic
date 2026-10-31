ALTER TYPE "public"."case_state" ADD VALUE 'FINALIZATION_VERIFICATION' BEFORE 'TRIAGED';--> statement-breakpoint
ALTER TYPE "public"."case_state" ADD VALUE 'ALREADY_RESOLVED';--> statement-breakpoint
CREATE TABLE "finalization_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"permit_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"method" text NOT NULL,
	"reported_status" text,
	"reported_final_at" date,
	"source_reference" text NOT NULL,
	"source_status" text,
	"source_final_at" date,
	"note" text NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"actor_role" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finalization_verifications" ADD CONSTRAINT "finalization_verifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_verifications" ADD CONSTRAINT "finalization_verifications_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_verifications" ADD CONSTRAINT "finalization_verifications_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_verifications" ADD CONSTRAINT "finalization_verifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finalization_case" ON "finalization_verifications" USING btree ("case_id");--> statement-breakpoint
CREATE TRIGGER finalization_verifications_append_only BEFORE UPDATE OR DELETE ON finalization_verifications
  FOR EACH ROW EXECUTE FUNCTION premedfix_forbid_mutation();
