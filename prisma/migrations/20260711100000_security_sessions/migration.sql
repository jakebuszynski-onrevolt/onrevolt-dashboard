CREATE TABLE `StaffSession` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `staffUserId` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,
  `userAgent` VARCHAR(500) NULL,
  `ipHash` CHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `StaffSession_tokenHash_key`(`tokenHash`),
  INDEX `StaffSession_staffUserId_revokedAt_expiresAt_idx`(`staffUserId`, `revokedAt`, `expiresAt`),
  INDEX `StaffSession_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StaffSession`
  ADD CONSTRAINT `StaffSession_staffUserId_fkey`
  FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
