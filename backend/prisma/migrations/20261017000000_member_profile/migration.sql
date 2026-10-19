-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "profileCompletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");
