CREATE TABLE `Activity` (
  `id` VARCHAR(191) NOT NULL,
  `type` ENUM('CALL', 'EMAIL', 'MEETING', 'NOTE', 'STATUS_CHANGE', 'SYSTEM') NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` TEXT NULL,
  `clientId` VARCHAR(191) NULL,
  `projectId` VARCHAR(191) NULL,
  `actorId` VARCHAR(191) NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `nextActionAt` DATETIME(3) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `Activity_clientId_occurredAt_idx`(`clientId`, `occurredAt`),
  INDEX `Activity_projectId_occurredAt_idx`(`projectId`, `occurredAt`),
  INDEX `Activity_actorId_occurredAt_idx`(`actorId`, `occurredAt`),
  INDEX `Activity_type_occurredAt_idx`(`type`, `occurredAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkflowRule` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `triggerStageId` VARCHAR(191) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `taskTitle` VARCHAR(191) NOT NULL,
  `taskDescription` TEXT NULL,
  `taskPriority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
  `dueOffsetDays` INTEGER NOT NULL DEFAULT 2,
  `assignToOwner` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `WorkflowRule_triggerStageId_active_idx`(`triggerStageId`, `active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Activity` ADD CONSTRAINT `Activity_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Activity` ADD CONSTRAINT `Activity_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Activity` ADD CONSTRAINT `Activity_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WorkflowRule` ADD CONSTRAINT `WorkflowRule_triggerStageId_fkey` FOREIGN KEY (`triggerStageId`) REFERENCES `PipelineStage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
