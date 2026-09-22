(async function () {
    const app = window.PaintingApp;
    await app.ready;
    if (!app.state.accessGranted) return;

    const {
        sb, state, escapeHTML, signedUrls, showToast, icons, adminMenu, redirectToLogin,
    } = app;
    const isAdmin = Boolean(state.profile?.is_admin);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const IMAGE_DURATION = 6500;
    const SIGNED_URL_LIFETIME = 1800;

    const categoryStage = document.getElementById('category-stage');
    const categoryTrack = document.getElementById('highlight-categories');
    const categoryControls = document.getElementById('category-controls');
    const categoryPrevious = document.getElementById('category-previous');
    const categoryNext = document.getElementById('category-next');
    const categoryLiveStatus = document.getElementById('category-live-status');
    const adminToolbar = document.getElementById('highlights-admin-toolbar');

    const viewerDialog = document.getElementById('highlight-viewer-dialog');
    const viewerCategoryName = document.getElementById('viewer-category-name');
    const viewerCount = document.getElementById('viewer-count');
    const viewerProgress = document.getElementById('viewer-progress');
    const viewerAdminMenu = document.getElementById('viewer-admin-menu');
    const viewerStage = document.getElementById('viewer-stage');
    const viewerMediaSlot = document.getElementById('viewer-media-slot');
    const viewerPrevious = document.getElementById('viewer-previous');
    const viewerNext = document.getElementById('viewer-next');
    const viewerClose = document.getElementById('viewer-close');
    const viewerCaption = document.getElementById('viewer-caption');
    const viewerPlayback = document.getElementById('viewer-playback');
    const viewerPlaybackLabel = viewerPlayback.querySelector('.viewer-playback-label');
    const viewerLike = document.getElementById('viewer-like');
    const viewerLiveStatus = document.getElementById('viewer-live-status');

    const categoryEditorDialog = document.getElementById('category-editor-dialog');
    const categoryEditorForm = document.getElementById('category-editor-form');
    const categoryEditorKicker = document.getElementById('category-editor-kicker');
    const categoryEditorTitle = document.getElementById('category-editor-title');
    const categoryNameInput = document.getElementById('category-name-input');
    const categoryEditorMessage = document.getElementById('category-editor-message');
    const categoryEditorSubmit = document.getElementById('category-editor-submit');
    const categoryEditorClose = document.getElementById('category-editor-close');
    const categoryEditorCancel = document.getElementById('category-editor-cancel');

    const initialParams = new URLSearchParams(window.location.search);
    const requestedCategoryId = initialParams.get('category');
    const requestedItemId = initialParams.get('item');

    let categories = [];
    let categoryNodes = [];
    let activeIndex = 0;
    let viewerIndex = 0;
    let viewerRenderToken = 0;
    let viewerCloseTimer = null;
    let viewerReturnFocus = null;
    let categoryEditorMode = 'create';
    let categoryEditorId = null;
    let categoryEditorReturnFocus = null;

    let imageFrame = null;
    let imageElapsed = 0;
    let imageStartedAt = 0;
    let playbackPaused = false;
    let visibilitySuspended = false;
    let menuPlaybackSuspended = false;

    const signedUrlCache = new Map();

    function activeCategory() {
        return categories[activeIndex] || null;
    }

    function viewerItems() {
        return activeCategory()?.highlights || [];
    }

    function momentLabel(count) {
        return `${count} ${count === 1 ? 'moment' : 'moments'}`;
    }

    function isViewerOpen() {
        return Boolean(viewerDialog.open);
    }

    function isEditorOpen() {
        return Boolean(categoryEditorDialog.open);
    }

    function replacePageUrl(itemId = null) {
        const category = activeCategory();
        const url = new URL(window.location.href);
        if (category) url.searchParams.set('category', category.id);
        else url.searchParams.delete('category');
        if (itemId) url.searchParams.set('item', itemId);
        else url.searchParams.delete('item');
        history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }

    function closeAdminMenus() {
        document.querySelectorAll('[data-admin-item-menu].open').forEach((menu) => {
            menu.classList.remove('open');
            menu.querySelector('[data-admin-menu-trigger]')?.setAttribute('aria-expanded', 'false');
        });
    }

    function adminToolbarMarkup() {
        return `<div class="admin-item-menu" data-admin-item-menu>
            <button class="admin-menu-trigger" type="button" data-admin-menu-trigger aria-label="Add highlight content" aria-expanded="false">+</button>
            <div class="admin-menu-popover" aria-label="Add highlight content">
                <button type="button" data-create-category>Create category</button>
                <a href="admin.html#highlight">Add highlight</a>
            </div>
        </div>`;
    }

    function categoryAdminMarkup(category) {
        if (!isAdmin) return '';
        const categoryId = escapeHTML(category.id);
        return `<div class="admin-item-menu highlight-category-admin" data-admin-item-menu>
            <button class="admin-menu-trigger" type="button" data-admin-menu-trigger aria-label="Open actions for ${escapeHTML(category.name)}" aria-expanded="false">&#8942;</button>
            <div class="admin-menu-popover" aria-label="Category actions">
                <button type="button" data-category-view="${categoryId}">View highlights</button>
                <button type="button" data-category-edit="${categoryId}">Edit category</button>
                <a href="admin.html#highlight">Add highlight</a>
                <button type="button" data-category-delete="${categoryId}" data-admin-delete>Delete category</button>
            </div>
        </div>`;
    }

    function categoryMarkup(category, index) {
        const count = category.highlights.length;
        const initial = category.name.trim().charAt(0) || '•';
        return `<article class="highlight-category-item" data-category-item="${escapeHTML(category.id)}" data-index="${index}">
            <button class="highlight-category-select" type="button" data-category-select="${escapeHTML(category.id)}" aria-label="${escapeHTML(category.name)}, ${momentLabel(count)}, category ${index + 1} of ${categories.length}">
                <span class="highlight-category-orb">
                    <span class="highlight-category-cover" data-category-cover="${escapeHTML(category.id)}">
                        <span class="highlight-cover-fallback" aria-hidden="true">${escapeHTML(initial)}</span>
                    </span>
                </span>
                <span class="highlight-category-label">
                    <span class="highlight-category-name">${escapeHTML(category.name)}</span>
                    <span class="highlight-category-meta">${momentLabel(count)}</span>
                </span>
            </button>
            ${categoryAdminMarkup(category)}
        </article>`;
    }

    function renderEmpty(title, text) {
        categoryTrack.innerHTML = `<div class="highlights-empty" role="status">
            <p>Studio archive</p>
            <h3>${escapeHTML(title)}</h3>
            <p>${escapeHTML(text)}</p>
        </div>`;
        categoryNodes = [];
        categoryControls.hidden = true;
        categoryLiveStatus.textContent = title;
        replacePageUrl();
    }

    function slotClass(offset) {
        if (offset < -2) return 'slot-before';
        if (offset === -2) return 'slot-n2';
        if (offset === -1) return 'slot-n1';
        if (offset === 0) return 'slot-active';
        if (offset === 1) return 'slot-p1';
        if (offset === 2) return 'slot-p2';
        return 'slot-after';
    }

    function visibleDistance() {
        return window.matchMedia('(max-width: 820px), (max-width: 960px) and (max-height: 520px)').matches ? 1 : 2;
    }

    function setActiveCategory(nextIndex, { announce = true, focus = false, syncUrl = true } = {}) {
        if (!categories.length) return;
        activeIndex = Math.max(0, Math.min(nextIndex, categories.length - 1));
        const maxVisibleOffset = visibleDistance();

        categoryNodes.forEach((node, index) => {
            const offset = index - activeIndex;
            const button = node.querySelector('[data-category-select]');
            node.classList.remove('slot-before', 'slot-n2', 'slot-n1', 'slot-active', 'slot-p1', 'slot-p2', 'slot-after');
            node.classList.add(slotClass(offset));
            button.tabIndex = offset === 0 ? 0 : -1;
            if (offset === 0) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');

            const adminActions = node.querySelector('.highlight-category-admin');
            if (adminActions) adminActions.inert = offset !== 0;
            const coverMedia = node.querySelector('.highlight-category-cover img, .highlight-category-cover video');
            if (coverMedia instanceof HTMLImageElement && Math.abs(offset) <= 1) {
                coverMedia.loading = 'eager';
                coverMedia.fetchPriority = offset === 0 ? 'high' : 'auto';
            } else if (coverMedia instanceof HTMLVideoElement && Math.abs(offset) <= 1) {
                coverMedia.preload = 'auto';
                if (coverMedia.readyState < 2) coverMedia.load();
            }

            const hidden = Math.abs(offset) > maxVisibleOffset;
            node.inert = hidden;
            if (hidden) node.setAttribute('aria-hidden', 'true');
            else node.removeAttribute('aria-hidden');
        });

        categoryPrevious.disabled = activeIndex === 0;
        categoryNext.disabled = activeIndex === categories.length - 1;
        categoryControls.hidden = categories.length < 2;
        closeAdminMenus();

        const category = activeCategory();
        if (announce) {
            categoryLiveStatus.textContent = `${category.name}, category ${activeIndex + 1} of ${categories.length}, ${momentLabel(category.highlights.length)}.`;
        }
        if (syncUrl && !isViewerOpen()) replacePageUrl();
        if (focus) categoryNodes[activeIndex]?.querySelector('[data-category-select]')?.focus({ preventScroll: true });
    }

    function renderCategories(preferredCategoryId = null) {
        if (!categories.length) {
            renderEmpty(
                'No highlights yet',
                isAdmin ? 'Create a category with the + control, then add its first image or video.' : 'New studio moments will appear here when they are ready.',
            );
            return;
        }

        const currentId = preferredCategoryId || activeCategory()?.id || requestedCategoryId;
        categoryTrack.innerHTML = categories.map(categoryMarkup).join('');
        categoryNodes = Array.from(categoryTrack.querySelectorAll('[data-category-item]'));
        const requestedIndex = categories.findIndex((category) => category.id === currentId);
        setActiveCategory(requestedIndex >= 0 ? requestedIndex : 0, { announce: false });
        void hydrateCategoryCovers();
    }

    async function primeSignedUrls(paths, force = false) {
        const now = Date.now();
        const uniquePaths = [...new Set(paths.filter(Boolean))];
        const needed = uniquePaths.filter((path) => {
            const cached = signedUrlCache.get(path);
            return force || !cached || cached.expiresAt < now + 60000;
        });
        if (!needed.length) return;
        const urls = await signedUrls('highlights', needed, SIGNED_URL_LIFETIME);
        needed.forEach((path) => {
            const url = urls.get(path);
            if (url) signedUrlCache.set(path, { url, expiresAt: now + (SIGNED_URL_LIFETIME * 1000) });
        });
    }

    async function getSignedUrl(path, force = false) {
        await primeSignedUrls([path], force);
        const cached = signedUrlCache.get(path);
        if (!cached?.url) throw new Error('The media URL could not be prepared.');
        return cached.url;
    }

    async function hydrateCategoryCovers() {
        const coverPairs = categories.map((category) => ({
            category,
            item: category.highlights.find((item) => item.media_type === 'image') || category.highlights[0],
        })).filter(({ item }) => item?.storage_path);
        if (!coverPairs.length) return;

        try {
            await primeSignedUrls(coverPairs.map(({ item }) => item.storage_path));
        } catch (error) {
            console.error('Could not prepare highlight covers.', error);
            return;
        }

        coverPairs.forEach(({ category, item }) => {
            const container = categoryTrack.querySelector(`[data-category-cover="${CSS.escape(category.id)}"]`);
            const cached = signedUrlCache.get(item.storage_path);
            if (!container || !cached?.url || container.querySelector('img, video')) return;
            const media = item.media_type === 'video' ? document.createElement('video') : document.createElement('img');
            media.setAttribute('aria-hidden', 'true');
            if (item.media_type === 'video') {
                const categoryIndex = categories.findIndex((entry) => entry.id === category.id);
                media.muted = true;
                media.playsInline = true;
                media.preload = Math.abs(categoryIndex - activeIndex) <= 1 ? 'auto' : 'metadata';
            } else {
                media.alt = '';
                media.decoding = 'async';
                const categoryIndex = categories.findIndex((entry) => entry.id === category.id);
                media.loading = Math.abs(categoryIndex - activeIndex) <= 1 ? 'eager' : 'lazy';
                media.fetchPriority = categoryIndex === activeIndex ? 'high' : 'auto';
            }
            media.addEventListener(item.media_type === 'video' ? 'loadeddata' : 'load', () => {
                media.pause?.();
                container.classList.add('has-cover');
            }, { once: true });
            media.addEventListener('error', async () => {
                if (media.dataset.retried) {
                    media.remove();
                    container.classList.remove('has-cover');
                    return;
                }
                media.dataset.retried = 'true';
                try { media.src = await getSignedUrl(item.storage_path, true); }
                catch { media.remove(); }
            });
            media.src = cached.url;
            container.appendChild(media);
        });
    }

    function normalizeCategories(rows) {
        return (rows || []).map((category) => {
            const allHighlights = [...(category.highlights || [])]
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            return {
                ...category,
                allHighlights,
                highlights: allHighlights.filter((item) => item.published),
            };
        }).filter((category) => isAdmin || category.highlights.length)
            .sort((a, b) => (Number(a.sort_order) - Number(b.sort_order)) || a.name.localeCompare(b.name));
    }

    function moveCategory(direction, { focus = false } = {}) {
        if (!categories.length) return false;
        const nextIndex = activeIndex + direction;
        if (nextIndex < 0 || nextIndex >= categories.length) return false;
        categoryStage.classList.add('has-interacted');
        setActiveCategory(nextIndex, { focus });
        return true;
    }

    function mountAdminToolbar() {
        if (!isAdmin) return;
        adminToolbar.hidden = false;
        adminToolbar.innerHTML = adminToolbarMarkup();
    }

    function openCategoryEditor(mode, category = null) {
        if (!isAdmin) return;
        closeAdminMenus();
        categoryEditorReturnFocus = document.activeElement;
        categoryEditorMode = mode;
        categoryEditorId = category?.id || null;
        categoryEditorKicker.textContent = mode === 'edit' ? 'Collection details' : 'New collection';
        categoryEditorTitle.textContent = mode === 'edit' ? 'Edit category' : 'Create category';
        categoryEditorSubmit.textContent = mode === 'edit' ? 'Save changes' : 'Create category';
        categoryNameInput.value = category?.name || '';
        categoryEditorMessage.textContent = '';
        categoryEditorDialog.showModal();
        window.setTimeout(() => categoryNameInput.focus(), 0);
    }

    function closeCategoryEditor() {
        if (!categoryEditorDialog.open) return;
        categoryEditorDialog.close();
        const focusTarget = categoryEditorReturnFocus?.isConnected
            ? categoryEditorReturnFocus
            : categoryNodes[activeIndex]?.querySelector('[data-category-select]');
        focusTarget?.focus?.({ preventScroll: true });
    }

    async function saveCategory(event) {
        event.preventDefault();
        if (!isAdmin) return;
        const name = categoryNameInput.value.trim();
        if (!name) {
            categoryEditorMessage.textContent = 'Enter a category name.';
            categoryNameInput.focus();
            return;
        }

        categoryEditorSubmit.disabled = true;
        categoryEditorMessage.textContent = categoryEditorMode === 'edit' ? 'Saving…' : 'Creating…';
        try {
            if (categoryEditorMode === 'edit') {
                const { data, error } = await sb.from('highlight_categories')
                    .update({ name })
                    .eq('id', categoryEditorId)
                    .select('id, name, sort_order')
                    .single();
                if (error) throw error;
                const category = categories.find((entry) => entry.id === categoryEditorId);
                if (category) category.name = data?.name || name;
                renderCategories(categoryEditorId);
                showToast('Category updated.', 'success');
            } else {
                const maxSortOrder = categories.reduce((maximum, category) => Math.max(maximum, Number(category.sort_order) || 0), 0);
                const { data, error } = await sb.from('highlight_categories')
                    .insert({ name, sort_order: maxSortOrder + 10 })
                    .select('id, name, sort_order, created_at, updated_at')
                    .single();
                if (error) throw error;
                categories.push({ ...data, highlights: [], allHighlights: [] });
                categories.sort((a, b) => (Number(a.sort_order) - Number(b.sort_order)) || a.name.localeCompare(b.name));
                renderCategories(data.id);
                showToast('Category created. Add its first highlight when you are ready.', 'success');
            }
            closeCategoryEditor();
        } catch (error) {
            categoryEditorMessage.textContent = error.message || 'The category could not be saved.';
        } finally {
            categoryEditorSubmit.disabled = false;
        }
    }

    async function removeStoredMedia(paths) {
        const uniquePaths = [...new Set(paths.filter(Boolean))];
        let cleanupError = null;
        for (let index = 0; index < uniquePaths.length; index += 100) {
            const { error } = await sb.storage.from('highlights').remove(uniquePaths.slice(index, index + 100));
            if (error) cleanupError = error;
        }
        return cleanupError;
    }

    async function deleteCategory(category) {
        if (!isAdmin || !category) return;
        const itemCount = category.allHighlights.length;
        const confirmed = window.confirm(`Delete “${category.name}” and ${momentLabel(itemCount)}? This cannot be undone.`);
        if (!confirmed) return;

        closeAdminMenus();
        const oldIndex = activeIndex;
        const paths = category.allHighlights.map((item) => item.storage_path);
        const { error } = await sb.from('highlight_categories').delete().eq('id', category.id);
        if (error) {
            showToast(error.message || 'The category could not be deleted.', 'error');
            return;
        }

        const cleanupError = await removeStoredMedia(paths);
        categories = categories.filter((entry) => entry.id !== category.id);
        activeIndex = Math.min(oldIndex, Math.max(0, categories.length - 1));
        renderCategories(categories[activeIndex]?.id || null);
        const focusTarget = categoryNodes[activeIndex]?.querySelector('[data-category-select]')
            || adminToolbar.querySelector('[data-admin-menu-trigger]');
        focusTarget?.focus({ preventScroll: true });
        showToast(
            cleanupError ? 'Category deleted, but some stored media needs manual cleanup.' : 'Category deleted.',
            cleanupError ? 'error' : 'success',
        );
    }

    function buildViewerProgress(items) {
        viewerProgress.innerHTML = items.map((_, index) => `<span><i data-progress-index="${index}"></i></span>`).join('');
    }

    function setViewerProgress(value) {
        viewerProgress.querySelectorAll('[data-progress-index]').forEach((bar, index) => {
            const scale = index < viewerIndex ? 1 : index === viewerIndex ? Math.max(0, Math.min(value, 1)) : 0;
            bar.style.transform = `scaleX(${scale})`;
        });
    }

    function stopViewerPlayback() {
        if (imageFrame) cancelAnimationFrame(imageFrame);
        imageFrame = null;
        viewerMediaSlot.querySelectorAll('video').forEach((video) => video.pause());
    }

    function pauseImageProgress() {
        if (!imageFrame) return;
        imageElapsed += performance.now() - imageStartedAt;
        cancelAnimationFrame(imageFrame);
        imageFrame = null;
    }

    function startImageProgress() {
        if (reducedMotion || playbackPaused || document.hidden || !isViewerOpen()) return;
        if (viewerDialog.querySelector('[data-admin-item-menu].open')) {
            menuPlaybackSuspended = true;
            return;
        }
        imageStartedAt = performance.now();
        const tick = (now) => {
            if (!isViewerOpen() || playbackPaused || viewerItems()[viewerIndex]?.media_type !== 'image') return;
            const elapsed = imageElapsed + (now - imageStartedAt);
            const ratio = elapsed / IMAGE_DURATION;
            setViewerProgress(ratio);
            if (ratio >= 1) {
                imageFrame = null;
                nextViewerItem();
                return;
            }
            imageFrame = requestAnimationFrame(tick);
        };
        imageFrame = requestAnimationFrame(tick);
    }

    function updatePlaybackButton() {
        const symbol = viewerPlayback.querySelector('[aria-hidden]');
        symbol.textContent = playbackPaused ? '▶' : 'Ⅱ';
        viewerPlaybackLabel.textContent = playbackPaused ? 'Play' : 'Pause';
        viewerPlayback.setAttribute('aria-label', playbackPaused ? 'Resume highlight' : 'Pause highlight');
    }

    function toggleImagePlayback() {
        if (viewerItems()[viewerIndex]?.media_type !== 'image' || reducedMotion) return;
        playbackPaused = !playbackPaused;
        if (playbackPaused) pauseImageProgress();
        else startImageProgress();
        updatePlaybackButton();
    }

    function suspendViewerForMenu() {
        if (!isViewerOpen() || menuPlaybackSuspended) return;
        const item = viewerItems()[viewerIndex];
        const video = viewerMediaSlot.querySelector('video.is-ready');
        if (item?.media_type === 'image' && !playbackPaused && imageFrame) {
            pauseImageProgress();
            menuPlaybackSuspended = true;
        } else if (video && !video.paused) {
            video.pause();
            menuPlaybackSuspended = true;
        }
    }

    function resumeViewerAfterMenu() {
        if (!menuPlaybackSuspended || !isViewerOpen()) return;
        menuPlaybackSuspended = false;
        if (document.hidden) return;
        const item = viewerItems()[viewerIndex];
        if (item?.media_type === 'image' && !playbackPaused) startImageProgress();
        else {
            const video = viewerMediaSlot.querySelector('video.is-ready');
            if (video) void video.play().catch(() => {});
        }
    }

    function showMediaError(item, token, message = 'This highlight could not be displayed.') {
        if (token !== viewerRenderToken) return;
        viewerMediaSlot.setAttribute('aria-busy', 'false');
        viewerMediaSlot.innerHTML = `<div class="viewer-media-error" role="status">
            <strong>Media unavailable</strong>
            <span>${escapeHTML(message)}</span>
            <button type="button" data-viewer-retry="${escapeHTML(item.id)}">Try again</button>
        </div>`;
        viewerPlayback.hidden = true;
    }

    function prepareMediaTransition() {
        const mediaElements = Array.from(viewerMediaSlot.querySelectorAll('.viewer-media'));
        const currentMedia = mediaElements.filter((media) => media.classList.contains('is-ready')).at(-1) || mediaElements.at(-1);
        mediaElements.filter((media) => media !== currentMedia).forEach((media) => media.remove());
        if (currentMedia) {
            currentMedia.classList.remove('is-leaving');
            currentMedia.classList.add('is-waiting');
            Array.from(viewerMediaSlot.children).forEach((child) => {
                if (child !== currentMedia && !child.classList.contains('viewer-media')) child.remove();
            });
        } else {
            viewerMediaSlot.innerHTML = '';
        }
        const loading = document.createElement('span');
        loading.className = 'viewer-media-loading';
        loading.setAttribute('aria-hidden', 'true');
        viewerMediaSlot.appendChild(loading);
        viewerMediaSlot.setAttribute('aria-busy', 'true');
    }

    function revealViewerMedia(media, token) {
        if (token !== viewerRenderToken) return;
        viewerMediaSlot.querySelector('.viewer-media-loading')?.remove();
        viewerMediaSlot.setAttribute('aria-busy', 'false');
        const previousMedia = Array.from(viewerMediaSlot.querySelectorAll('.viewer-media')).filter((entry) => entry !== media);
        media.classList.add('is-ready');
        previousMedia.forEach((entry) => {
            entry.setAttribute('aria-hidden', 'true');
            entry.classList.remove('is-waiting');
            entry.classList.add('is-leaving');
            window.setTimeout(() => entry.remove(), reducedMotion ? 0 : 440);
        });
    }

    async function handleMediaError(item, token, canRetry) {
        if (token !== viewerRenderToken) return;
        viewerMediaSlot.querySelectorAll(`[data-viewer-render="${token}"]`).forEach((media) => media.remove());
        if (canRetry) {
            try {
                const refreshedUrl = await getSignedUrl(item.storage_path, true);
                if (token === viewerRenderToken) mountViewerMedia(item, refreshedUrl, token, false);
                return;
            } catch (error) {
                showMediaError(item, token, error.message);
                return;
            }
        }
        showMediaError(item, token);
    }

    function mountViewerMedia(item, mediaUrl, token, canRetry = true) {
        if (token !== viewerRenderToken) return;
        viewerMediaSlot.querySelectorAll(`[data-viewer-render="${token}"]`).forEach((media) => media.remove());

        if (item.media_type === 'video') {
            const video = document.createElement('video');
            video.className = 'viewer-media';
            video.dataset.viewerRender = String(token);
            video.controls = true;
            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            video.setAttribute('aria-label', item.caption || `${activeCategory().name} video`);
            video.addEventListener('loadeddata', () => {
                if (token !== viewerRenderToken) return;
                revealViewerMedia(video, token);
                if (viewerDialog.querySelector('[data-admin-item-menu].open')) menuPlaybackSuspended = true;
                else if (!reducedMotion) void video.play().catch(() => {});
            }, { once: true });
            video.addEventListener('timeupdate', () => {
                if (token !== viewerRenderToken || !Number.isFinite(video.duration) || video.duration <= 0) return;
                setViewerProgress(video.currentTime / video.duration);
            });
            video.addEventListener('ended', () => {
                if (token === viewerRenderToken) nextViewerItem();
            }, { once: true });
            video.addEventListener('error', () => void handleMediaError(item, token, canRetry), { once: true });
            video.src = mediaUrl;
            viewerMediaSlot.appendChild(video);
            return;
        }

        const image = document.createElement('img');
        image.className = 'viewer-media';
        image.dataset.viewerRender = String(token);
        image.alt = item.caption || `${activeCategory().name} highlight`;
        image.decoding = 'async';
        image.addEventListener('load', () => {
            if (token !== viewerRenderToken) return;
            revealViewerMedia(image, token);
            startImageProgress();
        }, { once: true });
        image.addEventListener('error', () => void handleMediaError(item, token, canRetry), { once: true });
        image.src = mediaUrl;
        viewerMediaSlot.appendChild(image);
    }

    async function updateLike(item, token) {
        viewerLike.hidden = false;
        viewerLike.disabled = true;
        viewerLike.innerHTML = `${icons.heart}<span>—</span>`;
        const { data, error } = await sb.rpc('get_like_summary', {
            p_content_type: 'highlight',
            p_content_id: item.id,
        });
        if (token !== viewerRenderToken || viewerItems()[viewerIndex]?.id !== item.id) return;
        viewerLike.disabled = false;
        if (error) {
            viewerLike.innerHTML = `${icons.heart}<span>0</span>`;
            return;
        }
        const summary = data?.[0] || { like_count: 0, liked: false };
        viewerLike.innerHTML = `${icons.heart}<span>${Number(summary.like_count) || 0}</span>`;
        viewerLike.classList.toggle('liked', Boolean(summary.liked));
        viewerLike.setAttribute('aria-label', summary.liked ? 'Unlike this highlight' : 'Like this highlight');
    }

    function renderEmptyViewer(category) {
        viewerRenderToken += 1;
        stopViewerPlayback();
        viewerCategoryName.textContent = category.name;
        viewerCount.textContent = 'No moments';
        viewerProgress.innerHTML = '';
        viewerCaption.textContent = '';
        viewerCaption.classList.add('is-empty');
        viewerCaption.tabIndex = -1;
        viewerPrevious.disabled = true;
        viewerNext.disabled = true;
        viewerPlayback.hidden = true;
        viewerLike.hidden = true;
        viewerAdminMenu.innerHTML = '';
        viewerStage.classList.remove('is-video');
        viewerMediaSlot.setAttribute('aria-busy', 'false');
        viewerMediaSlot.innerHTML = `<div class="viewer-empty">
            <strong>This collection is waiting for its first moment.</strong>
            ${isAdmin ? '<a href="admin.html#highlight">Add a highlight</a>' : ''}
        </div>`;
        viewerLiveStatus.textContent = `${category.name} has no published highlights.`;
        replacePageUrl();
    }

    async function renderViewerItem() {
        const category = activeCategory();
        const items = viewerItems();
        if (!category) return;
        if (!items.length) {
            renderEmptyViewer(category);
            return;
        }

        viewerIndex = Math.max(0, Math.min(viewerIndex, items.length - 1));
        const item = items[viewerIndex];
        const token = ++viewerRenderToken;
        stopViewerPlayback();
        imageElapsed = 0;
        playbackPaused = false;
        visibilitySuspended = false;
        menuPlaybackSuspended = false;

        viewerCategoryName.textContent = category.name;
        viewerCount.textContent = `${String(viewerIndex + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
        buildViewerProgress(items);
        setViewerProgress(0);
        viewerCaption.textContent = item.caption || '';
        viewerCaption.classList.toggle('is-empty', !item.caption);
        viewerCaption.tabIndex = item.caption ? 0 : -1;
        viewerPrevious.disabled = viewerIndex === 0;
        viewerNext.disabled = false;
        viewerNext.setAttribute('aria-label', viewerIndex === items.length - 1 ? 'Close after this highlight' : 'Next highlight');
        viewerPlayback.hidden = item.media_type !== 'image' || reducedMotion;
        viewerStage.classList.toggle('is-video', item.media_type === 'video');
        viewerLike.hidden = false;
        viewerLike.classList.remove('liked');
        updatePlaybackButton();
        const detailsHref = `highlights.html?category=${encodeURIComponent(category.id)}&item=${encodeURIComponent(item.id)}`;
        viewerAdminMenu.innerHTML = adminMenu({ type: 'highlight', id: item.id, viewHref: detailsHref });
        prepareMediaTransition();
        viewerLiveStatus.textContent = `${category.name}, highlight ${viewerIndex + 1} of ${items.length}.`;
        replacePageUrl(item.id);

        void updateLike(item, token);
        try {
            const mediaUrl = await getSignedUrl(item.storage_path);
            if (token !== viewerRenderToken) return;
            mountViewerMedia(item, mediaUrl, token);
            const adjacentPaths = [items[viewerIndex - 1]?.storage_path, items[viewerIndex + 1]?.storage_path].filter(Boolean);
            void primeSignedUrls(adjacentPaths).catch(() => {});
        } catch (error) {
            showMediaError(item, token, error.message);
        }
    }

    function openViewer(index = 0) {
        const category = activeCategory();
        if (!category || isViewerOpen()) return;
        closeAdminMenus();
        viewerReturnFocus = document.activeElement;
        viewerIndex = Math.max(0, Math.min(index, Math.max(0, category.highlights.length - 1)));
        viewerDialog.classList.remove('is-closing');
        document.body.classList.add('highlight-viewer-open');
        viewerDialog.showModal();
        void renderViewerItem();
        window.setTimeout(() => viewerClose.focus({ preventScroll: true }), 0);
    }

    function finishViewerClose() {
        window.clearTimeout(viewerCloseTimer);
        viewerCloseTimer = null;
        viewerDialog.classList.remove('is-closing');
        document.body.classList.remove('highlight-viewer-open');
        stopViewerPlayback();
        viewerRenderToken += 1;
        viewerMediaSlot.innerHTML = '';
        replacePageUrl();
        setActiveCategory(activeIndex, { announce: false, syncUrl: false });
        const focusTarget = categoryNodes[activeIndex]?.querySelector('[data-category-select]') || viewerReturnFocus;
        focusTarget?.focus?.({ preventScroll: true });
    }

    function closeViewer() {
        if (!isViewerOpen() || viewerDialog.classList.contains('is-closing')) return;
        stopViewerPlayback();
        if (reducedMotion) {
            viewerDialog.close();
            return;
        }
        viewerDialog.classList.add('is-closing');
        viewerCloseTimer = window.setTimeout(() => {
            if (viewerDialog.open) viewerDialog.close();
        }, 240);
    }

    function previousViewerItem() {
        if (!isViewerOpen() || viewerIndex <= 0) return;
        viewerIndex -= 1;
        void renderViewerItem();
    }

    function nextViewerItem() {
        if (!isViewerOpen()) return;
        if (viewerIndex >= viewerItems().length - 1) {
            closeViewer();
            return;
        }
        viewerIndex += 1;
        void renderViewerItem();
    }

    async function toggleLike() {
        const item = viewerItems()[viewerIndex];
        if (!item || !state.user || viewerLike.disabled) return;
        const token = viewerRenderToken;
        const liked = viewerLike.classList.contains('liked');
        viewerLike.disabled = true;
        const query = liked
            ? sb.from('highlight_likes').delete().eq('highlight_id', item.id).eq('user_id', state.user.id)
            : sb.from('highlight_likes').insert({ highlight_id: item.id, user_id: state.user.id });
        const { error } = await query;
        if (token !== viewerRenderToken || viewerItems()[viewerIndex]?.id !== item.id) return;
        if (error) {
            viewerLike.disabled = false;
            showToast(error.message || 'The like could not be updated.', 'error');
            return;
        }
        await updateLike(item, token);
    }

    async function deleteHighlight(item) {
        if (!isAdmin || !item) return;
        if (!window.confirm('Delete this highlight? This cannot be undone.')) return;
        stopViewerPlayback();
        const category = activeCategory();
        const { error } = await sb.from('highlights').delete().eq('id', item.id);
        if (error) {
            showToast(error.message || 'The highlight could not be deleted.', 'error');
            void renderViewerItem();
            return;
        }
        const cleanupError = await removeStoredMedia([item.storage_path]);
        category.highlights = category.highlights.filter((entry) => entry.id !== item.id);
        category.allHighlights = category.allHighlights.filter((entry) => entry.id !== item.id);
        viewerIndex = Math.min(viewerIndex, Math.max(0, category.highlights.length - 1));
        renderCategories(category.id);
        if (category.highlights.length) void renderViewerItem();
        else renderEmptyViewer(category);
        showToast(
            cleanupError ? 'Highlight deleted, but its stored media needs manual cleanup.' : 'Highlight deleted.',
            cleanupError ? 'error' : 'success',
        );
    }

    function initWholePageWheel() {
        let accumulator = 0;
        let lastDirection = 0;
        let resetTimer = null;
        let lockedUntil = 0;

        window.addEventListener('wheel', (event) => {
            if (categories.length < 2 || isViewerOpen() || isEditorOpen() || event.ctrlKey || event.metaKey) return;
            if (document.querySelector('.highlights-nav-links.open, .account-menu.open, [data-admin-item-menu].open')) return;
            const horizontalGesture = Math.abs(event.deltaX) > Math.abs(event.deltaY);
            const primaryDelta = horizontalGesture ? event.deltaX : event.deltaY;
            if (!primaryDelta) return;
            const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
            const delta = primaryDelta * multiplier;
            const direction = delta > 0 ? 1 : -1;
            const canMove = direction > 0 ? activeIndex < categories.length - 1 : activeIndex > 0;
            if (!canMove) {
                accumulator = 0;
                if (horizontalGesture) event.preventDefault();
                return;
            }

            event.preventDefault();
            if (performance.now() < lockedUntil) return;
            if (direction !== lastDirection) accumulator = 0;
            lastDirection = direction;
            accumulator += delta;
            window.clearTimeout(resetTimer);
            resetTimer = window.setTimeout(() => { accumulator = 0; }, 140);
            if (Math.abs(accumulator) < 42) return;

            accumulator = 0;
            lockedUntil = performance.now() + 520;
            moveCategory(direction);
        }, { passive: false });
    }

    function initCategoryDrag() {
        let gesture = null;
        let suppressClickUntil = 0;
        let frame = null;

        function resetGesture() {
            if (frame) cancelAnimationFrame(frame);
            frame = null;
            categoryTrack.style.setProperty('--category-drag', '0px');
            categoryStage.classList.remove('is-dragging');
            gesture = null;
        }

        categoryStage.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || isViewerOpen() || isEditorOpen()) return;
            if (event.target.closest('.category-controls, [data-admin-item-menu]')) return;
            gesture = {
                id: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startTime: performance.now(),
                dx: 0,
                horizontal: false,
            };
        });

        categoryStage.addEventListener('pointermove', (event) => {
            if (!gesture || event.pointerId !== gesture.id) return;
            const dx = event.clientX - gesture.startX;
            const dy = event.clientY - gesture.startY;
            if (!gesture.horizontal && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15) {
                gesture.horizontal = true;
                categoryStage.classList.add('is-dragging');
                categoryStage.setPointerCapture?.(event.pointerId);
            }
            if (!gesture.horizontal) return;
            event.preventDefault();
            gesture.dx = dx;
            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                categoryTrack.style.setProperty('--category-drag', `${Math.max(-52, Math.min(52, dx * .24))}px`);
            });
        });

        function finishGesture(event) {
            if (!gesture || event.pointerId !== gesture.id) return;
            const { dx, horizontal, startTime } = gesture;
            const velocity = Math.abs(dx) / Math.max(1, performance.now() - startTime);
            resetGesture();
            if (!horizontal || (Math.abs(dx) < 48 && !(Math.abs(dx) > 22 && velocity > .42))) return;
            suppressClickUntil = Date.now() + 420;
            moveCategory(dx < 0 ? 1 : -1);
        }

        categoryStage.addEventListener('pointerup', finishGesture);
        categoryStage.addEventListener('pointercancel', resetGesture);
        categoryStage.addEventListener('lostpointercapture', (event) => {
            if (gesture && event.pointerId === gesture.id) resetGesture();
        });
        categoryTrack.addEventListener('click', (event) => {
            if (Date.now() < suppressClickUntil) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }

    function initViewerSwipe() {
        let start = null;
        let suppressClickUntil = 0;
        viewerStage.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'touch') return;
            if (event.target.closest('video')) return;
            const interactive = event.target.closest('button, a, input, textarea, select');
            if (interactive && !interactive.classList.contains('viewer-tap-zone')) return;
            start = { id: event.pointerId, x: event.clientX, y: event.clientY };
        });
        viewerStage.addEventListener('pointermove', (event) => {
            if (!start || event.pointerId !== start.id) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15) event.preventDefault();
        });
        viewerStage.addEventListener('pointerup', (event) => {
            if (!start || event.pointerId !== start.id) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            start = null;
            if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
            suppressClickUntil = Date.now() + 420;
            if (dx < 0) nextViewerItem();
            else previousViewerItem();
        });
        viewerStage.addEventListener('pointercancel', () => { start = null; });
        viewerStage.addEventListener('click', (event) => {
            if (Date.now() < suppressClickUntil && event.target.closest('.viewer-tap-zone')) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }

    function initNavigationEnhancements() {
        const menuToggle = document.querySelector('[data-menu-toggle]');
        const navLinks = document.querySelector('[data-nav-links]');
        const wordmark = document.querySelector('.highlights-wordmark');
        const page = document.querySelector('.highlights-page');
        const skipLink = document.querySelector('.highlights-skip-link');
        if (!menuToggle || !navLinks) return;
        const syncMenuState = () => {
            const open = navLinks.classList.contains('open');
            document.body.classList.toggle('highlights-menu-open', open);
            menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
            if (page) page.inert = open;
            if (skipLink) skipLink.inert = open;
        };
        menuToggle.addEventListener('click', () => window.setTimeout(syncMenuState, 0));
        navLinks.addEventListener('click', (event) => {
            if (event.target.closest('a')) window.setTimeout(syncMenuState, 0);
        });
        window.addEventListener('resize', () => {
            const compactNavigation = window.matchMedia('(max-width: 820px), (max-width: 960px) and (max-height: 520px)').matches;
            if (!compactNavigation && navLinks.classList.contains('open')) {
                navLinks.classList.remove('open');
                menuToggle.setAttribute('aria-expanded', 'false');
                syncMenuState();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Tab' && navLinks.classList.contains('open')) {
                const focusable = [wordmark, menuToggle, ...navLinks.querySelectorAll('a[href], button:not(:disabled)')]
                    .filter((element) => element && !element.hidden && element.offsetParent !== null);
                const first = focusable[0];
                const last = focusable.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
            if (event.key !== 'Escape') return;
            if (navLinks.classList.contains('open')) {
                navLinks.classList.remove('open');
                menuToggle.setAttribute('aria-expanded', 'false');
                syncMenuState();
                menuToggle.focus();
            }
            const accountMenu = document.querySelector('[data-account-menu].open');
            if (accountMenu) {
                accountMenu.classList.remove('open');
                document.querySelector('[data-account-trigger]')?.setAttribute('aria-expanded', 'false');
            }
            const adminActionMenu = document.querySelector('[data-admin-item-menu].open');
            if (adminActionMenu) {
                adminActionMenu.classList.remove('open');
                const trigger = adminActionMenu.querySelector('[data-admin-menu-trigger]');
                trigger?.setAttribute('aria-expanded', 'false');
                trigger?.focus();
            }
        });
    }

    function bindEvents() {
        categoryPrevious.addEventListener('click', () => moveCategory(-1, { focus: true }));
        categoryNext.addEventListener('click', () => moveCategory(1, { focus: true }));

        categoryStage.addEventListener('keydown', (event) => {
            if (isViewerOpen() || isEditorOpen() || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.target.closest('[data-admin-item-menu]')) return;
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveCategory(1, { focus: true });
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveCategory(-1, { focus: true });
            } else if (event.key === 'Home' && categories.length) {
                event.preventDefault();
                setActiveCategory(0, { focus: true });
            } else if (event.key === 'End' && categories.length) {
                event.preventDefault();
                setActiveCategory(categories.length - 1, { focus: true });
            }
        });

        categoryTrack.addEventListener('click', (event) => {
            const viewButton = event.target.closest('[data-category-view]');
            if (viewButton) {
                const index = categories.findIndex((category) => category.id === viewButton.dataset.categoryView);
                if (index >= 0) setActiveCategory(index, { announce: false });
                openViewer(0);
                return;
            }
            const editButton = event.target.closest('[data-category-edit]');
            if (editButton) {
                openCategoryEditor('edit', categories.find((category) => category.id === editButton.dataset.categoryEdit));
                return;
            }
            const deleteButton = event.target.closest('[data-category-delete]');
            if (deleteButton) {
                void deleteCategory(categories.find((category) => category.id === deleteButton.dataset.categoryDelete));
                return;
            }
            const selectButton = event.target.closest('[data-category-select]');
            if (!selectButton) return;
            const index = categories.findIndex((category) => category.id === selectButton.dataset.categorySelect);
            if (index < 0) return;
            if (index === activeIndex) openViewer(0);
            else setActiveCategory(index);
        });

        adminToolbar.addEventListener('click', (event) => {
            if (event.target.closest('[data-create-category]')) openCategoryEditor('create');
        });

        categoryEditorForm.addEventListener('submit', saveCategory);
        categoryEditorClose.addEventListener('click', closeCategoryEditor);
        categoryEditorCancel.addEventListener('click', closeCategoryEditor);
        categoryEditorDialog.addEventListener('click', (event) => {
            if (event.target === categoryEditorDialog) closeCategoryEditor();
        });

        viewerClose.addEventListener('click', closeViewer);
        viewerPrevious.addEventListener('click', previousViewerItem);
        viewerNext.addEventListener('click', nextViewerItem);
        viewerPlayback.addEventListener('click', toggleImagePlayback);
        viewerLike.addEventListener('click', () => void toggleLike());
        viewerDialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeViewer();
        });
        viewerDialog.addEventListener('close', finishViewerClose);
        viewerDialog.addEventListener('click', (event) => {
            const deleteButton = event.target.closest('[data-admin-delete="highlight"]');
            if (deleteButton && isAdmin) {
                const item = viewerItems().find((entry) => entry.id === deleteButton.dataset.id);
                void deleteHighlight(item);
            }
        });
        document.addEventListener('click', () => {
            window.setTimeout(() => {
                if (!isViewerOpen()) return;
                if (viewerDialog.querySelector('[data-admin-item-menu].open')) suspendViewerForMenu();
                else resumeViewerAfterMenu();
            }, 0);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !isViewerOpen()) return;
            const openMenu = viewerDialog.querySelector('[data-admin-item-menu].open');
            if (!openMenu) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            openMenu.classList.remove('open');
            const trigger = openMenu.querySelector('[data-admin-menu-trigger]');
            trigger?.setAttribute('aria-expanded', 'false');
            resumeViewerAfterMenu();
            trigger?.focus();
        }, true);
        viewerMediaSlot.addEventListener('click', (event) => {
            const retryButton = event.target.closest('[data-viewer-retry]');
            const item = viewerItems()[viewerIndex];
            if (retryButton && item?.id === retryButton.dataset.viewerRetry) void renderViewerItem();
        });

        document.addEventListener('keydown', (event) => {
            if (!isViewerOpen() || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.target.closest('input, textarea, select, video, [contenteditable="true"], [data-admin-item-menu], .viewer-playback, .viewer-like')) return;
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                nextViewerItem();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                previousViewerItem();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!isViewerOpen()) return;
            const item = viewerItems()[viewerIndex];
            const video = viewerMediaSlot.querySelector('video');
            if (document.hidden) {
                if (item?.media_type === 'image' && !playbackPaused && imageFrame) {
                    pauseImageProgress();
                    visibilitySuspended = true;
                } else if (video && !video.paused) {
                    video.pause();
                    visibilitySuspended = true;
                }
            } else if (visibilitySuspended) {
                visibilitySuspended = false;
                if (item?.media_type === 'image' && !playbackPaused) startImageProgress();
                else if (video) void video.play().catch(() => {});
            }
        });

        let resizeFrame = null;
        window.addEventListener('resize', () => {
            if (resizeFrame) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                if (!isViewerOpen()) setActiveCategory(activeIndex, { announce: false, syncUrl: false });
            });
        });
    }

    mountAdminToolbar();
    bindEvents();
    initWholePageWheel();
    initCategoryDrag();
    initViewerSwipe();
    initNavigationEnhancements();

    sb.auth?.onAuthStateChange?.((event) => {
        if (event !== 'SIGNED_OUT') return;
        stopViewerPlayback();
        document.documentElement.classList.add('auth-pending');
        if (viewerDialog.open) viewerDialog.close();
        if (categoryEditorDialog.open) categoryEditorDialog.close();
        redirectToLogin(window.location.href);
    });

    const { data, error } = await sb.from('highlight_categories')
        .select('id, name, sort_order, created_at, updated_at, highlights(id, category_id, media_type, storage_path, caption, published, created_at, updated_at)')
        .order('sort_order');

    if (error) {
        console.error('Could not load highlight categories.', error);
        renderEmpty('Unable to open the archive', 'Please refresh the page and try again.');
        return;
    }

    categories = normalizeCategories(data);
    renderCategories(requestedCategoryId);

    const requestedCategoryIndex = categories.findIndex((category) => category.id === requestedCategoryId);
    if (requestedCategoryIndex >= 0 && requestedCategoryIndex !== activeIndex) {
        setActiveCategory(requestedCategoryIndex, { announce: false });
    }
    const requestedItemIndex = activeCategory()?.highlights.findIndex((item) => item.id === requestedItemId) ?? -1;
    if (requestedItemId && requestedItemIndex >= 0) openViewer(requestedItemIndex);
    else if (requestedItemId) replacePageUrl();
})();
