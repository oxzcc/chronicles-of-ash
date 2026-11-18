DROP INDEX "npcs_campaign_idx";--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "job" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "npcs" ADD COLUMN "name_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "images_queue_idx" ON "images" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "npcs_campaign_name_idx" ON "npcs" USING btree ("campaign_id","name_key");