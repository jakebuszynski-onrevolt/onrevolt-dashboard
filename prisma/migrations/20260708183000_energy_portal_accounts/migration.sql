-- CreateTable
CREATE TABLE `EnergyPortalAccount` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `operator` ENUM('ENEA', 'PGE', 'TAURON', 'ENERGA', 'STOEN', 'INNY') NOT NULL DEFAULT 'ENEA',
    `login` VARCHAR(191) NULL,
    `encryptedPassword` TEXT NULL,
    `ppeNumber` VARCHAR(191) NULL,
    `portalPpeId` VARCHAR(191) NULL,
    `meterNumber` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `lastSyncAt` DATETIME(3) NULL,
    `lastSyncStatus` VARCHAR(191) NULL,
    `lastSyncMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EnergyPortalAccount_clientId_idx`(`clientId`),
    INDEX `EnergyPortalAccount_projectId_idx`(`projectId`),
    INDEX `EnergyPortalAccount_operator_idx`(`operator`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EnergyMeasurementFile` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `operator` ENUM('ENEA', 'PGE', 'TAURON', 'ENERGA', 'STOEN', 'INNY') NOT NULL DEFAULT 'ENEA',
    `kind` ENUM('ACTIVE_IMPORT', 'ACTIVE_EXPORT') NOT NULL,
    `periodYear` INTEGER NOT NULL,
    `periodMonth` INTEGER NOT NULL,
    `aggregation` VARCHAR(191) NOT NULL DEFAULT '60 min',
    `dataSource` VARCHAR(191) NOT NULL DEFAULT 'Dane po bilansowaniu',
    `documentId` VARCHAR(191) NULL,
    `storagePath` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DOWNLOADED',
    `error` TEXT NULL,
    `downloadedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EnergyMeasurementFile_accountId_kind_periodYear_periodMonth_key`(`accountId`, `kind`, `periodYear`, `periodMonth`),
    INDEX `EnergyMeasurementFile_clientId_idx`(`clientId`),
    INDEX `EnergyMeasurementFile_projectId_idx`(`projectId`),
    INDEX `EnergyMeasurementFile_documentId_idx`(`documentId`),
    INDEX `EnergyMeasurementFile_operator_idx`(`operator`),
    INDEX `EnergyMeasurementFile_periodYear_periodMonth_idx`(`periodYear`, `periodMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EnergyPortalAccount` ADD CONSTRAINT `EnergyPortalAccount_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EnergyPortalAccount` ADD CONSTRAINT `EnergyPortalAccount_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EnergyMeasurementFile` ADD CONSTRAINT `EnergyMeasurementFile_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `EnergyPortalAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EnergyMeasurementFile` ADD CONSTRAINT `EnergyMeasurementFile_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EnergyMeasurementFile` ADD CONSTRAINT `EnergyMeasurementFile_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EnergyMeasurementFile` ADD CONSTRAINT `EnergyMeasurementFile_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
