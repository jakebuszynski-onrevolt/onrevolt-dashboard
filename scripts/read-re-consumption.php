<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = realpath($argv[1] ?? '');
$station = $argv[2] ?? '';
if ($root === false || !is_file($root . '/api/dashboard.php') || !preg_match('/^[0-9A-Za-z_-]{1,64}$/D', $station)) {
    fwrite(STDERR, "Nieprawidłowy katalog RE albo identyfikator stacji\n");
    exit(1);
}

// Dostęp wyłącznie lokalnego procesu CRM, bez sesji klienta i bez operacji zapisu.
define('ONREVOLT_CRM_READ_ONLY_PROFILE', true);
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = ['station' => $station, 'days' => '370'];
$_POST = [];
require $root . '/api/dashboard.php';
