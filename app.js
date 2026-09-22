(function () {
    const sb = getSupabase();
    const state = { user: null, profile: null, accessGranted: true };

    const icons = {
        heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
        cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.3 10.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/></svg>',
    };

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
        })[char]);
    }

    function formatDate(value, options = {}) {
        if (!value) return '';
        return new Intl.DateTimeFormat('en', {
            day: 'numeric', month: 'short', year: 'numeric', ...options,
        }).format(new Date(value));
    }

    function formatMoney(value, currency = 'BDT') {
        if (value === null || value === undefined || value === '') return 'Price on request';
        return new Intl.NumberFormat('en-BD', {
            style: 'currency', currency, maximumFractionDigits: 0,
        }).format(Number(value));
    }

    function relativeTime(value) {
        const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
        const divisions = [
            { amount: 60, unit: 'second' }, { amount: 60, unit: 'minute' },
            { amount: 24, unit: 'hour' }, { amount: 7, unit: 'day' },
            { amount: 4.345, unit: 'week' }, { amount: 12, unit: 'month' },
            { amount: Infinity, unit: 'year' },
        ];
        let duration = seconds;
        for (const division of divisions) {
            if (Math.abs(duration) < division.amount) {
                return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(duration), division.unit);
            }
            duration /= division.amount;
        }
        return formatDate(value);
    }

    function safeNext(value) {
        if (!value) return 'index.html';
        try {
            const url = new URL(value, window.location.href);
            if (url.origin !== window.location.origin) return 'index.html';
            const file = url.pathname.split('/').pop() || 'index.html';
            return `${file}${url.search}${url.hash}`;
        } catch {
            return 'index.html';
        }
    }

    function loginUrl(next = window.location.href, mode = 'login') {
        const target = safeNext(next);
        return `login.html?mode=${mode}&next=${encodeURIComponent(target)}`;
    }

    function redirectToLogin(next = window.location.href, mode = 'login') {
        window.location.replace(loginUrl(next, mode));
    }

    function showToast(message, type = 'success') {
        let region = document.getElementById('toast-region');
        if (!region) {
            region = document.createElement('div');
            region.id = 'toast-region';
            region.className = 'toast-region';
            region.setAttribute('aria-live', 'polite');
            document.body.appendChild(region);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        region.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        window.setTimeout(() => {
            toast.classList.remove('show');
            window.setTimeout(() => toast.remove(), 250);
        }, 3500);
    }

    async function signedUrls(bucket, paths, expiresIn = 900) {
        const uniquePaths = [...new Set(paths.filter(Boolean))];
        if (!uniquePaths.length) return new Map();
        const result = new Map();
        const batches = [];
        for (let index = 0; index < uniquePaths.length; index += 100) batches.push(uniquePaths.slice(index, index + 100));
        const responses = await Promise.all(batches.map((batch) => sb.storage.from(bucket).createSignedUrls(batch, expiresIn)));
        responses.forEach(({ data, error }, batchIndex) => {
            if (error) throw error;
            const batch = batches[batchIndex];
            (data || []).forEach((item, index) => {
                if (item.signedUrl) result.set(item.path || batch[index], item.signedUrl);
            });
        });
        return result;
    }

    function emptyState(container, title, text = '') {
        if (!container) return;
        container.innerHTML = `<div class="empty-state"><p>${escapeHTML(title)}</p>${text ? `<span>${escapeHTML(text)}</span>` : ''}</div>`;
    }

    function initMobileMenu() {
        const toggle = document.querySelector('[data-menu-toggle]');
        const nav = document.querySelector('[data-nav-links]');
        if (!toggle || !nav) return;
        toggle.addEventListener('click', () => {
            const open = nav.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
        });
        nav.addEventListener('click', (event) => {
            if (event.target.closest('a')) {
                nav.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function initAccountMenu() {
        document.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-account-trigger]');
            const menu = document.querySelector('[data-account-menu]');
            if (trigger && menu) {
                const open = menu.classList.toggle('open');
                trigger.setAttribute('aria-expanded', String(open));
                return;
            }
            if (menu && !event.target.closest('.account-nav')) menu.classList.remove('open');
        });
    }

    function updateNavigation() {
        const isAdmin = Boolean(state.profile?.is_admin);
        document.querySelectorAll('.cart-link').forEach((link) => {
            link.hidden = isAdmin;
            link.setAttribute('aria-hidden', String(isAdmin));
        });
        document.querySelectorAll('[data-account-slot]').forEach((slot) => {
            if (!state.user) {
                slot.innerHTML = `<a href="${loginUrl(window.location.href)}" class="nav-account-link">Sign in</a>`;
                return;
            }
            const name = state.profile?.full_name || state.user.email?.split('@')[0] || 'Account';
            const initial = name.charAt(0).toUpperCase();
            slot.innerHTML = `
                <div class="account-nav">
                    <button class="account-trigger" type="button" data-account-trigger aria-expanded="false">
                        <span class="account-initial">${escapeHTML(initial)}</span>
                        <span class="account-name">${escapeHTML(name)}</span>
                    </button>
                    <div class="account-menu" data-account-menu>
                        <a href="profile.html">${isAdmin ? 'Account settings' : 'Account & orders'}</a>
                        ${isAdmin ? '<a href="admin.html">Admin studio</a>' : ''}
                        <button type="button" data-signout>Sign out</button>
                    </div>
                </div>`;
        });
    }

    async function updateCartCount() {
        const counters = document.querySelectorAll('[data-cart-count]');
        if (!counters.length) return;
        let count = 0;
        if (state.user && !state.profile?.is_banned && !state.profile?.is_admin) {
            const { count: cartCount } = await sb.from('cart_items').select('id', { count: 'exact', head: true });
            count = cartCount || 0;
        }
        counters.forEach((counter) => { counter.textContent = String(count); });
    }

    function showAuthDialog(targetHref) {
        let dialog = document.getElementById('auth-required-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'auth-required-dialog';
            dialog.className = 'auth-dialog';
            document.body.appendChild(dialog);
        }
        dialog.innerHTML = `
            <button class="dialog-close" type="button" aria-label="Close">×</button>
            <p class="eyebrow">Members only</p>
            <h2>Come inside the studio</h2>
            <p>Sign in or create an account to view artworks and highlights.</p>
            <div class="dialog-actions">
                <a class="button primary" href="${loginUrl(targetHref)}">Sign in</a>
                <a class="button quiet" href="${loginUrl(targetHref, 'register')}">Create account</a>
            </div>`;
        dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
        dialog.showModal();
    }

    function initGlobalActions() {
        document.addEventListener('click', async (event) => {
            const menuTrigger = event.target.closest('[data-admin-menu-trigger]');
            const menus = document.querySelectorAll('[data-admin-item-menu]');
            if (menuTrigger) {
                event.preventDefault();
                event.stopPropagation();
                const menu = menuTrigger.closest('[data-admin-item-menu]');
                const open = !menu.classList.contains('open');
                menus.forEach((item) => {
                    item.classList.remove('open');
                    item.querySelector('[data-admin-menu-trigger]')?.setAttribute('aria-expanded', 'false');
                });
                menu.classList.toggle('open', open);
                menuTrigger.setAttribute('aria-expanded', String(open));
                return;
            }
            if (!event.target.closest('[data-admin-item-menu]')) {
                menus.forEach((item) => {
                    item.classList.remove('open');
                    item.querySelector('[data-admin-menu-trigger]')?.setAttribute('aria-expanded', 'false');
                });
            }
            const protectedLink = event.target.closest('a[data-protected-link]');
            if (protectedLink && !state.user) {
                event.preventDefault();
                showAuthDialog(protectedLink.href);
                return;
            }
            const logout = event.target.closest('[data-signout]');
            if (logout) {
                event.preventDefault();
                logout.disabled = true;
                try { await signOut('index.html'); }
                catch (error) {
                    logout.disabled = false;
                    showToast(error.message || 'Could not sign out.', 'error');
                }
            }
        });
    }

    async function loadIdentity() {
        const { data: userData } = await sb.auth.getUser();
        state.user = userData.user || null;
        state.profile = null;
        if (state.user) {
            const { data } = await sb.from('user_profiles').select('*').eq('id', state.user.id).maybeSingle();
            state.profile = data || null;
            if (state.profile?.is_banned) {
                await sb.auth.signOut();
                state.user = null;
                state.profile = null;
                if (document.body.dataset.access) {
                    window.location.replace('login.html?notice=restricted');
                    return false;
                }
            }
        }
        return true;
    }

    function enforcePageAccess() {
        const required = document.body.dataset.access;
        state.accessGranted = true;
        if ((required === 'member' || required === 'customer') && !state.user) {
            state.accessGranted = false;
            redirectToLogin(window.location.href);
            return false;
        }
        if (required === 'customer' && state.profile?.is_admin) {
            state.accessGranted = false;
            window.location.replace('admin.html?notice=customer-only');
            return false;
        }
        if (required === 'admin' && (!state.user || !state.profile?.is_admin)) {
            state.accessGranted = false;
            window.location.replace(state.user ? 'index.html' : loginUrl(window.location.href));
            return false;
        }
        return true;
    }

    async function initialize() {
        initMobileMenu();
        initAccountMenu();
        initGlobalActions();
        await loadIdentity();
        if (!enforcePageAccess()) return state;
        updateNavigation();
        await updateCartCount();
        document.documentElement.classList.remove('auth-pending');
        document.body.classList.add('page-ready');
        window.dispatchEvent(new CustomEvent('painting-app-ready', { detail: state }));
        return state;
    }

    function adminMenu({ type, id, viewHref }) {
        if (!state.profile?.is_admin) return '';
        const safeType = ['painting', 'thought', 'highlight'].includes(type) ? type : '';
        if (!safeType) return '';
        const editHref = `admin.html?edit=${encodeURIComponent(safeType)}&id=${encodeURIComponent(id)}#manage`;
        return `<div class="admin-item-menu" data-admin-item-menu>
            <button class="admin-menu-trigger" type="button" data-admin-menu-trigger aria-label="Open admin actions" aria-expanded="false">&#8942;</button>
            <div class="admin-menu-popover" role="menu">
                <a href="${escapeHTML(viewHref)}" role="menuitem">View details</a>
                <a href="${editHref}" role="menuitem">Edit</a>
                <button type="button" data-admin-delete="${safeType}" data-id="${escapeHTML(id)}" role="menuitem">Delete</button>
            </div>
        </div>`;
    }

    const ready = initialize();
    onAuthChange((event) => {
        if (event === 'SIGNED_OUT') {
            state.user = null;
            state.profile = null;
            updateNavigation();
            updateCartCount();
        }
    });

    window.PaintingApp = {
        sb, state, ready, icons, escapeHTML, formatDate, formatMoney, relativeTime,
        signedUrls, emptyState, showToast, safeNext, loginUrl, redirectToLogin, updateCartCount, adminMenu,
    };
})();
