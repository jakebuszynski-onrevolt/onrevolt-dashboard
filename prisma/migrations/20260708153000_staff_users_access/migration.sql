-- AlterTable
ALTER TABLE `StaffUser`
  ADD COLUMN `systemRole` ENUM('ADMIN', 'MODERATOR') NOT NULL DEFAULT 'MODERATOR',
  ADD COLUMN `positionTitle` VARCHAR(191) NULL,
  ADD COLUMN `avatarUrl` VARCHAR(191) NULL,
  ADD COLUMN `passwordHash` VARCHAR(191) NULL,
  ADD COLUMN `passwordResetRequired` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `lastLoginAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `CompanyRole` (
  `id` VARCHAR(191) NOT NULL,
  `code` ENUM('SZEF', 'KOORDYNATOR', 'SPRZEDAWCA', 'MONTER', 'ELEKTRYK', 'SERWIS', 'PROJEKTANT', 'KSIEGOWOSC', 'BIURO', 'PODWYKONAWCA') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `CompanyRole_code_key`(`code`),
  INDEX `CompanyRole_sortOrder_idx`(`sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffUserCompanyRole` (
  `staffUserId` VARCHAR(191) NOT NULL,
  `companyRoleId` VARCHAR(191) NOT NULL,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `StaffUserCompanyRole_companyRoleId_idx`(`companyRoleId`),
  PRIMARY KEY (`staffUserId`, `companyRoleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `StaffUser_systemRole_idx` ON `StaffUser`(`systemRole`);
CREATE INDEX `StaffUser_active_idx` ON `StaffUser`(`active`);

-- AddForeignKey
ALTER TABLE `StaffUserCompanyRole` ADD CONSTRAINT `StaffUserCompanyRole_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffUserCompanyRole` ADD CONSTRAINT `StaffUserCompanyRole_companyRoleId_fkey` FOREIGN KEY (`companyRoleId`) REFERENCES `CompanyRole`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
