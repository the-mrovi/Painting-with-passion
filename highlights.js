(async function () {
    const app = window.PaintingApp;
    await app.ready;
    if (!app.state.accessGranted) return;
    const { sb, state, escapeHTML, signedUrls, emptyState, showToast, icons, adminMenu } = app;
    const categoryRail = document.getElementById('highlight-categories');
    const viewer = document.getElementById('highlight-viewer');
    const title = document.getElementById('active-highlight-title');
    const count = document.getElementById('active-highlight-count');
    const params = new URLSearchParams(window.location.search);
    const requestedCategory = params.get('category');
    const requestedItem = params.get('item');
    let categories = [];
    let items = [];
    let activeCategory = null;
    let index = 0;
    let timer = null;
    let urlMap = new Map();

    if (state.profile?.is_admin) {
        document.querySelector('.page-intro')?.insertAdjacentHTML(
            'beforeend',
            '<a class="button primary admin-page-action" href="admin.html#highlight"><span aria-hidden="true">+</span> Add Highlight</a>',
        );
    }

    const { data, error } = await sb.from('highlight_categories').select('id, name, sort_order, highlights(*)').order('sort_order');
    if (error) {
        emptyState(viewer, 'Highlights could not be loaded.', 'Please try again shortly.');
        return;
    }

    categories = (data || []).map((category) => ({
        ...category,
        highlights: (category.highlights || [])
            .filter((item) => item.published)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    })).filter((category) => category.highlights.length);

    if (!categories.length) {
        emptyState(viewer, 'No highlights have been shared yet.');
        categoryRail.innerHTML = '';
        return;
    }

    urlMap = await signedUrls('highlights', categories.flatMap((category) => category.highlights.map((item) => item.storage_path)));
    activeCategory = categories.find((category) => category.id === requestedCategory) || categories[0];
    index = Math.max(0, activeCategory.highlights.findIndex((item) => item.id === requestedItem));

    function categoryCover(category) {
        const image = category.highlights.find((item) => item.media_type === 'image');
        if (!image) return `<span class="highlight-cover-fallback">${escapeHTML(category.name.charAt(0))}</span>`;
        return `<img src="${urlMap.get(image.storage_path) || ''}" alt="">`;
    }

    function renderCategories() {
        categoryRail.innerHTML = categories.map((category) => `
            <button type="button" data-category="${category.id}" class="highlight-category ${category.id === activeCategory?.id ? 'active' : ''}" aria-pressed="${category.id === activeCategory?.id}">
                <span class="highlight-category-ring"><span class="highlight-category-cover">${categoryCover(category)}</span></span>
                <strong>${escapeHTML(category.name)}</strong>
                <small>${category.highlights.length} ${category.highlights.length === 1 ? 'moment' : 'moments'}</small>
            </button>`).join('');
    }

    function syncUrl() {
        const item = items[index];
        const next = new URL(window.location.href);
        next.searchParams.set('category', activeCategory.id);
        if (item) next.searchParams.set('item', item.id); else next.searchParams.delete('item');
        history.replaceState(null, '', `${next.pathname.split('/').pop()}${next.search}`);
    }

    function prepareCategory() {
        clearTimeout(timer);
        items = activeCategory?.highlights || [];
        index = Math.min(index, Math.max(0, items.length - 1));
        title.textContent = activeCategory?.name || 'Studio highlights';
        count.textContent = items.length ? `${index + 1} of ${items.length}` : '';
        renderCategories();
        render();
    }

    async function updateLike(item) {
        const button = viewer.querySelector('[data-highlight-like]');
        if (!button) return;
        const { data: summaryRows, error: likeError } = await sb.rpc('get_like_summary', { p_content_type: 'highlight', p_content_id: item.id });
        if (likeError) {
            button.innerHTML = `${icons.heart}<span>0</span>`;
            return;
        }
        const summary = summaryRows?.[0] || { like_count: 0, liked: false };
        button.innerHTML = `${icons.heart}<span>${summary.like_count}</span>`;
        button.classList.toggle('liked', Boolean(summary.liked));
        button.setAttribute('aria-label', summary.liked ? 'Unlike this highlight' : 'Like this highlight');
    }

    function render() {
        clearTimeout(timer);
        if (!items.length) {
            emptyState(viewer, 'This highlight collection is empty.');
            count.textContent = '';
            return;
        }
        const item = items[index];
        const mediaUrl = urlMap.get(item.storage_path) || '';
        const detailsHref = `highlights.html?category=${activeCategory.id}&item=${item.id}`;
        count.textContent = `${index + 1} of ${items.length}`;
        syncUrl();
        viewer.innerHTML = `
            <article class="story-card">
                <div class="story-progress" aria-hidden="true">${items.map((_, itemIndex) => `<span class="${itemIndex < index ? 'done' : itemIndex === index ? 'current' : ''}"><i></i></span>`).join('')}</div>
                <div class="story-top">
                    <span class="story-identity"><span>${escapeHTML(activeCategory.name.charAt(0))}</span><span><strong>Painting with passion</strong><small>${escapeHTML(activeCategory.name)}</small></span></span>
                    ${adminMenu({ type: 'highlight', id: item.id, viewHref: detailsHref })}
                </div>
                <div class="story-media-wrap">
                    ${item.media_type === 'video'
                        ? `<video class="story-media" src="${mediaUrl}" autoplay muted playsinline controls data-story-video></video>`
                        : `<img class="story-media" src="${mediaUrl}" alt="${escapeHTML(item.caption || activeCategory.name)}">`}
                </div>
                <button class="story-nav previous" type="button" data-story-prev aria-label="Previous highlight"><span aria-hidden="true">‹</span></button>
                <button class="story-nav next" type="button" data-story-next aria-label="Next highlight"><span aria-hidden="true">›</span></button>
                <div class="story-bottom">${item.caption ? `<p>${escapeHTML(item.caption)}</p>` : '<p class="story-no-caption">A moment from the studio.</p>'}<button class="icon-button like-button" type="button" data-highlight-like aria-label="Like this highlight"></button></div>
            </article>`;

        viewer.querySelector('[data-story-prev]').addEventListener('click', previous);
        viewer.querySelector('[data-story-next]').addEventListener('click', next);
        viewer.querySelector('[data-highlight-like]').addEventListener('click', async (event) => {
            const button = event.currentTarget;
            const liked = button.classList.contains('liked');
            button.disabled = true;
            const query = liked
                ? sb.from('highlight_likes').delete().eq('highlight_id', item.id).eq('user_id', state.user.id)
                : sb.from('highlight_likes').insert({ highlight_id: item.id, user_id: state.user.id });
            const { error: likeError } = await query;
            button.disabled = false;
            if (likeError) showToast(likeError.message, 'error'); else updateLike(item);
        });
        const video = viewer.querySelector('[data-story-video]');
        if (video) video.addEventListener('ended', next, { once: true });
        else timer = window.setTimeout(next, 6000);
        updateLike(item);
    }

    function previous() {
        if (!items.length) return;
        index = index > 0 ? index - 1 : items.length - 1;
        render();
    }

    function next() {
        if (!items.length) return;
        index = index < items.length - 1 ? index + 1 : 0;
        render();
    }

    categoryRail.addEventListener('click', (event) => {
        const button = event.target.closest('[data-category]');
        if (!button) return;
        activeCategory = categories.find((category) => category.id === button.dataset.category);
        index = 0;
        prepareCategory();
        document.querySelector('.highlight-feature')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    viewer.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-admin-delete="highlight"]');
        if (!button || !state.profile?.is_admin) return;
        const item = items.find((highlight) => highlight.id === button.dataset.id);
        if (!item || !window.confirm('Delete this highlight? This cannot be undone.')) return;
        button.disabled = true;
        clearTimeout(timer);
        const { error: deleteError } = await sb.from('highlights').delete().eq('id', item.id);
        if (deleteError) {
            button.disabled = false;
            showToast(deleteError.message, 'error');
            return;
        }
        const { error: storageError } = await sb.storage.from('highlights').remove([item.storage_path]);
        activeCategory.highlights = activeCategory.highlights.filter((highlight) => highlight.id !== item.id);
        if (!activeCategory.highlights.length) {
            categories = categories.filter((category) => category.id !== activeCategory.id);
            activeCategory = categories[0] || null;
            index = 0;
        } else {
            index = Math.min(index, activeCategory.highlights.length - 1);
        }
        if (!activeCategory) {
            categoryRail.innerHTML = '';
            emptyState(viewer, 'No highlights have been shared yet.');
            title.textContent = 'Studio highlights';
            count.textContent = '';
        } else {
            prepareCategory();
        }
        showToast(storageError ? 'Highlight deleted, but its stored media needs manual cleanup.' : 'Highlight deleted.', storageError ? 'error' : 'success');
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight') next();
        if (event.key === 'ArrowLeft') previous();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearTimeout(timer);
        else if (items[index]?.media_type !== 'video') timer = window.setTimeout(next, 6000);
    });

    prepareCategory();
})();
