(async function () {
    const app = window.PaintingApp;
    await app.ready;
    const { sb, state, escapeHTML, formatDate, emptyState, showToast, adminMenu } = app;
    const feed = document.getElementById('thoughts-feed');
    const filters = document.getElementById('thought-filters');
    const search = document.getElementById('thought-search');
    let activeCategory = 'all';
    let thoughts = [];
    let categories = [];
    const thoughtDialog = document.getElementById('thought-create-dialog');
    const thoughtForm = document.getElementById('thought-create-form');
    const thoughtMessage = document.getElementById('thought-create-message');
    const thoughtCategorySelect = thoughtForm.elements.category_id;
    const customCategoryField = thoughtForm.querySelector('[data-custom-thought-category]');

    if (state.profile?.is_admin) {
        document.querySelector('.page-intro')?.insertAdjacentHTML(
            'beforeend',
            '<button class="button primary admin-page-action" type="button" data-add-thought><span aria-hidden="true">+</span> Add Thought</button>',
        );
        thoughtDialog.hidden = false;
    }

    function renderCategoryControls() {
        filters.innerHTML = `<button class="filter-chip active" data-category="all">All</button>${categories.map((category) => `<button class="filter-chip" data-category="${category.id}">${escapeHTML(category.name)}</button>`).join('')}`;
        filters.querySelector(`[data-category="${CSS.escape(activeCategory)}"]`)?.classList.add('active');
        filters.querySelectorAll('button').forEach((button) => {
            if (button.dataset.category !== activeCategory) button.classList.remove('active');
        });
        if (state.profile?.is_admin) {
            const current = thoughtCategorySelect.value;
            thoughtCategorySelect.innerHTML = `<option value="">Uncategorised</option>${categories.map((category) => `<option value="${category.id}">${escapeHTML(category.name)}</option>`).join('')}<option value="__new__">Create a new category…</option>`;
            if ([...thoughtCategorySelect.options].some((option) => option.value === current)) thoughtCategorySelect.value = current;
        }
    }

    async function loadThoughts() {
        const [{ data: rows, error }, { data: categoryRows, error: categoryError }] = await Promise.all([
            sb.from('thoughts').select('id, title, excerpt, content, read_time, created_at, category_id, thought_categories(name)').eq('published', true).order('created_at', { ascending: false }),
            sb.from('thought_categories').select('id, name, sort_order').order('sort_order'),
        ]);
        if (error || categoryError) {
            emptyState(feed, 'Thoughts could not be loaded.', 'Please try again shortly.');
            return false;
        }
        thoughts = rows || [];
        categories = categoryRows || [];
        if (activeCategory !== 'all' && !categories.some((category) => category.id === activeCategory)) activeCategory = 'all';
        renderCategoryControls();
        render();
        return true;
    }

    function render() {
        const term = search.value.trim().toLowerCase();
        const visible = thoughts.filter((thought) => {
            const categoryMatch = activeCategory === 'all' || thought.category_id === activeCategory;
            const text = `${thought.title} ${thought.excerpt || ''} ${thought.content}`.toLowerCase();
            return categoryMatch && (!term || text.includes(term));
        });
        if (!visible.length) {
            emptyState(feed, 'No thoughts match this view.');
            return;
        }
        feed.innerHTML = visible.map((thought) => {
            const snippet = thought.excerpt || `${thought.content.slice(0, 260)}${thought.content.length > 260 ? '…' : ''}`;
            const detailsHref = `post.html?id=${thought.id}`;
            return `<article class="thought-row">
                ${adminMenu({ type: 'thought', id: thought.id, viewHref: detailsHref })}
                <div class="thought-meta"><span>${escapeHTML(thought.thought_categories?.name || 'Note')}</span><time>${formatDate(thought.created_at)}</time></div>
                <h2><a href="${detailsHref}">${escapeHTML(thought.title)}</a></h2>
                <p>${escapeHTML(snippet)}</p>
                <a class="text-link" href="${detailsHref}">Read · ${thought.read_time} min</a>
            </article>`;
        }).join('');
    }

    filters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-category]');
        if (!button) return;
        activeCategory = button.dataset.category;
        filters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
        render();
    });
    search.addEventListener('input', render);

    feed.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-admin-delete="thought"]');
        if (!button || !state.profile?.is_admin) return;
        const thought = thoughts.find((item) => item.id === button.dataset.id);
        if (!thought || !window.confirm(`Delete “${thought.title}”? This also removes its comments and likes.`)) return;
        button.disabled = true;
        const { error: deleteError } = await sb.from('thoughts').delete().eq('id', thought.id);
        if (deleteError) {
            button.disabled = false;
            showToast(deleteError.message, 'error');
            return;
        }
        thoughts = thoughts.filter((item) => item.id !== thought.id);
        render();
        showToast('Thought deleted.');
    });

    function closeThoughtDialog() {
        if (thoughtDialog.open) thoughtDialog.close();
        thoughtForm.reset();
        thoughtMessage.textContent = '';
        thoughtMessage.classList.remove('error');
        syncCustomCategoryField();
    }

    function syncCustomCategoryField() {
        const needsCustomCategory = thoughtCategorySelect.value === '__new__';
        customCategoryField.hidden = !needsCustomCategory;
        thoughtForm.elements.custom_category.required = needsCustomCategory;
        if (!needsCustomCategory) thoughtForm.elements.custom_category.value = '';
    }

    if (state.profile?.is_admin) {
        document.querySelector('[data-add-thought]')?.addEventListener('click', () => {
            thoughtMessage.textContent = '';
            thoughtMessage.classList.remove('error');
            thoughtDialog.showModal();
        });
        thoughtCategorySelect.addEventListener('change', syncCustomCategoryField);
        document.querySelectorAll('[data-close-thought-dialog]').forEach((button) => button.addEventListener('click', closeThoughtDialog));
        thoughtDialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeThoughtDialog();
        });
        thoughtDialog.addEventListener('click', (event) => {
            if (event.target === thoughtDialog) closeThoughtDialog();
        });
        thoughtForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!state.profile?.is_admin) return;
            const button = thoughtForm.querySelector('[type="submit"]');
            const content = thoughtForm.elements.content.value.trim();
            let categoryId = thoughtCategorySelect.value;
            button.disabled = true;
            button.textContent = 'Publishing…';
            thoughtMessage.textContent = 'Saving your thought…';
            thoughtMessage.classList.remove('error');
            try {
                if (categoryId === '__new__') {
                    const name = thoughtForm.elements.custom_category.value.trim();
                    if (!name) throw new Error('Enter a name for the new category.');
                    const maxSortOrder = categories.reduce((maximum, category) => Math.max(maximum, Number(category.sort_order) || 0), 0);
                    const { data: newCategory, error: categoryError } = await sb.from('thought_categories')
                        .insert({ name, sort_order: maxSortOrder + 10 })
                        .select('id, name, sort_order')
                        .single();
                    if (categoryError) throw categoryError;
                    categoryId = newCategory.id;
                    categories.push(newCategory);
                    categories.sort((a, b) => (Number(a.sort_order) - Number(b.sort_order)) || a.name.localeCompare(b.name));
                    renderCategoryControls();
                    thoughtCategorySelect.value = categoryId;
                    syncCustomCategoryField();
                }
                const { error: insertError } = await sb.from('thoughts').insert({
                    title: thoughtForm.elements.title.value.trim(),
                    excerpt: thoughtForm.elements.excerpt.value.trim() || null,
                    content,
                    category_id: categoryId || null,
                    read_time: Math.max(1, Math.ceil(content.split(/\s+/).length / 200)),
                    published: thoughtForm.elements.published.checked,
                    created_by: state.user.id,
                });
                if (insertError) throw insertError;
                closeThoughtDialog();
                await loadThoughts();
                showToast('Thought published.', 'success');
            } catch (error) {
                thoughtMessage.textContent = error.message || 'The thought could not be published.';
                thoughtMessage.classList.add('error');
            } finally {
                button.disabled = false;
                button.textContent = 'Publish thought';
            }
        });
    }

    await loadThoughts();
})();
