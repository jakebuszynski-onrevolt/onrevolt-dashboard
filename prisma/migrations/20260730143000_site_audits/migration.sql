CREATE TABLE `SiteAudit` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'COMPLETED') NOT NULL DEFAULT 'DRAFT',
    `schemaVersion` INTEGER NOT NULL DEFAULT 1,
    `visitDate` DATETIME(3) NULL,
    `auditorId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `currentStep` INTEGER NOT NULL DEFAULT 1,
    `completedSteps` JSON NULL,
    `progressPercent` INTEGER NOT NULL DEFAULT 0,
    `formData` JSON NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SiteAudit_projectId_updatedAt_idx`(`projectId`, `updatedAt`),
    INDEX `SiteAudit_status_idx`(`status`),
    INDEX `SiteAudit_auditorId_idx`(`auditorId`),
    INDEX `SiteAudit_createdById_idx`(`createdById`),
    INDEX `SiteAudit_visitDate_idx`(`visitDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Document`
    ADD COLUMN `siteAuditId` VARCHAR(191) NULL,
    ADD COLUMN `auditFieldKey` VARCHAR(191) NULL;

CREATE INDEX `Document_siteAuditId_auditFieldKey_idx`
    ON `Document`(`siteAuditId`, `auditFieldKey`);

ALTER TABLE `SiteAudit`
    ADD CONSTRAINT `SiteAudit_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SiteAudit`
    ADD CONSTRAINT `SiteAudit_auditorId_fkey`
    FOREIGN KEY (`auditorId`) REFERENCES `StaffUser`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SiteAudit`
    ADD CONSTRAINT `SiteAudit_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Document`
    ADD CONSTRAINT `Document_siteAuditId_fkey`
    FOREIGN KEY (`siteAuditId`) REFERENCES `SiteAudit`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
