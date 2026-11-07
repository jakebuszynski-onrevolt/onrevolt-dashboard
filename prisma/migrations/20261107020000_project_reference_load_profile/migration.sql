CREATE TABLE `ProjectReferenceLoadProfile` (
  `projectId` VARCHAR(191) NOT NULL,
  `profileKey` VARCHAR(191) NULL,
  `contentHash` CHAR(64) NULL,
  `profileName` VARCHAR(500) NULL,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `projectionVersion` INTEGER NOT NULL DEFAULT 1,
  `selectedById` VARCHAR(191) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`projectId`),
  INDEX `ProjectReferenceLoadProfile_profileKey_idx` (`profileKey`),
  CONSTRAINT `ProjectReferenceLoadProfile_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProjectReferenceLoadProfile_profileKey_fkey`
    FOREIGN KEY (`profileKey`) REFERENCES `ReferenceLoadProfile` (`key`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
