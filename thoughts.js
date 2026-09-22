(async function () {
    const app = window.PaintingApp;
    await app.ready;
    const { sb, state, escapeHTML, formatDate, emptyState, showToast, adminMenu } = app;
    const feed = document.getElementById('thoughts-feed');
    const filters = document.getElementById('thought-filters');
    const search = document.getElementById('thought-search');
    let activeCategory = 'all';
    let thoughts = [];

    if (state.profile?.is_admin) {
        document.querySelector('.page-intro')?.insertAdjacentHTML(
            'beforeend',
            '<a class="button primary admin-page-action" href="admin.html#thought"><span aria-hidden="true">+</span> Add Thought</a>',
        );
    }

    const [{ data: rows, error }, { data: categories }] = await Promise.all([
        sb.from('thoughts').select('id, title, excerpt, content, read_time, created_at, category_id, thought_categories(name)').eq('published', true).order('created_at', { ascending: false }),
        sb.from('thought_categories').select('id, name').order('sort_order'),
    ]);

    if (error) {
        emptyState(feed, 'Thoughts could not be loaded.', 'Please try again shortly.');
        return;
    }
    thoughts = rows || [];
    filters.innerHTML = `<button class="filter-chip active" data-category="all">All</button>${(categories || []).map((category) => `<button class="filter-chip" data-category="${category.id}">${escapeHTML(category.name)}</button>`).join('')}`;

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

    render();
})();
