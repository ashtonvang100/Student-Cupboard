CREATE TABLE "inventory_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_areas_name_valid" CHECK ("inventory_areas"."name" = btrim("inventory_areas"."name") AND length("inventory_areas"."name") > 0 AND "inventory_areas"."name" !~ '[[:cntrl:]]')
);
--> statement-breakpoint
CREATE TABLE "inventory_scan_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" varchar(16) NOT NULL,
	"actor_id" varchar(200) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "inventory_scan_sessions_mode_valid" CHECK ("inventory_scan_sessions"."mode" IN ('full', 'individual')),
	CONSTRAINT "inventory_scan_sessions_closed_at_valid" CHECK ("inventory_scan_sessions"."closed_at" IS NULL OR "inventory_scan_sessions"."closed_at" >= "inventory_scan_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inventory_session_areas" (
	"session_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	CONSTRAINT "inventory_session_areas_session_id_area_id_pk" PRIMARY KEY("session_id","area_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_session_areas" ADD CONSTRAINT "inventory_session_areas_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inventory_scan_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_session_areas" ADD CONSTRAINT "inventory_session_areas_area_fk" FOREIGN KEY ("area_id") REFERENCES "public"."inventory_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_areas_name_unique" ON "inventory_areas" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_scan_sessions_actor_key_unique" ON "inventory_scan_sessions" USING btree ("actor_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "inventory_session_areas_area_session_idx" ON "inventory_session_areas" USING btree ("area_id","session_id");