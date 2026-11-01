<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

include 'koneksi.php'; // file koneksi database MariaDB

$data = json_decode(file_get_contents("php://input"), true);

if (isset($data['username']) && isset($data['password']) && isset($data['mac_address'])) {
    $username = $data['username'];
    $password = password_hash($data['password'], PASSWORD_DEFAULT); // Enkripsi password aman
    $mac_address = $data['mac_address'];

    $stmt = $conn->prepare("INSERT INTO users (username, password, mac_address) VALUES (?, ?, ?)");
    $stmt->bind_param("sss", $username, $password, $mac_address);

    if ($stmt->execute()) {
        echo json_encode(["status" => "success", "message" => "Akun berhasil didaftarkan"]);
    } else {
        echo json_encode(["status" => "error", "message" => "Gagal menyimpan ke database"]);
    }
} else {
    echo json_encode(["status" => "error", "message" => "Data tidak lengkap"]);
}
?>