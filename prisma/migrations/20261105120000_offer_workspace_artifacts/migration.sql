CREATE TABLE `OfferWorkspaceArtifact` (
    `id` CHAR(64) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `sourceKey` CHAR(64) NOT NULL,
    `payload` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `OfferWorkspaceArtifact_source_key` (`projectId`, `kind`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OfferWorkspaceArtifact`
ADD CONSTRAINT `OfferWorkspaceArtifact_projectId_fkey`
FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OfferWorkspaceCalculationSnapshot`
ADD COLUMN `existingPvPowerKw` DOUBLE NULL,
ADD COLUMN `requiresPvSource` BOOLEAN NOT NULL DEFAULT false;
