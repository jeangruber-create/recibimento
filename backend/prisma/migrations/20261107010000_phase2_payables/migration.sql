-- Phase 2: Contas a pagar (obrigações futuras) + vínculo com saída realizada (Expense.payableId)

ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "payableId" TEXT;
CREATE INDEX IF NOT EXISTS "Expense_payableId_idx" ON "Expense"("payableId");

CREATE TABLE IF NOT EXISTS "Payable" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "payee" TEXT,
    "nature" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment" "Payment" NOT NULL DEFAULT 'dinheiro',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "competenceDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "note" TEXT,
    "sectorId" INTEGER NOT NULL,
    "congregationId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "createdByName" TEXT,
    "approvedById" INTEGER,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "proofName" TEXT,
    "proofType" TEXT,
    "proofSize" INTEGER,
    "proofData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Payable_sectorId_congregationId_dueDate_idx" ON "Payable"("sectorId", "congregationId", "dueDate");
CREATE INDEX IF NOT EXISTS "Payable_status_dueDate_idx" ON "Payable"("status", "dueDate");
CREATE INDEX IF NOT EXISTS "Payable_dueDate_idx" ON "Payable"("dueDate");

DO $$ BEGIN
  ALTER TABLE "Payable" ADD CONSTRAINT "Payable_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Payable" ADD CONSTRAINT "Payable_congregationId_fkey" FOREIGN KEY ("congregationId") REFERENCES "Congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
