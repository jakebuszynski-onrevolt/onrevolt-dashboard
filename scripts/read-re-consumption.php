<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = realpath($argv[1] ?? '');
$station = $argv[2] ?? '';
$from = $argv[3] ?? '';
$to = $argv[4] ?? '';
if ($root === false || !is_file($root . '/api/dashboard.php') || !preg_match('/^[0-9A-Za-z_-]{1,64}$/D', $station)) {
    fwrite(STDERR, "Nieprawidłowy katalog RE albo identyfikator stacji\n");
    exit(1);
}
$fromDate = DateTimeImmutable::createFromFormat('!Y-m-d', $from);
$toDate = DateTimeImmutable::createFromFormat('!Y-m-d', $to);
if (!$fromDate || !$toDate || $fromDate->format('Y-m-d') !== $from || $toDate->format('Y-m-d') !== $to
    || $toDate <= $fromDate || (int)$fromDate->diff($toDate)->days > 31) {
    fwrite(STDERR, "Nieprawidłowy miesięczny zakres profilu RE\n");
    exit(1);
}

// Dostęp wyłącznie lokalnego procesu CRM, bez sesji klienta i bez operacji zapisu.
define('ONREVOLT_CRM_READ_ONLY_PROFILE', true);
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = ['station' => $station, 'from' => $from, 'to' => $to, 'context' => '0'];
$_POST = [];
require $root . '/api/dashboard.php';
