<?php
// =========================================================================
// PIC: SITI NUR ROHMAH (BACK-END DEVELOPER)
// Scope: Konfigurasi Server, Operasi Database (CRUD), & Statistik Latihan
// =========================================================================
date_default_timezone_set('Asia/Jakarta');

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

session_start();
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $data): never {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond(405, [
        'success' => false,
        'message' => 'Gunakan metode POST.'
    ]);
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    respond(400, [
        'success' => false,
        'message' => 'Format JSON tidak valid.'
    ]);
}

$action = $input['action'] ?? '';

try {
    // 1. SIMPAN DATA PENGGUNA BARU & INISIALISASI TABEL PENGATURAN AWAL
    if ($action === 'register') {
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';
        $mac_address = trim($input['mac_address'] ?? '');

        if (
            !preg_match('/^[a-zA-Z0-9_]{3,50}$/', $username) ||
            !is_string($password) ||
            strlen($password) < 8 ||
            strlen($password) > 72
        ) {
            respond(422, [
                'success' => false,
                'message' => 'Username harus 3–50 karakter dan password 8–72 karakter.'
            ]);
        }

        $pdo->beginTransaction();

        $stmt = $pdo->prepare(
            'INSERT INTO users (username, password_hash, mac_address)
             VALUES (?, ?, ?)'
        );
        $stmt->execute([
            $username,
            password_hash($password, PASSWORD_DEFAULT),
            $mac_address
        ]);

        $userId = (int) $pdo->lastInsertId();

        $stmt = $pdo->prepare(
            'INSERT INTO machine_settings (user_id)
             VALUES (?)'
        );
        $stmt->execute([$userId]);

        $stmt = $pdo->prepare(
            'INSERT INTO activity_history (user_id, activity)
             VALUES (?, ?)'
        );
        $stmt->execute([$userId, 'register']);

        $pdo->commit();

        respond(201, [
            'success' => true,
            'message' => 'Registrasi berhasil.'
        ]);
    }

    // 2. SIMPAN / CATAT SESI LATIHAN (TABEL training_sessions)
    if ($action === 'save_training') {
        $userId = $_SESSION['user_id'] ?? null;

        if (!$userId) {
            respond(401, [
                'success' => false,
                'message' => 'Unauthorized. Sesi pengguna tidak ditemukan.'
            ]);
        }

        $mode = $input['mode'] ?? 'custom';
        $speed = (int) ($input['speed'] ?? 75);
        $interval_seconds = (int) ($input['interval'] ?? 2);
        $status = $input['status'] ?? 'completed';
        $notes = $input['notes'] ?? '';
        $duration_input = isset($input['duration']) ? (int) $input['duration'] : 0;

        if ($status === 'running') {
            $stmt = $pdo->prepare(
                'INSERT INTO training_sessions (user_id, mode, speed, interval_seconds, started_at, ended_at, duration_seconds, status, notes) 
                 VALUES (?, ?, ?, ?, NOW(), NOW(), 0, ?, ?)'
            );
            $stmt->execute([$userId, $mode, $speed, $interval_seconds, $status, $notes]);
        } else {
            $stmtFind = $pdo->prepare(
                'SELECT id, started_at FROM training_sessions WHERE user_id = ? AND status = "running" ORDER BY id DESC LIMIT 1'
            );
            $stmtFind->execute([$userId]);
            $activeSession = $stmtFind->fetch();

            if ($activeSession) {
                $sessionId = $activeSession['id'];
                $endedAt = date('Y-m-d H:i:s');
                
                $duration = $duration_input > 0 ? $duration_input : (strtotime($endedAt) - strtotime($activeSession['started_at']));
                if ($duration < 0) $duration = 0;

                $stmtUpdate = $pdo->prepare(
                    'UPDATE training_sessions 
                     SET ended_at = ?, duration_seconds = ?, status = ?, notes = ? 
                     WHERE id = ?'
                );
                $stmtUpdate->execute([$endedAt, $duration, 'completed', $notes, $sessionId]);
            } else {
                $stmt = $pdo->prepare(
                    'INSERT INTO training_sessions (user_id, mode, speed, interval_seconds, started_at, ended_at, duration_seconds, status, notes) 
                     VALUES (?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)'
                );
                $stmt->execute([$userId, $mode, $speed, $interval_seconds, $duration_input, $status, $notes]);
            }
        }

        respond(200, [
            'success' => true,
            'message' => 'Sesi latihan berhasil dicatat ke database.'
        ]);
    }

    // 3. AMBIL PENGATURAN MESIN (TABEL machine_settings)
    if ($action === 'get_settings') {
        $userId = $_SESSION['user_id'] ?? null;

        if (!$userId) {
            respond(401, [
                'success' => false,
                'message' => 'Unauthorized. Silakan login terlebih dahulu.'
            ]);
        }

        $stmt = $pdo->prepare('SELECT mode, speed, interval_seconds, direction, random_enabled FROM machine_settings WHERE user_id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $settings = $stmt->fetch();

        if (!$settings) {
            $stmt = $pdo->prepare('INSERT INTO machine_settings (user_id, mode, speed, interval_seconds, direction, random_enabled) VALUES (?, "custom", 75, 2, "stop", 0)');
            $stmt->execute([$userId]);
            $settings = [
                'mode' => 'custom',
                'speed' => 75,
                'interval_seconds' => 2,
                'direction' => 'stop',
                'random_enabled' => 0
            ];
        }

        respond(200, [
            'success' => true,
            'settings' => $settings
        ]);
    }

    // 4. PERBARUI PENGATURAN MESIN (TABEL machine_settings)
    if ($action === 'update_settings') {
        $userId = $_SESSION['user_id'] ?? null;

        if (!$userId) {
            respond(401, [
                'success' => false,
                'message' => 'Unauthorized.'
            ]);
        }

        $mode = $input['mode'] ?? 'custom';
        $speed = (int) ($input['speed'] ?? 75);
        $interval_seconds = (int) ($input['interval'] ?? 2);
        $direction = $input['direction'] ?? 'stop';
        $random_enabled = isset($input['random_enabled']) ? (int)$input['random_enabled'] : 0;

        $stmt = $pdo->prepare('SELECT id FROM machine_settings WHERE user_id = ?');
        $stmt->execute([$userId]);
        $exists = $stmt->fetch();

        if ($exists) {
            $stmt = $pdo->prepare(
                'UPDATE machine_settings 
                 SET mode = ?, speed = ?, interval_seconds = ?, direction = ?, random_enabled = ?, updated_at = NOW() 
                 WHERE user_id = ?'
            );
            $stmt->execute([$mode, $speed, $interval_seconds, $direction, $random_enabled, $userId]);
        } else {
            $stmt = $pdo->prepare(
                'INSERT INTO machine_settings (user_id, mode, speed, interval_seconds, direction, random_enabled, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, NOW())'
            );
            $stmt->execute([$userId, $mode, $speed, $interval_seconds, $direction, $random_enabled]);
        }

        respond(200, [
            'success' => true,
            'message' => 'Machine settings berhasil diperbarui.'
        ]);
    }

    // 5. AMBIL DATA HISTORI LATIHAN & KALKULASI STATISTIK RINGKASAN
    if ($action === 'get_history') {
        $userId = $_SESSION['user_id'] ?? null;

        if (!$userId) {
            respond(401, [
                'success' => false,
                'message' => 'Unauthorized. Silakan login terlebih dahulu.'
            ]);
        }

        $filter = $input['filter'] ?? 'all';
        $sql = 'SELECT id, mode, speed, interval_seconds, started_at, ended_at, status, notes 
                FROM training_sessions 
                WHERE user_id = ?';
        
        $params = [$userId];

        if ($filter === 'today') {
            $sql .= ' AND DATE(started_at) = CURDATE()';
        } elseif ($filter === 'week') {
            $sql .= ' AND WEEK(started_at, 1) = WEEK(NOW(), 1) AND YEAR(started_at) = YEAR(NOW())';
        } elseif ($filter === 'month') {
            $sql .= ' AND MONTH(started_at) = MONTH(NOW()) AND YEAR(started_at) = YEAR(NOW())';
        }

        $sql .= ' ORDER BY started_at DESC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $sessions = $stmt->fetchAll();

        $stmtSum = $pdo->prepare("SELECT COUNT(*) as total_sesi, SUM(duration_seconds) as total_detik FROM training_sessions WHERE user_id = ? AND status = 'completed'");
        $stmtSum->execute([$userId]);
        $summaryData = $stmtSum->fetch();

        $totalSesi = (int) ($summaryData['total_sesi'] ?? count($sessions));
        $totalDetik = (int) ($summaryData['total_detik'] ?? 0);

        $totalJam = round($totalDetik / 3600, 1);
        $rataRataMnt = $totalSesi > 0 ? round(($totalDetik / $totalSesi) / 60) : 0;

        respond(200, [
            'success' => true,
            'summary' => [
                'total_sesi' => $totalSesi,
                'total_durasi_jam' => $totalJam,
                'rata_rata_mnt' => $rataRataMnt
            ],
            'history' => $sessions
        ]);
    }

    respond(400, [
        'success' => false,
        'message' => 'Action tidak dikenal.'
    ]);

} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    error_log($e->getMessage());

    if ($e->getCode() === '23000') {
        respond(409, [
            'success' => false,
            'message' => 'Username sudah digunakan.'
        ]);
    }

    respond(500, [
        'success' => false,
        'message' => 'Terjadi kesalahan pada server.'
    ]);
}
?>