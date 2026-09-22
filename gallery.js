(async function () {
    const app = window.PaintingApp;
    await app.ready;
    if (!app.state.accessGranted) return;
    const { sb, state, escapeHTML, formatMoney, signedUrls, emptyState, showToast, adminMenu } = app;
    const grid = document.getElementById('gallery-grid');
    const filters = document.getElementById('gallery-filters');
    let active = 'all';
    let paintings = [];
    let urls = new Map();

    if (state.profile?.is_admin) {
        document.querySelector('.page-intro')?.insertAdjacentHTML(
            'beforeend',
            '<a class="button primary admin-page-action" href="admin.html#artwork"><span aria-hidden="true">+</span> Add Artwork</a>',
        );
    }

    const { data, error } = await sb.from('paintings').select('*').eq('published', true).order('created_at', { ascending: false });
    if (error) {
        emptyState(grid, 'The collection could not be loaded.', 'Please try again shortly.');
        return;
    }
    paintings = data || [];
    urls = await signedUrls('artworks', paintings.map((painting) => painting.storage_path));

    function render() {
        const visible = paintings.filter((painting) => active === 'all' || (active === 'available' ? painting.is_available : !painting.is_available));
        if (!visible.length) {
            emptyState(grid, active === 'all' ? 'No artworks have been published yet.' : 'No artworks match this view.');
            return;
        }
        grid.innerHTML = visible.map((painting, index) => {
            const detailsHref = `painting.html?id=${painting.id}`;
            return `<article class="gallery-piece ${index % 3 === 1 ? 'portrait' : ''}">
                ${adminMenu({ type: 'painting', id: painting.id, viewHref: detailsHref })}
                <a class="gallery-piece-link" href="${detailsHref}">
                    <span class="gallery-image"><img src="${urls.get(painting.storage_path) || ''}" alt="${escapeHTML(painting.title)}"></span>
                    <span class="gallery-caption">
                        <span><strong>${escapeHTML(painting.title)}</strong><small>${escapeHTML([painting.medium, painting.dimensions].filter(Boolean).join(' · '))}</small></span>
                        <span><em>${painting.is_available ? 'Available' : 'Collected'}</em><small>${formatMoney(painting.price, painting.currency)}</small></span>
                    </span>
                </a>
            </article>`;
        }).join('');
    }

    filters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-filter]');
        if (!button) return;
        active = button.dataset.filter;
        filters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
        render();
    });

    grid.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-admin-delete="painting"]');
        if (!button || !state.profile?.is_admin) return;
        const painting = paintings.find((item) => item.id === button.dataset.id);
        if (!painting || !window.confirm(`Delete “${painting.title}”? This cannot be undone.`)) return;
        button.disabled = true;
        const { error: deleteError } = await sb.from('paintings').delete().eq('id', painting.id);
        if (deleteError) {
            button.disabled = false;
            showToast(deleteError.message, 'error');
            return;
        }
        const { error: storageError } = await sb.storage.from('artworks').remove([painting.storage_path]);
        paintings = paintings.filter((item) => item.id !== painting.id);
        render();
        showToast(storageError ? 'Artwork deleted, but its stored image needs manual cleanup.' : 'Artwork deleted.', storageError ? 'error' : 'success');
    });

    render();
})();
