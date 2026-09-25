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
    const artworkDialog = document.getElementById('artwork-create-dialog');
    const artworkForm = document.getElementById('artwork-create-form');
    const artworkMessage = document.getElementById('artwork-create-message');

    if (state.profile?.is_admin) {
        document.querySelector('.page-intro')?.insertAdjacentHTML(
            'beforeend',
            '<button class="button primary admin-page-action" type="button" data-add-artwork><span aria-hidden="true">+</span> Add Artwork</button>',
        );
        artworkDialog.hidden = false;
    }

    async function loadPaintings() {
        const { data, error } = await sb.from('paintings').select('*').eq('published', true).order('created_at', { ascending: false });
        if (error) {
            emptyState(grid, 'The collection could not be loaded.', 'Please try again shortly.');
            return false;
        }
        paintings = data || [];
        urls = await signedUrls('artworks', paintings.map((painting) => painting.storage_path));
        render();
        return true;
    }

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

    function closeArtworkDialog() {
        if (artworkDialog.open) artworkDialog.close();
        artworkForm.reset();
        artworkMessage.textContent = '';
        artworkMessage.classList.remove('error');
    }

    function validateArtworkFile(file) {
        if (!file) throw new Error('Choose an artwork image.');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG, or WebP image.');
        if (file.size > 15 * 1024 * 1024) throw new Error('Keep artwork images under 15MB.');
    }

    function artworkStoragePath(file) {
        const extension = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
        return `${state.user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    }

    if (state.profile?.is_admin) {
        document.querySelector('[data-add-artwork]')?.addEventListener('click', () => {
            artworkMessage.textContent = '';
            artworkMessage.classList.remove('error');
            artworkDialog.showModal();
        });
        document.querySelectorAll('[data-close-artwork-dialog]').forEach((button) => button.addEventListener('click', closeArtworkDialog));
        artworkDialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeArtworkDialog();
        });
        artworkDialog.addEventListener('click', (event) => {
            if (event.target === artworkDialog) closeArtworkDialog();
        });
        artworkForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!state.profile?.is_admin) return;
            const button = artworkForm.querySelector('[type="submit"]');
            const file = window.PaintingMediaUpload?.get(artworkForm.elements.image)?.file || artworkForm.elements.image.files[0];
            let path = '';
            button.disabled = true;
            button.textContent = 'Publishing…';
            artworkMessage.textContent = 'Uploading and preparing the Gallery…';
            artworkMessage.classList.remove('error');
            try {
                validateArtworkFile(file);
                path = artworkStoragePath(file);
                const { error: uploadError } = await sb.storage.from('artworks').upload(path, file, { cacheControl: '3600', upsert: false });
                if (uploadError) throw uploadError;
                const price = artworkForm.elements.price.value.trim();
                const { error: insertError } = await sb.from('paintings').insert({
                    title: artworkForm.elements.title.value.trim(),
                    storage_path: path,
                    caption: artworkForm.elements.caption.value.trim() || null,
                    description: artworkForm.elements.description.value.trim() || null,
                    medium: artworkForm.elements.medium.value.trim() || null,
                    dimensions: artworkForm.elements.dimensions.value.trim() || null,
                    price: price ? Number(price) : null,
                    currency: artworkForm.elements.currency.value,
                    is_available: artworkForm.elements.is_available.checked,
                    published: artworkForm.elements.published.checked,
                    created_by: state.user.id,
                });
                if (insertError) throw insertError;
                closeArtworkDialog();
                await loadPaintings();
                showToast('Artwork published to the Gallery.', 'success');
            } catch (error) {
                if (path) await sb.storage.from('artworks').remove([path]);
                artworkMessage.textContent = error.message || 'The artwork could not be published.';
                artworkMessage.classList.add('error');
            } finally {
                button.disabled = false;
                button.textContent = 'Publish artwork';
            }
        });
    }

    await loadPaintings();
})();
