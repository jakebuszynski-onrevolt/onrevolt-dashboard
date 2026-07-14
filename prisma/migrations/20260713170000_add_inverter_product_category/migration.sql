ALTER TABLE `Product`
    MODIFY `category` ENUM(
        'MAGAZYN_ENERGII',
        'FALOWNIK',
        'INWERTER',
        'FOTOWOLTAIKA',
        'LICZNIK_GRID',
        'OSPRZET_ELEKTRONIKA',
        'USLUGA_MONTAZOWA',
        'KOSZTY_OPERACYJNE',
        'MONITOROWANIE',
        'SYSTEM_MONITORUJACY',
        'INNE'
    ) NOT NULL;
