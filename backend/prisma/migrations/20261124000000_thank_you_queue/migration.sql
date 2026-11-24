-- Fila diária de agradecimentos por WhatsApp: dízimos confirmados de membros com celular cadastrado.
CREATE TABLE IF NOT EXISTS "ThankYouQueue" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "recipientUserId" INTEGER,
    "memberCode" TEXT,
    "personName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "externalId" TEXT,
    "lastError" TEXT,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "ThankYouQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThankYouQueue_receiptId_key" ON "ThankYouQueue"("receiptId");
CREATE INDEX IF NOT EXISTS "ThankYouQueue_status_queueDate_idx" ON "ThankYouQueue"("status", "queueDate");
CREATE INDEX IF NOT EXISTS "ThankYouQueue_queueDate_idx" ON "ThankYouQueue"("queueDate");
CREATE INDEX IF NOT EXISTS "ThankYouQueue_recipientUserId_idx" ON "ThankYouQueue"("recipientUserId");

DO $$ BEGIN
  ALTER TABLE "ThankYouQueue" ADD CONSTRAINT "ThankYouQueue_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ThankYouQueue" ADD CONSTRAINT "ThankYouQueue_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ThankYouQueue" ADD CONSTRAINT "ThankYouQueue_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
