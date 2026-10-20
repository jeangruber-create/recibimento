-- Confirmação de recebimento PIX (dízimo/oferta declarado pelo membro).
-- O lançamento do membro nasce com status 'pendente' e só entra nos totais
-- (painel, fechamento, prestação, limite de 40%) depois de confirmado.
ALTER TABLE "Receipt" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Receipt" ADD COLUMN "confirmedByEmail" TEXT;
-- Origem do lançamento: 'membro' identifica dízimo/oferta de casa declarado pelo próprio membro.
ALTER TABLE "Receipt" ADD COLUMN "source" TEXT;
