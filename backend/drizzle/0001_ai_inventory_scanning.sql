CREATE TABLE "inventory_area_counts" (
	"product_id" integer NOT NULL,
	"area" varchar(120) NOT NULL,
	"quantity" integer NOT NULL,
	"scan_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_area_counts_product_id_area_pk" PRIMARY KEY("product_id","area"),
	CONSTRAINT "area_quantity_nonnegative" CHECK ("inventory_area_counts"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(200) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"area" varchar(120) NOT NULL,
	"status" varchar(30) NOT NULL,
	"analysis" jsonb,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" varchar(100),
	"reviewed_by" varchar(200),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_scans_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "product_nutrition" (
	"product_id" integer PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"scan_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "scan_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "actor_id" varchar(200);--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "previous_quantity" integer;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "new_quantity" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "package_size" varchar(100);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variation" varchar(200);--> statement-breakpoint
ALTER TABLE "inventory_area_counts" ADD CONSTRAINT "inventory_area_counts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_area_counts" ADD CONSTRAINT "inventory_area_counts_scan_id_inventory_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."inventory_scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_nutrition" ADD CONSTRAINT "product_nutrition_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_nutrition" ADD CONSTRAINT "product_nutrition_scan_id_inventory_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."inventory_scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_actor_key_unique" ON "inventory_scans" USING btree ("actor_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "scans_created_idx" ON "inventory_scans" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_scan_id_inventory_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."inventory_scans"("id") ON DELETE no action ON UPDATE no action;