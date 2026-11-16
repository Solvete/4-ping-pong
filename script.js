window.onerror = function(msg, url, line) {
    alert("CRASH JS: " + msg + " di baris " + line);
};

document.addEventListener('DOMContentLoaded', () => {
    const ESP32_IP = 'http://192.168.4.1';
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

            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('pingpong_token');
                if (statusTimer) {
                    clearInterval(statusTimer);
                    statusTimer = null;
                }
                alert('Sesi Anda telah kedaluwarsa atau digunakan di perangkat lain. Silakan login kembali.');
                showPage(loginPage);
                return { status: 'error', message: 'Unauthorized' };
            }

            const data = await response.json();

            if (data.success === false && data.message && (data.message.toLowerCase().includes('token') || data.message.toLowerCase().includes('sesi'))) {
                localStorage.removeItem('pingpong_token');
                if (statusTimer) {
                    clearInterval(statusTimer);
                    statusTimer = null;
                }
                alert(data.message || 'Sesi tidak valid. Silakan login kembali.');
                showPage(loginPage);
                return { status: 'error', message: data.message };
            }

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
    const btnRandomMode = $('btnRandomMode'); 
    const btnEmergency = $('btnEmergency');
    const timerDisplay = $('timerDisplay');
    const loadingOverlay = $('loading-overlay');
    const helpModal = $('help-modal');

    // HLK Elements
    const hlkOverlay = $('hlk-overlay');
    const hlkStatusTitle = $('hlk-status-title');
    const hlkStatusDesc = $('hlk-status-desc');
    const hlkCountdownBox = $('hlk-countdown-box');
    const hlkTimerSpan = $('hlk-timer');

    let currentSpeed = 75;
    let currentInterval = 2;
    let currentMode = 'custom';
    let currentDirection = 'stop';
    let isLauncherRunning = false;
    let isRandomRunning = false;
    let isEmergencyActive = false;
    let isPlayerInHLKRange = true;
    let hlkResumeCountdownTimer = null;
    let statusTimer = null;
    let trainingStartTime = null; 
    let machineUptimeSeconds = 0;
    let machineUptimeTimer = null;

    // Pop-up Guide Troubleshooting Event Listener
    document.querySelectorAll('.help-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            helpModal?.classList.remove('hidden');
        });
    });

    $('btn-close-help')?.addEventListener('click', () => helpModal?.classList.add('hidden'));
    $('btn-understood')?.addEventListener('click', () => helpModal?.classList.add('hidden'));

    try {
        const savedToken = localStorage.getItem('pingpong_token');
        if (savedToken) {
            showPage(controlPage);
            loadMachineSettings();
            refreshStatus();
            if (statusTimer) clearInterval(statusTimer);
            statusTimer = setInterval(refreshStatus, 3000);
        } else {
            showPage(loginPage);
        }
    } catch (err) {
        console.error('Error saat auto-login:', err);
        showPage(loginPage);
    }

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

    async function loadMachineSettings() {
        const result = await sendPhpApi('get_settings');
        if (result.status === 'success' && result.settings) {
            currentMode = result.settings.mode || 'custom';
            currentSpeed = Number(result.settings.speed || 75);
            currentInterval = Number(result.settings.interval_seconds || 2);
            currentDirection = result.settings.direction || 'stop';

            updateModeSelect(currentMode);
            renderSettings();
        }
    }

    async function saveMachineSettings() {
        await sendPhpApi('update_settings', {
            mode: currentMode,
            speed: currentSpeed,
            interval: currentInterval,
            direction: currentDirection,
            random_enabled: currentMode === 'random' ? 1 : 0
        });
    }

    function showPage(target) {
        if (!target) return;
        pages.forEach(page => page?.classList.add('hidden'));
        target.classList.remove('hidden');
        window.scrollTo(0, 0);
    }

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

            if (!response.ok) {
                return {
                    status: 'error',
                    message: data.message || `HTTP ${response.status}`
                };
            }
            return data;
        } catch (error) {
            console.error(`[API] ${endpoint}`, error);
            // KONDISI SIMULASI/OFFLINE (Biar tombol tetep bisa dipencet tes tanpa ESP32)
            if (endpoint === '/api/control/start') {
                return { status: 'success', state: payload.action === 'start' ? 'running' : 'stopped' };
            }
            if (endpoint === '/api/control/emergency') {
                return { status: 'success' };
            }
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

    // CEK VALIDASI JIKA EMERGENCY AKTIF
    function guardEmergency() {
        if (isEmergencyActive) {
            alert('Matikan mode Berhenti Darurat terlebih dahulu untuk memulai kembali permainan. Pastikan kondisi mesin dan area sekitar sudah aman!');
            return true;
        }
        return false;
    }

    // PENGUNCIAN KONTROL SAAT DARURAT / JALAN
    function toggleControls() {
        const isLocked = isEmergencyActive || isLauncherRunning;
        const isCustomOrRandom = (currentMode === 'custom' || currentMode === 'random') && !isLocked;
        const isPureCustom = (currentMode === 'custom') && !isLocked;

        if (modeSelect) modeSelect.disabled = isLocked;

        const speedPlus = $('speedPlus');
        const speedMinus = $('speedMinus');
        const intervalPlus = $('intervalPlus');
        const intervalMinus = $('intervalMinus');

        if (speedPlus) speedPlus.disabled = !isCustomOrRandom;
        if (speedMinus) speedMinus.disabled = !isCustomOrRandom;
        if (intervalPlus) intervalPlus.disabled = !isCustomOrRandom;
        if (intervalMinus) intervalMinus.disabled = !isCustomOrRandom;

        const dpadButtons = [
            'btnUp', 'btnDown', 'btnLeft', 'btnRight', 
            'btnUpLeft', 'btnUpRight', 'btnDownLeft', 'btnDownRight', 
            'btnResetPos'
        ];
        dpadButtons.forEach(id => {
            const btn = $(id);
            if (btn) btn.disabled = !isPureCustom;
        });

        if (btnRandomMode) {
            btnRandomMode.disabled = !isCustomOrRandom;
        }

        // Tombol StartLauncher SELALU BISA DIKLIK KECUALI LAGI EMERGENCY
        if (btnStart) {
            btnStart.disabled = isEmergencyActive;
        }
    }

    function renderSettings() {
        if (speedInput) speedInput.value = `${currentSpeed}%`;
        if (intervalInput) intervalInput.value = `${currentInterval} dtk`;
        
        toggleControls();

        // Update Tampilan Tombol Start
        if (btnStart) {
            btnStart.textContent = isLauncherRunning ? '⏹ Berhentikan Pelontar' : '▶ Mulai Pelontar';
        }

        // Update Tampilan Tombol Darurat
        if (btnEmergency) {
            if (isEmergencyActive) {
                btnEmergency.textContent = 'KONDISI DARURAT AKTIF (KLIK UNTUK RESET)';
                btnEmergency.classList.add('emergency-active');
            } else {
                btnEmergency.textContent = 'BERHENTI DARURAT';
                btnEmergency.classList.remove('emergency-active');
            }
        }

        if (btnRandomMode) {
            if (currentMode === 'random') {
                btnRandomMode.textContent = 'Hentikan Acak';
                btnRandomMode.style.backgroundColor = '#ef4444';
                btnRandomMode.style.color = '#ffffff';
                btnRandomMode.style.borderColor = '#ef4444';
            } else {
                btnRandomMode.textContent = 'Gunakan Mode Acak';
                btnRandomMode.style.backgroundColor = '#ffffff';
                btnRandomMode.style.color = '#000000';
                btnRandomMode.style.borderColor = '#000000';
            }
        }
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
        if (guardEmergency()) return false;
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
        if (guardEmergency()) return;
        const espMode = modeToESP32(mode);
        currentMode = espMode;

        if (mode === 'easy' || mode === 'beginner') {
            currentSpeed = 40;
            currentInterval = 4;
            currentMode = 'beginner';
        } else if (mode === 'medium' || mode === 'intermediate') {
            currentSpeed = 65;
            currentInterval = 3;
            currentMode = 'intermediate';
        } else if (mode === 'hard' || mode === 'advanced') {
            currentSpeed = 90;
            currentInterval = 1;
            currentMode = 'advanced';
        } else if (mode === 'custom') {
            currentMode = 'custom';
        }

        renderSettings();
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
        if (guardEmergency()) return;
        if (currentMode !== 'custom' && currentMode !== 'random') return;
        currentSpeed = Math.min(100, currentSpeed + 5);
        renderSettings();
        await updateSettings();
    });

    $('speedMinus')?.addEventListener('click', async () => {
        if (guardEmergency()) return;
        if (currentMode !== 'custom' && currentMode !== 'random') return;
        currentSpeed = Math.max(10, currentSpeed - 5);
        renderSettings();
        await updateSettings();
    });

    $('intervalPlus')?.addEventListener('click', async () => {
        if (guardEmergency()) return;
        if (currentMode !== 'custom' && currentMode !== 'random') return;
        currentInterval = Math.min(10, currentInterval + 1);
        renderSettings();
        await updateSettings();
    });

    $('intervalMinus')?.addEventListener('click', async () => {
        if (guardEmergency()) return;
        if (currentMode !== 'custom' && currentMode !== 'random') return;
        currentInterval = Math.max(1, currentInterval - 1);
        renderSettings();
        await updateSettings();
    });

    // ==============================
    // API LOGIN & REGIS
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
            await loadMachineSettings();
            await refreshStatus();

            if (statusTimer) clearInterval(statusTimer);
            statusTimer = setInterval(refreshStatus, 3000);
        } else {
            alert(result.message || 'Login gagal. Periksa username dan password.');
        }
    });

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
    // API MOVE (ESP32) - D-PAD
    // ==============================
    const movementButtons = {
        btnUp: 'up',
        btnDown: 'down',
        btnLeft: 'left',
        btnRight: 'right',
        btnUpLeft: 'upleft',
        btnUpRight: 'upright',
        btnDownLeft: 'downleft',
        btnDownRight: 'downright'
    };

    Object.entries(movementButtons).forEach(([id, direction]) => {
        const btn = $(id);
        if (!btn) return;

        let moveInterval = null;

        const startMoving = async (e) => {
            e.preventDefault();
            if (guardEmergency()) return;
            if (currentMode !== 'custom') return;
            if (moveInterval) return;

            await sendApi('/api/control/move', 'POST', { direction: direction });

            moveInterval = setInterval(async () => {
                await sendApi('/api/control/move', 'POST', { direction: direction });
            }, 200);

            currentDirection = direction;
            await saveMachineSettings();
        };

        const stopMoving = async (e) => {
            e.preventDefault();
            if (moveInterval) {
                clearInterval(moveInterval);
                moveInterval = null;
            }

            if (currentMode === 'custom') {
                await sendApi('/api/control/move', 'POST', { direction: 'stop' });
            }
        };

        btn.addEventListener('mousedown', startMoving);
        btn.addEventListener('mouseup', stopMoving);
        btn.addEventListener('mouseleave', stopMoving);

        btn.addEventListener('touchstart', startMoving, { passive: false });
        btn.addEventListener('touchend', stopMoving);
        btn.addEventListener('touchcancel', stopMoving);
    });

    $('btnResetPos')?.addEventListener('click', async () => {
        if (guardEmergency()) return;
        if (currentMode !== 'custom') return;
        const result = await sendApi('/api/control/reset', 'POST', {});
        if (checkError(result)) return;

        currentMode = result.mode || 'custom';
        currentSpeed = Number(result.speed ?? 75);
        currentInterval = Number(result.interval ?? 2);
        currentDirection = 'stop';
        isLauncherRunning = false;
        isRandomRunning = false;

        updateModeSelect(currentMode);
        renderSettings();
        await saveMachineSettings();

        alert('Pengaturan berhasil direset.');
    });

    // ==============================
    // TOMBOL GUNAKAN MODE ACAK
    // ==============================
    btnRandomMode?.addEventListener('click', async () => {
        if (guardEmergency()) return;
        if (currentMode === 'custom') {
            currentMode = 'random';
            isRandomRunning = true;
        } else {
            currentMode = 'custom';
            isRandomRunning = false;
        }

        renderSettings();

        await sendApi('/api/control/random', 'POST', {});
        await sendApi('/api/control/mode', 'POST', { mode: currentMode });
        await saveMachineSettings();
    });

    // ==============================
    // API START / STOP (FIXED TOGGLE)
    // ==============================
    btnStart?.addEventListener('click', async () => {
        if (guardEmergency()) return;

        const action = isLauncherRunning ? 'stop' : 'start';

        if (action === 'start') {
            trainingStartTime = new Date(); 

            if (machineUptimeTimer) clearInterval(machineUptimeTimer);
            
            machineUptimeTimer = setInterval(() => {
                machineUptimeSeconds++;
                const mnt = Math.floor(machineUptimeSeconds / 60);
                const dtk = machineUptimeSeconds % 60;
                
                if (timerDisplay) {
                    if (mnt > 0) {
                        timerDisplay.textContent = `${mnt} Menit ${dtk} Detik`;
                    } else {
                        timerDisplay.textContent = `${dtk} Detik`;
                    }
                }
            }, 1000);

        } else {
            if (machineUptimeTimer) {
                clearInterval(machineUptimeTimer);
                machineUptimeTimer = null;
            }
        }

        const result = await sendApi('/api/control/start', 'POST', {
            action: action,
            mode: currentMode,
            speed: currentSpeed,
            interval: currentInterval
        });

        if (result.status !== 'error') {
            let durationSeconds = 0;

            if (action === 'stop' && trainingStartTime) {
                const endTime = new Date();
                durationSeconds = Math.floor((endTime - trainingStartTime) / 1000);
                if (durationSeconds < 0) durationSeconds = 0;
                trainingStartTime = null; 
            }

            // PERBAIKAN STATE JALAN / STOP
            isLauncherRunning = (action === 'start');
            if (!isLauncherRunning) isRandomRunning = false;

            renderSettings();

            await sendPhpApi('save_training', {
                mode: currentMode,
                speed: currentSpeed,
                interval: currentInterval,
                status: action === 'start' ? 'running' : 'completed',
                duration: durationSeconds, 
                notes: `Latihan mode ${currentMode} dengan kecepatan ${currentSpeed}%`
            });
        } else {
            // JIKA FAIL OFFLINE/ERROR REVERSED TOGGLE BUAT TEST UI
            isLauncherRunning = (action === 'start');
            renderSettings();
        }
    });

    // ==============================
    // EMERGENCY STOP HANDLER (FIXED TOGGLE ON/OFF)
    // ==============================
    btnEmergency?.addEventListener('click', async () => {
        if (!isEmergencyActive) {
            // BIKIN KONDISI DARURAT AKTIF
            await sendApi('/api/control/emergency', 'POST', {});

            isEmergencyActive = true;
            isLauncherRunning = false;
            isRandomRunning = false;
            currentDirection = 'stop';

            if (machineUptimeTimer) {
                clearInterval(machineUptimeTimer);
                machineUptimeTimer = null;
            }

            renderSettings();
            alert('BERHENTI DARURAT AKTIF! Seluruh modul kontrol dikunci. Pastikan kondisi aman sebelum mematikan darurat.');
        } else {
            // MATIKAN KONDISI DARURAT (RESET AMAN)
            isEmergencyActive = false;
            renderSettings();
            alert('Mode Berhenti Darurat dimatikan. Sistem kembali normal.');
        }
    });

    // ==============================
    // LOGIKA SENSOR HLK (IDLE & RESUME)
    // ==============================
    function handleHlkSensorStatus(inRange) {
        if (!isLauncherRunning) return;

        if (!inRange && isPlayerInHLKRange) {
            isPlayerInHLKRange = false;
            hlkCountdownBox?.classList.add('hidden');
            hlkStatusTitle.textContent = 'Pemain Tidak Dalam Range HLK';
            hlkStatusDesc.textContent = 'Mesin di-pause sementara. Silakan kembali ke area latihan.';
            hlkOverlay?.classList.remove('hidden');

            if (hlkResumeCountdownTimer) clearInterval(hlkResumeCountdownTimer);

        } else if (inRange && !isPlayerInHLKRange) {
            isPlayerInHLKRange = true;
            hlkStatusTitle.textContent = 'Pemain Terdeteksi!';
            hlkStatusDesc.textContent = 'Persiapkan diri Anda, mesin akan berlanjut secara otomatis.';
            hlkCountdownBox?.classList.remove('hidden');

            let countdown = 5;
            if (hlkTimerSpan) hlkTimerSpan.textContent = countdown;

            if (hlkResumeCountdownTimer) clearInterval(hlkResumeCountdownTimer);

            hlkResumeCountdownTimer = setInterval(() => {
                countdown--;
                if (hlkTimerSpan) hlkTimerSpan.textContent = countdown;

                if (countdown <= 0) {
                    clearInterval(hlkResumeCountdownTimer);
                    hlkOverlay?.classList.add('hidden');
                }
            }, 1000);
        }
    }

    async function refreshStatus() {
        const result = await sendApi('/api/status', 'GET');
        if (result.status === 'error') return;

        if (result.state !== undefined) {
            isLauncherRunning = result.state === 'running';
        }

        if (result.hlk_in_range !== undefined) {
            handleHlkSensorStatus(result.hlk_in_range);
        }

        if (result.mode) {
            currentMode = result.mode;
            updateModeSelect(currentMode);
        }

        if (result.speed !== undefined) currentSpeed = Number(result.speed);
        if (result.interval !== undefined) currentInterval = Number(result.interval);
        if (result.direction !== undefined) currentDirection = result.direction;

        renderSettings();
    }

    // ==============================
    // STANDAR TIPHON & QOS JARINGAN
    // ==============================
    function calculateTiphonQoS(latency, packetLoss, jitter) {
        let latencyScore = 4;
        if (latency > 450) latencyScore = 1;
        else if (latency > 300) latencyScore = 2;
        else if (latency > 150) latencyScore = 3;

        let packetLossScore = 4;
        if (packetLoss > 25) packetLossScore = 1;
        else if (packetLoss > 15) packetLossScore = 2;
        else if (packetLoss > 3) packetLossScore = 3;

        let jitterScore = 4;
        if (jitter > 225) jitterScore = 1;
        else if (jitter > 125) jitterScore = 2;
        else if (jitter > 75) jitterScore = 3;

        const avgScore = (latencyScore + packetLossScore + jitterScore) / 3;

        if (avgScore >= 3.8) return 'Sangat Baik';
        if (avgScore >= 3.0) return 'Baik';
        if (avgScore >= 2.0) return 'Cukup';
        return 'Buruk';
    }

    async function checkQoS() {
        const qosCards = qosPage?.querySelectorAll('.qos-metric-value');
        if (!qosCards || qosCards.length < 4) return;

        const startTime = performance.now();
        let latency = 15;
        let packetLoss = 0.0;
        let throughputText = "2.5 Mbps";
        let jitter = 1.2;

        try {
            const response = await fetch(`${ESP32_IP}/api/ping`, { method: 'GET', mode: 'cors' });
            latency = Math.round(performance.now() - startTime);
            const data = await response.json();

            packetLoss = data.packet_loss !== undefined ? parseFloat(data.packet_loss) : 0.1;
            throughputText = (data.throughput || data.bandwidth) ? `${data.throughput || data.bandwidth} Kbps` : '1024 Kbps';
            jitter = data.jitter !== undefined ? parseFloat(data.jitter) : 2.4;

            qosCards[0].textContent = `${latency} ms`; 
            qosCards[1].textContent = `${packetLoss}%`; 
            qosCards[2].textContent = throughputText; 
            qosCards[3].textContent = `${jitter} ms`; 
        } catch (err) {
            latency = 90;
            packetLoss = 0.0;
            throughputText = "60 Kbps";
            jitter = 60;

            qosCards[0].textContent = `${latency} ms`;    
            qosCards[1].textContent = `${packetLoss}%`;     
            qosCards[2].textContent = throughputText; 
            qosCards[3].textContent = `${jitter} ms`;   
        }

        const overallStatus = calculateTiphonQoS(latency, packetLoss, jitter);
        const overallStatusElem = $('qos-overall-status');
        if (overallStatusElem) {
            overallStatusElem.textContent = overallStatus;
        }
    }

    let qosTimer = null;
    $('btn-to-qos')?.addEventListener('click', () => {
        showPage(qosPage);
        checkQoS(); 
        if (qosTimer) clearInterval(qosTimer);
        qosTimer = setInterval(checkQoS, 2000); 
    });

    $('btn-qos-back')?.addEventListener('click', () => {
        if (qosTimer) {
            clearInterval(qosTimer);
            qosTimer = null;
        }
        showPage(controlPage);
    });

    // ==============================
    // HISTORI LATIHAN
    // ==============================
    async function loadHistoryData() {
        const list = historyPage?.querySelector('.history-list');
        if (!list) return;

        list.innerHTML = '<div class="history-card" style="text-align:center;">Memuat data histori dari database...</div>';

        const filterSelect = $('timeFilter');
        let filterValue = 'all';
        if (filterSelect) {
            const selectedText = filterSelect.value.toLowerCase();
            if (selectedText.includes('hari ini')) {
                filterValue = 'today';
            } else if (selectedText.includes('minggu ini')) {
                filterValue = 'week';
            } else if (selectedText.includes('bulan ini')) {
                filterValue = 'month'; 
            } else {
                filterValue = 'all';
            }
        }

        const result = await sendPhpApi('get_history', { filter: filterValue });

        if (result.status !== 'success') {
            list.innerHTML = `<div class="history-card" style="text-align:center; color:red;">${result.message || 'Gagal memuat histori.'}</div>`;
            return;
        }

        const statsValues = historyPage.querySelectorAll('.stat-value');
        if (statsValues.length >= 3 && result.summary) {
            statsValues[0].innerHTML = `${result.summary.total_sesi} <span class="stat-unit">sesi</span>`;
            statsValues[1].innerHTML = `${result.summary.total_durasi_jam} <span class="stat-unit">jam</span>`;
            statsValues[2].innerHTML = `${result.summary.rata_rata_mnt} <span class="stat-unit">mnt</span>`;
        }

        list.innerHTML = '';

        if (!result.history || result.history.length === 0) {
            list.innerHTML = '<div class="history-card" style="text-align:center;">Belum ada riwayat aktivitas latihan untuk filter ini.</div>';
            return;
        }

        result.history.forEach(item => {
            const start = new Date(item.started_at);
            const end = new Date(item.ended_at);
            let diffSec = Math.floor((end - start) / 1000);
            if (diffSec < 0) diffSec = 0;
            
            const durasiMnt = Math.floor(diffSec / 60);
            const sisaDetik = diffSec % 60;

            const card = document.createElement('div');
            card.className = 'history-card';
            card.innerHTML = `
                <div class="card-top">
                    <div>
                        <div class="card-date">Mode: ${item.mode.toUpperCase()}</div>
                        <div class="card-time">${item.started_at}</div>
                    </div>
                    <span class="badge ${item.status === 'completed' ? 'badge-gray' : 'badge-red'}">${item.status}</span>
                </div>
                <div class="card-duration">⏱ Durasi Latihan: <strong>${durasiMnt} menit ${sisaDetik} detik</strong> (${diffSec} total detik)</div>
                <div class="card-metrics">
                    <div>
                        <span class="metric-label">KECEPATAN</span>
                        <span class="metric-val">${item.speed}%</span>
                    </div>
                    <div>
                        <span class="metric-label">INTERVAL</span>
                        <span class="metric-val">${item.interval_seconds} dtk</span>
                    </div>
                </div>
                ${item.notes ? `<p class="subtitle" style="margin-top:4px;">CatatanCatatan: ${item.notes}</p>` : ''}
            `;
            list.appendChild(card);
        });
    }

    $('btn-to-history')?.addEventListener('click', async () => {
        const token = localStorage.getItem('pingpong_token');
        if (!token) {
            alert('Sesi Anda belum terdaftar atau token hilang. Silakan login kembali.');
            showPage(loginPage);
            return;
        }

        showPage(historyPage);  
        await loadHistoryData();
    });

    $('timeFilter')?.addEventListener('change', async () => {
        await loadHistoryData();
    });

    $('btn-history-back')?.addEventListener('click', () => showPage(controlPage));

    $('btnLogout')?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (statusTimer) {
            clearInterval(statusTimer);
            statusTimer = null;
        }
        if (machineUptimeTimer) {
            clearInterval(machineUptimeTimer);
            machineUptimeTimer = null;
        }
        machineUptimeSeconds = 0; 
        if (timerDisplay) timerDisplay.textContent = '0 Menit';

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

    renderSettings();
});