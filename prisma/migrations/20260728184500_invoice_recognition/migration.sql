ALTER TABLE `Document`
  ADD COLUMN `amountDue` DECIMAL(12, 2) NULL,
  ADD COLUMN `invoiceProvider` VARCHAR(191) NULL,
  ADD COLUMN `invoiceParserId` VARCHAR(191) NULL,
  ADD COLUMN `invoiceParserVersion` VARCHAR(191) NULL,
  ADD COLUMN `invoiceConfidence` DECIMAL(5, 4) NULL,
  ADD COLUMN `invoicePpeNumber` VARCHAR(191) NULL,
  ADD COLUMN `invoiceTariff` VARCHAR(191) NULL,
  ADD COLUMN `energyConsumptionKwh` DECIMAL(14, 3) NULL,
  ADD COLUMN `invoiceRecognition` JSON NULL;

CREATE INDEX `Document_invoicePpeNumber_idx` ON `Document`(`invoicePpeNumber`);
