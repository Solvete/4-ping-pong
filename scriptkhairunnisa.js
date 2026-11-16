window.onerror = function(msg, url, line) {
    alert("CRASH JS: " + msg + " di baris " + line);
};

document.addEventListener('DOMContentLoaded', () => {
    const ESP32_IP = 'http://192.168.4.1';

    const $ = (id) => document.getElementById(id);

    // =========================================================
    // 1. MANAJEMEN HALAMAN (SPA NAVIGATION) - FRONTEND
    // =========================================================
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

    // Elemen Sensor HLK Overlay
    const hlkOverlay = $('hlk-overlay');
    const hlkStatusTitle = $('hlk-status-title');
    const hlkStatusDesc = $('hlk-status-desc');
    const hlkCountdownBox = $('hlk-countdown-box');
    const hlkTimerSpan = $('hlk-timer');

    // State Variables (Status Lokal Frontend)
    let currentSpeed = 75;
    let currentInterval = 2;
    let currentMode = 'custom';
    let currentDirection = 'stop';
    let isLauncherRunning = false;
    let isRandomRunning = false;
    let isEmergencyActive = false;
    let isPlayerInHLKRange = true;
    let hlkResumeCountdownTimer = null;
    let trainingStartTime = null; 
    let machineUptimeSeconds = 0;
    let machineUptimeTimer = null;

    // Pop-up Guide Troubleshooting
    document.querySelectorAll('.help-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            helpModal?.classList.remove('hidden');
        });
    });

    $('btn-close-help')?.addEventListener('click', () => helpModal?.classList.add('hidden'));
    $('btn-understood')?.addEventListener('click', () => helpModal?.classList.add('hidden'));

    function showPage(target) {
        if (!target) return;
        pages.forEach(page => page?.classList.add('hidden'));
        target.classList.remove('hidden');
        window.scrollTo(0, 0);
    }

    // Auto Check Token Lokal
    const savedToken = localStorage.getItem('pingpong_token');
    if (savedToken) {
        showPage(controlPage);
        renderSettings();
    } else {
        showPage(loginPage);
    }

    // =========================================================
    // 2. KONTROL MIKROKONTROLER (ESP32 API) - FRONTEND & HARDARE
    // =========================================================
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

            return data;
        } catch (error) {
            console.warn(`[Simulasi Mode Offline - ${endpoint}]`, error.message);
            if (endpoint === '/api/control/start') {
                return { status: 'success', state: payload.action === 'start' ? 'running' : 'stopped' };
            }
            return { status: 'success' };
        }
    }

    // Validasi & Pengunci Kontrol (UI Guarding)
    function guardEmergency() {
        if (isEmergencyActive) {
            alert('Matikan mode Berhenti Darurat terlebih dahulu untuk memulai kembali permainan!');
            return true;
        }
        return false;
    }

    function toggleControls() {
        const isLocked = isEmergencyActive || isLauncherRunning;
        const isCustomOrRandom = (currentMode === 'custom' || currentMode === 'random') && !isLocked;
        const isPureCustom = (currentMode === 'custom') && !isLocked;

        if (modeSelect) modeSelect.disabled = isLocked;

        if ($('speedPlus')) $('speedPlus').disabled = !isCustomOrRandom;
        if ($('speedMinus')) $('speedMinus').disabled = !isCustomOrRandom;
        if ($('intervalPlus')) $('intervalPlus').disabled = !isCustomOrRandom;
        if ($('intervalMinus')) $('intervalMinus').disabled = !isCustomOrRandom;

        const dpadButtons = [
            'btnUp', 'btnDown', 'btnLeft', 'btnRight', 
            'btnUpLeft', 'btnUpRight', 'btnDownLeft', 'btnDownRight', 
            'btnResetPos'
        ];
        dpadButtons.forEach(id => {
            const btn = $(id);
            if (btn) btn.disabled = !isPureCustom;
        });

        if (btnRandomMode) btnRandomMode.disabled = !isCustomOrRandom;
        if (btnStart) btnStart.disabled = isEmergencyActive;
    }

    function renderSettings() {
        if (speedInput) speedInput.value = `${currentSpeed}%`;
        if (intervalInput) intervalInput.value = `${currentInterval} dtk`;
        
        toggleControls();

        if (btnStart) {
            btnStart.textContent = isLauncherRunning ? '⏹ Berhentikan Pelontar' : '▶ Mulai Pelontar';
        }

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

    function modeToESP32(mode) {
        const modeMap = { easy: 'beginner', medium: 'intermediate', hard: 'advanced', custom: 'custom' };
        return modeMap[mode] || 'custom';
    }

    async function applyMode(mode) {
        if (guardEmergency()) return;
        currentMode = modeToESP32(mode);

        if (mode === 'easy' || mode === 'beginner') {
            currentSpeed = 40; currentInterval = 4;
        } else if (mode === 'medium' || mode === 'intermediate') {
            currentSpeed = 65; currentInterval = 3;
        } else if (mode === 'hard' || mode === 'advanced') {
            currentSpeed = 90; currentInterval = 1;
        }

        renderSettings();
        await sendApi('/api/control/mode', 'POST', { mode: currentMode });
    }

    modeSelect?.addEventListener('change', async () => await applyMode(modeSelect.value));

    $('speedPlus')?.addEventListener('click', async () => {
        if (guardEmergency() || (currentMode !== 'custom' && currentMode !== 'random')) return;
        currentSpeed = Math.min(100, currentSpeed + 5);
        renderSettings();
        await sendApi('/api/control/settings', 'POST', { speed: currentSpeed, interval: currentInterval });
    });

    $('speedMinus')?.addEventListener('click', async () => {
        if (guardEmergency() || (currentMode !== 'custom' && currentMode !== 'random')) return;
        currentSpeed = Math.max(10, currentSpeed - 5);
        renderSettings();
        await sendApi('/api/control/settings', 'POST', { speed: currentSpeed, interval: currentInterval });
    });

    $('intervalPlus')?.addEventListener('click', async () => {
        if (guardEmergency() || (currentMode !== 'custom' && currentMode !== 'random')) return;
        currentInterval = Math.min(10, currentInterval + 1);
        renderSettings();
        await sendApi('/api/control/settings', 'POST', { speed: currentSpeed, interval: currentInterval });
    });

    $('intervalMinus')?.addEventListener('click', async () => {
        if (guardEmergency() || (currentMode !== 'custom' && currentMode !== 'random')) return;
        currentInterval = Math.max(1, currentInterval - 1);
        renderSettings();
        await sendApi('/api/control/settings', 'POST', { speed: currentSpeed, interval: currentInterval });
    });

    // Login & Navigation Event Listeners (Frontend Flow)
    $('btn-submit-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.setItem('pingpong_token', 'frontend_demo_token');
        showPage(controlPage);
    });

    $('btn-to-register')?.addEventListener('click', () => showPage(registerPage));
    $('btn-submit-register')?.addEventListener('click', (e) => {
        e.preventDefault();
        alert('Registrasi berhasil (Simulasi Frontend).');
        showPage(loginPage);
    });

    $('btnLogout')?.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('pingpong_token');
        showPage(loginPage);
    });

    // Movement D-Pad Control
    const movementButtons = {
        btnUp: 'up', btnDown: 'down', btnLeft: 'left', btnRight: 'right',
        btnUpLeft: 'upleft', btnUpRight: 'upright', btnDownLeft: 'downleft', btnDownRight: 'downright'
    };

    Object.entries(movementButtons).forEach(([id, direction]) => {
        const btn = $(id);
        if (!btn) return;

        let moveInterval = null;

        const startMoving = async (e) => {
            e.preventDefault();
            if (guardEmergency() || currentMode !== 'custom' || moveInterval) return;
            await sendApi('/api/control/move', 'POST', { direction });
            moveInterval = setInterval(async () => {
                await sendApi('/api/control/move', 'POST', { direction });
            }, 200);
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
    });

    // Start / Stop Launcher & Timer Uptime
    btnStart?.addEventListener('click', async () => {
        if (guardEmergency()) return;

        isLauncherRunning = !isLauncherRunning;

        if (isLauncherRunning) {
            trainingStartTime = new Date();
            if (machineUptimeTimer) clearInterval(machineUptimeTimer);
            machineUptimeTimer = setInterval(() => {
                machineUptimeSeconds++;
                const mnt = Math.floor(machineUptimeSeconds / 60);
                const dtk = machineUptimeSeconds % 60;
                if (timerDisplay) {
                    timerDisplay.textContent = mnt > 0 ? `${mnt} Menit ${dtk} Detik` : `${dtk} Detik`;
                }
            }, 1000);
        } else {
            if (machineUptimeTimer) {
                clearInterval(machineUptimeTimer);
                machineUptimeTimer = null;
            }
        }

        renderSettings();
        await sendApi('/api/control/start', 'POST', {
            action: isLauncherRunning ? 'start' : 'stop',
            mode: currentMode, speed: currentSpeed, interval: currentInterval
        });
    });

    // Emergency Stop Local Handler
    btnEmergency?.addEventListener('click', async () => {
        isEmergencyActive = !isEmergencyActive;
        if (isEmergencyActive) {
            isLauncherRunning = false;
            isRandomRunning = false;
            if (machineUptimeTimer) {
                clearInterval(machineUptimeTimer);
                machineUptimeTimer = null;
            }
            renderSettings();
            alert('BERHENTI DARURAT AKTIF! Kontrol dikunci.');
        } else {
            renderSettings();
            alert('Mode Berhenti Darurat dimatikan.');
        }
        await sendApi('/api/control/emergency', 'POST', {});
    });

    // =========================================================
    // 3. PENGUJIAN KUALITAS JARINGAN (QoS & TIPHON METRICS) - PERFORMA
    // =========================================================
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
        } catch (err) {
            // Nilai Toleransi Simulasi saat Offline
            latency = 90;
            packetLoss = 0.0;
            throughputText = "60 Kbps";
            jitter = 60;
        }

        qosCards[0].textContent = `${latency} ms`; 
        qosCards[1].textContent = `${packetLoss}%`; 
        qosCards[2].textContent = throughputText; 
        qosCards[3].textContent = `${jitter} ms`; 

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

    $('btn-to-history')?.addEventListener('click', () => showPage(historyPage));
    $('btn-history-back')?.addEventListener('click', () => showPage(controlPage));

    renderSettings();
});