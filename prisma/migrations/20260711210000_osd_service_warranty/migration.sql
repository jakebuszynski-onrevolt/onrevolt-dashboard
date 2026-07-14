ALTER TABLE `InstalledDevice`
  ADD COLUMN `commissionedAt` DATETIME(3) NULL,
  ADD COLUMN `warrantyMonths` INTEGER NULL,
  ADD COLUMN `warrantyUntil` DATETIME(3) NULL;

CREATE TABLE `OdsCase` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `operator` ENUM('ENEA','PGE','TAURON','ENERGA','STOEN','INNY') NOT NULL,
  `ppeNumber` VARCHAR(191) NULL,
  `applicationNumber` VARCHAR(191) NULL,
  `status` ENUM('PREPARATION','READY_TO_SUBMIT','SUBMITTED','CORRECTION_REQUIRED','ACCEPTED','METER_WORK','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PREPARATION',
  `submittedAt` DATETIME(3) NULL,
  `deadlineAt` DATETIME(3) NULL,
  `acceptedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `OdsCase_projectId_key`(`projectId`),
  INDEX `OdsCase_status_deadlineAt_idx`(`status`,`deadlineAt`), INDEX `OdsCase_operator_idx`(`operator`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OdsChecklistItem` (
  `id` VARCHAR(191) NOT NULL, `odsCaseId` VARCHAR(191) NOT NULL, `title` VARCHAR(191) NOT NULL,
  `required` BOOLEAN NOT NULL DEFAULT true, `completed` BOOLEAN NOT NULL DEFAULT false,
  `completedAt` DATETIME(3) NULL, `sortOrder` INTEGER NOT NULL DEFAULT 0, `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), INDEX `OdsChecklistItem_odsCaseId_sortOrder_idx`(`odsCaseId`,`sortOrder`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ServiceTicket` (
  `id` VARCHAR(191) NOT NULL, `number` VARCHAR(191) NOT NULL, `clientId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NULL, `installedDeviceId` VARCHAR(191) NULL, `assignedToId` VARCHAR(191) NULL,
  `title` VARCHAR(191) NOT NULL, `description` TEXT NOT NULL,
  `status` ENUM('NEW','DIAGNOSIS','SCHEDULED','IN_PROGRESS','WAITING_PARTS','RESOLVED','CLOSED') NOT NULL DEFAULT 'NEW',
  `priority` ENUM('LOW','NORMAL','HIGH','URGENT') NOT NULL DEFAULT 'NORMAL', `warrantyClaim` BOOLEAN NOT NULL DEFAULT false,
  `dueAt` DATETIME(3) NULL, `resolvedAt` DATETIME(3) NULL, `resolution` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `ServiceTicket_number_key`(`number`),
  INDEX `ServiceTicket_clientId_status_idx`(`clientId`,`status`), INDEX `ServiceTicket_projectId_idx`(`projectId`),
  INDEX `ServiceTicket_installedDeviceId_idx`(`installedDeviceId`), INDEX `ServiceTicket_assignedToId_status_idx`(`assignedToId`,`status`), INDEX `ServiceTicket_dueAt_idx`(`dueAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Document` ADD COLUMN `odsCaseId` VARCHAR(191) NULL, ADD COLUMN `serviceTicketId` VARCHAR(191) NULL;
CREATE INDEX `Document_odsCaseId_idx` ON `Document`(`odsCaseId`);
CREATE INDEX `Document_serviceTicketId_idx` ON `Document`(`serviceTicketId`);

ALTER TABLE `OdsCase` ADD CONSTRAINT `OdsCase_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OdsChecklistItem` ADD CONSTRAINT `OdsChecklistItem_odsCaseId_fkey` FOREIGN KEY (`odsCaseId`) REFERENCES `OdsCase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ServiceTicket` ADD CONSTRAINT `ServiceTicket_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ServiceTicket` ADD CONSTRAINT `ServiceTicket_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ServiceTicket` ADD CONSTRAINT `ServiceTicket_installedDeviceId_fkey` FOREIGN KEY (`installedDeviceId`) REFERENCES `InstalledDevice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ServiceTicket` ADD CONSTRAINT `ServiceTicket_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Document` ADD CONSTRAINT `Document_odsCaseId_fkey` FOREIGN KEY (`odsCaseId`) REFERENCES `OdsCase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Document` ADD CONSTRAINT `Document_serviceTicketId_fkey` FOREIGN KEY (`serviceTicketId`) REFERENCES `ServiceTicket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
