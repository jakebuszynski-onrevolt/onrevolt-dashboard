-- Existing rows keep their historical per-line costs until explicitly reviewed.
ALTER TABLE `ConfigurationTemplateItem`
  ADD COLUMN `pricingMode` VARCHAR(16) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN `operatingCostBasis` VARCHAR(16) NOT NULL DEFAULT 'PER_LINE',
  ADD COLUMN `catalogPriceId` VARCHAR(191) NULL;

ALTER TABLE `ConfigurationItem`
  ADD COLUMN `pricingMode` VARCHAR(16) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN `operatingCostBasis` VARCHAR(16) NOT NULL DEFAULT 'PER_LINE',
  ADD COLUMN `catalogPriceId` VARCHAR(191) NULL;
