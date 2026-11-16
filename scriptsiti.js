const PHP_API = 'http://192.168.4.2/pingpong-api/api.php';

/**
 * Fungsi inti pengirim request POST berformat JSON ke server PHP (Laragon)
 */
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
            return { status: 'error', message: 'Unauthorized' };
        }

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

/**
 * Mengambil konfigurasi pengaturan mesin terakhir milik user dari database
 */
async function loadMachineSettingsFromDB() {
    const result = await sendPhpApi('get_settings');
    if (result.status === 'success' && result.settings) {
        return {
            mode: result.settings.mode || 'custom',
            speed: Number(result.settings.speed || 75),
            interval: Number(result.settings.interval_seconds || 2),
            direction: result.settings.direction || 'stop',
            random_enabled: Number(result.settings.random_enabled || 0)
        };
    }
    return null;
}

/**
 * Menyimpan perubahan pengaturan kecepatan, interval, & arah ke database
 */
async function saveMachineSettingsToDB({ mode, speed, interval, direction, random_enabled }) {
    return await sendPhpApi('update_settings', {
        mode,
        speed,
        interval,
        direction,
        random_enabled: random_enabled ? 1 : 0
    });
}

/**
 * Mencatat sesi latihan (mulai / selesai beserta durasi riil) ke database
 */
async function recordTrainingSessionToDB({ mode, speed, interval, status, duration, notes }) {
    return await sendPhpApi('save_training', {
        mode,
        speed,
        interval,
        status,
        duration,
        notes
    });
}

/**
 * Mengambil data histori latihan & ringkasan statistik berdasarkan filter waktu
 */
async function fetchTrainingHistoryFromDB(filterValue = 'all') {
    const result = await sendPhpApi('get_history', { filter: filterValue });

    if (result.status !== 'success') {
        return {
            success: false,
            message: result.message || 'Gagal memuat histori.'
        };
    }

    return {
        success: true,
        summary: result.summary,
        history: result.history
    };
}

// Ekspos seluruh fungsi layanan Back-End agar dapat dipanggil oleh modul Front-End / IoT
window.BackendService = {
    sendPhpApi,
    loadMachineSettingsFromDB,
    saveMachineSettingsToDB,
    recordTrainingSessionToDB,
    fetchTrainingHistoryFromDB
};