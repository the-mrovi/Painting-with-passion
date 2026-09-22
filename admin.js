(async function () {
    const app = window.PaintingApp;
    await app.ready;
    if (!app.state.profile?.is_admin) return;
    const { sb, state, escapeHTML, formatDate, formatMoney, relativeTime, signedUrls, emptyState, showToast } = app;
    const cache = { paintings: new Map(), thoughts: new Map(), highlights: new Map() };
    const acceptedArtworkTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const acceptedHighlightTypes = [...acceptedArtworkTypes, 'video/mp4', 'video/webm'];
    const pageParams = new URLSearchParams(window.location.search);

    function initAdminNavigation() {
        const toggles = document.querySelectorAll('[data-admin-nav-toggle]');
        const setOpen = (open) => {
            document.body.classList.toggle('admin-nav-open', open);
            toggles.forEach((toggle) => toggle.setAttribute('aria-expanded', String(open)));
        };
        toggles.forEach((toggle) => toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('admin-nav-open'))));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setOpen(false);
        });
        document.querySelector('.admin-sidebar nav[aria-label="Admin sections"]')?.addEventListener('click', (event) => {
            if (event.target.closest('[data-admin-tab]') && window.matchMedia('(max-width: 720px)').matches) setOpen(false);
        });
    }

    function cacheFor(type) {
        if (type === 'painting') return cache.paintings;
        if (type === 'thought') return cache.thoughts;
        return cache.highlights;
    }

    function initTabs() {
        const tabs = document.querySelectorAll('[data-admin-tab]');
        const panels = document.querySelectorAll('[data-admin-panel]');
        tabs.forEach((tab) => tab.addEventListener('click', () => {
            tabs.forEach((item) => item.classList.toggle('active', item === tab));
            panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.adminPanel === tab.dataset.adminTab));
            const url = new URL(window.location.href);
            url.hash = tab.dataset.adminTab;
            history.replaceState(null, '', `${url.pathname.split('/').pop()}${url.search}${url.hash}`);
        }));
        const initial = [...tabs].find((tab) => tab.dataset.adminTab === location.hash.slice(1)) || tabs[0];
        initial?.click();

        document.querySelectorAll('[data-manage-tab]').forEach((tab) => tab.addEventListener('click', () => {
            document.querySelectorAll('[data-manage-tab]').forEach((item) => item.classList.toggle('active', item === tab));
            document.querySelectorAll('[data-manage-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.managePanel === tab.dataset.manageTab));
        }));
    }

    function validateFile(file, allowed, maxMb) {
        if (!file) throw new Error('Choose a file to upload.');
        if (!allowed.includes(file.type)) throw new Error('This file type is not supported.');
        if (file.size > maxMb * 1024 * 1024) throw new Error(`Keep files under ${maxMb}MB.`);
    }

    function storagePath(file) {
        const extension = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
        return `${state.user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    }

    async function upload(bucket, file) {
        const path = storagePath(file);
        const { error } = await sb.storage.from(bucket).upload(path, file, { cacheControl: '3600', upsert: false });
        if (error) throw error;
        return path;
    }

    async function loadDashboard() {
        const requests = ['paintings', 'thoughts', 'comments', 'highlights'].map((table) => sb.from(table).select('id', { count: 'exact', head: true }));
        const results = await Promise.all(requests);
        ['paintings', 'thoughts', 'comments', 'highlights'].forEach((name, index) => {
            document.getElementById(`stat-${name}`).textContent = String(results[index].count || 0);
        });

        const feed = document.getElementById('activity-feed');
        const { data: events, error } = await sb.from('activity_events').select('*').order('created_at', { ascending: false }).limit(20);
        if (error || !events?.length) {
            emptyState(feed, error ? 'Activity could not be loaded.' : 'No activity yet.');
            return;
        }
        const actorIds = [...new Set(events.map((event) => event.actor_user_id).filter(Boolean))];
        const { data: profiles } = actorIds.length ? await sb.from('user_profiles').select('id, full_name, email').in('id', actorIds) : { data: [] };
        const actors = new Map((profiles || []).map((profile) => [profile.id, profile.full_name || profile.email]));
        const messages = {
            user_registered: 'joined the studio', thought_liked: 'liked a thought', painting_liked: 'liked an artwork',
            highlight_liked: 'liked a highlight', comment_created: 'left a comment', order_created: 'placed an order',
            artwork_created: 'published an artwork', thought_created: 'published a thought', highlight_created: 'shared a highlight',
        };
        feed.innerHTML = events.map((event) => {
            const actor = actors.get(event.actor_user_id) || event.metadata?.name || event.metadata?.author || 'Someone';
            const detail = event.metadata?.title || event.metadata?.order_number || '';
            return `<article class="activity-row"><span>${escapeHTML(actor.charAt(0).toUpperCase())}</span><div><p><strong>${escapeHTML(actor)}</strong> ${escapeHTML(messages[event.event_type] || 'updated the studio')}</p>${detail ? `<small>${escapeHTML(String(detail))}</small>` : ''}</div><time>${relativeTime(event.created_at)}</time></article>`;
        }).join('');
    }

    async function loadCategories() {
        const [{ data: thoughtCategories }, { data: highlightCategories }] = await Promise.all([
            sb.from('thought_categories').select('*').order('sort_order'),
            sb.from('highlight_categories').select('*').order('sort_order'),
        ]);
        const thoughtSelects = document.querySelectorAll('[data-thought-category-select]');
        const highlightSelects = document.querySelectorAll('[data-highlight-category-select]');
        thoughtSelects.forEach((select) => {
            const current = select.value;
            select.innerHTML = '<option value="">Uncategorised</option>' + (thoughtCategories || []).map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join('');
            select.value = current;
        });
        highlightSelects.forEach((select) => {
            const current = select.value;
            select.innerHTML = '<option value="">Choose category</option>' + (highlightCategories || []).map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join('');
            select.value = current;
        });
        renderCategoryList('thought', thoughtCategories || []);
        renderCategoryList('highlight', highlightCategories || []);
    }

    function renderCategoryList(type, items) {
        const container = document.getElementById(`${type}-category-list`);
        if (!items.length) {
            emptyState(container, 'No categories yet.');
            return;
        }
        container.innerHTML = items.map((item, index) => `<div class="category-row"><span>${escapeHTML(item.name)}</span><span><button data-category-move="up" data-category-type="${type}" data-category-id="${item.id}" ${index === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button data-category-move="down" data-category-type="${type}" data-category-id="${item.id}" ${index === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></span></div>`).join('');
    }

    async function createCategory(type, name) {
        const table = type === 'thought' ? 'thought_categories' : 'highlight_categories';
        const { count } = await sb.from(table).select('id', { count: 'exact', head: true });
        const { error } = await sb.from(table).insert({ name, sort_order: ((count || 0) + 1) * 10 });
        if (error) throw error;
        await loadCategories();
    }

    document.querySelectorAll('[data-category-form]').forEach((form) => form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = form.querySelector('input');
        const name = input.value.trim();
        if (!name) return;
        try {
            await createCategory(form.dataset.categoryForm, name);
            input.value = '';
            showToast('Category added.');
        } catch (error) { showToast(error.message, 'error'); }
    }));

    document.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-category-move]');
        if (!button) return;
        const type = button.dataset.categoryType;
        const table = type === 'thought' ? 'thought_categories' : 'highlight_categories';
        const { data: items } = await sb.from(table).select('id, sort_order').order('sort_order');
        const index = items.findIndex((item) => item.id === button.dataset.categoryId);
        const swapIndex = button.dataset.categoryMove === 'up' ? index - 1 : index + 1;
        if (index < 0 || !items[swapIndex]) return;
        const first = items[index];
        const second = items[swapIndex];
        const results = await Promise.all([
            sb.from(table).update({ sort_order: second.sort_order }).eq('id', first.id),
            sb.from(table).update({ sort_order: first.sort_order }).eq('id', second.id),
        ]);
        if (results.some((result) => result.error)) showToast('Could not reorder categories.', 'error'); else loadCategories();
    });

    document.getElementById('artwork-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const file = form.elements.image.files[0];
        const button = form.querySelector('[type="submit"]');
        let path = '';
        button.disabled = true;
        button.textContent = 'Publishing…';
        try {
            validateFile(file, acceptedArtworkTypes, 15);
            path = await upload('artworks', file);
            const price = form.elements.price.value.trim();
            const { error } = await sb.from('paintings').insert({
                title: form.elements.title.value.trim(), storage_path: path,
                caption: form.elements.caption.value.trim() || null,
                description: form.elements.description.value.trim() || null,
                medium: form.elements.medium.value.trim() || null,
                dimensions: form.elements.dimensions.value.trim() || null,
                price: price ? Number(price) : null,
                currency: form.elements.currency.value,
                is_available: form.elements.is_available.checked,
                published: form.elements.published.checked,
                created_by: state.user.id,
            });
            if (error) throw error;
            form.reset();
            form.elements.is_available.checked = true;
            form.elements.published.checked = true;
            showToast('Artwork published.');
            await Promise.all([loadDashboard(), loadPaintings()]);
        } catch (error) {
            if (path) await sb.storage.from('artworks').remove([path]);
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Publish artwork';
        }
    });

    document.getElementById('thought-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const content = form.elements.content.value.trim();
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        const { error } = await sb.from('thoughts').insert({
            title: form.elements.title.value.trim(), excerpt: form.elements.excerpt.value.trim() || null,
            content, category_id: form.elements.category_id.value || null,
            read_time: Math.max(1, Math.ceil(content.split(/\s+/).length / 200)),
            published: form.elements.published.checked, created_by: state.user.id,
        });
        button.disabled = false;
        if (error) showToast(error.message, 'error');
        else {
            form.reset();
            form.elements.published.checked = true;
            showToast('Thought published.');
            await Promise.all([loadDashboard(), loadThoughts()]);
        }
    });

    const highlightCaption = document.querySelector('#highlight-form [name="caption"]');
    highlightCaption.addEventListener('input', () => {
        const words = highlightCaption.value.trim() ? highlightCaption.value.trim().split(/\s+/).length : 0;
        document.getElementById('highlight-word-count').textContent = `${words}/100 words`;
    });
    document.getElementById('highlight-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const file = form.elements.media.files[0];
        const words = form.elements.caption.value.trim() ? form.elements.caption.value.trim().split(/\s+/).length : 0;
        const button = form.querySelector('[type="submit"]');
        let path = '';
        button.disabled = true;
        button.textContent = 'Uploading…';
        try {
            validateFile(file, acceptedHighlightTypes, 50);
            if (!form.elements.category_id.value) throw new Error('Choose a highlight category.');
            if (words > 100) throw new Error('Keep the caption to 100 words or fewer.');
            path = await upload('highlights', file);
            const { error } = await sb.from('highlights').insert({
                category_id: form.elements.category_id.value,
                media_type: file.type.startsWith('video/') ? 'video' : 'image',
                storage_path: path, caption: form.elements.caption.value.trim() || null,
                published: form.elements.published.checked, created_by: state.user.id,
            });
            if (error) throw error;
            form.reset();
            form.elements.published.checked = true;
            highlightCaption.dispatchEvent(new Event('input'));
            showToast('Highlight shared.');
            await Promise.all([loadDashboard(), loadHighlights()]);
        } catch (error) {
            if (path) await sb.storage.from('highlights').remove([path]);
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Share highlight';
        }
    });

    async function loadPaintings() {
        const list = document.getElementById('painting-admin-list');
        const { data, error } = await sb.from('paintings').select('*').order('created_at', { ascending: false });
        if (error || !data?.length) {
            emptyState(list, error ? 'Artworks could not be loaded.' : 'No artworks yet.');
            return;
        }
        cache.paintings = new Map(data.map((item) => [item.id, item]));
        const urls = await signedUrls('artworks', data.map((item) => item.storage_path));
        list.innerHTML = data.map((item) => `<article class="manage-row"><img src="${urls.get(item.storage_path) || ''}" alt=""><div><a href="painting.html?id=${item.id}" target="_blank">${escapeHTML(item.title)}</a><span>${item.published ? 'Published' : 'Draft'} · ${item.is_available ? 'Available' : 'Unavailable'} · ${formatMoney(item.price, item.currency)}</span></div><div><button data-edit="painting" data-id="${item.id}">Edit</button><button class="danger" data-delete="painting" data-id="${item.id}">Delete</button></div></article>`).join('');
    }

    async function loadThoughts() {
        const list = document.getElementById('thought-admin-list');
        const { data, error } = await sb.from('thoughts').select('*, thought_categories(name)').order('created_at', { ascending: false });
        if (error || !data?.length) {
            emptyState(list, error ? 'Thoughts could not be loaded.' : 'No thoughts yet.');
            return;
        }
        cache.thoughts = new Map(data.map((item) => [item.id, item]));
        list.innerHTML = data.map((item) => `<article class="manage-row text-only"><div><a href="post.html?id=${item.id}" target="_blank">${escapeHTML(item.title)}</a><span>${escapeHTML(item.thought_categories?.name || 'Uncategorised')} · ${item.published ? 'Published' : 'Draft'} · ${formatDate(item.created_at)}</span></div><div><button data-edit="thought" data-id="${item.id}">Edit</button><button class="danger" data-delete="thought" data-id="${item.id}">Delete</button></div></article>`).join('');
    }

    async function loadHighlights() {
        const list = document.getElementById('highlight-admin-list');
        const { data, error } = await sb.from('highlights').select('*, highlight_categories(name)').order('created_at', { ascending: false });
        if (error || !data?.length) {
            emptyState(list, error ? 'Highlights could not be loaded.' : 'No highlights yet.');
            return;
        }
        cache.highlights = new Map(data.map((item) => [item.id, item]));
        const imageItems = data.filter((item) => item.media_type === 'image');
        const urls = await signedUrls('highlights', imageItems.map((item) => item.storage_path));
        list.innerHTML = data.map((item) => `<article class="manage-row">${item.media_type === 'image' ? `<img src="${urls.get(item.storage_path) || ''}" alt="">` : '<span class="video-thumb">Video</span>'}<div><a href="highlights.html?category=${item.category_id}&item=${item.id}" target="_blank">${escapeHTML(item.caption || 'Untitled highlight')}</a><span>${escapeHTML(item.highlight_categories?.name || '')} · ${item.published ? 'Published' : 'Draft'}</span></div><div><button data-edit="highlight" data-id="${item.id}">Edit</button><button class="danger" data-delete="highlight" data-id="${item.id}">Delete</button></div></article>`).join('');
    }

    async function loadComments() {
        const list = document.getElementById('comment-admin-list');
        const { data, error } = await sb.from('comments').select('*, thoughts(id, title)').order('created_at', { ascending: false });
        if (error || !data?.length) {
            emptyState(list, error ? 'Comments could not be loaded.' : 'No comments yet.');
            return;
        }
        list.innerHTML = data.map((item) => `<article class="manage-row text-only"><div><strong>${escapeHTML(item.author_name)}</strong><p>${escapeHTML(item.content)}</p><a href="post.html?id=${item.thought_id}" target="_blank">On ${escapeHTML(item.thoughts?.title || 'thought')}</a></div><div><button class="danger" data-delete-comment="${item.id}">Delete</button></div></article>`).join('');
    }

    async function loadUsers() {
        const list = document.getElementById('user-admin-list');
        const { data, error } = await sb.from('user_profiles').select('*').order('created_at', { ascending: false });
        if (error || !data?.length) {
            emptyState(list, error ? 'Users could not be loaded.' : 'No registered users yet.');
            return;
        }
        list.innerHTML = data.map((user) => `<article class="manage-row text-only"><div><strong>${escapeHTML(user.full_name)}</strong><span>${escapeHTML(user.email || '')} · Joined ${formatDate(user.created_at)}${user.is_admin ? ' · Admin' : ''}</span>${user.ban_reason ? `<p>${escapeHTML(user.ban_reason)}</p>` : ''}</div><div>${!user.is_admin ? `<button class="${user.is_banned ? '' : 'danger'}" data-ban-user="${user.id}" data-banned="${user.is_banned}">${user.is_banned ? 'Unban' : 'Ban'}</button>` : ''}</div></article>`).join('');
    }

    async function loadOrders() {
        const list = document.getElementById('orders-list');
        const { data, error } = await sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
        if (error || !data?.length) {
            emptyState(list, error ? 'Orders could not be loaded.' : 'No orders have been placed yet.');
            return;
        }
        const statuses = ['pending', 'confirmed', 'paid', 'preparing', 'shipped', 'completed', 'cancelled'];
        list.innerHTML = data.map((order) => `<article class="admin-order"><header><div><strong>${escapeHTML(order.order_number)}</strong><span>${formatDate(order.created_at)} · ${escapeHTML(order.full_name)} · ${escapeHTML(order.email)}</span></div><select data-order-status="${order.id}">${statuses.map((status) => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></header><div class="admin-order-items">${(order.order_items || []).map((item) => `<span>${escapeHTML(item.artwork_name)} <strong>${formatMoney(item.line_total, order.currency)}</strong></span>`).join('')}</div><p>${escapeHTML(order.address_line)}, ${escapeHTML(order.city)}${order.postal_code ? `, ${escapeHTML(order.postal_code)}` : ''} · ${escapeHTML(order.phone)} · ${escapeHTML(order.payment_method.replaceAll('_', ' '))}</p>${order.customer_note ? `<blockquote>${escapeHTML(order.customer_note)}</blockquote>` : ''}</article>`).join('');
    }

    const editDialog = document.getElementById('edit-dialog');
    const editForm = document.getElementById('editor-form');
    async function openEditor(type, id) {
        const item = cacheFor(type).get(id);
        if (!item) return;
        editForm.dataset.type = type;
        editForm.dataset.id = id;
        document.getElementById('editor-title').textContent = `Edit ${type}`;
        const fields = document.getElementById('editor-fields');
        if (type === 'painting') {
            fields.innerHTML = `<label>Artwork name<input name="title" required value="${escapeHTML(item.title)}"></label><div class="form-pair"><label>Price<input name="price" type="number" min="0" step="0.01" value="${item.price ?? ''}"></label><label>Currency<select name="currency"><option ${item.currency === 'BDT' ? 'selected' : ''}>BDT</option><option ${item.currency === 'USD' ? 'selected' : ''}>USD</option></select></label></div><div class="form-pair"><label>Medium<input name="medium" value="${escapeHTML(item.medium || '')}"></label><label>Dimensions<input name="dimensions" value="${escapeHTML(item.dimensions || '')}"></label></div><label>Short caption<input name="caption" value="${escapeHTML(item.caption || '')}"></label><label>Details<textarea name="description" rows="6">${escapeHTML(item.description || '')}</textarea></label><label>Replace image<input name="replacement" type="file" accept="image/jpeg,image/png,image/webp"></label><div class="check-row"><label><input type="checkbox" name="is_available" ${item.is_available ? 'checked' : ''}> Available</label><label><input type="checkbox" name="published" ${item.published ? 'checked' : ''}> Published</label></div>`;
        } else if (type === 'thought') {
            const { data: categories } = await sb.from('thought_categories').select('*').order('sort_order');
            fields.innerHTML = `<label>Title<input name="title" required value="${escapeHTML(item.title)}"></label><label>Category<select name="category_id"><option value="">Uncategorised</option>${(categories || []).map((category) => `<option value="${category.id}" ${category.id === item.category_id ? 'selected' : ''}>${escapeHTML(category.name)}</option>`).join('')}</select></label><label>Excerpt<textarea name="excerpt" rows="3">${escapeHTML(item.excerpt || '')}</textarea></label><label>Thought<textarea name="content" rows="12" required>${escapeHTML(item.content)}</textarea></label><label class="check-label"><input type="checkbox" name="published" ${item.published ? 'checked' : ''}> Published</label>`;
        } else {
            const { data: categories } = await sb.from('highlight_categories').select('*').order('sort_order');
            fields.innerHTML = `<label>Category<select name="category_id" required>${(categories || []).map((category) => `<option value="${category.id}" ${category.id === item.category_id ? 'selected' : ''}>${escapeHTML(category.name)}</option>`).join('')}</select></label><label>Caption<textarea name="caption" rows="6" maxlength="900">${escapeHTML(item.caption || '')}</textarea><small>Maximum 100 words</small></label><label>Replace image or video<input name="replacement" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"><small>Optional · up to 50MB</small></label><label class="check-label"><input type="checkbox" name="published" ${item.published ? 'checked' : ''}> Published</label>`;
        }
        editDialog.showModal();
    }

    editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const type = editForm.dataset.type;
        const id = editForm.dataset.id;
        const item = cacheFor(type).get(id);
        const button = editForm.querySelector('[type="submit"]');
        button.disabled = true;
        let newPath = '';
        let uploadedBucket = '';
        try {
            if (type === 'painting') {
                const replacement = editForm.elements.replacement.files[0];
                if (replacement) {
                    validateFile(replacement, acceptedArtworkTypes, 15);
                    uploadedBucket = 'artworks';
                    newPath = await upload('artworks', replacement);
                }
                const price = editForm.elements.price.value.trim();
                const updates = {
                    title: editForm.elements.title.value.trim(), price: price ? Number(price) : null,
                    currency: editForm.elements.currency.value, medium: editForm.elements.medium.value.trim() || null,
                    dimensions: editForm.elements.dimensions.value.trim() || null, caption: editForm.elements.caption.value.trim() || null,
                    description: editForm.elements.description.value.trim() || null, is_available: editForm.elements.is_available.checked,
                    published: editForm.elements.published.checked,
                };
                if (newPath) updates.storage_path = newPath;
                const { error } = await sb.from('paintings').update(updates).eq('id', id);
                if (error) throw error;
                if (newPath) await sb.storage.from('artworks').remove([item.storage_path]);
                await loadPaintings();
            } else if (type === 'thought') {
                const content = editForm.elements.content.value.trim();
                const { error } = await sb.from('thoughts').update({
                    title: editForm.elements.title.value.trim(), category_id: editForm.elements.category_id.value || null,
                    excerpt: editForm.elements.excerpt.value.trim() || null, content,
                    read_time: Math.max(1, Math.ceil(content.split(/\s+/).length / 200)), published: editForm.elements.published.checked,
                }).eq('id', id);
                if (error) throw error;
                await loadThoughts();
            } else {
                const replacement = editForm.elements.replacement.files[0];
                const caption = editForm.elements.caption.value.trim();
                const words = caption ? caption.split(/\s+/).length : 0;
                if (words > 100) throw new Error('Keep the caption to 100 words or fewer.');
                if (replacement) {
                    validateFile(replacement, acceptedHighlightTypes, 50);
                    uploadedBucket = 'highlights';
                    newPath = await upload('highlights', replacement);
                }
                const updates = {
                    category_id: editForm.elements.category_id.value,
                    caption: caption || null,
                    published: editForm.elements.published.checked,
                };
                if (replacement) {
                    updates.storage_path = newPath;
                    updates.media_type = replacement.type.startsWith('video/') ? 'video' : 'image';
                }
                const { error } = await sb.from('highlights').update(updates).eq('id', id);
                if (error) throw error;
                if (newPath) await sb.storage.from('highlights').remove([item.storage_path]);
                await loadHighlights();
            }
            editDialog.close();
            showToast('Changes saved.');
        } catch (error) {
            if (newPath && uploadedBucket) await sb.storage.from(uploadedBucket).remove([newPath]);
            showToast(error.message, 'error');
        } finally { button.disabled = false; }
    });
    document.querySelectorAll('[data-close-editor]').forEach((button) => button.addEventListener('click', () => editDialog.close()));

    document.addEventListener('click', async (event) => {
        const edit = event.target.closest('[data-edit]');
        if (edit) { openEditor(edit.dataset.edit, edit.dataset.id); return; }
        const remove = event.target.closest('[data-delete]');
        if (remove) {
            if (!window.confirm(`Delete this ${remove.dataset.delete}? This cannot be undone.`)) return;
            const type = remove.dataset.delete;
            const table = type === 'painting' ? 'paintings' : type === 'thought' ? 'thoughts' : 'highlights';
            const bucket = type === 'painting' ? 'artworks' : type === 'highlight' ? 'highlights' : null;
            const source = cache[type === 'painting' ? 'paintings' : type === 'thought' ? 'thoughts' : 'highlights'].get(remove.dataset.id);
            const { error } = await sb.from(table).delete().eq('id', remove.dataset.id);
            if (error) { showToast(error.message, 'error'); return; }
            if (bucket && source?.storage_path) await sb.storage.from(bucket).remove([source.storage_path]);
            showToast('Content deleted.');
            await Promise.all([loadDashboard(), type === 'painting' ? loadPaintings() : type === 'thought' ? loadThoughts() : loadHighlights()]);
            return;
        }
        const comment = event.target.closest('[data-delete-comment]');
        if (comment && window.confirm('Delete this comment?')) {
            const { error } = await sb.from('comments').delete().eq('id', comment.dataset.deleteComment);
            if (error) showToast(error.message, 'error'); else { showToast('Comment deleted.'); loadComments(); loadDashboard(); }
            return;
        }
        const ban = event.target.closest('[data-ban-user]');
        if (ban) {
            const currentlyBanned = ban.dataset.banned === 'true';
            let reason = null;
            if (!currentlyBanned) {
                reason = window.prompt('Reason for restricting this account (optional):') || null;
                if (!window.confirm('Restrict this user from member features?')) return;
            }
            const { error } = await sb.rpc('set_user_ban', { p_user_id: ban.dataset.banUser, p_banned: !currentlyBanned, p_reason: reason });
            if (error) showToast(error.message, 'error'); else { showToast(currentlyBanned ? 'User unbanned.' : 'User banned.'); loadUsers(); }
        }
    });

    document.getElementById('orders-list').addEventListener('change', async (event) => {
        const select = event.target.closest('[data-order-status]');
        if (!select) return;
        select.disabled = true;
        const { error } = await sb.from('orders').update({ status: select.value }).eq('id', select.dataset.orderStatus);
        select.disabled = false;
        if (error) showToast(error.message, 'error'); else showToast('Order status updated.');
    });

    document.getElementById('admin-signout').addEventListener('click', () => signOut('index.html'));
    initAdminNavigation();
    initTabs();
    if (pageParams.get('notice') === 'customer-only') {
        showToast('Admin accounts cannot use the customer cart or place orders.', 'error');
    }
    await loadCategories();
    await Promise.all([loadDashboard(), loadPaintings(), loadThoughts(), loadHighlights(), loadComments(), loadUsers(), loadOrders()]);
    const requestedType = pageParams.get('edit');
    const requestedId = pageParams.get('id');
    if (['painting', 'thought', 'highlight'].includes(requestedType) && requestedId) {
        document.querySelector('[data-admin-tab="manage"]')?.click();
        const manageTab = requestedType === 'painting' ? 'paintings' : requestedType === 'thought' ? 'thoughts' : 'highlights';
        document.querySelector(`[data-manage-tab="${manageTab}"]`)?.click();
        await openEditor(requestedType, requestedId);
    }
})();
