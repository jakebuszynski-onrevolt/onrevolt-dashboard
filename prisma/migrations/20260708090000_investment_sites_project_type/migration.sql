-- AlterEnum
ALTER TABLE `Client`
    MODIFY `clientType` ENUM('UNKNOWN', 'B2C', 'B2B', 'B2C_B2B') NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE `Product`
    MODIFY `clientType` ENUM('UNKNOWN', 'B2C', 'B2B', 'B2C_B2B') NULL;

ALTER TABLE `ConfigurationTemplate`
    MODIFY `clientType` ENUM('UNKNOWN', 'B2C', 'B2B', 'B2C_B2B') NOT NULL;

ALTER TABLE `Configuration`
    MODIFY `clientType` ENUM('UNKNOWN', 'B2C', 'B2B', 'B2C_B2B') NOT NULL;

-- CreateTable
CREATE TABLE `InvestmentSite` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `addressLine` VARCHAR(191) NULL,
    `postalCode` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `fullAddress` VARCHAR(191) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `source` VARCHAR(191) NULL,
    `pipedriveOrgId` VARCHAR(191) NULL,
    `pipedriveDealId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InvestmentSite_pipedriveDealId_key`(`pipedriveDealId`),
    INDEX `InvestmentSite_clientId_idx`(`clientId`),
    INDEX `InvestmentSite_city_idx`(`city`),
    INDEX `InvestmentSite_source_idx`(`source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Project`
    ADD COLUMN `investmentSiteId` VARCHAR(191) NULL,
    ADD COLUMN `clientType` ENUM('UNKNOWN', 'B2C', 'B2B', 'B2C_B2B') NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex
CREATE INDEX `Project_investmentSiteId_idx` ON `Project`(`investmentSiteId`);
CREATE INDEX `Project_clientType_idx` ON `Project`(`clientType`);
CREATE INDEX `Project_source_idx` ON `Project`(`source`);

-- AddForeignKey
ALTER TABLE `InvestmentSite` ADD CONSTRAINT `InvestmentSite_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_investmentSiteId_fkey` FOREIGN KEY (`investmentSiteId`) REFERENCES `InvestmentSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
