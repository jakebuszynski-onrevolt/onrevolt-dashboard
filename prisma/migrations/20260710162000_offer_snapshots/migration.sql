ALTER TABLE `Offer`
  ADD COLUMN `title` VARCHAR(191) NULL,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'PLN',
  ADD COLUMN `subsidyGross` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `thermoReliefGross` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `totalAfterSupportGross` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `currentAnnualBillGross` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `projectedAnnualBillGross` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `annualSavingsGross` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `paybackYears` DECIMAL(8, 2) NULL,
  ADD COLUMN `tariffBefore` VARCHAR(191) NULL,
  ADD COLUMN `tariffAfter` VARCHAR(191) NULL,
  ADD COLUMN `settlementBefore` VARCHAR(191) NULL,
  ADD COLUMN `settlementAfter` VARCHAR(191) NULL,
  ADD COLUMN `descriptionBefore` TEXT NULL,
  ADD COLUMN `descriptionAfter` TEXT NULL,
  ADD COLUMN `lineItemsSnapshot` JSON NULL,
  ADD COLUMN `energySnapshot` JSON NULL,
  ADD COLUMN `calculationSnapshot` JSON NULL,
  ADD COLUMN `clientSnapshot` JSON NULL;

UPDATE `Offer`
SET `totalAfterSupportGross` = `totalGross`
WHERE `totalAfterSupportGross` = 0;
