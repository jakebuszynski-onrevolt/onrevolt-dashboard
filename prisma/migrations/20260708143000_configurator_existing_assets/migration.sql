-- AlterTable
ALTER TABLE `ConfigurationTemplate`
  ADD COLUMN `roofType` ENUM('FLAT', 'SLOPED', 'GROUND', 'OTHER', 'UNKNOWN') NULL,
  ADD COLUMN `goal` ENUM('NEW_PV', 'PV_WITH_STORAGE', 'STORAGE_RETROFIT', 'PV_EXPANSION', 'INVERTER_REPLACEMENT', 'EMS_MONITORING', 'SERVICE_ONLY', 'MIXED') NULL,
  ADD COLUMN `powerKw` DECIMAL(8, 3) NULL,
  ADD COLUMN `capacityKwh` DECIMAL(8, 3) NULL,
  ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `requiresExistingPv` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `requiresExistingInverter` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `ConfigurationTemplateItem`
  ADD COLUMN `role` ENUM('MAIN_EQUIPMENT', 'ACCESSORY', 'MOUNTING', 'CABLING', 'PROTECTION', 'MONITORING', 'FORMALITIES', 'LOGISTICS', 'LABOR', 'DESIGN', 'OTHER') NOT NULL DEFAULT 'OTHER',
  ADD COLUMN `supplyMode` ENUM('ONREVOLT_SUPPLIED', 'CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'SERVICE_ONLY', 'NOT_INCLUDED') NOT NULL DEFAULT 'ONREVOLT_SUPPLIED',
  ADD COLUMN `unitPurchaseNet` DECIMAL(12, 2) NULL,
  ADD COLUMN `purchaseVatRate` DECIMAL(5, 4) NULL,
  ADD COLUMN `operatingCostNet` DECIMAL(12, 2) NULL,
  ADD COLUMN `marginRate` DECIMAL(5, 4) NULL,
  ADD COLUMN `saleVatRate` DECIMAL(5, 4) NULL,
  ADD COLUMN `isOptional` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `requiresReview` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Configuration`
  ADD COLUMN `goal` ENUM('NEW_PV', 'PV_WITH_STORAGE', 'STORAGE_RETROFIT', 'PV_EXPANSION', 'INVERTER_REPLACEMENT', 'EMS_MONITORING', 'SERVICE_ONLY', 'MIXED') NULL,
  ADD COLUMN `roofType` ENUM('FLAT', 'SLOPED', 'GROUND', 'OTHER', 'UNKNOWN') NULL,
  ADD COLUMN `targetPowerKw` DECIMAL(8, 3) NULL,
  ADD COLUMN `targetCapacityKwh` DECIMAL(8, 3) NULL,
  ADD COLUMN `existingAssetsSnapshot` JSON NULL;

-- AlterTable
ALTER TABLE `ConfigurationItem`
  ADD COLUMN `role` ENUM('MAIN_EQUIPMENT', 'ACCESSORY', 'MOUNTING', 'CABLING', 'PROTECTION', 'MONITORING', 'FORMALITIES', 'LOGISTICS', 'LABOR', 'DESIGN', 'OTHER') NOT NULL DEFAULT 'OTHER',
  ADD COLUMN `supplyMode` ENUM('ONREVOLT_SUPPLIED', 'CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'SERVICE_ONLY', 'NOT_INCLUDED') NOT NULL DEFAULT 'ONREVOLT_SUPPLIED',
  ADD COLUMN `isOptional` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `requiresReview` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `ProjectExistingAsset` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NULL,
  `kind` ENUM('PV_MODULES', 'PV_INVERTER', 'HYBRID_INVERTER', 'BATTERY', 'GRID_METER', 'EMS', 'PROTECTION', 'CABLING', 'OTHER') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `producer` VARCHAR(191) NULL,
  `model` VARCHAR(191) NULL,
  `powerKw` DECIMAL(8, 3) NULL,
  `capacityKwh` DECIMAL(8, 3) NULL,
  `quantity` DECIMAL(12, 3) NULL,
  `voltageKind` VARCHAR(191) NULL,
  `phaseCount` INTEGER NULL,
  `parameters` JSON NULL,
  `verificationStatus` ENUM('DECLARED', 'PHOTO_CONFIRMED', 'DOCUMENT_CONFIRMED', 'AUDIT_CONFIRMED', 'UNKNOWN') NOT NULL DEFAULT 'DECLARED',
  `compatibilityStatus` ENUM('UNKNOWN', 'COMPATIBLE', 'NEEDS_AUDIT', 'INCOMPATIBLE') NOT NULL DEFAULT 'UNKNOWN',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `ProjectExistingAsset_projectId_idx`(`projectId`),
  INDEX `ProjectExistingAsset_productId_idx`(`productId`),
  INDEX `ProjectExistingAsset_kind_idx`(`kind`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ConfigurationTemplate_goal_idx` ON `ConfigurationTemplate`(`goal`);
CREATE INDEX `ConfigurationTemplate_roofType_idx` ON `ConfigurationTemplate`(`roofType`);
CREATE UNIQUE INDEX `ConfigurationTemplate_sourceSheet_sourceRange_key` ON `ConfigurationTemplate`(`sourceSheet`, `sourceRange`);

-- AddForeignKey
ALTER TABLE `ProjectExistingAsset` ADD CONSTRAINT `ProjectExistingAsset_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectExistingAsset` ADD CONSTRAINT `ProjectExistingAsset_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
