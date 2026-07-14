CREATE TABLE `PurchaseOrder` (
  `id` VARCHAR(191) NOT NULL,
  `number` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `offerId` VARCHAR(191) NULL,
  `supplier` VARCHAR(191) NOT NULL,
  `status` ENUM('DRAFT','ORDERED','PARTIAL','DELIVERED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `orderedAt` DATETIME(3) NULL,
  `expectedAt` DATETIME(3) NULL,
  `deliveredAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PurchaseOrder_number_key`(`number`),
  INDEX `PurchaseOrder_projectId_idx`(`projectId`),
  INDEX `PurchaseOrder_offerId_idx`(`offerId`),
  INDEX `PurchaseOrder_supplier_idx`(`supplier`),
  INDEX `PurchaseOrder_status_expectedAt_idx`(`status`,`expectedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseOrderItem` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `supplierSku` VARCHAR(191) NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `receivedQuantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `unitPurchaseNet` DECIMAL(12,2) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `PurchaseOrderItem_purchaseOrderId_idx`(`purchaseOrderId`),
  INDEX `PurchaseOrderItem_productId_idx`(`productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockReservation` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `configurationId` VARCHAR(191) NULL,
  `productId` VARCHAR(191) NULL,
  `purchaseOrderItemId` VARCHAR(191) NULL,
  `installationId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `status` ENUM('RESERVED','RELEASED','ISSUED','CANCELLED') NOT NULL DEFAULT 'RESERVED',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `StockReservation_projectId_status_idx`(`projectId`,`status`),
  INDEX `StockReservation_configurationId_idx`(`configurationId`),
  INDEX `StockReservation_productId_idx`(`productId`),
  INDEX `StockReservation_purchaseOrderItemId_idx`(`purchaseOrderItemId`),
  INDEX `StockReservation_installationId_idx`(`installationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_offerId_fkey` FOREIGN KEY (`offerId`) REFERENCES `Offer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `StockReservation` ADD CONSTRAINT `StockReservation_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `StockReservation` ADD CONSTRAINT `StockReservation_configurationId_fkey` FOREIGN KEY (`configurationId`) REFERENCES `Configuration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `StockReservation` ADD CONSTRAINT `StockReservation_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `StockReservation` ADD CONSTRAINT `StockReservation_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `StockReservation` ADD CONSTRAINT `StockReservation_installationId_fkey` FOREIGN KEY (`installationId`) REFERENCES `Installation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
