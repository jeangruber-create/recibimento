-- AlterEnum
ALTER TYPE "PrestacaoStatus" ADD VALUE 'received';

-- AlterTable
ALTER TABLE "Prestacao" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" INTEGER,
ADD COLUMN     "receivedNote" TEXT;
