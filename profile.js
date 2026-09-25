(async function () {
    const app = window.PaintingApp;
    await app.ready;
    const { sb, state, escapeHTML, formatDate, formatMoney, emptyState, showToast } = app;
    const profile = state.profile || {};
    const heading = document.getElementById('profile-heading');
    const form = document.getElementById('profile-form');
    const passwordForm = document.getElementById('password-form');
    const orders = document.getElementById('profile-orders');

    heading.innerHTML = `
        <div class="profile-heading-copy">
            <p class="eyebrow">${profile.is_admin ? 'Admin account' : 'Member account'}</p>
            <h1 class="site-page-title portfolio-section-title">Profile</h1>
        </div>
        <div class="profile-identity">
            <span>${escapeHTML((profile.full_name || 'A').charAt(0).toUpperCase())}</span>
            <div><strong>${escapeHTML(profile.full_name || 'Your account')}</strong><p>${escapeHTML(profile.email || state.user.email || '')}</p></div>
        </div>`;
    form.elements.full_name.value = profile.full_name || '';
    form.elements.phone_number.value = profile.phone_number || '';
    form.elements.email.value = profile.email || state.user.email || '';

    if (profile.is_admin) {
        document.querySelector('.orders-column')?.setAttribute('hidden', '');
        document.querySelector('.profile-layout')?.classList.add('admin-profile-layout');
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]');
        const fullName = form.elements.full_name.value.trim();
        const phoneNumber = form.elements.phone_number.value.trim();
        if (!fullName) return;
        button.disabled = true;
        const { error } = await sb.from('user_profiles').update({ full_name: fullName, phone_number: phoneNumber || null }).eq('id', state.user.id);
        button.disabled = false;
        if (error) showToast(error.message, 'error');
        else {
            state.profile.full_name = fullName;
            state.profile.phone_number = phoneNumber;
            showToast('Account details saved.');
        }
    });

    passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = passwordForm.elements.password.value;
        const confirmation = passwordForm.elements.password_confirmation.value;
        if (password.length < 8) {
            showToast('Use at least 8 characters for your new password.', 'error');
            return;
        }
        if (password !== confirmation) {
            showToast('The passwords do not match.', 'error');
            return;
        }
        const button = passwordForm.querySelector('[type="submit"]');
        button.disabled = true;
        const { error } = await sb.auth.updateUser({ password });
        button.disabled = false;
        if (error) showToast(error.message, 'error');
        else {
            passwordForm.reset();
            showToast('Password updated.');
        }
    });

    document.getElementById('profile-signout').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try { await signOut('index.html'); }
        catch (error) {
            event.currentTarget.disabled = false;
            showToast(error.message, 'error');
        }
    });

    if (profile.is_admin) return;

    const { data: orderRows, error: orderError } = await sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
    if (orderError || !orderRows?.length) {
        emptyState(orders, orderError ? 'Orders could not be loaded.' : 'No orders yet.', orderError ? '' : 'Placed orders will appear here.');
        return;
    }
    orders.innerHTML = orderRows.map((order) => `
        <details class="order-card">
            <summary>
                <span><strong>${escapeHTML(order.order_number)}</strong><small>${formatDate(order.created_at)}</small></span>
                <span><em class="order-status ${order.status}">${escapeHTML(order.status)}</em><strong>${formatMoney(order.total, order.currency)}</strong></span>
            </summary>
            <div class="order-card-body">
                ${(order.order_items || []).map((item) => `<div><span>${escapeHTML(item.artwork_name)}</span><strong>${formatMoney(item.line_total, order.currency)}</strong></div>`).join('')}
                <p>Delivery to ${escapeHTML(order.address_line)}, ${escapeHTML(order.city)}. The studio will contact you before payment or dispatch.</p>
            </div>
        </details>`).join('');
})();
