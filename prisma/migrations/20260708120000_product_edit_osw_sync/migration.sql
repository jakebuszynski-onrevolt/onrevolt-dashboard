ALTER TABLE `Product`
  ADD COLUMN `supplierSku` VARCHAR(191) NULL,
  ADD COLUMN `supplierUrl` VARCHAR(191) NULL,
  ADD COLUMN `supplierSyncedAt` DATETIME(3) NULL;

CREATE INDEX `Product_supplierSku_idx` ON `Product`(`supplierSku`);
