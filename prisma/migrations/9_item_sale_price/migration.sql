-- Per-item sale price. Null means "no sale"; when set below priceCts the
-- customer pays salePriceCts and the original renders struck-through.

ALTER TABLE "MenuItem" ADD COLUMN "salePriceCts" INTEGER;
