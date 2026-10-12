ALTER TABLE `Product`
  ADD COLUMN `legacySku` VARCHAR(191) NULL;

CREATE INDEX `Product_legacySku_idx` ON `Product`(`legacySku`);
