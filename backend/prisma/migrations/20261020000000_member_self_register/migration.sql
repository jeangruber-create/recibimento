-- Autocadastro do membro: número da residência, verificação por celular e reset de senha pelo admin
ALTER TABLE "User" ADD COLUMN     "addressNumber" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedVia" TEXT,
ADD COLUMN     "resetCodeHash" TEXT,
ADD COLUMN     "resetCodeExpiresAt" TIMESTAMP(3);
