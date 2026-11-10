CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(120) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_nonempty" CHECK (length(trim("categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inventory_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit" varchar(50) DEFAULT 'each' NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "inventory_quantity_nonnegative" CHECK ("inventory"."quantity" >= 0),
	CONSTRAINT "inventory_threshold_nonnegative" CHECK ("inventory"."low_stock_threshold" >= 0),
	CONSTRAINT "inventory_unit_nonempty" CHECK (length(trim("inventory"."unit")) > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inventory_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"transaction_type" varchar(20) NOT NULL,
	"quantity_change" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transactions_type_and_sign" CHECK (("inventory_transactions"."transaction_type" = 'addition' AND "inventory_transactions"."quantity_change" > 0) OR ("inventory_transactions"."transaction_type" = 'removal' AND "inventory_transactions"."quantity_change" < 0) OR ("inventory_transactions"."transaction_type" = 'adjustment' AND "inventory_transactions"."quantity_change" <> 0)),
	CONSTRAINT "inventory_transactions_reason_nonempty" CHECK (length(trim("inventory_transactions"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(200) NOT NULL,
	"brand" varchar(200),
	"barcode" varchar(100),
	"description" text,
	"category_id" integer NOT NULL,
	"nutrition" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_barcode_unique" UNIQUE("barcode"),
	CONSTRAINT "products_name_nonempty" CHECK (length(trim("products"."name")) > 0),
	CONSTRAINT "products_barcode_nonempty" CHECK ("products"."barcode" IS NULL OR length(trim("products"."barcode")) > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_unique" ON "categories" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "inventory_transactions_product_id_id_idx" ON "inventory_transactions" USING btree ("product_id","id");--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");