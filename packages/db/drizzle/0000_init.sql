CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"role" text DEFAULT 'agent' NOT NULL,
	"is_active" boolean DEFAULT true,
	"is_online" boolean DEFAULT false,
	"last_seen_at" timestamp with time zone,
	"password_hash" text,
	"push_subscriptions" jsonb DEFAULT '[]'::jsonb,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb,
	"reset_token" text,
	"reset_token_expires_at" timestamp with time zone,
	"invite_token" text,
	"invite_token_expires_at" timestamp with time zone,
	"invited_by" uuid,
	"invite_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"channel" text,
	"total_conversations" integer DEFAULT 0,
	"new_conversations" integer DEFAULT 0,
	"resolved_conversations" integer DEFAULT 0,
	"ai_resolved" integer DEFAULT 0,
	"ai_escalated" integer DEFAULT 0,
	"ai_resolution_rate" numeric(5, 2),
	"avg_first_response_seconds" integer,
	"avg_resolution_seconds" integer,
	"avg_csat" numeric(3, 2),
	"csat_responses" integer DEFAULT 0,
	"cod_conversions" integer DEFAULT 0,
	"cod_conversion_revenue" numeric(12, 2) DEFAULT '0',
	"upsell_revenue" numeric(12, 2) DEFAULT '0',
	"total_messages" integer DEFAULT 0,
	"ai_messages" integer DEFAULT 0,
	"human_messages" integer DEFAULT 0,
	"unique_agents_active" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"title" text NOT NULL,
	"shortcut" text,
	"content" text NOT NULL,
	"channel" text,
	"is_shared" text DEFAULT 'true',
	"tags" text[] DEFAULT '{}',
	"use_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wa_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language_code" text DEFAULT 'en',
	"category" text NOT NULL,
	"status" text DEFAULT 'pending',
	"header_type" text,
	"header_content" text,
	"body_text" text NOT NULL,
	"footer_text" text,
	"buttons" text,
	"use_case" text,
	"meta_template_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consent_type" text NOT NULL,
	"channel" text NOT NULL,
	"granted" text NOT NULL,
	"consent_text" text NOT NULL,
	"consent_version" text NOT NULL,
	"ip_address" "inet",
	"device_info" text,
	"double_opt_in" text DEFAULT 'false',
	"double_opt_in_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_channel" text,
	"revocation_method" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'open',
	"assigned_to" uuid,
	"primary_intent" text,
	"sentiment" text DEFAULT 'neutral',
	"sentiment_score" numeric(3, 2),
	"urgency_score" integer DEFAULT 0,
	"emotion_tags" text[] DEFAULT '{}',
	"ai_handled" boolean DEFAULT false,
	"ai_resolution_rate" numeric(3, 2),
	"human_touched" boolean DEFAULT false,
	"escalation_reason" text,
	"routing_decision" text,
	"first_reply_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"snooze_until" timestamp with time zone,
	"session_expires_at" timestamp with time zone,
	"csat_score" integer,
	"csat_submitted_at" timestamp with time zone,
	"resolution_time_seconds" integer,
	"turn_count" integer DEFAULT 0,
	"circular_count" integer DEFAULT 0,
	"cod_conversion_offered" boolean DEFAULT false,
	"cod_conversion_accepted" boolean DEFAULT false,
	"cod_conversion_revenue" numeric(12, 2),
	"tags" text[] DEFAULT '{}',
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"shopify_order_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone" text,
	"email" text,
	"name" text,
	"shopify_customer_id" bigint,
	"whatsapp_id" text,
	"instagram_id" text,
	"city" text,
	"state" text,
	"country" text DEFAULT 'IN',
	"language_pref" text DEFAULT 'auto',
	"total_orders" integer DEFAULT 0,
	"total_spent" numeric(12, 2) DEFAULT '0',
	"last_order_at" timestamp with time zone,
	"clv_score" numeric(5, 2),
	"churn_risk" text DEFAULT 'low',
	"tier" text DEFAULT 'new',
	"sentiment_7d" numeric(3, 2),
	"tags" text[] DEFAULT '{}',
	"notes" jsonb DEFAULT '[]'::jsonb,
	"wa_support_consent" boolean DEFAULT false,
	"wa_marketing_consent" boolean DEFAULT false,
	"consent_timestamp" timestamp with time zone,
	"consent_text_version" text,
	"is_optout" boolean DEFAULT false,
	"optout_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopify_domain" text NOT NULL,
	"shopify_access_token" text NOT NULL,
	"shop_name" text NOT NULL,
	"shop_email" text,
	"shop_currency" text DEFAULT 'INR',
	"plan" text DEFAULT 'trial' NOT NULL,
	"plan_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"whatsapp_phone_number_id" text,
	"whatsapp_token" text,
	"whatsapp_verify_token" text,
	"whatsapp_business_account_id" text,
	"instagram_page_id" text,
	"instagram_token" text,
	"ai_persona_name" text DEFAULT 'Sahay',
	"ai_language" text DEFAULT 'hinglish',
	"ai_tone" text DEFAULT 'warm',
	"ai_confidence_threshold" numeric(3, 2) DEFAULT '0.75',
	"ai_brand_voice" text,
	"ai_prohibited_phrases" text[] DEFAULT '{}',
	"ai_preferred_phrases" text[] DEFAULT '{}',
	"timezone" text DEFAULT 'Asia/Kolkata',
	"business_hours" text,
	"sla_policies" text,
	"is_active" boolean DEFAULT true,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tenants_shopify_domain_unique" UNIQUE("shopify_domain")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" uuid,
	"content_type" text DEFAULT 'text' NOT NULL,
	"content" text,
	"content_richtext" jsonb,
	"media_url" text,
	"media_size" integer,
	"media_mime_type" text,
	"media_filename" text,
	"transcription" text,
	"transcription_confidence" numeric(3, 2),
	"voice_duration_seconds" integer,
	"is_ai_draft" boolean DEFAULT false,
	"ai_confidence" numeric(3, 2),
	"ai_intent" text,
	"ai_cited_sources" jsonb DEFAULT '[]'::jsonb,
	"ai_model" text,
	"channel_message_id" text,
	"channel_status" text DEFAULT 'sent',
	"channel_error" text,
	"channel_raw_payload" jsonb,
	"template_name" text,
	"template_params" jsonb,
	"ig_story_id" text,
	"ig_story_media_url" text,
	"interactive_type" text,
	"interactive_payload" jsonb,
	"sent_at" timestamp with time zone DEFAULT now(),
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"language" text DEFAULT 'en',
	"title_hi" text,
	"content_hi" text,
	"title_hinglish" text,
	"content_hinglish" text,
	"category" text,
	"tags" text[] DEFAULT '{}',
	"is_published" boolean DEFAULT false,
	"is_ai_generated" boolean DEFAULT false,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"source_url" text,
	"title" text,
	"content" text NOT NULL,
	"language" text DEFAULT 'en',
	"chunk_type" text,
	"chunk_index" integer DEFAULT 0,
	"product_id" text,
	"product_name" text,
	"category" text,
	"skin_types" text[] DEFAULT '{}',
	"price_tier" text,
	"embedding" vector(1536),
	"retrieval_count" integer DEFAULT 0,
	"avg_csat_on_use" numeric(3, 2),
	"last_updated" timestamp with time zone DEFAULT now(),
	"shopify_updated_at" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shopify_order_id" text NOT NULL,
	"shopify_order_number" text,
	"customer_id" uuid,
	"shopify_customer_id" text,
	"email" text,
	"phone" text,
	"financial_status" text,
	"fulfillment_status" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"total_price" numeric(12, 2) NOT NULL,
	"subtotal_price" numeric(12, 2),
	"total_tax" numeric(12, 2),
	"total_discounts" numeric(12, 2),
	"line_item_count" integer,
	"line_items" jsonb,
	"shipping_address" jsonb,
	"billing_address" jsonb,
	"tags" text,
	"note" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_templates" ADD CONSTRAINT "wa_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_agents_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_agents_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agents_tenant_email" ON "agents" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "idx_agents_tenant_active" ON "agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_agents_email" ON "agents" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_analytics_tenant_date_channel" ON "analytics_daily" USING btree ("tenant_id","date","channel");--> statement-breakpoint
CREATE INDEX "idx_analytics_date" ON "analytics_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_canned_tenant" ON "canned_responses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_canned_shortcut" ON "canned_responses" USING btree ("tenant_id","shortcut");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wa_templates_tenant_name_lang" ON "wa_templates" USING btree ("tenant_id","name","language_code");--> statement-breakpoint
CREATE INDEX "idx_audit_tenant" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_resource" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_consent_customer" ON "consent_records" USING btree ("customer_id","consent_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_consent_tenant" ON "consent_records" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_tenant_status" ON "conversations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_customer" ON "conversations" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_assigned" ON "conversations" USING btree ("tenant_id","assigned_to","status");--> statement-breakpoint
CREATE INDEX "idx_conversations_channel" ON "conversations" USING btree ("tenant_id","channel");--> statement-breakpoint
CREATE INDEX "idx_conversations_snooze" ON "conversations" USING btree ("snooze_until");--> statement-breakpoint
CREATE INDEX "idx_conversations_session" ON "conversations" USING btree ("session_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customers_tenant_phone" ON "customers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customers_tenant_shopify" ON "customers" USING btree ("tenant_id","shopify_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customers_tenant_wa" ON "customers" USING btree ("tenant_id","whatsapp_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customers_tenant_ig" ON "customers" USING btree ("tenant_id","instagram_id");--> statement-breakpoint
CREATE INDEX "idx_customers_tier" ON "customers" USING btree ("tenant_id","tier");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tenants_shopify_domain" ON "tenants" USING btree ("shopify_domain");--> statement-breakpoint
CREATE INDEX "idx_tenants_plan" ON "tenants" USING btree ("plan");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_tenant" ON "messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_channel_id" ON "messages" USING btree ("channel_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ka_tenant_slug" ON "kb_articles" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_ka_tenant_published" ON "kb_articles" USING btree ("tenant_id","is_published");--> statement-breakpoint
CREATE INDEX "idx_kc_tenant_active" ON "knowledge_chunks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_kc_source" ON "knowledge_chunks" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_kc_updated" ON "knowledge_chunks" USING btree ("tenant_id","last_updated");--> statement-breakpoint
CREATE INDEX "idx_kc_product" ON "knowledge_chunks" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_orders_tenant_shopify_order" ON "orders" USING btree ("tenant_id","shopify_order_id");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_customer" ON "orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_created" ON "orders" USING btree ("tenant_id","created_at");