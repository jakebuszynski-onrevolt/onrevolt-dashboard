CREATE TABLE IF NOT EXISTS `EnergyMeter_reference_load_profiles` (
  `station` VARCHAR(64) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `profileKey` VARCHAR(191) NULL DEFAULT NULL,
  `contentHash` CHAR(64) NULL DEFAULT NULL,
  `payloadJson` MEDIUMTEXT NULL,
  `annualKwh` DECIMAL(16,3) NULL DEFAULT NULL,
  `projectionVersion` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`station`),
  KEY `idx_reference_load_profile_project` (`projectId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
