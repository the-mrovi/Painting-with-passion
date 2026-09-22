(async function () {
    const app = window.PaintingApp;
    await app.ready;
    const { sb, state, escapeHTML, formatMoney, signedUrls, emptyState, showToast, icons } = app;
    const id = new URLSearchParams(window.location.search).get('id');
    const detail = document.getElementById('painting-detail');
    const related = document.getElementById('related-artworks');
    if (!id) {
        emptyState(detail, 'This artwork could not be found.');
        return;
    }

    const { data: painting, error } = await sb.from('paintings').select('*').eq('id', id).single();
    if (error || !painting) {
        emptyState(detail, 'This artwork could not be found.');
        return;
    }
    const urls = await signedUrls('artworks', [painting.storage_path]);
    const imageUrl = urls.get(painting.storage_path) || '';
    document.title = `${painting.title} | Painting with passion`;
    detail.innerHTML = `
        <div class="painting-image-wrap" data-zoom-wrap>
            <img src="${imageUrl}" alt="${escapeHTML(painting.title)}" data-zoom-image>
        </div>
        <div class="painting-copy">
            <a class="back-link" href="gallery.html">← The collection</a>
            <p class="eyebrow">${painting.is_available ? 'Original · Available' : 'Private collection'}</p>
            <h1>${escapeHTML(painting.title)}</h1>
            <p class="painting-spec">${escapeHTML([painting.medium, painting.dimensions].filter(Boolean).join(' · '))}</p>
            ${painting.caption ? `<p class="painting-caption">${escapeHTML(painting.caption)}</p>` : ''}
            ${painting.description ? `<div class="painting-story"><h2>About this piece</h2>${painting.description.split(/\n{2,}/).map((line) => `<p>${escapeHTML(line)}</p>`).join('')}</div>` : ''}
            <div class="painting-purchase">
                <strong>${formatMoney(painting.price, painting.currency)}</strong>
                <div class="painting-actions">
                    <button class="icon-button like-button" id="painting-like" aria-label="Like this artwork"></button>
                    ${state.profile?.is_admin
                        ? `<a class="button primary" href="admin.html?edit=painting&id=${painting.id}#manage">Edit artwork</a>`
                        : `<button class="button primary" id="add-to-cart" ${!painting.is_available || painting.price === null ? 'disabled' : ''}>${painting.is_available && painting.price !== null ? 'Add to cart' : 'Not available'}</button>`}
                </div>
                <small>${state.profile?.is_admin ? 'Admin accounts manage artworks and do not place customer orders.' : 'Orders are reviewed by the studio before payment and delivery are confirmed.'}</small>
            </div>
        </div>`;

    const likeButton = document.getElementById('painting-like');
    async function loadLike() {
        const { data } = await sb.rpc('get_like_summary', { p_content_type: 'painting', p_content_id: id });
        const summary = data?.[0] || { like_count: 0, liked: false };
        likeButton.innerHTML = `${icons.heart}<span>${summary.like_count}</span>`;
        likeButton.classList.toggle('liked', Boolean(summary.liked));
    }
    likeButton.addEventListener('click', async () => {
        const liked = likeButton.classList.contains('liked');
        likeButton.disabled = true;
        const query = liked
            ? sb.from('painting_likes').delete().eq('painting_id', id).eq('user_id', state.user.id)
            : sb.from('painting_likes').insert({ painting_id: id, user_id: state.user.id });
        const { error: likeError } = await query;
        likeButton.disabled = false;
        if (likeError) showToast(likeError.message, 'error'); else loadLike();
    });

    const cartButton = document.getElementById('add-to-cart');
    if (cartButton && !cartButton.disabled) {
        const { data: existing } = await sb.from('cart_items').select('id').eq('painting_id', id).maybeSingle();
        if (existing) cartButton.textContent = 'View in cart';
        cartButton.addEventListener('click', async () => {
            if (cartButton.textContent === 'View in cart') {
                window.location.href = 'checkout.html';
                return;
            }
            cartButton.disabled = true;
            cartButton.textContent = 'Adding…';
            const { error: cartError } = await sb.from('cart_items').insert({ user_id: state.user.id, painting_id: id });
            if (cartError && cartError.code !== '23505') {
                showToast(cartError.message, 'error');
                cartButton.disabled = false;
                cartButton.textContent = 'Add to cart';
                return;
            }
            cartButton.disabled = false;
            cartButton.textContent = 'View in cart';
            app.updateCartCount();
            showToast('Artwork added to your cart.');
        });
    }

    const zoomWrap = detail.querySelector('[data-zoom-wrap]');
    const zoomImage = detail.querySelector('[data-zoom-image]');
    if (window.matchMedia('(hover: hover)').matches) {
        zoomWrap.addEventListener('pointermove', (event) => {
            const rect = zoomWrap.getBoundingClientRect();
            zoomImage.style.transformOrigin = `${((event.clientX - rect.left) / rect.width) * 100}% ${((event.clientY - rect.top) / rect.height) * 100}%`;
        });
    }

    const { data: relatedRows } = await sb.from('paintings').select('id, title, storage_path, medium').eq('published', true).neq('id', id).limit(3);
    if (!relatedRows?.length) {
        related.closest('section').hidden = true;
    } else {
        const relatedUrls = await signedUrls('artworks', relatedRows.map((item) => item.storage_path));
        related.innerHTML = relatedRows.map((item) => `<a href="painting.html?id=${item.id}"><img src="${relatedUrls.get(item.storage_path) || ''}" alt="${escapeHTML(item.title)}"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.medium || '')}</small></a>`).join('');
    }
    loadLike();
})();
