-- AlterTable
ALTER TABLE `Task`
  ADD INDEX `Task_createdById_idx`(`createdById`),
  ADD INDEX `Task_priority_idx`(`priority`);

-- CreateTable
CREATE TABLE `TaskComment` (
  `id` VARCHAR(191) NOT NULL,
  `taskId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NULL,
  `body` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `TaskComment_taskId_idx`(`taskId`),
  INDEX `TaskComment_authorId_idx`(`authorId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PanelNotification` (
  `id` VARCHAR(191) NOT NULL,
  `staffUserId` VARCHAR(191) NOT NULL,
  `actorId` VARCHAR(191) NULL,
  `taskId` VARCHAR(191) NULL,
  `type` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `message` TEXT NULL,
  `href` VARCHAR(191) NULL,
  `readAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `PanelNotification_staffUserId_readAt_createdAt_idx`(`staffUserId`, `readAt`, `createdAt`),
  INDEX `PanelNotification_taskId_idx`(`taskId`),
  INDEX `PanelNotification_actorId_idx`(`actorId`),
  INDEX `PanelNotification_type_idx`(`type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TaskComment` ADD CONSTRAINT `TaskComment_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskComment` ADD CONSTRAINT `TaskComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanelNotification` ADD CONSTRAINT `PanelNotification_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanelNotification` ADD CONSTRAINT `PanelNotification_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanelNotification` ADD CONSTRAINT `PanelNotification_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
