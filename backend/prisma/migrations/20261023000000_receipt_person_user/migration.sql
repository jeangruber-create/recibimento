-- Vincula o recibo a um membro cadastrado (pessoa), além do nome/código em texto.
ALTER TABLE "Receipt" ADD COLUMN "personUserId" INTEGER;

ALTER TABLE "Receipt"
  ADD CONSTRAINT "Receipt_personUserId_fkey"
  FOREIGN KEY ("personUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Receipt_personUserId_idx" ON "Receipt"("personUserId");
