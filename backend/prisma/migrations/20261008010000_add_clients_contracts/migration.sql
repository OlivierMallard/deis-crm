-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PROPOSED', 'SIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Client" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "sourceProspectId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_sourceProspectId_key" ON "Client"("sourceProspectId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_reference_key" ON "Contract"("reference");

-- CreateIndex
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_sourceProspectId_fkey" FOREIGN KEY ("sourceProspectId") REFERENCES "Prospect"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense en profondeur pour les ecritures SQL directes.
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_amountCents_check" CHECK ("amountCents" >= 0);
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dates_check" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_currency_check" CHECK ("currency" = 'EUR');
