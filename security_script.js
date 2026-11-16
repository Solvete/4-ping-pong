
document.addEventListener('DOMContentLoaded', () => {

    const PHP_SECURITY_API =
        'http://192.168.4.2/pingpong-api/api_security_only.php';

    const ESP32_MAC_API =
        'http://192.168.4.1/api/get-client-mac';

    const TOKEN_KEY = 'pingpong_token';

    const $ = id => document.getElementById(id);

    const loginPage = $('login-page');
    const registerPage = $('register-page');
    const forgotPage = $('forgot-page');
    const controlPage = $('control-page');
    const loading = $('loading-overlay');

    function showPage(page) {
        [loginPage, registerPage, forgotPage, controlPage]
            .forEach(element => element?.classList.add('hidden'));

        page?.classList.remove('hidden');
    }

    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
    }

    async function getClientMac() {
        try {
            const response = await fetch(ESP32_MAC_API);
            if (!response.ok) throw new Error('MAC endpoint error');

            const data = await response.json();
            return data.mac || '';

        } catch (error) {
            console.error('Gagal mengambil MAC:', error);
            return '';
        }
    }

    async function securityRequest(action, payload = {}) {

        const token = localStorage.getItem(TOKEN_KEY);

        const headers = {
            'Content-Type': 'application/json'
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        try {
            const response = await fetch(PHP_SECURITY_API, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    action,
                    ...payload
                })
            });

            const data = await response.json();

            // Auto-Logout untuk sesi yang tidak valid.
            // Pengecualian: 403 pada verifikasi MAC bukan berarti sesi login invalid.
            if (
                token &&
                (response.status === 401 ||
                (response.status === 403 && action !== 'forgot_verify' && action !== 'forgot_reset'))
            ) {
                clearSession();
                showPage(loginPage);
            }

            return {
                ...data,
                httpStatus: response.status
            };

        } catch (error) {
            console.error('Security API:', error);

            return {
                success: false,
                message: 'Server tidak dapat dihubungi.'
            };
        }
    }

    // ==================================
    // VALIDASI TOKEN
    // ==================================

    async function validateSession() {

        const token = localStorage.getItem(TOKEN_KEY);

        if (!token) {
            showPage(loginPage);
            return false;
        }

        const result = await securityRequest('validate_token');

        if (!result.success) {
            clearSession();
            showPage(loginPage);
            return false;
        }

        showPage(controlPage);
        return true;
    }

    validateSession();

    // ==================================
    // SIGN UP
    // ==================================

    $('btn-submit-register')?.addEventListener('click', async event => {

        event.preventDefault();

        const username = $('reg-username')?.value.trim();
        const password = $('reg-password')?.value;
        const confirm = $('reg-confirm-password')?.value;

        if (!username || !password || !confirm) {
            alert('Lengkapi semua data.');
            return;
        }

        if (password !== confirm) {
            alert('Konfirmasi password tidak cocok.');
            return;
        }

        loading?.classList.remove('hidden');

        const mac = await getClientMac();

        const result = await securityRequest('register', {
            username,
            password,
            mac_address: mac
        });

        loading?.classList.add('hidden');

        alert(result.message);

        if (result.success) {
            showPage(loginPage);
        }
    });

    // ==================================
    // LOGIN
    // ==================================

    $('btn-submit-login')?.addEventListener('click', async event => {

        event.preventDefault();

        const username = $('login-username')?.value.trim();
        const password = $('login-password')?.value;

        if (!username || !password) {
            alert('Username dan password wajib diisi.');
            return;
        }

        loading?.classList.remove('hidden');

        const mac = await getClientMac();

        const result = await securityRequest('login', {
            username,
            password,
            mac_address: mac
        });

        loading?.classList.add('hidden');

        if (result.success && result.token) {

            localStorage.setItem(TOKEN_KEY, result.token);

            showPage(controlPage);

            alert('Login berhasil.');

        } else {
            alert(result.message);
        }
    });

    // ==================================
    // FORGOT PASSWORD
    // ==================================

    $('link-forgot')?.addEventListener('click', event => {
        event.preventDefault();

        $('forgot-step-1')?.classList.remove('hidden');
        $('forgot-step-2')?.classList.add('hidden');

        showPage(forgotPage);
    });

    // Verifikasi username dan MAC Address.
    $('btn-submit-verify')?.addEventListener('click', async event => {

        event.preventDefault();

        const username = $('forgot-username')?.value.trim();

        if (!username) {
            alert('Masukkan username.');
            return;
        }

        loading?.classList.remove('hidden');

        const mac = await getClientMac();

        const result = await securityRequest('forgot_verify', {
            username,
            mac_address: mac
        });

        loading?.classList.add('hidden');

        if (result.success) {
            $('forgot-username').disabled = true;

            $('forgot-step-1')?.classList.add('hidden');
            $('forgot-step-2')?.classList.remove('hidden');

            alert(result.message);

        } else {
            alert(result.message);
        }
    });

    // Reset password.
    $('btn-submit-reset-pw')?.addEventListener('click', async event => {

        event.preventDefault();

        const username = $('forgot-username')?.value.trim();
        const newPassword = $('forgot-new-password')?.value;
        const confirm = $('forgot-confirm-password')?.value;

        if (!newPassword || !confirm) {
            alert('Lengkapi password baru.');
            return;
        }

        if (newPassword !== confirm) {
            alert('Konfirmasi password tidak cocok.');
            return;
        }

        loading?.classList.remove('hidden');

        const result = await securityRequest('forgot_reset', {
            username,
            newPassword
        });

        loading?.classList.add('hidden');

        alert(result.message);

        if (result.success) {
            clearSession();
            $('forgot-username').disabled = false;
            showPage(loginPage);
        }
    });

    // ==================================
    // LOGOUT
    // ==================================

    $('btnLogout')?.addEventListener('click', async event => {

        event.preventDefault();

        const result = await securityRequest('logout');

        clearSession();
        showPage(loginPage);

        alert(result.message || 'Logout berhasil.');
    });

    // ==================================
    // NAVIGASI
    // ==================================

    $('btn-to-register')?.addEventListener('click', () => {
        showPage(registerPage);
    });

    $('btn-to-login')?.addEventListener('click', () => {
        showPage(loginPage);
    });

    $('btn-forgot-to-login')?.addEventListener('click', () => {
        $('forgot-username').disabled = false;
        showPage(loginPage);
    });

    // ==================================
    // VALIDASI TOKEN BERKALA
    // ==================================

    setInterval(() => {
        if (localStorage.getItem(TOKEN_KEY)) {
            validateSession();
        }
    }, 60000);

    // Bisa dipanggil oleh script aplikasi utama.
    window.getPingpongSecurityToken = () => {
        return localStorage.getItem(TOKEN_KEY) || '';
    };

    window.validatePingpongSecuritySession = validateSession;

});
