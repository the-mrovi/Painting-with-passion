(async function () {
    const app = window.PaintingApp;
    await app.ready;
    const { sb } = app;
    const params = new URLSearchParams(window.location.search);
    const next = app.safeNext(params.get('next') || 'index.html');
    const form = document.getElementById('auth-form');
    const message = document.getElementById('auth-message');
    const submit = document.getElementById('auth-submit');
    const forgot = document.getElementById('forgot-password');
    const backToLogin = document.getElementById('back-to-login');
    const modeButtons = document.querySelectorAll('button[data-auth-mode]');
    const heading = {
        eyebrow: document.getElementById('auth-eyebrow'),
        title: document.getElementById('auth-title'),
        description: document.getElementById('auth-description'),
    };
    const initialMode = ['login', 'register', 'recovery'].includes(params.get('mode')) ? params.get('mode') : 'login';
    let mode = initialMode;

    function setMessage(text = '', type = '') {
        message.textContent = text;
        message.className = `form-message ${type}`;
    }

    function setMode(value) {
        mode = ['login', 'register', 'recovery'].includes(value) ? value : 'login';
        document.body.dataset.authMode = mode;
        modeButtons.forEach((button) => {
            const active = button.dataset.authMode === mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        const copy = {
            login: ['The private studio', 'Welcome in', 'Sign in to see artworks, highlights, and your orders.', 'Sign in'],
            register: ['Join the studio', 'Create an account', 'Save favourites, follow new work, and place artwork orders.', 'Create account'],
            recovery: ['Account recovery', 'Reset your password', 'Enter the email used for your account. We will send you a secure reset link.', 'Send reset link'],
        }[mode];
        heading.eyebrow.textContent = copy[0];
        heading.title.textContent = copy[1];
        heading.description.textContent = copy[2];
        submit.textContent = copy[3];
        form.elements.password.required = mode !== 'recovery';
        form.elements.password_confirmation.required = mode === 'register';
        form.elements.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
        setMessage();
    }

    modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.authMode)));
    document.querySelectorAll('[data-password-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.passwordToggle);
            input.type = input.type === 'password' ? 'text' : 'password';
            button.textContent = input.type === 'password' ? 'Show' : 'Hide';
        });
    });

    setMode(mode);

    if (params.get('notice') === 'restricted') {
        setMessage('This account is currently restricted. Please contact the studio if you think this is a mistake.', 'error');
    } else if (next !== 'index.html') {
        setMessage('Sign in to continue to the members-only studio.', 'info');
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const email = String(data.get('email') || '').trim().toLowerCase();
        const password = String(data.get('password') || '');
        setMessage();

        if (!email) {
            setMessage('Enter the email used for your account.', 'error');
            return;
        }

        if (mode !== 'recovery' && !password) {
            setMessage('Enter your email and password.', 'error');
            return;
        }

        submit.disabled = true;
        submit.textContent = mode === 'register' ? 'Creating account…' : mode === 'recovery' ? 'Sending link…' : 'Signing in…';
        try {
            if (mode === 'recovery') {
                const { error } = await sb.auth.resetPasswordForEmail(email, {
                    redirectTo: new URL('reset-password.html', window.location.href).href,
                });
                if (error) throw error;
                form.reset();
                setMessage('If an account uses that email, a password reset link is on its way. Check your inbox and spam folder.', 'success');
                return;
            } else if (mode === 'register') {
                const fullName = String(data.get('full_name') || '').trim();
                const phoneNumber = String(data.get('phone_number') || '').trim();
                const confirmation = String(data.get('password_confirmation') || '');
                if (!fullName) throw new Error('Please enter your name.');
                if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
                if (password !== confirmation) throw new Error('The passwords do not match.');

                const { data: authData, error } = await sb.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { full_name: fullName, phone_number: phoneNumber },
                        emailRedirectTo: new URL('index.html', window.location.href).href,
                    },
                });
                if (error) throw error;
                if (!authData.session) {
                    form.reset();
                    setMode('login');
                    setMessage('Account created. Check your email to confirm it, then sign in.', 'success');
                    return;
                }
            } else {
                const { data: authData, error } = await sb.auth.signInWithPassword({ email, password });
                if (error) throw error;
                const { data: profile } = await sb.from('user_profiles').select('is_admin, is_banned').eq('id', authData.user.id).maybeSingle();
                if (profile?.is_banned) {
                    await sb.auth.signOut();
                    throw new Error('This account is currently restricted.');
                }
                const destination = next === 'index.html' && profile?.is_admin ? 'admin.html' : next;
                window.location.replace(destination);
                return;
            }
            window.location.replace(next);
        } catch (error) {
            setMessage(error.message || 'Authentication failed. Please try again.', 'error');
        } finally {
            submit.disabled = false;
            submit.textContent = mode === 'register' ? 'Create account' : mode === 'recovery' ? 'Send reset link' : 'Sign in';
        }
    });

    forgot.addEventListener('click', () => setMode('recovery'));
    backToLogin.addEventListener('click', () => setMode('login'));
})();
