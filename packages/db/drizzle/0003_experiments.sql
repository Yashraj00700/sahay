CREATE TABLE "experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"tenant_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "experiment_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(10, 4) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"key" text NOT NULL,
	"description" text,
	"variants" jsonb NOT NULL,
	"is_active" boolean DEFAULT true,
	"starts_at" timestamp with time zone DEFAULT now(),
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_outcomes" ADD CONSTRAINT "experiment_outcomes_assignment_id_experiment_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."experiment_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_exp_assignment_unique" ON "experiment_assignments" USING btree ("experiment_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_exp_assignment_experiment" ON "experiment_assignments" USING btree ("experiment_id","variant");--> statement-breakpoint
CREATE INDEX "idx_exp_assignment_tenant" ON "experiment_assignments" USING btree ("tenant_id","experiment_id");--> statement-breakpoint
CREATE INDEX "idx_exp_outcome_assignment" ON "experiment_outcomes" USING btree ("assignment_id","metric");--> statement-breakpoint
CREATE INDEX "idx_exp_outcome_metric" ON "experiment_outcomes" USING btree ("metric","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_experiments_tenant_key" ON "experiments" USING btree ("tenant_id","key","is_active");--> statement-breakpoint
CREATE INDEX "idx_experiments_key_active" ON "experiments" USING btree ("key","is_active");