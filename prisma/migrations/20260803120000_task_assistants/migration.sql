-- Add assistants to tasks without changing existing task assignments.
CREATE TABLE `TaskAssistant` (
  `taskId` VARCHAR(191) NOT NULL,
  `staffUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `TaskAssistant_staffUserId_idx`(`staffUserId`),
  PRIMARY KEY (`taskId`, `staffUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TaskAssistant`
  ADD CONSTRAINT `TaskAssistant_taskId_fkey`
  FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `TaskAssistant`
  ADD CONSTRAINT `TaskAssistant_staffUserId_fkey`
  FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
