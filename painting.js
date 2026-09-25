(async function () {
    const app = window.PaintingApp;
    await app.ready;
    const { sb, state, escapeHTML, formatMoney, signedUrls, emptyState, showToast, icons } = app;
    const id = new URLSearchParams(window.location.search).get('id');
    const detail = document.getElementById('painting-detail');
    const related = document.getElementById('related-artworks');
    const isAdmin = Boolean(state.profile?.is_admin);

    if (!id) {
        emptyState(detail, 'This artwork could not be found.');
        return;
    }

    const paintingRequest = state.user
        ? sb.from('paintings').select('*').eq('id', id).single()
        : sb.rpc('get_public_paintings', { p_painting_id: id });
    const { data: paintingResult, error } = await paintingRequest;
    let painting = state.user ? paintingResult : paintingResult?.[0];

    if (error || !painting) {
        emptyState(detail, 'This artwork could not be found.');
        return;
    }

    const urls = await signedUrls('artworks', [painting.storage_path]);
    const imageUrl = urls.get(painting.storage_path) || '';
    const fullStory = painting.description?.trim() || painting.caption?.trim() || '';
    const previewStory = painting.story_preview?.trim() || '';
    const story = state.user ? fullStory : previewStory;
    const storyNeedsLogin = !state.user && Boolean(painting.has_more_story);
    document.title = `${painting.title} | Painting with passion`;

    detail.innerHTML = `
        <div class="painting-image-wrap" data-zoom-wrap>
            <img src="${imageUrl}" alt="${escapeHTML(painting.title)}" data-zoom-image>
        </div>
        <div class="painting-copy">
            <a class="back-link" href="gallery.html">← The collection</a>
            <p class="eyebrow" data-availability-eyebrow>${painting.is_available ? 'Original · Available' : 'Original · Unavailable'}</p>
            <h1>${escapeHTML(painting.title)}</h1>
            <p class="painting-spec">${escapeHTML([painting.medium, painting.dimensions].filter(Boolean).join(' · '))}</p>
            ${state.user && painting.caption ? `<p class="painting-caption">${escapeHTML(painting.caption)}</p>` : ''}
            ${story ? `<div class="painting-story${storyNeedsLogin ? ' is-preview' : ''}"><h2>About this piece</h2><div class="painting-story-copy">${story.split(/\n{2,}/).map((line) => `<p>${escapeHTML(line)}</p>`).join('')}</div>${storyNeedsLogin ? '<button class="painting-story-more" type="button" data-story-login>… See more</button>' : ''}</div>` : ''}
            ${isAdmin ? `<div class="admin-availability">
                <label for="artwork-availability"><span>Availability</span><select id="artwork-availability">
                    <option value="true" ${painting.is_available ? 'selected' : ''}>Available</option>
                    <option value="false" ${painting.is_available ? '' : 'selected'}>Unavailable</option>
                </select></label>
                <small>Changes apply immediately to Gallery, Cart, and checkout.</small>
            </div>` : ''}
            <div class="painting-purchase">
                <p class="painting-availability ${painting.is_available ? 'is-available' : 'is-unavailable'}" data-availability-status>${painting.is_available ? 'Available' : 'Currently unavailable'}</p>
                <strong>${painting.price === null ? 'Price on request' : formatMoney(painting.price, painting.currency)}</strong>
                <div class="painting-actions">
                    <button class="icon-button like-button" id="painting-like" aria-label="Like this artwork"></button>
                    ${isAdmin
                        ? `<a class="button primary" href="admin.html?edit=painting&id=${painting.id}#manage">Edit artwork</a>`
                        : `<button class="button primary" id="add-to-cart" ${!painting.is_available || painting.price === null ? 'disabled' : ''}>${painting.is_available && painting.price !== null ? 'Add to cart' : 'Not available'}</button>`}
                </div>
                <small>${isAdmin ? 'Admin accounts manage artworks and do not place customer orders.' : 'Orders are reviewed by the studio before payment and delivery are confirmed.'}</small>
            </div>
        </div>`;

    function requireLogin(title, message) {
        app.showAuthDialog(window.location.href, {
            eyebrow: 'Account required',
            title,
            message,
        });
    }

    detail.querySelector('[data-story-login]')?.addEventListener('click', () => {
        requireLogin('Log in to read the full story.', 'Sign in or create an account, then you will return to this artwork.');
    });

    const likeButton = document.getElementById('painting-like');
    async function loadLike() {
        const { data } = await sb.rpc('get_like_summary', { p_content_type: 'painting', p_content_id: id });
        const summary = data?.[0] || { like_count: 0, liked: false };
        likeButton.innerHTML = `${icons.heart}<span>${summary.like_count}</span>`;
        likeButton.classList.toggle('liked', Boolean(summary.liked));
    }
    likeButton.addEventListener('click', async () => {
        if (!state.user) {
            requireLogin('Log in to like this artwork.', 'Sign in or create an account to save your appreciation.');
            return;
        }
        const liked = likeButton.classList.contains('liked');
        likeButton.disabled = true;
        const query = liked
            ? sb.from('painting_likes').delete().eq('painting_id', id).eq('user_id', state.user.id)
            : sb.from('painting_likes').insert({ painting_id: id, user_id: state.user.id });
        const { error: likeError } = await query;
        likeButton.disabled = false;
        if (likeError) showToast(likeError.message, 'error'); else loadLike();
    });

    function applyAvailability(available) {
        painting.is_available = available;
        const eyebrow = detail.querySelector('[data-availability-eyebrow]');
        const status = detail.querySelector('[data-availability-status]');
        const cartButton = document.getElementById('add-to-cart');
        eyebrow.textContent = available ? 'Original · Available' : 'Original · Unavailable';
        status.textContent = available ? 'Available' : 'Currently unavailable';
        status.classList.toggle('is-available', available);
        status.classList.toggle('is-unavailable', !available);
        if (cartButton) {
            cartButton.disabled = !available || painting.price === null;
            cartButton.textContent = available && painting.price !== null ? 'Add to cart' : 'Not available';
        }
    }

    const availabilitySelect = document.getElementById('artwork-availability');
    availabilitySelect?.addEventListener('change', async () => {
        const nextAvailability = availabilitySelect.value === 'true';
        const previousAvailability = painting.is_available;
        availabilitySelect.disabled = true;
        const { data, error: updateError } = await sb
            .from('paintings')
            .update({ is_available: nextAvailability })
            .eq('id', id)
            .select('is_available')
            .single();
        availabilitySelect.disabled = false;
        if (updateError) {
            availabilitySelect.value = String(previousAvailability);
            showToast(updateError.message || 'Availability could not be updated.', 'error');
            return;
        }
        applyAvailability(Boolean(data.is_available));
        showToast(data.is_available ? 'Artwork is now available.' : 'Artwork is now unavailable.', 'success');
    });

    const cartButton = document.getElementById('add-to-cart');
    if (cartButton && !cartButton.disabled) {
        if (state.user) {
            const { data: existing } = await sb.from('cart_items').select('id').eq('painting_id', id).maybeSingle();
            if (existing) cartButton.textContent = 'View in cart';
        }
        cartButton.addEventListener('click', async () => {
            if (!state.user) {
                requireLogin('Log in to use your cart.', 'Sign in or create an account, then you will return to this artwork.');
                return;
            }
            if (cartButton.textContent === 'View in cart') {
                window.location.href = 'checkout.html';
                return;
            }
            cartButton.disabled = true;
            cartButton.textContent = 'Checking…';
            const { data: latest, error: latestError } = await sb
                .from('paintings')
                .select('title, published, is_available, price')
                .eq('id', id)
                .single();
            if (latestError) {
                showToast('Availability could not be checked. Please try again.', 'error');
                cartButton.disabled = false;
                cartButton.textContent = 'Add to cart';
                return;
            }
            if (!latest.published || !latest.is_available || latest.price === null) {
                applyAvailability(false);
                showToast(`${latest.title} is currently unavailable.`, 'error');
                return;
            }
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
            showToast('Artwork added to your cart.', 'success');
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

    const relatedRequest = state.user
        ? sb.from('paintings').select('id, title, storage_path, medium').eq('published', true).neq('id', id).limit(3)
        : sb.rpc('get_public_paintings');
    const { data: relatedResult } = await relatedRequest;
    const relatedRows = (relatedResult || []).filter((item) => item.id !== id).slice(0, 3);
    if (!relatedRows.length) {
        related.closest('section').hidden = true;
    } else {
        const relatedUrls = await signedUrls('artworks', relatedRows.map((item) => item.storage_path));
        related.innerHTML = relatedRows.map((item) => `<a href="painting.html?id=${item.id}"><img src="${relatedUrls.get(item.storage_path) || ''}" alt="${escapeHTML(item.title)}"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.medium || '')}</small></a>`).join('');
    }
    loadLike();
})();
