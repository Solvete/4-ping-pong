<?php
date_default_timezone_set('Asia/Jakarta');

// Header CORS agar dapat diakses dari ESP32 / perangkat lain dalam jaringan lokal
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Tangani preflight request OPTIONS dari browser
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
    // REGISTER
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

    // LOGIN (DENGAN FITUR COOLDOWN 3 MENIT & CEK LOGIN AKTIF DI PERANGKAT LAIN)
    if ($action === 'login') {
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';

        if (
            $username === '' ||
            !is_string($password) ||
            $password === ''
        ) {
            respond(422, [
                'success' => false,
                'message' => 'Username dan password wajib diisi.'
            ]);
        }

        // Ambil data user beserta kolom pelacak gagal dan waktu lockout
        $stmt = $pdo->prepare(
            'SELECT id, username, password_hash, role, failed_attempts, lockout_until
             FROM users
             WHERE username = ? AND account_status = ?'
        );
        $stmt->execute([$username, 'active']);
        $user = $stmt->fetch();

        if (!$user) {
            respond(401, [
                'success' => false,
                'message' => 'Username atau password salah.'
            ]);
        }

        // Cek apakah akun sedang dalam masa cooldown (3 menit)
        if (!empty($user['lockout_until']) && strtotime($user['lockout_until']) > time()) {
            $sisa_detik = strtotime($user['lockout_until']) - time();
            $sisa_menit = ceil($sisa_detik / 60);
            
            respond(429, [
                'success' => false,
                'message' => "Akun dikunci sementara karena 3x salah password. Silakan coba lagi dalam {$sisa_menit} menit."
            ]);
        }

        // Verifikasi password
        if (!password_verify($password, $user['password_hash'])) {
            $new_failed = $user['failed_attempts'] + 1;
            
            if ($new_failed >= 3) {
                // Jika sudah 3 kali gagal, kunci akun selama 3 menit
                $stmtLock = $pdo->prepare(
                    'UPDATE users SET failed_attempts = ?, lockout_until = DATE_ADD(NOW(), INTERVAL 3 MINUTE) WHERE id = ?'
                );
                $stmtLock->execute([$new_failed, $user['id']]);

                respond(429, [
                    'success' => false,
                    'message' => 'Terlalu banyak percobaan gagal. Akun dikunci selama 3 menit.'
                ]);
            } else {
                // Jika belum 3 kali, update jumlah kegagalan saja
                $stmtUpdate = $pdo->prepare(
                    'UPDATE users SET failed_attempts = ? WHERE id = ?'
                );
                $stmtUpdate->execute([$new_failed, $user['id']]);

                $sisa_kesempatan = 3 - $new_failed;
                respond(401, [
                    'success' => false,
                    'message' => "Username atau password salah. Sisa percobaan: {$sisa_kesempatan} kali."
                ]);
            }
        }

        // CEK APAKAH USER INI SUDAH PUNYA SESI AKTIF DI PERANGKAT LAIN (TOLAK LOGIN KEDUA)
        $stmtCheckActive = $pdo->prepare(
            "SELECT id FROM device_sessions WHERE user_id = ? AND connection_status = 'connected' AND expires_at > NOW() LIMIT 1"
        );
        $stmtCheckActive->execute([$user['id']]);
        $activeSession = $stmtCheckActive->fetch();

        if ($activeSession) {
            respond(409, [
                'success' => false,
                'message' => 'Login ditolak! Akun ini sedang aktif digunakan di perangkat lain.'
            ]);
        }

        // Jika Login Berhasil: Reset kembali counter gagal dan lockout_until menjadi NULL
        $stmtReset = $pdo->prepare(
            'UPDATE users SET failed_attempts = 0, lockout_until = NULL WHERE id = ?'
        );
        $stmtReset->execute([$user['id']]);

        session_regenerate_id(true);

        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['role'] = $user['role'];

        $pdo->beginTransaction();

        $stmt = $pdo->prepare(
            'INSERT INTO activity_history (user_id, activity)
             VALUES (?, ?)'
        );
        $stmt->execute([(int) $user['id'], 'login']);

        $token = bin2hex(random_bytes(32));
        $expires_at = date('Y-m-d H:i:s', strtotime('+24 hours'));

        $ip_address = $_SERVER['REMOTE_ADDR'] ?? null;
        $mac_address = $input['mac_address'] ?? $_SERVER['HTTP_X_MAC_ADDRESS'] ?? null;

        // Masukkan token baru ke tabel device_sessions tanpa menutup sesi perangkat pertama
        $stmt = $pdo->prepare(
            'INSERT INTO device_sessions (user_id, mac_address, ip_address, token, expires_at, connection_status, connected_at) VALUES (?, ?, ?, ?, ?, "connected", NOW())'
        );
        $stmt->execute([(int) $user['id'], $mac_address, $ip_address, $token, $expires_at]);

        $pdo->commit();

        respond(200, [
            'success' => true,
            'message' => 'Login berhasil.',
            'token' => $token,
            'user' => [
                'id' => (int) $user['id'],
                'username' => $user['username'],
                'role' => $user['role']
            ]
        ]);
    }

    // CEK SESI LOGIN
    if ($action === 'me') {
        if (!isset($_SESSION['user_id'])) {
            respond(401, [
                'success' => false,
                'message' => 'Belum login.'
            ]);
        }

        respond(200, [
            'success' => true,
            'user' => [
                'id' => $_SESSION['user_id'],
                'username' => $_SESSION['username'],
                'role' => $_SESSION['role']
            ]
        ]);
    }

   // LOGOUT
    if ($action === 'logout') {
        $headers = getallheaders();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        $token = '';

        if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
            $token = $matches[1];
        }

        $userId = null;

        if (isset($_SESSION['user_id'])) {
            $userId = (int) $_SESSION['user_id'];
        } elseif (!empty($token)) {
            $stmt = $pdo->prepare(
                'SELECT user_id FROM device_sessions WHERE token = ? AND expires_at > NOW() LIMIT 1'
            );
            $stmt->execute([$token]);
            $sessionData = $stmt->fetch();

            if ($sessionData) {
                $userId = (int) $sessionData['user_id'];
            }
        }

        if ($userId) {
            $stmt = $pdo->prepare(
                'INSERT INTO activity_history (user_id, activity)
                 VALUES (?, ?)'
            );
            $stmt->execute([
                $userId,
                'logout'
            ]);

            // Update waktu disconnect secara real-time detik itu juga
            $stmt = $pdo->prepare(
                "UPDATE device_sessions 
                 SET disconnected_at = NOW(), connection_status = 'disconnected' 
                 WHERE user_id = ? AND connection_status = 'connected'"
            );
            $stmt->execute([$userId]);
        }

        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();

            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                $params['secure'],
                $params['httponly']
            );
        }

        session_destroy();

        respond(200, [
            'success' => true,
            'message' => 'Logout berhasil.'
        ]);
    }

    // FORGOT PASSWORD - TAHAP 1
    if ($action === 'forgot_verify') {
        $username = trim($input['username'] ?? '');
        $current_mac = trim($input['mac_address'] ?? '');

        if ($username === '') {
            respond(422, [
                'success' => false,
                'message' => 'Username wajib diisi.'
            ]);
        }

        $stmt =$pdo->prepare(
            'SELECT id, mac_address FROM users WHERE username = ? AND account_status = ?'
        );
        $stmt->execute([$username, 'active']);
        $user =$stmt->fetch();

        if (!$user) {
            respond(404, [
                'success' => false,
                'message' => 'Username tidak ditemukan atau akun tidak aktif.'
            ]);
        }

        if (empty($user['mac_address']) || strcasecmp($user['mac_address'],$current_mac) !== 0) {
            respond(403, [
                'success' => false,
                'message' => 'Akses ditolak! Reset password hanya dapat dilakukan dari perangkat asli saat registrasi.'
            ]);
        }

        $userId = (int) $user['id'];$expires_at = date('Y-m-d H:i:s', strtotime('+1 hour'));

        $pdo->beginTransaction();

        $stmt =$pdo->prepare(
            'INSERT INTO activity_history (user_id, activity) VALUES (?, ?)'
        );
        $stmt->execute([$userId, 'password_verify_request']);

        $stmt =$pdo->prepare(
            'INSERT INTO password_reset_requests (user_id, submitted_mac, status, expires_at) VALUES (?, ?, ?, ?)'
        );
        $stmt->execute([$userId, $current_mac, 'pending',$expires_at]);

        $pdo->commit();

        respond(200, [
            'success' => true,
            'message' => 'Username dan perangkat terverifikasi.'
        ]);
    }

    // FORGOT PASSWORD - TAHAP 2
    if ($action === 'forgot_reset') {
        $username = trim($input['username'] ?? '');
        $newPassword =$input['newPassword'] ?? '';

        if ($username === '' || !is_string($newPassword) || strlen($newPassword) < 8 || strlen($newPassword) > 72) {
            respond(422, [
                'success' => false,
                'message' => 'Username dan password baru (8–72 karakter) wajib diisi.'
            ]);
        }

        $pdo->beginTransaction();

        $stmt =$pdo->prepare('SELECT id FROM users WHERE username = ? AND account_status = ?');
        $stmt->execute([$username, 'active']);
        $user =$stmt->fetch();

        if (!$user) {$pdo->rollBack();
            respond(404, [
                'success' => false,
                'message' => 'Username tidak ditemukan.'
            ]);
        }

        $userId = (int)$user['id'];
        $newHash = password_hash($newPassword, PASSWORD_DEFAULT);

        $stmt =$pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $stmt->execute([$newHash,$userId]);

        $stmt =$pdo->prepare(
            'INSERT INTO activity_history (user_id, activity) VALUES (?, ?)'
        );
        $stmt->execute([$userId, 'password_reset']);

        $stmt =$pdo->prepare(
            "UPDATE password_reset_requests SET status = 'completed' WHERE user_id = ? AND status = 'pending'"
        );
        $stmt->execute([$userId]);

        $pdo->commit();

        respond(200, [
            'success' => true,
            'message' => 'Password berhasil diperbarui.'
        ]);
    }

    // SIMPAN / CATAT SESI LATIHAN (TRAINING SESSIONS)
    if ($action === 'save_training') {
        $headers = getallheaders();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        $token = '';

        if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
            $token = $matches[1];
        }

        $userId = null;

        if (isset($_SESSION['user_id'])) {
            $userId = (int)$_SESSION['user_id'];
        } elseif (!empty($token)) {
            $stmt = $pdo->prepare(
                'SELECT user_id FROM device_sessions WHERE token = ? AND expires_at > NOW() LIMIT 1'
            );
            $stmt->execute([$token]);
            $sessionData = $stmt->fetch();

            if ($sessionData) {
                $userId = (int)$sessionData['user_id'];
            }
        }

        if (!$userId) {
            respond(401, [
                'success' => false,
                'message' => 'Unauthorized. Token sesi tidak valid atau kedaluwarsa.'
            ]);
        }

        $mode = $input['mode'] ?? 'custom';
        $speed = (int) ($input['speed'] ?? 75);
        $interval_seconds = (int) ($input['interval'] ?? 2);
        $status = $input['status'] ?? 'completed';
        $notes = $input['notes'] ?? '';
        
        // Tangkap durasi riil dari JavaScript
        $duration_input = isset($input['duration']) ? (int) $input['duration'] : 0;

        if ($status === 'running') {
            // Jika status running (Mulai), buat baris baru dengan started_at = NOW()
            $stmt = $pdo->prepare(
                'INSERT INTO training_sessions (user_id, mode, speed, interval_seconds, started_at, ended_at, duration_seconds, status, notes) 
                 VALUES (?, ?, ?, ?, NOW(), NOW(), 0, ?, ?)'
            );
            $stmt->execute([$userId, $mode, $speed, $interval_seconds, $status, $notes]);
        } else {
            // Jika status completed (Berhenti), update sesi terakhir yang masih running milik user tersebut
            $stmtFind = $pdo->prepare(
                'SELECT id, started_at FROM training_sessions WHERE user_id = ? AND status = "running" ORDER BY id DESC LIMIT 1'
            );
            $stmtFind->execute([$userId]);
            $activeSession = $stmtFind->fetch();

            if ($activeSession) {
                $sessionId = $activeSession['id'];
                $endedAt = date('Y-m-d H:i:s');
                
                // Gunakan durasi riil yang dikirim dari JavaScript, fallback ke hitungan selisih waktu database jika input kosong
                $duration = $duration_input > 0 ? $duration_input : (strtotime($endedAt) - strtotime($activeSession['started_at']));
                if ($duration < 0) $duration = 0;

                $stmtUpdate = $pdo->prepare(
                    'UPDATE training_sessions 
                     SET ended_at = ?, duration_seconds = ?, status = ?, notes = ? 
                     WHERE id = ?'
                );
                $stmtUpdate->execute([$endedAt, $duration, 'completed', $notes, $sessionId]);
            } else {
                // Fallback jika tidak ada sesi running yang ditemukan
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

    // AMBIL MACHINE SETTINGS
    if ($action === 'get_settings') {$headers = getallheaders();
        $authHeader =$headers['Authorization'] ?? $headers['authorization'] ?? '';$token = '';

        if (preg_match('/Bearer\s(\S+)/', $authHeader,$matches)) {
            $token =$matches[1];
        }

        $userId = null;

        if (isset($_SESSION['user_id'])) {
            $userId = (int)$_SESSION['user_id'];
        } elseif (!empty($token)) {
            $stmt =$pdo->prepare(
                'SELECT user_id FROM device_sessions WHERE token = ? AND expires_at > NOW() LIMIT 1'
            );
            $stmt->execute([$token]);
            $sessionData =$stmt->fetch();

            if ($sessionData) {
                $userId = (int)$sessionData['user_id'];
            }
        }

        if (!$userId) {
            respond(401, [
                'success' => false,
                'message' => 'Unauthorized. Silakan login terlebih dahulu.'
            ]);
        }

        $stmt =$pdo->prepare('SELECT mode, speed, interval_seconds, direction, random_enabled FROM machine_settings WHERE user_id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $settings =$stmt->fetch();

        if (!$settings) {
            $stmt =$pdo->prepare('INSERT INTO machine_settings (user_id, mode, speed, interval_seconds, direction, random_enabled) VALUES (?, "custom", 75, 2, "stop", 0)');
            $stmt->execute([$userId]);$settings = [
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

    // UPDATE MACHINE SETTINGS
    if ($action === 'update_settings') {$headers = getallheaders();
        $authHeader =$headers['Authorization'] ?? $headers['authorization'] ?? '';$token = '';

        if (preg_match('/Bearer\s(\S+)/', $authHeader,$matches)) {
            $token =$matches[1];
        }

        $userId = null;

        if (isset($_SESSION['user_id'])) {
            $userId = (int)$_SESSION['user_id'];
        } elseif (!empty($token)) {
            $stmt =$pdo->prepare(
                'SELECT user_id FROM device_sessions WHERE token = ? AND expires_at > NOW() LIMIT 1'
            );
            $stmt->execute([$token]);
            $sessionData =$stmt->fetch();

            if ($sessionData) {
                $userId = (int)$sessionData['user_id'];
            }
        }

        if (!$userId) {
            respond(401, [
                'success' => false,
                'message' => 'Unauthorized.'
            ]);
        }

        $mode = $input['mode'] ?? 'custom';$speed = (int) ($input['speed'] ?? 75);$interval_seconds = (int) ($input['interval'] ?? 2);$direction = $input['direction'] ?? 'stop';$random_enabled = isset($input['random_enabled']) ? (int)$input['random_enabled'] : 0;

        $stmt =$pdo->prepare('SELECT id FROM machine_settings WHERE user_id = ?');
        $stmt->execute([$userId]);
        $exists =$stmt->fetch();

        if ($exists) {$stmt = $pdo->prepare(
                'UPDATE machine_settings 
                 SET mode = ?, speed = ?, interval_seconds = ?, direction = ?, random_enabled = ?, updated_at = NOW() 
                 WHERE user_id = ?'
            );$stmt->execute([$mode,$speed, $interval_seconds,$direction, $random_enabled,$userId]);
        } else {
            $stmt = $pdo->prepare(
                'INSERT INTO machine_settings (user_id, mode, speed, interval_seconds, direction, random_enabled, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, NOW())'
            );$stmt->execute([$userId,$mode, $speed,$interval_seconds, $direction,$random_enabled]);
        }

        respond(200, [
            'success' => true,
            'message' => 'Machine settings berhasil diperbarui.'
        ]);
    }

    // AMBIL HISTORI LATIHAN (TRAINING SESSIONS DENGAN FILTER WAKTU)
    if ($action === 'get_history') {$headers = getallheaders();
        $authHeader =$headers['Authorization'] ?? $headers['authorization'] ?? '';$token = '';

        if (preg_match('/Bearer\s(\S+)/', $authHeader,$matches)) {
            $token =$matches[1];
        }

        $userId = null;

        if (isset($_SESSION['user_id'])) {
            $userId = (int)$_SESSION['user_id'];
        } elseif (!empty($token)) {
            $stmt =$pdo->prepare(
                'SELECT user_id FROM device_sessions WHERE token = ? AND expires_at > NOW() LIMIT 1'
            );
            $stmt->execute([$token]);
            $sessionData =$stmt->fetch();

            if ($sessionData) {
                $userId = (int)$sessionData['user_id'];
            }
        }

        if (!$userId) {
            respond(401, [
                'success' => false,
                'message' => 'Unauthorized. Silakan login terlebih dahulu.'
            ]);
        }

        // Tangkap parameter filter dari input (default: all)
        $filter = $input['filter'] ?? 'all';$sql = 'SELECT id, mode, speed, interval_seconds, started_at, ended_at, status, notes 
                FROM training_sessions 
                WHERE user_id = ?';
        
        $params = [$userId];

        // Logika kondisi berdasarkan pilihan filter waktu real-time dunia nyata
        if ($filter === 'today') {$sql .= ' AND DATE(started_at) = CURDATE()';
        } elseif ($filter === 'week') {
            // Menyaring murni berdasarkan minggu kalender yang sedang berjalan di tahun ini 
            // (mode 1 menghitung awal minggu dari hari Senin)
            $sql .= ' AND WEEK(started_at, 1) = WEEK(NOW(), 1) AND YEAR(started_at) = YEAR(NOW())';
        } elseif ($filter === 'month') {
            // Murni menyaring berdasarkan bulan dan tahun saat ini di dunia nyata
            $sql .= ' AND MONTH(started_at) = MONTH(NOW()) AND YEAR(started_at) = YEAR(NOW())';
        }

        $sql .= ' ORDER BY started_at DESC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $sessions =$stmt->fetchAll();

        // Hitung statistik ringkasan menggunakan database / penjumlahan duration_seconds
        $stmtSum =$pdo->prepare("SELECT COUNT(*) as total_sesi, SUM(duration_seconds) as total_detik FROM training_sessions WHERE user_id = ? AND status = 'completed'");
        $stmtSum->execute([$userId]);
        $summaryData =$stmtSum->fetch();

        $totalSesi = (int) ($summaryData['total_sesi'] ?? count($sessions));
        $totalDetik = (int) ($summaryData['total_detik'] ?? 0);

        $totalJam = round($totalDetik / 3600, 1);
        $rataRataMnt =$totalSesi > 0 ? round(($totalDetik / $totalSesi) / 60) : 0;

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

    // JIKA ACTION TIDAK DIKENAL
    respond(400, [
        'success' => false,
        'message' => 'Action tidak dikenal.'
    ]);

} catch (PDOException $e) {
    if ($pdo->inTransaction()) {$pdo->rollBack();
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