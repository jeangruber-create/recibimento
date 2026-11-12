-- Phase 1: validação/conferência de lançamentos (controle financeiro geral)
-- Receipt: campos de revisão (default 'reviewed' para não inundar fila com histórico)
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'reviewed';
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "reviewedById" INTEGER;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "reviewedByName" TEXT;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;

-- Expense: status operacional + revisão (default 'approved' para histórico existente)
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "reviewedById" INTEGER;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "reviewedByName" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;

-- Índices para fila de validação e visão consolidada
CREATE INDEX IF NOT EXISTS "Receipt_reviewStatus_date_idx" ON "Receipt"("reviewStatus", "date");
CREATE INDEX IF NOT EXISTS "Expense_reviewStatus_date_idx" ON "Expense"("reviewStatus", "date");
CREATE INDEX IF NOT EXISTS "Expense_status_date_idx" ON "Expense"("status", "date");
