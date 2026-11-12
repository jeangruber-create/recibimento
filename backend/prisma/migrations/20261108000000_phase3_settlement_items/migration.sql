-- Fatia 1 (acerto/prestação): contas básicas, envio à sede, itens do acerto (quitada/a_quitar/enviada_sede) e provisão/repasse da sede.

ALTER TABLE "Payable" ADD COLUMN IF NOT EXISTS "isBasic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payable" ADD COLUMN IF NOT EXISTS "basicType" TEXT;
ALTER TABLE "Payable" ADD COLUMN IF NOT EXISTS "sentToSede" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payable" ADD COLUMN IF NOT EXISTS "sentToSedeAt" TIMESTAMP(3);
ALTER TABLE "Payable" ADD COLUMN IF NOT EXISTS "sentToSedeById" INTEGER;
ALTER TABLE "Payable" ADD COLUMN IF NOT EXISTS "sentToSedeByName" TEXT;
ALTER TABLE "Payable" ADD COLUMN IF NOT EXISTS "sentToSedeNote" TEXT;

CREATE INDEX IF NOT EXISTS "Payable_sentToSede_sectorId_idx" ON "Payable"("sentToSede", "sectorId");
CREATE INDEX IF NOT EXISTS "Payable_isBasic_sectorId_idx" ON "Payable"("isBasic", "sectorId");

CREATE TABLE IF NOT EXISTS "SettlementItem" (
    "id" TEXT NOT NULL,
    "sectorId" INTEGER NOT NULL,
    "congregationId" INTEGER,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "prestacaoId" TEXT,
    "payableId" TEXT,
    "expenseId" TEXT,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "isBasic" BOOLEAN NOT NULL DEFAULT false,
    "disposition" TEXT NOT NULL DEFAULT 'a_quitar',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountProvisioned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "responsible" TEXT NOT NULL DEFAULT 'setor',
    "status" TEXT NOT NULL DEFAULT 'registered',
    "sedeValidationStatus" TEXT NOT NULL DEFAULT 'pending',
    "sedeValidatedById" INTEGER,
    "sedeValidatedByName" TEXT,
    "sedeValidatedAt" TIMESTAMP(3),
    "sedeValidationNote" TEXT,
    "executedById" INTEGER,
    "executedByName" TEXT,
    "executedAt" TIMESTAMP(3),
    "note" TEXT,
    "proofName" TEXT,
    "proofType" TEXT,
    "proofSize" INTEGER,
    "proofData" TEXT,
    "createdById" INTEGER,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SettlementItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SedeFunding" (
    "id" TEXT NOT NULL,
    "sectorId" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3),
    "settlementItemId" TEXT,
    "payableId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provisioned',
    "note" TEXT,
    "createdById" INTEGER,
    "createdByName" TEXT,
    "releasedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SedeFunding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SettlementItem_sectorId_weekStart_idx" ON "SettlementItem"("sectorId", "weekStart");
CREATE INDEX IF NOT EXISTS "SettlementItem_prestacaoId_idx" ON "SettlementItem"("prestacaoId");
CREATE INDEX IF NOT EXISTS "SettlementItem_payableId_idx" ON "SettlementItem"("payableId");
CREATE INDEX IF NOT EXISTS "SettlementItem_expenseId_idx" ON "SettlementItem"("expenseId");
CREATE INDEX IF NOT EXISTS "SettlementItem_sedeValidationStatus_idx" ON "SettlementItem"("sedeValidationStatus");
CREATE INDEX IF NOT EXISTS "SettlementItem_disposition_sectorId_weekStart_idx" ON "SettlementItem"("disposition", "sectorId", "weekStart");
CREATE INDEX IF NOT EXISTS "SedeFunding_sectorId_status_idx" ON "SedeFunding"("sectorId", "status");
CREATE INDEX IF NOT EXISTS "SedeFunding_settlementItemId_idx" ON "SedeFunding"("settlementItemId");
CREATE INDEX IF NOT EXISTS "SedeFunding_payableId_idx" ON "SedeFunding"("payableId");

DO $$ BEGIN
  ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_congregationId_fkey" FOREIGN KEY ("congregationId") REFERENCES "Congregation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_prestacaoId_fkey" FOREIGN KEY ("prestacaoId") REFERENCES "Prestacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SedeFunding" ADD CONSTRAINT "SedeFunding_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SedeFunding" ADD CONSTRAINT "SedeFunding_settlementItemId_fkey" FOREIGN KEY ("settlementItemId") REFERENCES "SettlementItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SedeFunding" ADD CONSTRAINT "SedeFunding_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
