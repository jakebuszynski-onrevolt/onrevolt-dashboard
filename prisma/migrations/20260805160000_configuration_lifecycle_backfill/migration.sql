-- Align legacy configurations with the lifecycle already represented by related records.
UPDATE `Configuration` AS `configuration`
SET `configuration`.`status` = 'OFFERED'
WHERE `configuration`.`status` IN ('DRAFT', 'READY')
  AND EXISTS (
    SELECT 1
    FROM `Offer` AS `offer`
    WHERE `offer`.`configurationId` = `configuration`.`id`
  );

UPDATE `Configuration` AS `configuration`
SET `configuration`.`status` = 'ACCEPTED'
WHERE `configuration`.`status` IN ('DRAFT', 'READY', 'OFFERED')
  AND EXISTS (
    SELECT 1
    FROM `Offer` AS `offer`
    WHERE `offer`.`configurationId` = `configuration`.`id`
      AND `offer`.`status` = 'ACCEPTED'
  );

UPDATE `Configuration` AS `configuration`
SET `configuration`.`status` = 'INSTALLED'
WHERE `configuration`.`status` <> 'ARCHIVED'
  AND EXISTS (
    SELECT 1
    FROM `Installation` AS `installation`
    WHERE `installation`.`configurationId` = `configuration`.`id`
  );
