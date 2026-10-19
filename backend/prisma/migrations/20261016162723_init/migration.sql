-- CreateEnum
CREATE TYPE "Role" AS ENUM ('sede', 'tesoureiro_setor', 'tesoureiro_congregacao', 'coletor', 'membro');

-- CreateEnum
CREATE TYPE "Payment" AS ENUM ('dinheiro', 'pix', 'cartao', 'outros');

-- CreateEnum
CREATE TYPE "ClosureScope" AS ENUM ('congregacao', 'setor');

-- CreateEnum
CREATE TYPE "ClosureStatus" AS ENUM ('closed', 'validated');

-- CreateEnum
CREATE TYPE "PrestacaoStatus" AS ENUM ('open', 'submitted', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT,
    "memberCode" TEXT,
    "sectorId" INTEGER,
    "congregationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Congregation" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "sectorId" INTEGER NOT NULL,

    CONSTRAINT "Congregation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "personMemberCode" TEXT,
    "type" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "payment" "Payment" NOT NULL DEFAULT 'dinheiro',
    "status" TEXT NOT NULL DEFAULT 'confirmado',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sectorId" INTEGER NOT NULL,
    "congregationId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "value" DECIMAL(12,2) NOT NULL,
    "payment" "Payment" NOT NULL DEFAULT 'dinheiro',
    "sectorId" INTEGER NOT NULL,
    "congregationId" INTEGER NOT NULL,
    "proofName" TEXT,
    "proofType" TEXT,
    "proofSize" INTEGER,
    "proofData" TEXT,
    "createdByName" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekClosure" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "scope" "ClosureScope" NOT NULL,
    "sectorId" INTEGER NOT NULL,
    "congregationId" INTEGER,
    "income" DECIMAL(12,2) NOT NULL,
    "expense" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "ratio" DOUBLE PRECISION NOT NULL,
    "exceeded" BOOLEAN NOT NULL DEFAULT false,
    "justification" TEXT,
    "status" "ClosureStatus" NOT NULL DEFAULT 'closed',
    "closedBy" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "WeekClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prestacao" (
    "id" TEXT NOT NULL,
    "sectorId" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" "PrestacaoStatus" NOT NULL DEFAULT 'open',
    "declaredCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "declaredPix" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "incomeBy" JSONB,
    "expenseBy" JSONB,
    "note" TEXT,
    "repasseProof" JSONB,
    "pixProofs" JSONB,
    "submittedById" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prestacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'excedente_despesa',
    "weekStart" TIMESTAMP(3) NOT NULL,
    "scope" "ClosureScope" NOT NULL,
    "sectorId" INTEGER NOT NULL,
    "congregationId" INTEGER,
    "income" DECIMAL(12,2) NOT NULL,
    "expense" DECIMAL(12,2) NOT NULL,
    "ratio" DOUBLE PRECISION NOT NULL,
    "limitPct" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "justification" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_memberCode_key" ON "User"("memberCode");

-- CreateIndex
CREATE INDEX "User_sectorId_idx" ON "User"("sectorId");

-- CreateIndex
CREATE INDEX "User_congregationId_idx" ON "User"("congregationId");

-- CreateIndex
CREATE INDEX "Congregation_sectorId_idx" ON "Congregation"("sectorId");

-- CreateIndex
CREATE INDEX "Receipt_sectorId_congregationId_date_idx" ON "Receipt"("sectorId", "congregationId", "date");

-- CreateIndex
CREATE INDEX "Receipt_personMemberCode_idx" ON "Receipt"("personMemberCode");

-- CreateIndex
CREATE INDEX "Receipt_date_idx" ON "Receipt"("date");

-- CreateIndex
CREATE INDEX "Expense_sectorId_congregationId_date_idx" ON "Expense"("sectorId", "congregationId", "date");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "WeekClosure_weekStart_sectorId_idx" ON "WeekClosure"("weekStart", "sectorId");

-- CreateIndex
CREATE INDEX "WeekClosure_weekStart_sectorId_congregationId_idx" ON "WeekClosure"("weekStart", "sectorId", "congregationId");

-- CreateIndex
CREATE UNIQUE INDEX "Prestacao_sectorId_weekStart_key" ON "Prestacao"("sectorId", "weekStart");

-- CreateIndex
CREATE INDEX "Alert_weekStart_sectorId_idx" ON "Alert"("weekStart", "sectorId");

-- CreateIndex
CREATE INDEX "Alert_read_idx" ON "Alert"("read");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_congregationId_fkey" FOREIGN KEY ("congregationId") REFERENCES "Congregation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Congregation" ADD CONSTRAINT "Congregation_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_congregationId_fkey" FOREIGN KEY ("congregationId") REFERENCES "Congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_congregationId_fkey" FOREIGN KEY ("congregationId") REFERENCES "Congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekClosure" ADD CONSTRAINT "WeekClosure_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prestacao" ADD CONSTRAINT "Prestacao_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
