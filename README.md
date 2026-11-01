# 4-ping-pong

**4-Ping-Pong** atau disebut juga **Ping-Pong-Machine** merupakan proyek *Project Based Learning (PBL)* Kelompok 4 kelas TMJ 5A, Politeknik Negeri Jakarta. Proyek ini berfokus pada perancangan dan pembangunan robot pelontar bola pingpong otomatis yang dapat dikendalikan melalui antarmuka web.

Sistem ini dirancang untuk membantu latihan tenis meja dengan menyediakan pengaturan kecepatan, interval pelontaran, tingkat kesulitan, serta arah pergerakan bola. Pengguna dapat mengakses dan mengendalikan mesin melalui perangkat yang terhubung ke jaringan Wi-Fi Access Point ESP32.

## Features
Beberapa fitur utama yang dikembangkan dalam proyek ini meliputi:

- **Web-Based Control:** Pengendalian mesin melalui antarmuka web.
- **Difficulty Settings:** Pengaturan tingkat kesulitan latihan.
- **Speed Control:** Pengaturan kecepatan pelontaran bola.
- **Interval Control:** Pengaturan jeda waktu antar pelontaran bola.
- **Movement Control:** Pengaturan arah pelontaran menggunakan mekanisme servo.
- **Emergency Stop:** Tombol untuk menghentikan pengoperasian mesin dalam kondisi darurat.
- **User Authentication:** Sistem registrasi dan login untuk pengguna.
- **Password Security:** Pengamanan password menggunakan algoritma hashing *bcrypt*.
- **Forgot Password:** Fitur reset password melalui verifikasi MAC Address perangkat.
- **Session Management:** Pengelolaan sesi autentikasi dan aktivitas pengguna.

## System Architecture
Sistem menggunakan dua mikrokontroler ESP32 yang memiliki fungsi berbeda.

### ESP32-1 (Web Server and Network Controller)
ESP32 pertama bertugas menangani jaringan Wi-Fi Access Point, Web Server, Captive Portal, serta endpoint API yang digunakan oleh web dashboard. ESP32 ini juga berperan dalam komunikasi data dengan ESP32 kedua menggunakan ESP-NOW.

### ESP32-2 (Machine Controller)
ESP32 kedua bertugas mengendalikan mekanisme mesin pingpong, seperti motor pelontar, gearbox, servo, dan komponen penggerak lainnya.

### Backend and Database
Sistem menggunakan PHP sebagai backend untuk menangani proses autentikasi, pengelolaan sesi, dan permintaan data. MariaDB yang dijalankan melalui Laragon digunakan untuk menyimpan data pengguna dan riwayat aktivitas latihan.

## Technologies Used
- **Microcontroller:** ESP32
- **Programming Language:** C++
- **Frontend:** HTML, CSS, JavaScript
- **Backend:** PHP
- **Database:** MariaDB
- **Local Server:** Laragon
- **Communication Protocol:** Wi-Fi, HTTP/REST API, ESP-NOW
- **File System:** LittleFS

## Network Security
Untuk menjaga keamanan sistem dan data pengguna, proyek ini menerapkan beberapa mekanisme keamanan, yaitu:

- Password hashing menggunakan *bcrypt* sebelum password disimpan ke database.
- Autentikasi pengguna melalui fitur Sign Up dan Log In.
- Pengelolaan session dan token untuk mempertahankan status autentikasi pengguna.
- Verifikasi MAC Address pada proses Forgot Password.
- Pembatasan percobaan login untuk mengurangi risiko akses tidak sah.

## Repository Structure
Berikut merupakan penjelasan fungsi dari masing-masing file dalam repository:

1. **ESP32-2.ino** merupakan kode program yang berfungsi untuk mengatur mekanisme mesin pingpong itu sendiri, seperti motor pelontar, gearbox, servo, dan komponen penggerak lainnya.

2. **ESP32-1.ino** merupakan kode program ESP32 pertama yang secara khusus menangani Web Server, Captive Portal, endpoint API, serta komunikasi dengan ESP32 kedua.

3. **index.html** merupakan file utama yang menampilkan antarmuka visual kepada pengguna, mulai dari halaman login, kontrol mesin, hingga pemantauan QoS.

4. **style.css** merupakan file yang digunakan untuk mengatur tampilan visual dari index.html, meliputi warna, tata letak, ukuran font, dan elemen desain lainnya.

5. **script.js** merupakan file JavaScript dari sisi frontend yang digunakan untuk memberikan interaksi dan mengatur fungsi pada halaman web.

6. **api.php** merupakan endpoint backend utama yang menangani logika REST API, seperti autentikasi login dan registrasi, sesi latihan, pengaturan sistem, serta proses lainnya.

7. **config.php** merupakan file konfigurasi yang digunakan untuk mengatur koneksi database MariaDB melalui Laragon.

8. **register.php** merupakan script tambahan yang digunakan untuk memproses pendaftaran akun pengguna di sisi server.

9. **settings.json** merupakan file konfigurasi lokal yang digunakan untuk menyimpan pengaturan mesin, seperti mode latihan, kecepatan, dan interval pelontaran.

## Contributors
Proyek ini dikembangkan oleh Kelompok 4 TMJ 5A:

- [Arini](https://github.com/arinisalsa) - Network Security
- [Kayla](https://github.com/Solvete) - Network Infrastructure & IoT Engineer
- [Khairunnisa](https://github.com/Myssstique) - Front End Development & QoS Analyst
- [Siti](https://github.com/situyy) - Back End Development

## Project Information

- **Project:** Project Based Learning (PBL) Rancang Bangun Robot Pelontar Bola Pingpong Otomatis Berbasis ESP32 dengan Kendali Web HTTP serta Sensor HLK-LD2410C 
- **Group:** Kelompok 4
- **Class:** TMJ 5A
- **Institution:** Politeknik Negeri Jakarta

**Developed by Group 4 - TMJ 5A**
