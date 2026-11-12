-- Additive role only: existing users and project stages remain unchanged.
ALTER TABLE `CompanyRole` MODIFY `code` ENUM('SZEF', 'KOORDYNATOR', 'SPRZEDAWCA', 'MONTER', 'ELEKTRYK', 'SERWIS', 'PROJEKTANT', 'DEVELOPER', 'KSIEGOWOSC', 'BIURO', 'PODWYKONAWCA', 'WIZJA_LOKALNA') NOT NULL;
