-- Group existing B2C/B2B variants without merging or deleting any template.
ALTER TABLE `ConfigurationTemplate`
  ADD COLUMN `familyKey` VARCHAR(80) NULL,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

UPDATE `ConfigurationTemplate`
SET `familyKey` = CONCAT('legacy-', SHA2(LOWER(TRIM(`name`)), 256))
WHERE `familyKey` IS NULL;

ALTER TABLE `ConfigurationTemplate`
  MODIFY `familyKey` VARCHAR(80) NOT NULL;

CREATE INDEX `ConfigurationTemplate_familyKey_isActive_idx`
  ON `ConfigurationTemplate`(`familyKey`, `isActive`);

ALTER TABLE `Configuration`
  ADD COLUMN `sourceTemplateVersion` INTEGER NULL;

UPDATE `Configuration` AS `configuration`
INNER JOIN `ConfigurationTemplate` AS `template`
  ON `template`.`id` = `configuration`.`templateId`
SET `configuration`.`sourceTemplateVersion` = `template`.`version`
WHERE `configuration`.`sourceTemplateVersion` IS NULL;
