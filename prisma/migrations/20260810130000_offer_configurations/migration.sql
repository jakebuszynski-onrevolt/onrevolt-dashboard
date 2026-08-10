-- One offer can cover multiple independent technical configurations.
CREATE TABLE `OfferConfiguration` (
  `id` VARCHAR(191) NOT NULL,
  `offerId` VARCHAR(191) NOT NULL,
  `configurationId` VARCHAR(191) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `OfferConfiguration_offerId_configurationId_key`(`offerId`, `configurationId`),
  INDEX `OfferConfiguration_offerId_sortOrder_idx`(`offerId`, `sortOrder`),
  INDEX `OfferConfiguration_configurationId_idx`(`configurationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `OfferConfiguration` (`id`, `offerId`, `configurationId`, `sortOrder`, `createdAt`)
SELECT CONCAT('oc_', LEFT(`id`, 188)), `id`, `configurationId`, 0, `createdAt`
FROM `Offer`
WHERE `configurationId` IS NOT NULL;

ALTER TABLE `OfferConfiguration`
  ADD CONSTRAINT `OfferConfiguration_offerId_fkey`
    FOREIGN KEY (`offerId`) REFERENCES `Offer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `OfferConfiguration_configurationId_fkey`
    FOREIGN KEY (`configurationId`) REFERENCES `Configuration`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
