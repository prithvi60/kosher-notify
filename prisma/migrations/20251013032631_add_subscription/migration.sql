-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "productId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE INDEX "Subscription_inventoryItemId_idx" ON "Subscription"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_email_inventoryItemId_key" ON "Subscription"("email", "inventoryItemId");
