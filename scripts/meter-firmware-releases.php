<?php
declare(strict_types=1);

// Deploy as releases.php in OTA/EnergyMeter and OTA/EnergyMeter/PGE.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$family = basename(__DIR__) === 'PGE' ? 'PGE' : 'ENERGYMETER';
$urlPrefix = 'https://windyone.pl/OTA/EnergyMeter/' . ($family === 'PGE' ? 'PGE/' : '') . 'firmware/';
$versionPattern = $family === 'PGE' ? '/^PGE-\d{4}\.\d{2}\.\d{2}\.\d+$/' : '/^\d{4}\.\d{2}\.\d{2}\.\d+$/';

try {
    $directory = __DIR__ . '/releases';
    if (!is_dir($directory) || !is_readable($directory)) {
        throw new RuntimeException('Release directory unavailable');
    }
    $files = glob($directory . '/*.json');
    if ($files === false || count($files) === 0) {
        throw new RuntimeException('No releases');
    }
    $releases = [];
    foreach ($files as $file) {
        if (is_link($file) || !is_file($file) || filesize($file) > 65536) {
            throw new RuntimeException('Invalid manifest file');
        }
        $release = json_decode(file_get_contents($file), true, 16, JSON_THROW_ON_ERROR);
        if (!is_array($release)
            || !isset($release['version'], $release['url'], $release['sha256'], $release['size'])
            || !is_string($release['version']) || !preg_match($versionPattern, $release['version'])
            || basename($file) !== $release['version'] . '.json'
            || !is_string($release['sha256']) || !preg_match('/^[a-f0-9]{64}$/i', $release['sha256'])
            || !is_int($release['size']) || $release['size'] <= 0
            || !is_string($release['url']) || !str_starts_with($release['url'], $urlPrefix)
            || ($family === 'PGE' && ($release['family'] ?? null) !== 'PGE-SX1276')) {
            throw new RuntimeException('Invalid release metadata');
        }
        $binaryName = substr($release['url'], strlen($urlPrefix));
        if (!preg_match('/^[A-Za-z0-9._-]+\.bin$/', $binaryName)) {
            throw new RuntimeException('Invalid binary name');
        }
        $binary = __DIR__ . '/firmware/' . $binaryName;
        if (is_link($binary) || !is_file($binary) || filesize($binary) !== $release['size']) {
            throw new RuntimeException('Missing or incomplete binary');
        }
        // Return only public release metadata, never station or device configuration.
        $item = [
            'version' => $release['version'],
            'url' => $release['url'],
            'sha256' => $release['sha256'],
            'size' => $release['size'],
        ];
        if ($family === 'PGE') $item['family'] = 'PGE-SX1276';
        $releases[] = $item;
    }
    usort($releases, static fn(array $a, array $b): int => version_compare($b['version'], $a['version']));
    echo json_encode(['family' => $family, 'releases' => $releases], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    error_log('Firmware catalog ' . $family . ': ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['error' => 'Firmware catalog unavailable']);
}
