(async function () {
    const sb = getSupabase();
    const form = document.getElementById('reset-password-form');
    const submit = document.getElementById('reset-submit');
    const message = document.getElementById('reset-message');
    const loading = document.getElementById('reset-loading');
    const invalid = document.getElementById('reset-invalid');
    const success = document.getElementById('reset-success');
    const continueLink = document.getElementById('continue-to-account');
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const hasRecoveryParameters = hash.get('type') === 'recovery' || hash.has('access_token') || query.has('code');
    let recoverySession = null;
    let completed = false;

    function setMessage(text = '', type = '') {
        message.textContent = text;
        message.className = `form-message ${type}`;
    }

    function showForm(session) {
        if (completed || !session) return;
        recoverySession = session;
        loading.hidden = true;
        invalid.hidden = true;
        form.hidden = false;
        if (hasRecoveryParameters) history.replaceState({}, '', window.location.pathname);
        form.elements.password.focus();
    }

    function showInvalid() {
        if (completed || recoverySession) return;
        loading.hidden = true;
        form.hidden = true;
        invalid.hidden = false;
    }

    const { data: listener } = sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) showForm(session);
    });

    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (!sessionError && sessionData.session && hasRecoveryParameters) {
        showForm(sessionData.session);
    } else if (!recoverySession) {
        showInvalid();
    }

    document.querySelectorAll('[data-password-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.passwordToggle);
            input.type = input.type === 'password' ? 'text' : 'password';
            button.textContent = input.type === 'password' ? 'Show' : 'Hide';
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = form.elements.password.value;
        const confirmation = form.elements.password_confirmation.value;
        setMessage();

        if (!recoverySession) {
            showInvalid();
            return;
        }
        if (password.length < 8) {
            setMessage('Use at least 8 characters for your new password.', 'error');
            return;
        }
        if (password !== confirmation) {
            setMessage('The passwords do not match.', 'error');
            return;
        }

        submit.disabled = true;
        submit.textContent = 'Updating password…';
        const { data, error } = await sb.auth.updateUser({ password });
        if (error) {
            submit.disabled = false;
            submit.textContent = 'Update password';
            setMessage(error.message || 'The password could not be updated. Request a new reset link and try again.', 'error');
            return;
        }

        completed = true;
        form.reset();
        form.hidden = true;
        success.hidden = false;
        const userId = data.user?.id || recoverySession.user?.id;
        if (userId) {
            const { data: profile } = await sb.from('user_profiles').select('is_admin').eq('id', userId).maybeSingle();
            if (profile?.is_admin) {
                continueLink.href = 'admin.html';
                continueLink.textContent = 'Continue to admin studio';
            }
        }
        listener.subscription.unsubscribe();
    });
})();
