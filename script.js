document.addEventListener('DOMContentLoaded', () => {
    // Web di-host langsung oleh ESP32
    const ESP32_IP = 'http://192.168.4.1';

    // SESUAIKAN IP INI: Ganti localhost dengan IP Address Laptop Anda di jaringan Wi-Fi ESP32
    const PHP_API = 'http://192.168.4.2/pingpong-api/api.php';

    async function sendPhpApi(action, payload = {}) {
        try {
            const token = localStorage.getItem('pingpong_token') || '';

            const response = await fetch(PHP_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    action,
                    ...payload
                })
            });

            const data = await response.json();

            return {
                ...data,
                status: data.success ? 'success' : 'error'
            };
        } catch (error) {
            console.error('PHP API error:', error);
            return {
                status: 'error',
                message: 'PHP Laragon tidak dapat dihubungi.'
            };
        }
    }

    const $ = (id) => document.getElementById(id);

    const pages = [
        'login-page',
        'register-page',
        'forgot-page',
        'control-page',
        'history-page',
        'qos-page'
    ].map(id => $(id));

    const loginPage = $('login-page');
    const registerPage = $('register-page');
    const forgotPage = $('forgot-page');
    const controlPage = $('control-page');
    const historyPage = $('history-page');
    const qosPage = $('qos-page');

    const speedInput = $('speedValue');
    const intervalInput = $('intervalValue');
    const modeSelect = $('modeSelect');
    const btnStart = $('btnStartLauncher');
    const loadingOverlay = $('loading-overlay');

    let currentSpeed = 75;
    let currentInterval = 2;
    let currentMode = 'custom';
    let isLauncherRunning = false;
    let isRandomRunning = false;
    let statusTimer = null;

    // ==============================
    // PEMETAAN MODE WEB KE ESP32
    // ==============================
    function modeToESP32(mode) {
        const modeMap = {
            easy: 'beginner',
            medium: 'intermediate',
            hard: 'advanced',
            custom: 'custom',
            beginner: 'beginner',
            intermediate: 'intermediate',
            advanced: 'advanced',
            random: 'random'
        };
        return modeMap[mode] || 'custom';
    }

    function modeToWeb(mode) {
        const modeMap = {
            beginner: 'easy',
            intermediate: 'medium',
            advanced: 'hard',
            custom: 'custom',
            random: 'random',
            easy: 'easy',
            medium: 'medium',
            hard: 'hard'
        };
        return modeMap[mode] || 'custom';
    }

    // ==============================
    // SINKRONISASI MACHINE SETTINGS
    // ==============================
    async function loadMachineSettings() {
        const result = await sendPhpApi('get_settings');
        if (result.status === 'success' && result.settings) {
            currentMode = result.settings.mode || 'custom';
            currentSpeed = Number(result.settings.speed || 75);
            currentInterval = Number(result.settings.interval_seconds || 2);

            updateModeSelect(currentMode);
            renderSettings();

            console.log("Pengaturan mesin dimuat dari database:", result.settings);
        }
    }

    async function saveMachineSettings() {
        await sendPhpApi('update_settings', {
            mode: currentMode,
            speed: currentSpeed,
            interval: currentInterval,
            direction: 'stop',
            random_enabled: currentMode === 'random' ? 1 : 0
        });
    }

    // ==============================
    // NAVIGASI HALAMAN
    // ==============================
    function showPage(target) {
        if (!target) return;
        pages.forEach(page => page?.classList.add('hidden'));
        target.classList.remove('hidden');
        window.scrollTo(0, 0);
    }

    // ==============================
    // HELPER HTTP REST API (ESP32)
    // ==============================
    async function sendApi(endpoint, method = 'POST', payload = {}) {
        try {
            const options = {
                method: method,
                headers: { 'Content-Type': 'application/json' }
            };

            if (method !== 'GET') {
                options.body = JSON.stringify(payload);
            }

            const response = await fetch(`${ESP32_IP}${endpoint}`, options);
            const text = await response.text();
            let data = {};

            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                throw new Error(`Respons bukan JSON (HTTP ${response.status}).`);
            }

            console.log(`[API] ${endpoint} (${response.status})`, data);

            if (!response.ok) {
                return {
                    status: 'error',
                    message: data.message || `HTTP ${response.status}`
                };
            }
            return data;
        } catch (error) {
            console.error(`[API] ${endpoint}`, error);
            return {
                status: 'error',
                message: error.message || 'Tidak dapat terhubung ke ESP32.'
            };
        }
    }

    function checkError(result) {
        if (!result || result.status === 'error') {
            alert(result?.message || 'Permintaan gagal.');
            return true;
        }
        return false;
    }

    // ==============================
    // HELPER MENGUNCI / MEMBUKA KONTROL LATIHAN
    // ==============================
    function toggleControls(isCustom) {
        const speedPlus = $('speedPlus');
        const speedMinus = $('speedMinus');
        const intervalPlus = $('intervalPlus');
        const intervalMinus = $('intervalMinus');

        if (speedPlus) speedPlus.disabled = !isCustom;
        if (speedMinus) speedMinus.disabled = !isCustom;
        if (intervalPlus) intervalPlus.disabled = !isCustom;
        if (intervalMinus) intervalMinus.disabled = !isCustom;

        const dpadButtons = [
            'btnUp', 'btnDown', 'btnLeft', 'btnRight', 
            'btnUpLeft', 'btnUpRight', 'btnDownLeft', 'btnDownRight', 
            'btnCenter'
        ];
        dpadButtons.forEach(id => {
            const btn = $(id);
            if (btn) btn.disabled = !isCustom;
        });

        const btnResetPos = $('btnResetPos');
        const btnRandom = $('btnRandom');

        if (btnResetPos) btnResetPos.disabled = !isCustom;
        if (btnRandom) btnRandom.disabled = !isCustom;
    }

    function renderSettings() {
        if (speedInput) speedInput.value = `${currentSpeed}%`;
        if (intervalInput) intervalInput.value = `${currentInterval} dtk`;
        const isCustomMode = (currentMode === 'custom');
        toggleControls(isCustomMode);
    }

    function updateModeSelect(mode) {
        if (!modeSelect) return;
        const webMode = modeToWeb(mode);
        const optionExists = Array.from(modeSelect.options).some(option => option.value === webMode);
        if (optionExists) {
            modeSelect.value = webMode;
        }
    }

    async function updateSettings() {
        const result = await sendApi('/api/control/settings', 'POST', {
            speed: currentSpeed,
            interval: currentInterval
        });

        if (checkError(result)) return false;

        if (result.speed !== undefined) currentSpeed = Number(result.speed);
        if (result.interval !== undefined) currentInterval = Number(result.interval);

        renderSettings();
        await saveMachineSettings();
        return true;
    }

    async function applyMode(mode) {
        const espMode = modeToESP32(mode);
        currentMode = espMode;

        if (mode === 'easy' || mode === 'beginner') {
            currentSpeed = 40;
            currentInterval = 4;
        } else if (mode === 'medium' || mode === 'intermediate') {
            currentSpeed = 65;
            currentInterval = 3;
        } else if (mode === 'hard' || mode === 'advanced') {
            currentSpeed = 90;
            currentInterval = 1;
        }

        renderSettings();

        // SIMPAN PERUBAHAN MODE KE DATABASE LARAGON
        await saveMachineSettings();

        const result = await sendApi('/api/control/mode', 'POST', { mode: currentMode });
        if (checkError(result)) return;

        if (result.mode) {
            currentMode = result.mode;
        }

        updateModeSelect(currentMode);
        await updateSettings();
    }

    modeSelect?.addEventListener('change', async () => {
        await applyMode(modeSelect.value);
    });

    $('speedPlus')?.addEventListener('click', async () => {
        if (currentMode !== 'custom') return;
        currentSpeed = Math.min(100, currentSpeed + 5);
        renderSettings();
        await updateSettings();
    });

    $('speedMinus')?.addEventListener('click', async () => {
        if (currentMode !== 'custom') return;
        currentSpeed = Math.max(10, currentSpeed - 5);
        renderSettings();
        await updateSettings();
    });

    $('intervalPlus')?.addEventListener('click', async () => {
        if (currentMode !== 'custom') return;
        currentInterval = Math.min(10, currentInterval + 1);
        renderSettings();
        await updateSettings();
    });

    $('intervalMinus')?.addEventListener('click', async () => {
        if (currentMode !== 'custom') return;
        currentInterval = Math.max(1, currentInterval - 1);
        renderSettings();
        await updateSettings();
    });

    // ==============================
    // API LOGIN (PHP LARAGON)
    // ==============================
    $('btn-submit-login')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = $('login-username')?.value.trim() || '';
        const password = $('login-password')?.value || '';

        if (!username || !password) {
            alert('Username dan password harus diisi.');
            return;
        }

        let userMac = "";
        try {
            let macResponse = await fetch('http://192.168.4.1/api/get-client-mac');
            let macData = await macResponse.json();
            userMac = macData.mac || "";
            console.log("MAC Address terbaca:", userMac);
        } catch (error) {
            console.error('Gagal mengambil MAC address saat login:', error);
        }

        loadingOverlay?.classList.remove('hidden');

        const result = await sendPhpApi('login', {
            username: username,
            password: password,
            mac_address: userMac
        });

        loadingOverlay?.classList.add('hidden');

        if (result.status === 'success') {
            if (result.token) {
                localStorage.setItem('pingpong_token', result.token);
            }

            showPage(controlPage);

            // Muat konfigurasi machine settings milik user dari database PHP
            await loadMachineSettings();

            await refreshStatus();

            if (statusTimer) clearInterval(statusTimer);
            statusTimer = setInterval(refreshStatus, 3000);
        } else {
            alert(result.message || 'Login gagal. Periksa username dan password.');
        }
    });

    // ==============================
    // NAVIGASI & API REGISTER (PHP LARAGON)
    // ==============================
    $('btn-to-register')?.addEventListener('click', () => showPage(registerPage));

    $('btn-submit-register')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = $('reg-username')?.value.trim() || '';
        const password = $('reg-password')?.value || '';
        const confirmPassword = $('reg-confirm-password')?.value || '';

        if (!username || !password || !confirmPassword) {
            alert('Semua kolom registrasi harus diisi.');
            return;
        }

        if (password !== confirmPassword) {
            alert('Konfirmasi password tidak sama.');
            return;
        } 

        let userMac = "";
        try {
            let macResponse = await fetch('http://192.168.4.1/api/get-client-mac');
            let macData = await macResponse.json();
            userMac = macData.mac || "";
        } catch (error) {
            console.error('Gagal mengambil MAC address:', error);
        }

        const result = await sendPhpApi('register', {
            username: username,
            password: password,
            mac_address: userMac
        });

        if (result.status === 'success') {
            alert(result.message || 'Registrasi berhasil. Silakan login.');
            $('reg-username').value = '';
            $('reg-password').value = '';
            $('reg-confirm-password').value = '';
            showPage(loginPage);
        } else {
            alert(result.message || 'Registrasi gagal.');
        }
    });

    // ==============================
    // API FORGOT PASSWORD (PHP LARAGON)
    // ==============================
    $('link-forgot')?.addEventListener('click', (e) => {
        e.preventDefault();
        $('forgot-step-1')?.classList.remove('hidden');
        $('forgot-step-2')?.classList.add('hidden');
        if ($('forgot-username')) {
            $('forgot-username').value = '';
            $('forgot-username').disabled = false;
        }
        if ($('forgot-new-password')) $('forgot-new-password').value = '';
        if ($('forgot-confirm-password')) $('forgot-confirm-password').value = '';
        showPage(forgotPage);
    });

    // TAHAP 1: Verifikasi Username & MAC Address
    $('btn-submit-verify')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = $('forgot-username')?.value.trim() || '';

        if (!username) {
            alert('Username harus diisi.');
            return;
        }

        let userMac = "";
        try {
            let macResponse = await fetch('http://192.168.4.1/api/get-client-mac');
            let macData = await macResponse.json();
            userMac = macData.mac || "";
        } catch (error) {
            console.error('Gagal mengambil MAC address:', error);
        }

        loadingOverlay?.classList.remove('hidden');

        const result = await sendPhpApi('forgot_verify', {
            username: username,
            mac_address: userMac
        });

        loadingOverlay?.classList.add('hidden');

        if (result.status === 'success') {
            alert('Verifikasi berhasil! Silakan masukkan password baru Anda.');
            $('forgot-username').disabled = true;
            $('forgot-step-1')?.classList.add('hidden');
            $('forgot-step-2')?.classList.remove('hidden');
        } else {
            alert(result.message || 'Verifikasi gagal. Username atau perangkat tidak cocok.');
        }
    });

    // TAHAP 2: Simpan Password Baru
    $('btn-submit-reset-pw')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = $('forgot-username')?.value.trim() || '';
        const newPassword = $('forgot-new-password')?.value || '';
        const confirmPassword = $('forgot-confirm-password')?.value || '';

        if (!newPassword || !confirmPassword) {
            alert('Semua kolom password harus diisi.');
            return;
        }

        if (newPassword !== confirmPassword) {
            alert('Konfirmasi password baru tidak cocok.');
            return;
        }

        loadingOverlay?.classList.remove('hidden');

        const result = await sendPhpApi('forgot_reset', {
            username: username,
            newPassword: newPassword
        });

        loadingOverlay?.classList.add('hidden');

        if (result.status === 'success') {
            alert('Password berhasil diperbarui! Silakan login kembali.');
            if ($('forgot-username')) $('forgot-username').disabled = false;
            showPage(loginPage);
        } else {
            alert(result.message || 'Gagal memperbarui password.');
        }
    });

    $('btn-to-login')?.addEventListener('click', () => showPage(loginPage));
    $('btn-forgot-to-login')?.addEventListener('click', () => {
        if ($('forgot-username')) $('forgot-username').disabled = false;
        showPage(loginPage);
    });

    // ==============================
    // API MOVE (ESP32) - 8 ARAH
    // ==============================
    const movementButtons = {
        btnUp: 'up',
        btnDown: 'down',
        btnLeft: 'left',
        btnRight: 'right',
        btnUpLeft: 'upleft',
        btnUpRight: 'upright',
        btnDownLeft: 'downleft',
        btnDownRight: 'downright',
        btnCenter: 'stop'
    };

    Object.entries(movementButtons).forEach(([id, direction]) => {
        $(id)?.addEventListener('click', async () => {
            if (currentMode !== 'custom') return;
            const result = await sendApi('/api/control/move', 'POST', { direction: direction });
            if (!checkError(result)) {
                console.log('Arah mesin:', result.direction);
            }
        });
    });

    // ==============================
    // API RESET POSISI / PENGATURAN (ESP32)
    // ==============================
    $('btnResetPos')?.addEventListener('click', async () => {
        if (currentMode !== 'custom') return;
        const result = await sendApi('/api/control/reset', 'POST', {});
        if (checkError(result)) return;

        currentMode = result.mode || 'custom';
        currentSpeed = Number(result.speed ?? 75);
        currentInterval = Number(result.interval ?? 2);
        isLauncherRunning = false;
        isRandomRunning = false;

        updateModeSelect(currentMode);
        renderSettings();
        await saveMachineSettings();

        if (btnStart) btnStart.textContent = '▶ Mulai Pelontar';
        const randomButton = $('btnRandom');
        if (randomButton) randomButton.textContent = 'Mulai Acak';

        alert('Pengaturan berhasil direset.');
    });

    // ==============================
    // API RANDOM (ESP32)
    // ==============================
    $('btnRandom')?.addEventListener('click', async () => {
        const button = $('btnRandom');
        if (!button) return;

        if (!isRandomRunning) {
            if (currentMode !== 'custom') return;
            const result = await sendApi('/api/control/random', 'POST', {});
            if (checkError(result)) return;

            currentMode = 'random';
            isRandomRunning = true;

            const startResult = await sendApi('/api/control/start', 'POST', {
                action: 'start',
                mode: 'random',
                speed: currentSpeed,
                interval: currentInterval
            });

            if (checkError(startResult)) {
                isRandomRunning = false;
                return;
            }

            isLauncherRunning = startResult.state === 'running';
            button.textContent = 'Hentikan Acak';
            if (btnStart) {
                btnStart.textContent = isLauncherRunning ? '⏹ Berhentikan Pelontar' : '▶ Mulai Pelontar';
            }
            await saveMachineSettings();
        } else {
            const result = await sendApi('/api/control/start', 'POST', { action: 'stop' });
            if (checkError(result)) return;

            isRandomRunning = false;
            isLauncherRunning = false;

            button.textContent = 'Mulai Acak';
            if (btnStart) btnStart.textContent = '▶ Mulai Pelontar';
        }
    });

    // ==============================
    // API START / STOP (ESP32) + CATAT TRAINING SESSIONS
    // ==============================
    btnStart?.addEventListener('click', async () => {
        const action = isLauncherRunning ? 'stop' : 'start';
        btnStart.disabled = true;

        // 1. Kirim perintah ke ESP32 seperti biasa
        const result = await sendApi('/api/control/start', 'POST', {
            action: action,
            mode: currentMode,
            speed: currentSpeed,
            interval: currentInterval
        });

        // 2. TAMBAHAN: Jika berhasil start/stop, catat juga sesinya ke database PHP Laragon (tabel training_sessions)
        if (result.status !== 'error') {
            await sendPhpApi('save_training', {
                mode: currentMode,
                speed: currentSpeed,
                interval: currentInterval,
                status: action === 'start' ? 'running' : 'completed',
                notes: `Latihan mode ${currentMode} dengan kecepatan ${currentSpeed}%`
            });
        }

        btnStart.disabled = false;
        if (checkError(result)) return;

        isLauncherRunning = result.state === 'running';

        if (!isLauncherRunning) {
            isRandomRunning = false;
            const randomButton = $('btnRandom');
            if (randomButton) randomButton.textContent = 'Mulai Acak';
        }

        btnStart.textContent = isLauncherRunning ? '⏹ Berhentikan Pelontar' : '▶ Mulai Pelontar';
    });

    // ==============================
    // API EMERGENCY STOP (ESP32)
    // ==============================
    $('btnEmergency')?.addEventListener('click', async () => {
        const result = await sendApi('/api/control/emergency', 'POST', {});
        if (checkError(result)) return;

        isLauncherRunning = false;
        isRandomRunning = false;

        if (btnStart) btnStart.textContent = '▶ Mulai Pelontar';
        const randomButton = $('btnRandom');
        if (randomButton) randomButton.textContent = 'Mulai Acak';

        alert('Perintah berhenti darurat dikirim ke ESP32.');
    });

    // ==============================
    // LOGOUT (KEMBALI KE HALAMAN LOGIN)
    // ==============================
    $('btnLogout')?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (statusTimer) {
            clearInterval(statusTimer);
            statusTimer = null;
        }

        try {
            await sendPhpApi('logout');
        } catch (err) {
            console.error('Logout error:', err);
        }

        localStorage.removeItem('pingpong_token');
        if ($('login-username')) $('login-username').value = '';
        if ($('login-password')) $('login-password').value = '';

        showPage(loginPage);
    });

    // ==============================
    // API STATUS (ESP32)
    // ==============================
    async function refreshStatus() {
        const result = await sendApi('/api/status', 'GET');
        if (result.status === 'error') return;

        isLauncherRunning = result.state === 'running';

        if (btnStart) {
            btnStart.textContent = isLauncherRunning ? '⏹ Berhentikan Pelontar' : '▶ Mulai Pelontar';
        }

        if (result.mode) {
            currentMode = result.mode;
            updateModeSelect(currentMode);
        }

        if (result.speed !== undefined) currentSpeed = Number(result.speed);
        if (result.interval !== undefined) currentInterval = Number(result.interval);

        renderSettings();

        const timer = $('timerDisplay');
        if (timer && result.uptime_seconds !== undefined) {
            const seconds = Number(result.uptime_seconds || 0);
            timer.textContent = seconds >= 60 ? `${Math.floor(seconds / 60)} Menit` : `${seconds} Detik`;
        }
    }

    // ==============================
    // MONITORING TELEMETRI QOS REAL-TIME
    // ==============================
    async function checkQoS() {
        const qosCards = qosPage?.querySelectorAll('.qos-metric-value');
        if (!qosCards || qosCards.length < 4) return;

        const startTime = performance.now();

        try {
            const response = await fetch(`${ESP32_IP}/api/ping`);
            const latency = Math.round(performance.now() - startTime);
            const data = await response.json();

            qosCards[0].textContent = `${latency} ms`;
            qosCards[1].textContent = data.packet_loss !== undefined ? `${data.packet_loss}%` : '0%';
            qosCards[2].textContent = data.bandwidth ? `${data.bandwidth} Kbps` : '64 Kbps';

            if (data.jitter !== undefined) {
                qosCards[3].textContent = `${data.jitter} ms`;
            } else if (data.rssi) {
                qosCards[3].textContent = `${data.rssi} dBm`;
            } else {
                qosCards[3].textContent = '-';
            }
        } catch (err) {
            qosCards[0].textContent = "Offline";
            qosCards[1].textContent = "100%";
            qosCards[2].textContent = "0 Kbps";
            qosCards[3].textContent = "-";
        }
    }

    setInterval(checkQoS, 2000);

    // ==============================
    // API HISTORI
    // ==============================
    $('btn-to-history')?.addEventListener('click', async () => {
        showPage(historyPage);  

        const list = historyPage?.querySelector('.history-list');
        if (!list) return;

        list.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'history-card';
        card.textContent = 'Histori aktivitas latihan tersimpan di database MariaDB server.';
        list.appendChild(card);
    });

    $('btn-to-qos')?.addEventListener('click', () => {
        showPage(qosPage);
    });

    $('btn-history-back')?.addEventListener('click', () => showPage(controlPage));
    $('btn-qos-back')?.addEventListener('click', () => showPage(controlPage));

    renderSettings();
});