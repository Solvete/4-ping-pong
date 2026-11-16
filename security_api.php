
<?php
date_default_timezone_set('Asia/Jakarta');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config.php';

function respond($status, $data) {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function getInput() {
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function getBearerToken() {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $auth = $headers['Authorization'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    return preg_match('/^Bearer\s+(\S+)$/i', trim($auth), $match)
        ? $match[1] : '';
}

function requireSecurityBearer($pdo) {
    $token = getBearerToken();

    if (!$token) {
        respond(401, ['success' => false, 'message' => 'Token tidak ditemukan.']);
    }

    $stmt = $pdo->prepare(
        "SELECT * FROM device_sessions
         WHERE token = ?
         AND connection_status = 'connected'
         AND expires_at > NOW()
         LIMIT 1"
    );

    $stmt->execute([$token]);
    $session = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$session) {
        respond(401, ['success' => false, 'message' => 'Token tidak valid atau sudah expired.']);
    }

    return $session;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['success' => false, 'message' => 'Method tidak diizinkan.']);
}

$input = getInput();
$action = $input['action'] ?? '';

try {

    // ==================================
    // SIGN UP
    // ==================================

    if ($action === 'register') {

        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';
        $mac = trim($input['mac_address'] ?? '');

        if (!preg_match('/^[a-zA-Z0-9_]{3,50}$/', $username)) {
            respond(422, ['success' => false, 'message' => 'Format username tidak valid.']);
        }

        if (strlen($password) < 8 || strlen($password) > 72) {
            respond(422, ['success' => false, 'message' => 'Password harus 8-72 karakter.']);
        }

        // Password hashing menggunakan bcrypt.
        $passwordHash = password_hash($password, PASSWORD_BCRYPT);

        $stmt = $pdo->prepare(
            "INSERT INTO users (username, password_hash, mac_address)
             VALUES (?, ?, ?)"
        );

        $stmt->execute([
            $username,
            $passwordHash,
            $mac ?: null
        ]);

        respond(201, [
            'success' => true,
            'message' => 'Registrasi berhasil. Silakan login.'
        ]);
    }

    // ==================================
    // LOGIN
    // ==================================

    if ($action === 'login') {

        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';

        $stmt = $pdo->prepare(
            "SELECT * FROM users
             WHERE username = ?
             LIMIT 1"
        );

        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user || (isset($user['account_status']) && $user['account_status'] !== 'active')) {
            respond(401, ['success' => false, 'message' => 'Username atau password salah.']);
        }

        // Pemeriksaan lockout.
        if (!empty($user['lockout_until']) &&
            strtotime($user['lockout_until']) > time()) {

            $remaining = strtotime($user['lockout_until']) - time();

            respond(429, [
                'success' => false,
                'message' => 'Akun dikunci. Coba lagi dalam ' . ceil($remaining / 60) . ' menit.'
            ]);
        }

        // Verifikasi password bcrypt.
        if (!password_verify($password, $user['password_hash'])) {

            $failed = (int)$user['failed_attempts'] + 1;

            if ($failed >= 3) {

                $stmt = $pdo->prepare(
                    "UPDATE users
                     SET failed_attempts = ?,
                     lockout_until = DATE_ADD(NOW(), INTERVAL 3 MINUTE)
                     WHERE id = ?"
                );

                $stmt->execute([$failed, $user['id']]);

                respond(429, [
                    'success' => false,
                    'message' => 'Terlalu banyak percobaan gagal. Akun dikunci selama 3 menit.'
                ]);
            }

            $stmt = $pdo->prepare(
                "UPDATE users SET failed_attempts = ? WHERE id = ?"
            );

            $stmt->execute([$failed, $user['id']]);

            respond(401, [
                'success' => false,
                'message' => 'Password salah. Sisa percobaan: ' . (3 - $failed)
            ]);
        }

        // Single Active Session.
        $stmt = $pdo->prepare(
            "SELECT id FROM device_sessions
             WHERE user_id = ?
             AND connection_status = 'connected'
             AND expires_at > NOW()
             LIMIT 1"
        );

        $stmt->execute([$user['id']]);

        if ($stmt->fetch()) {
            respond(409, [
                'success' => false,
                'message' => 'Akun sedang aktif pada perangkat lain.'
            ]);
        }

        $token = bin2hex(random_bytes(32));
        $expiresAt = date('Y-m-d H:i:s', strtotime('+24 hours'));

        $mac = trim($input['mac_address'] ?? '');
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;

        $pdo->beginTransaction();

        $stmt = $pdo->prepare(
            "UPDATE users
             SET failed_attempts = 0, lockout_until = NULL
             WHERE id = ?"
        );
        $stmt->execute([$user['id']]);

        $stmt = $pdo->prepare(
            "INSERT INTO device_sessions
             (user_id, mac_address, ip_address, token,
              expires_at, connection_status, connected_at)
             VALUES (?, ?, ?, ?, ?, 'connected', NOW())"
        );

        $stmt->execute([
            $user['id'],
            $mac ?: null,
            $ip,
            $token,
            $expiresAt
        ]);

        $pdo->commit();

        respond(200, [
            'success' => true,
            'message' => 'Login berhasil.',
            'token' => $token,
            'expires_at' => $expiresAt,
            'user' => [
                'id' => $user['id'],
                'username' => $user['username'],
                'role' => $user['role'] ?? 'USER'
            ]
        ]);
    }

    // ==================================
    // VALIDASI TOKEN
    // ==================================

    if ($action === 'validate_token') {

        $session = requireSecurityBearer($pdo);

        respond(200, [
            'success' => true,
            'message' => 'Token valid.',
            'user_id' => $session['user_id'],
            'expires_at' => $session['expires_at']
        ]);
    }

    // ==================================
    // LOGOUT
    // ==================================

    if ($action === 'logout') {

        $token = getBearerToken();

        if (!$token) {
            respond(401, ['success' => false, 'message' => 'Token tidak ditemukan.']);
        }

        $stmt = $pdo->prepare(
            "UPDATE device_sessions
             SET connection_status = 'disconnected',
                 disconnected_at = NOW()
             WHERE token = ?
             AND connection_status = 'connected'"
        );

        $stmt->execute([$token]);

        respond(200, [
            'success' => true,
            'message' => 'Logout berhasil.'
        ]);
    }

    // ==================================
    // FORGOT PASSWORD - VERIFIKASI MAC
    // ==================================

    if ($action === 'forgot_verify') {

        $username = trim($input['username'] ?? '');
        $mac = trim($input['mac_address'] ?? '');

        if (!$username || !$mac) {
            respond(422, ['success' => false, 'message' => 'Username dan MAC Address wajib diisi.']);
        }

        $stmt = $pdo->prepare(
            "SELECT id, mac_address FROM users WHERE username = ? LIMIT 1"
        );

        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user || empty($user['mac_address']) ||
            strcasecmp($user['mac_address'], $mac) !== 0) {

            respond(403, [
                'success' => false,
                'message' => 'Verifikasi MAC Address gagal.'
            ]);
        }

        $stmt = $pdo->prepare(
            "UPDATE password_reset_requests
             SET status = 'expired'
             WHERE user_id = ? AND status = 'pending'"
        );
        $stmt->execute([$user['id']]);

        $stmt = $pdo->prepare(
            "INSERT INTO password_reset_requests
             (user_id, submitted_mac, status, expires_at)
             VALUES (?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 1 HOUR))"
        );

        $stmt->execute([$user['id'], $mac]);

        respond(200, [
            'success' => true,
            'message' => 'Verifikasi berhasil. Silakan buat password baru.'
        ]);
    }

    // ==================================
    // RESET PASSWORD
    // ==================================

    if ($action === 'forgot_reset') {

        $username = trim($input['username'] ?? '');
        $newPassword = $input['newPassword'] ?? '';

        if (strlen($newPassword) < 8 || strlen($newPassword) > 72) {
            respond(422, ['success' => false, 'message' => 'Password harus 8-72 karakter.']);
        }

        $stmt = $pdo->prepare(
            "SELECT id FROM users WHERE username = ? LIMIT 1"
        );

        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
            respond(404, ['success' => false, 'message' => 'User tidak ditemukan.']);
        }

        $stmt = $pdo->prepare(
            "SELECT id FROM password_reset_requests
             WHERE user_id = ?
             AND status = 'pending'
             AND expires_at > NOW()
             ORDER BY id DESC LIMIT 1"
        );

        $stmt->execute([$user['id']]);
        $request = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$request) {
            respond(403, ['success' => false, 'message' => 'Verifikasi perangkat tidak tersedia atau kedaluwarsa.']);
        }

        // Reset password juga menggunakan bcrypt.
        $passwordHash = password_hash($newPassword, PASSWORD_BCRYPT);

        $pdo->beginTransaction();

        $stmt = $pdo->prepare(
            "UPDATE users
             SET password_hash = ?,
                 failed_attempts = 0,
                 lockout_until = NULL
             WHERE id = ?"
        );

        $stmt->execute([$passwordHash, $user['id']]);

        $stmt = $pdo->prepare(
            "UPDATE password_reset_requests
             SET status = 'completed' WHERE id = ?"
        );
        $stmt->execute([$request['id']]);

        // Cabut semua sesi aktif setelah password diubah.
        $stmt = $pdo->prepare(
            "UPDATE device_sessions
             SET connection_status = 'disconnected',
                 disconnected_at = NOW()
             WHERE user_id = ? AND connection_status = 'connected'"
        );
        $stmt->execute([$user['id']]);

        $pdo->commit();

        respond(200, [
            'success' => true,
            'message' => 'Password berhasil diubah. Silakan login kembali.'
        ]);
    }

    respond(400, [
        'success' => false,
        'message' => 'Action tidak dikenali.'
    ]);

} catch (Throwable $e) {

    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    error_log($e->getMessage());

    respond(500, [
        'success' => false,
        'message' => 'Terjadi kesalahan pada server.'
    ]);
}