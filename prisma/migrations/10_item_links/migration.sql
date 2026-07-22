-- Upsell / cross-sell recommendations between menu items.

CREATE TYPE "LinkKind" AS ENUM ('UPSELL', 'CROSS_SELL');

CREATE TABLE "MenuItemLink" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "linkedItemId" TEXT NOT NULL,
    "kind" "LinkKind" NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuItemLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MenuItemLink_itemId_linkedItemId_key" ON "MenuItemLink"("itemId", "linkedItemId");
CREATE INDEX "MenuItemLink_itemId_idx" ON "MenuItemLink"("itemId");

ALTER TABLE "MenuItemLink"
    ADD CONSTRAINT "MenuItemLink_itemId_fkey" FOREIGN KEY ("itemId")
    REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MenuItemLink"
    ADD CONSTRAINT "MenuItemLink_linkedItemId_fkey" FOREIGN KEY ("linkedItemId")
    REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
