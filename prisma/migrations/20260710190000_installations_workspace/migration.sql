ALTER TABLE `Installation`
  ADD COLUMN `offerId` VARCHAR(191) NULL,
  ADD COLUMN `configurationId` VARCHAR(191) NULL,
  ADD COLUMN `plannedEndAt` DATETIME(3) NULL,
  ADD COLUMN `confirmedAt` DATETIME(3) NULL,
  ADD COLUMN `contactName` VARCHAR(191) NULL,
  ADD COLUMN `contactPhone` VARCHAR(191) NULL,
  ADD COLUMN `internalNotes` TEXT NULL,
  MODIFY `status` ENUM('TO_SCHEDULE', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'NEEDS_COMPLETION', 'WAITING_OSD', 'COMPLETED', 'SERVICE_REQUIRED') NOT NULL DEFAULT 'TO_SCHEDULE';

ALTER TABLE `Task`
  ADD COLUMN `installationId` VARCHAR(191) NULL;

CREATE TABLE `InstallationTeamMember` (
  `installationId` VARCHAR(191) NOT NULL,
  `staffUserId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NULL,
  `isLead` BOOLEAN NOT NULL DEFAULT false,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `InstallationTeamMember_staffUserId_idx`(`staffUserId`),
  PRIMARY KEY (`installationId`, `staffUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InstallationChecklistItem` (
  `id` VARCHAR(191) NOT NULL,
  `installationId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `required` BOOLEAN NOT NULL DEFAULT true,
  `completed` BOOLEAN NOT NULL DEFAULT false,
  `completedAt` DATETIME(3) NULL,
  `completedById` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `InstallationChecklistItem_installationId_idx`(`installationId`),
  INDEX `InstallationChecklistItem_completedById_idx`(`completedById`),
  INDEX `InstallationChecklistItem_completed_idx`(`completed`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InstallationPlannedItem` (
  `id` VARCHAR(191) NOT NULL,
  `installationId` VARCHAR(191) NOT NULL,
  `configurationItemId` VARCHAR(191) NULL,
  `productId` VARCHAR(191) NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `name` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(12, 3) NOT NULL,
  `role` ENUM('MAIN_EQUIPMENT', 'ACCESSORY', 'MOUNTING', 'CABLING', 'PROTECTION', 'MONITORING', 'FORMALITIES', 'LOGISTICS', 'LABOR', 'DESIGN', 'OTHER') NOT NULL DEFAULT 'OTHER',
  `supplyMode` ENUM('ONREVOLT_SUPPLIED', 'CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'SERVICE_ONLY', 'NOT_INCLUDED') NOT NULL DEFAULT 'ONREVOLT_SUPPLIED',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `InstallationPlannedItem_installationId_idx`(`installationId`),
  INDEX `InstallationPlannedItem_configurationItemId_idx`(`configurationItemId`),
  INDEX `InstallationPlannedItem_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InstalledDevice`
  ADD COLUMN `plannedItemId` VARCHAR(191) NULL;

CREATE INDEX `Installation_offerId_idx` ON `Installation`(`offerId`);
CREATE INDEX `Installation_configurationId_idx` ON `Installation`(`configurationId`);
CREATE INDEX `Installation_plannedAt_idx` ON `Installation`(`plannedAt`);
CREATE INDEX `Installation_teamLeadId_idx` ON `Installation`(`teamLeadId`);
CREATE INDEX `Task_installationId_idx` ON `Task`(`installationId`);
CREATE INDEX `InstalledDevice_plannedItemId_idx` ON `InstalledDevice`(`plannedItemId`);

ALTER TABLE `Installation` ADD CONSTRAINT `Installation_offerId_fkey` FOREIGN KEY (`offerId`) REFERENCES `Offer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Installation` ADD CONSTRAINT `Installation_configurationId_fkey` FOREIGN KEY (`configurationId`) REFERENCES `Configuration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Installation` ADD CONSTRAINT `Installation_teamLeadId_fkey` FOREIGN KEY (`teamLeadId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Task` ADD CONSTRAINT `Task_installationId_fkey` FOREIGN KEY (`installationId`) REFERENCES `Installation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InstallationTeamMember` ADD CONSTRAINT `InstallationTeamMember_installationId_fkey` FOREIGN KEY (`installationId`) REFERENCES `Installation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InstallationTeamMember` ADD CONSTRAINT `InstallationTeamMember_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InstallationChecklistItem` ADD CONSTRAINT `InstallationChecklistItem_installationId_fkey` FOREIGN KEY (`installationId`) REFERENCES `Installation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InstallationChecklistItem` ADD CONSTRAINT `InstallationChecklistItem_completedById_fkey` FOREIGN KEY (`completedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InstallationPlannedItem` ADD CONSTRAINT `InstallationPlannedItem_installationId_fkey` FOREIGN KEY (`installationId`) REFERENCES `Installation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InstallationPlannedItem` ADD CONSTRAINT `InstallationPlannedItem_configurationItemId_fkey` FOREIGN KEY (`configurationItemId`) REFERENCES `ConfigurationItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InstallationPlannedItem` ADD CONSTRAINT `InstallationPlannedItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InstalledDevice` ADD CONSTRAINT `InstalledDevice_plannedItemId_fkey` FOREIGN KEY (`plannedItemId`) REFERENCES `InstallationPlannedItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
