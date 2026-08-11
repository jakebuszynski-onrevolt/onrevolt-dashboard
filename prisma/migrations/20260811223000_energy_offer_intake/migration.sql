ALTER TABLE `EnergyAudit`
  ADD COLUMN `terrainType` VARCHAR(191) NULL,
  ADD COLUMN `buildingType` VARCHAR(191) NULL,
  ADD COLUMN `roofShape` VARCHAR(191) NULL,
  ADD COLUMN `settlementSystem` VARCHAR(191) NULL,
  ADD COLUMN `energySupplier` VARCHAR(191) NULL,
  ADD COLUMN `connectionType` VARCHAR(191) NULL,
  ADD COLUMN `heatingSource` VARCHAR(191) NULL,
  ADD COLUMN `heatingSourceDetail` VARCHAR(191) NULL;
