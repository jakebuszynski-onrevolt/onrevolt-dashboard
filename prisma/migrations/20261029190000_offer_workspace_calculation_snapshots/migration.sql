CREATE TABLE `OfferWorkspaceCalculationSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(36) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `sourceRevision` CHAR(64) NOT NULL,
    `draftHash` CHAR(64) NOT NULL,
    `algorithmVersion` VARCHAR(64) NOT NULL,
    `pricesAsOf` VARCHAR(10) NULL,
    `sourceDependencyStamp` CHAR(64) NULL,
    `targetOperatorId` INTEGER NULL,
    `targetTariffId` INTEGER NULL,
    `currentSettlement` VARCHAR(16) NULL,
    `targetSettlement` VARCHAR(16) NULL,
    `mode` VARCHAR(16) NOT NULL,
    `completed` INTEGER NOT NULL,
    `total` INTEGER NOT NULL,
    `result` JSON NOT NULL,
    `deadlineAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `OfferWorkspaceCalculationSnapshot_jobId_key` (`jobId`),
    INDEX `OfferCalcSnapshot_lookup_idx` (`actorId`, `projectId`, `sourceRevision`, `draftHash`, `algorithmVersion`, `pricesAsOf`, `sourceDependencyStamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OfferWorkspaceCalculationSnapshot`
ADD CONSTRAINT `OfferWorkspaceCalculationSnapshot_projectId_fkey`
FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `OfferWorkspaceCalculationSnapshotAdmission` (
    `jobId` VARCHAR(36) NOT NULL,
    `admittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`jobId`),
    CONSTRAINT `OfferWorkspaceCalculationSnapshotAdmission_jobId_fkey`
        FOREIGN KEY (`jobId`) REFERENCES `OfferWorkspaceCalculationSnapshot`(`jobId`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
