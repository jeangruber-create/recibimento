-- Chave PIX por congregação (gerida pela sede/tesouraria), usada no dizimar/ofertar pelo portal do membro
ALTER TABLE "Congregation" ADD COLUMN     "pixKey" TEXT,
ADD COLUMN     "pixKeyType" TEXT;
