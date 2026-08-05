-- Add structured client discovery notes without changing existing records.
ALTER TABLE `Client`
  ADD COLUMN `clientProblem` TEXT NULL,
  ADD COLUMN `expectedResult` TEXT NULL;
