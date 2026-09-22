(async function () {
    const app = window.PaintingApp;
    await app.ready;
    const { sb, state, escapeHTML, formatDate, emptyState, showToast, icons } = app;
    const id = new URLSearchParams(window.location.search).get('id');
    const article = document.getElementById('thought-article');
    const commentList = document.getElementById('comment-list');
    const commentForm = document.getElementById('comment-form');
    const likeButton = document.getElementById('thought-like');

    if (!id) {
        emptyState(article, 'This thought could not be found.');
        return;
    }
    const { data: thought, error } = await sb.from('thoughts').select('*, thought_categories(name)').eq('id', id).single();
    if (error || !thought) {
        emptyState(article, 'This thought could not be found.');
        return;
    }

    document.title = `${thought.title} | Painting with passion`;
    const paragraphs = thought.content.split(/\n{2,}/).filter(Boolean).map((text) => `<p>${escapeHTML(text).replace(/\n/g, '<br>')}</p>`).join('');
    article.innerHTML = `
        <header class="article-heading">
            <a class="back-link" href="thoughts.html">← All thoughts</a>
            <p class="eyebrow">${escapeHTML(thought.thought_categories?.name || 'Thought')} · ${formatDate(thought.created_at)} · ${thought.read_time} min read</p>
            <h1>${escapeHTML(thought.title)}</h1>
        </header>
        <div class="article-body">${paragraphs}</div>`;

    async function loadLike() {
        const { data } = await sb.rpc('get_like_summary', { p_content_type: 'thought', p_content_id: id });
        const summary = data?.[0] || { like_count: 0, liked: false };
        likeButton.innerHTML = `${icons.heart}<span>${summary.like_count}</span>`;
        likeButton.classList.toggle('liked', Boolean(summary.liked));
        likeButton.setAttribute('aria-label', summary.liked ? 'Unlike this thought' : 'Like this thought');
    }

    likeButton.addEventListener('click', async () => {
        if (!state.user) {
            window.location.href = app.loginUrl(window.location.href);
            return;
        }
        likeButton.disabled = true;
        const liked = likeButton.classList.contains('liked');
        const query = liked
            ? sb.from('thought_likes').delete().eq('thought_id', id).eq('user_id', state.user.id)
            : sb.from('thought_likes').insert({ thought_id: id, user_id: state.user.id });
        const { error: likeError } = await query;
        likeButton.disabled = false;
        if (likeError) showToast(likeError.message, 'error');
        else loadLike();
    });

    async function loadComments() {
        const { data: comments, error: commentError } = await sb.from('comments').select('*').eq('thought_id', id).order('created_at', { ascending: false });
        if (commentError || !comments?.length) {
            emptyState(commentList, commentError ? 'Comments could not be loaded.' : 'No comments yet.', commentError ? '' : 'Be the first to join the conversation.');
            return;
        }
        commentList.innerHTML = comments.map((comment) => `
            <article class="comment-item">
                <div><strong>${escapeHTML(comment.author_name)}</strong><time>${formatDate(comment.created_at)}</time></div>
                <p>${escapeHTML(comment.content)}</p>
                ${state.user?.id === comment.user_id ? `<button class="comment-delete" data-delete-comment="${comment.id}">Delete</button>` : ''}
            </article>`).join('');
    }

    if (!state.user) {
        commentForm.innerHTML = `<p>Have something to add? <a href="${app.loginUrl(window.location.href)}">Sign in to comment</a>.</p>`;
    } else {
        commentForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const textarea = commentForm.querySelector('textarea');
            const content = textarea.value.trim();
            if (!content) return;
            const button = commentForm.querySelector('button');
            button.disabled = true;
            const { error: insertError } = await sb.from('comments').insert({ thought_id: id, user_id: state.user.id, content });
            button.disabled = false;
            if (insertError) showToast(insertError.message, 'error');
            else {
                textarea.value = '';
                loadComments();
            }
        });
    }

    commentList.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-delete-comment]');
        if (!button || !window.confirm('Delete this comment?')) return;
        const { error: deleteError } = await sb.from('comments').delete().eq('id', button.dataset.deleteComment);
        if (deleteError) showToast(deleteError.message, 'error');
        else loadComments();
    });

    await Promise.all([loadLike(), loadComments()]);
})();
