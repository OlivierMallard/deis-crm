-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CARD', 'CASH', 'CHECK', 'OTHER');

-- CreateTable
CREATE TABLE "Quote" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "contractId" INTEGER,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE NOT NULL,
    "validUntil" DATE,
    "vatExemptionMention" TEXT,
    "totalExclTaxCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalInclTaxCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL,
    "totalExclTaxCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalInclTaxCents" INTEGER NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "contractId" INTEGER,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "totalExclTaxCents" INTEGER NOT NULL,
    "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL,
    "totalInclTaxCents" INTEGER NOT NULL,
    "vatExemptionMention" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- Database guards complement API validation; existing tables are untouched.
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_amounts_check" CHECK ("totalExclTaxCents" >= 0 AND "vatCents" >= 0 AND "totalInclTaxCents"::bigint = "totalExclTaxCents"::bigint + "vatCents"::bigint), ADD CONSTRAINT "Quote_dates_check" CHECK ("validUntil" IS NULL OR "validUntil" >= "issueDate");
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_finance_check" CHECK ("quantity" > 0 AND "unitPriceCents" >= 0 AND "vatRateBasisPoints" IN (0,2000) AND "position" >= 0 AND "totalExclTaxCents" = round("quantity" * "unitPriceCents") AND "vatCents" = round("totalExclTaxCents"::numeric * "vatRateBasisPoints" / 10000) AND "totalInclTaxCents"::bigint = "totalExclTaxCents"::bigint + "vatCents"::bigint);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_finance_check" CHECK ("totalExclTaxCents" >= 0 AND "vatRateBasisPoints" IN (0,2000) AND "vatCents" = round("totalExclTaxCents"::numeric * "vatRateBasisPoints" / 10000) AND "totalInclTaxCents"::bigint = "totalExclTaxCents"::bigint + "vatCents"::bigint AND "dueDate" >= "issueDate");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amountCents" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_reference_key" ON "Quote"("reference");

-- CreateIndex
CREATE INDEX "Quote_clientId_idx" ON "Quote"("clientId");

-- CreateIndex
CREATE INDEX "Quote_contractId_idx" ON "Quote"("contractId");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_position_key" ON "QuoteLine"("quoteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_reference_key" ON "Invoice"("reference");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_contractId_idx" ON "Invoice"("contractId");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
