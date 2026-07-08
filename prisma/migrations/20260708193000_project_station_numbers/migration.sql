-- AlterTable
ALTER TABLE `Project`
    ADD COLUMN `dashboardStationNumber` VARCHAR(191) NULL,
    ADD COLUMN `weatherStationNumber` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Project_dashboardStation_idx` ON `Project`(`dashboardStation`);

-- CreateIndex
CREATE INDEX `Project_dashboardStationNumber_idx` ON `Project`(`dashboardStationNumber`);
