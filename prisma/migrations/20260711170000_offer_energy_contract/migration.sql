ALTER TABLE `Offer`
  ADD COLUMN `energyScenarioId` VARCHAR(191) NULL;

ALTER TABLE `Contract`
  ADD COLUMN `depositPercent` DECIMAL(5, 2) NULL,
  ADD COLUMN `paymentSchedule` JSON NULL,
  ADD COLUMN `commercialSnapshot` JSON NULL;

CREATE INDEX `Offer_energyScenarioId_idx` ON `Offer`(`energyScenarioId`);

ALTER TABLE `Offer`
  ADD CONSTRAINT `Offer_energyScenarioId_fkey`
  FOREIGN KEY (`energyScenarioId`) REFERENCES `EnergyScenario`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
