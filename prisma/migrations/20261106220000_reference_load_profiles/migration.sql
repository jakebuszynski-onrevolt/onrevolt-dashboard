CREATE TABLE `ReferenceLoadProfileSource` (
  `key` VARCHAR(191) NOT NULL,
  `title` VARCHAR(500) NOT NULL,
  `publisher` VARCHAR(255) NOT NULL,
  `url` TEXT NOT NULL,
  `downloadUrl` TEXT NULL,
  `retrievedAt` VARCHAR(191) NOT NULL,
  `license` VARCHAR(255) NOT NULL,
  `rawSha256` CHAR(64) NOT NULL,
  `notes` TEXT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ReferenceLoadProfile` (
  `key` VARCHAR(191) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `name` VARCHAR(500) NOT NULL,
  `category` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(64) NOT NULL,
  `quantity` VARCHAR(100) NOT NULL,
  `unit` VARCHAR(64) NOT NULL,
  `timeBasis` VARCHAR(64) NOT NULL,
  `resolutionMinutes` INTEGER NOT NULL,
  `start` VARCHAR(191) NULL,
  `end` VARCHAR(191) NULL,
  `pointCount` INTEGER UNSIGNED NOT NULL,
  `contentHash` CHAR(64) NOT NULL,
  `series` JSON NOT NULL,
  `metadata` JSON NOT NULL,
  `quality` JSON NOT NULL,
  PRIMARY KEY (`key`),
  INDEX `ReferenceLoadProfile_sourceKey_idx` (`sourceKey`),
  INDEX `ReferenceLoadProfile_category_kind_idx` (`category`, `kind`),
  CONSTRAINT `ReferenceLoadProfile_sourceKey_fkey`
    FOREIGN KEY (`sourceKey`) REFERENCES `ReferenceLoadProfileSource` (`key`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
