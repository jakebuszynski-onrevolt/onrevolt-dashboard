CREATE TABLE `EnergyAudit` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `status` ENUM('DRAFT', 'READY', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
  `profileSource` ENUM('ANNUAL_DECLARATION', 'MONTHLY_MANUAL', 'OPERATOR_HOURLY') NOT NULL DEFAULT 'ANNUAL_DECLARATION',
  `annualConsumptionKwh` DECIMAL(12,3) NULL,
  `connectionPowerKw` DECIMAL(10,3) NULL,
  `phaseCount` INTEGER NULL,
  `mainFuseA` INTEGER NULL,
  `roofType` ENUM('FLAT', 'SLOPED', 'GROUND', 'OTHER', 'UNKNOWN') NULL,
  `roofAreaM2` DECIMAL(10,2) NULL,
  `roofOrientation` VARCHAR(191) NULL,
  `roofTiltDeg` DECIMAL(5,2) NULL,
  `shadingNotes` TEXT NULL,
  `existingPvKw` DECIMAL(10,3) NULL,
  `existingInverter` VARCHAR(191) NULL,
  `existingBatteryKwh` DECIMAL(10,3) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `EnergyAudit_projectId_updatedAt_idx`(`projectId`, `updatedAt`),
  UNIQUE INDEX `EnergyAudit_projectId_key`(`projectId`),
  INDEX `EnergyAudit_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EnergyScenario` (
  `id` VARCHAR(191) NOT NULL,
  `auditId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `engineVersion` VARCHAR(191) NOT NULL,
  `inputSnapshot` JSON NOT NULL,
  `resultSnapshot` JSON NOT NULL,
  `pvPowerKw` DECIMAL(10,3) NOT NULL,
  `batteryCapacityKwh` DECIMAL(10,3) NOT NULL,
  `investmentGross` DECIMAL(12,2) NULL,
  `recommended` BOOLEAN NOT NULL DEFAULT false,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `EnergyScenario_auditId_createdAt_idx`(`auditId`, `createdAt`),
  INDEX `EnergyScenario_createdById_idx`(`createdById`),
  INDEX `EnergyScenario_recommended_idx`(`recommended`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EnergyAudit` ADD CONSTRAINT `EnergyAudit_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EnergyScenario` ADD CONSTRAINT `EnergyScenario_auditId_fkey` FOREIGN KEY (`auditId`) REFERENCES `EnergyAudit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EnergyScenario` ADD CONSTRAINT `EnergyScenario_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
