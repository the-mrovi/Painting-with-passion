(async function () {
    const app = window.PaintingApp;
    await app.ready;
    if (!app.state.accessGranted || app.state.profile?.is_admin) return;
    const { sb, state, escapeHTML, formatMoney, signedUrls, emptyState, showToast, updateCartCount } = app;
    const list = document.getElementById('cart-items');
    const total = document.getElementById('cart-total');
    const form = document.getElementById('checkout-form');
    const orderPanel = document.getElementById('order-panel');
    let cart = [];

    if (state.profile) {
        form.elements.full_name.value = state.profile.full_name || '';
        form.elements.email.value = state.profile.email || state.user.email || '';
        form.elements.phone.value = state.profile.phone_number || '';
    }

    form.querySelectorAll('[name="payment_method"]').forEach((radio) => radio.addEventListener('change', () => {
        const mobile = form.elements.payment_method.value === 'mobile_transfer';
        document.getElementById('payment-reference-field').hidden = !mobile;
    }));

    async function loadCart() {
        const { data, error } = await sb.from('cart_items').select('id, painting_id, paintings(*)').order('created_at');
        if (error) {
            emptyState(list, 'Your cart could not be loaded.');
            return;
        }
        cart = (data || []).filter((item) => item.paintings);
        if (!cart.length) {
            emptyState(list, 'Your cart is empty.', 'Return to the collection to choose a piece.');
            total.textContent = formatMoney(0, 'BDT');
            orderPanel.hidden = true;
            return;
        }
        orderPanel.hidden = false;
        const urls = await signedUrls('artworks', cart.map((item) => item.paintings.storage_path));
        list.innerHTML = cart.map((item) => {
            const painting = item.paintings;
            return `<article class="cart-row ${!painting.is_available ? 'unavailable' : ''}">
                <img src="${urls.get(painting.storage_path) || ''}" alt="${escapeHTML(painting.title)}">
                <div><a href="painting.html?id=${painting.id}">${escapeHTML(painting.title)}</a><span>${escapeHTML([painting.medium, painting.dimensions].filter(Boolean).join(' · '))}</span>${!painting.is_available ? '<em>No longer available</em>' : ''}</div>
                <strong>${formatMoney(painting.price, painting.currency)}</strong>
                <button data-remove-cart="${item.id}" aria-label="Remove ${escapeHTML(painting.title)}">Remove</button>
            </article>`;
        }).join('');
        const currency = cart[0].paintings.currency;
        const sum = cart.reduce((value, item) => value + (item.paintings.is_available ? Number(item.paintings.price || 0) : 0), 0);
        total.textContent = formatMoney(sum, currency);
    }

    list.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-remove-cart]');
        if (!button) return;
        button.disabled = true;
        const { error } = await sb.from('cart_items').delete().eq('id', button.dataset.removeCart);
        if (error) showToast(error.message, 'error');
        else {
            await loadCart();
            updateCartCount();
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]');
        const data = new FormData(form);
        button.disabled = true;
        button.textContent = 'Placing order…';
        const { data: result, error } = await sb.rpc('place_order', {
            p_full_name: String(data.get('full_name') || ''),
            p_email: String(data.get('email') || ''),
            p_phone: String(data.get('phone') || ''),
            p_address_line: String(data.get('address_line') || ''),
            p_city: String(data.get('city') || ''),
            p_postal_code: String(data.get('postal_code') || ''),
            p_country: String(data.get('country') || ''),
            p_payment_method: String(data.get('payment_method') || 'studio_confirmation'),
            p_payment_reference: String(data.get('payment_reference') || ''),
            p_customer_note: String(data.get('customer_note') || ''),
        });
        button.disabled = false;
        button.textContent = 'Place order';
        if (error) {
            showToast(error.message, 'error');
            await loadCart();
            return;
        }
        const order = result?.[0];
        updateCartCount();
        const dialog = document.getElementById('order-success');
        dialog.querySelector('[data-order-number]').textContent = order?.order_number || 'Created';
        dialog.showModal();
    });

    document.getElementById('order-success').addEventListener('close', () => { window.location.href = 'profile.html#orders'; });
    await loadCart();
})();
