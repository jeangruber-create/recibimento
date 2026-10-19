-- CreateTable: trilha de auditoria imutável (append-only)
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" INTEGER,
    "actorName" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "sectorId" INTEGER,
    "congregationId" INTEGER,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");
CREATE INDEX "AuditLog_sectorId_idx" ON "AuditLog"("sectorId");

-- Integridade de valores monetários e proporções (validado no próprio banco)
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_value_nonneg" CHECK ("value" >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_value_nonneg" CHECK ("value" >= 0);
ALTER TABLE "WeekClosure" ADD CONSTRAINT "WeekClosure_amounts_nonneg" CHECK ("income" >= 0 AND "expense" >= 0 AND "ratio" >= 0);
ALTER TABLE "Prestacao" ADD CONSTRAINT "Prestacao_declared_nonneg" CHECK ("declaredCash" >= 0 AND "declaredPix" >= 0);
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_amounts_nonneg" CHECK ("income" >= 0 AND "expense" >= 0 AND "ratio" >= 0);

-- Integridade de dados cadastrais (CPF/CEP/telefone em formato canônico de dígitos)
ALTER TABLE "User" ADD CONSTRAINT "User_cpf_len" CHECK ("cpf" IS NULL OR char_length("cpf") = 11);
ALTER TABLE "User" ADD CONSTRAINT "User_cep_len" CHECK ("cep" IS NULL OR char_length("cep") = 8);
ALTER TABLE "User" ADD CONSTRAINT "User_phone_len" CHECK ("phone" IS NULL OR char_length("phone") BETWEEN 10 AND 11);

-- Unicidade: no máximo um fechamento por semana por escopo (congregação / setor)
CREATE UNIQUE INDEX "WeekClosure_congregacao_week_key" ON "WeekClosure"("weekStart", "congregationId") WHERE "scope" = 'congregacao';
CREATE UNIQUE INDEX "WeekClosure_setor_week_key" ON "WeekClosure"("weekStart", "sectorId") WHERE "scope" = 'setor';
