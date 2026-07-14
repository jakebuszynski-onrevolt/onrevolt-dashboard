ALTER TABLE `Document`
  ADD COLUMN `documentDate` DATETIME(3) NULL,
  ADD COLUMN `tags` JSON NULL,
  ADD COLUMN `billingPeriodFrom` DATETIME(3) NULL,
  ADD COLUMN `billingPeriodTo` DATETIME(3) NULL,
  ADD COLUMN `billingCycleMonths` INTEGER NULL,
  ADD COLUMN `invoiceNumber` VARCHAR(191) NULL,
  ADD COLUMN `amountGross` DECIMAL(12, 2) NULL;

CREATE INDEX `Document_documentDate_idx` ON `Document`(`documentDate`);
CREATE INDEX `Document_billingPeriodFrom_billingPeriodTo_idx` ON `Document`(`billingPeriodFrom`, `billingPeriodTo`);
