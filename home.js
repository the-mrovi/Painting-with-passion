(async function () {
    const app = window.PaintingApp;
    await app.ready;

    const { sb, state, signedUrls } = app;
    const body = document.body;
    const stage = document.getElementById('artwork-stage');
    const track = document.getElementById('artwork-track');
    const controls = document.getElementById('artwork-controls');
    const previousButton = document.getElementById('artwork-previous');
    const nextButton = document.getElementById('artwork-next');
    const gestureHint = document.getElementById('artwork-gesture-hint');
    const liveStatus = document.getElementById('artwork-live-status');
    const infoInner = document.getElementById('exhibition-info-inner');
    const titleElement = document.getElementById('artwork-title');
    const storyElement = document.getElementById('artwork-story');
    const metaElement = document.getElementById('artwork-meta');
    const adminLink = document.getElementById('artwork-admin-link');
    const currentElement = document.getElementById('artwork-current');
    const totalElement = document.getElementById('artwork-total');
    const indexElement = document.querySelector('.exhibition-index');
    const menuToggle = document.querySelector('[data-menu-toggle]');
    const navLinks = document.querySelector('[data-nav-links]');

    const isAdmin = Boolean(state.profile?.is_admin);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const stackedLayout = window.matchMedia(
        '(max-width: 820px), (max-width: 960px) and (max-height: 520px)'
    );
    const rotations = [-1.35, .8, -0.55, 1.2, -0.85, .45, -1.05, .68];

    body.classList.add('home-auth-resolved');
    body.classList.toggle('home-cart-visible', Boolean(state.user && !isAdmin));

    if (state.user) {
        sb.auth?.onAuthStateChange?.((event) => {
            if (event !== 'SIGNED_OUT') return;
            body.classList.remove('home-cart-visible');
            window.location.replace('index.html');
        });
    }

    let storyScrollFrame = 0;

    function updateStoryScrollability() {
        storyScrollFrame = 0;
        const needsOwnScroll = !stackedLayout.matches
            && storyElement.scrollHeight > storyElement.clientHeight + 2;
        storyElement.tabIndex = needsOwnScroll ? 0 : -1;
    }

    function scheduleStoryScrollability() {
        if (storyScrollFrame) cancelAnimationFrame(storyScrollFrame);
        storyScrollFrame = requestAnimationFrame(updateStoryScrollability);
    }

    function closeMobileMenu(restoreFocus = false) {
        if (!menuToggle || !navLinks) return;
        navLinks.classList.remove('open');
        navLinks.querySelector('[data-account-menu]')?.classList.remove('open');
        navLinks.querySelector('[data-account-trigger]')?.setAttribute('aria-expanded', 'false');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.setAttribute('aria-label', 'Open menu');
        body.classList.remove('home-menu-open');
        if (restoreFocus) menuToggle.focus();
    }

    function syncMobileMenu() {
        if (!menuToggle || !navLinks) return;
        const open = navLinks.classList.contains('open');
        if (!open) {
            navLinks.querySelector('[data-account-menu]')?.classList.remove('open');
            navLinks.querySelector('[data-account-trigger]')?.setAttribute('aria-expanded', 'false');
        }
        menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        body.classList.toggle('home-menu-open', open && stackedLayout.matches);
    }

    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', syncMobileMenu);
        navLinks.addEventListener('click', (event) => {
            if (event.target.closest('a')) closeMobileMenu();
        });
        document.addEventListener('click', () => {
            const accountMenu = navLinks.querySelector('[data-account-menu]');
            const accountTrigger = navLinks.querySelector('[data-account-trigger]');
            if (accountMenu && accountTrigger) {
                accountTrigger.setAttribute('aria-expanded', String(accountMenu.classList.contains('open')));
            }
        });
        document.addEventListener('keydown', (event) => {
            const accountMenu = navLinks.querySelector('[data-account-menu].open');
            if (event.key === 'Escape' && accountMenu) {
                const accountTrigger = navLinks.querySelector('[data-account-trigger]');
                event.preventDefault();
                accountMenu.classList.remove('open');
                accountTrigger?.setAttribute('aria-expanded', 'false');
                accountTrigger?.focus();
                return;
            }

            if (!navLinks.classList.contains('open') || !stackedLayout.matches) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                closeMobileMenu(true);
                return;
            }

            if (event.key !== 'Tab') return;
            const focusable = [menuToggle, ...navLinks.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
                .filter((element) => !element.hidden && element.getClientRects().length);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            } else if (!focusable.includes(document.activeElement)) {
                event.preventDefault();
                first.focus();
            }
        });
        stackedLayout.addEventListener?.('change', (event) => {
            if (!event.matches) closeMobileMenu();
            scheduleStoryScrollability();
        });
    }

    function setIntroCopy(title, story) {
        titleElement.textContent = title;
        storyElement.replaceChildren();
        const paragraph = document.createElement('p');
        paragraph.textContent = story;
        storyElement.appendChild(paragraph);
        metaElement.replaceChildren();
        adminLink.hidden = true;
        currentElement.textContent = '—';
        totalElement.textContent = '—';
        indexElement.hidden = false;
        scheduleStoryScrollability();
    }

    function makeMessage({ kicker, title, copy, actions = [] }) {
        stage.classList.add('is-static');
        stage.removeAttribute('aria-roledescription');
        stage.tabIndex = -1;
        controls.hidden = true;
        gestureHint.hidden = true;
        track.replaceChildren();

        const message = document.createElement('div');
        message.className = 'exhibition-message';

        const kickerElement = document.createElement('p');
        kickerElement.className = 'exhibition-kicker';
        kickerElement.textContent = kicker;

        const heading = document.createElement('h3');
        heading.textContent = title;

        const copyElement = document.createElement('p');
        copyElement.textContent = copy;

        message.append(kickerElement, heading, copyElement);

        if (actions.length) {
            const actionWrap = document.createElement('div');
            actionWrap.className = 'exhibition-message-actions';
            actions.forEach((action) => {
                const element = action.href ? document.createElement('a') : document.createElement('button');
                element.textContent = action.label;
                if (action.href) element.href = action.href;
                if (action.onClick) {
                    element.type = 'button';
                    element.addEventListener('click', action.onClick);
                }
                actionWrap.appendChild(element);
            });
            message.appendChild(actionWrap);
        }

        track.appendChild(message);
    }

    if (!state.user) {
        setIntroCopy(
            'The private collection',
            'Original paintings are shared inside the members’ studio. Sign in to move through the exhibition one work at a time.'
        );
        makeMessage({
            kicker: 'Members’ exhibition',
            title: 'Come inside the studio.',
            copy: 'Sign in or create an account to see the paintings, their stories, and available work.',
            actions: [
                { label: 'Sign in', href: app.loginUrl('index.html') },
                { label: 'Create account', href: app.loginUrl('index.html', 'register') },
            ],
        });
        return;
    }

    const { data: paintings, error } = await sb
        .from('paintings')
        .select('id, title, storage_path, caption, description, medium, dimensions, created_at')
        .eq('published', true)
        .order('created_at', { ascending: false });

    if (error) {
        setIntroCopy(
            'The archive is resting',
            'The paintings could not be opened just now. Your account and the rest of the studio are unchanged.'
        );
        makeMessage({
            kicker: 'Connection interrupted',
            title: 'The exhibition could not open.',
            copy: 'Try again in a moment. If the problem continues, the studio may be temporarily unavailable.',
            actions: [{ label: 'Try again', onClick: () => window.location.reload() }],
        });
        return;
    }

    if (!paintings?.length) {
        setIntroCopy(
            'The first work is coming',
            'No paintings have been published to the exhibition yet.'
        );
        makeMessage({
            kicker: 'Studio archive',
            title: 'A quiet room, for now.',
            copy: isAdmin
                ? 'Publish a painting from Admin Studio and it will appear here automatically.'
                : 'New work will appear here as soon as it is ready to be shared.',
            actions: isAdmin ? [{ label: 'Open Admin Studio', href: 'admin.html#artwork' }] : [],
        });
        return;
    }

    let activeIndex = 0;
    let isTransitioning = false;
    let queuedIndex = null;
    let transitionTimer = 0;
    let pointerState = null;
    let suppressArtworkClick = false;
    let parallaxFrame = 0;
    let pendingPointer = null;
    const cards = [];
    const urlCache = new Map();
    const imageRetries = new Map();
    const imageRequestVersions = new Map();
    let imageRequestSerial = 0;
    const urlLifetime = 12 * 60 * 1000;

    track.replaceChildren();

    function createSketch() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('artwork-sketch');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');

        const paths = [
            'M 4 6 C 18 2, 33 4, 49 2 C 66 1, 84 3, 96 7 C 98 22, 96 39, 98 56 C 99 73, 97 89, 93 96 C 76 99, 58 96, 40 98 C 23 99, 8 97, 3 92 C 1 76, 4 59, 2 42 C 1 27, 2 13, 4 6 Z',
            'M 3 5 C 21 1, 37 5, 53 3 C 70 1, 87 4, 95 8 C 97 25, 95 43, 98 61 C 99 78, 96 92, 91 97 C 73 98, 56 95, 37 97 C 20 98, 7 95, 4 90 C 2 72, 5 55, 3 39 C 1 23, 1 11, 3 5 Z',
        ];

        paths.forEach((data) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', data);
            svg.appendChild(path);
        });
        return svg;
    }

    function makeCard(painting, index) {
        const article = document.createElement('article');
        article.className = 'artwork-item is-far-after';
        article.dataset.index = String(index);
        article.setAttribute('aria-hidden', 'true');

        const link = document.createElement('a');
        link.className = 'artwork-link';
        link.href = `painting.html?id=${encodeURIComponent(painting.id)}`;
        link.tabIndex = -1;
        link.draggable = false;
        link.setAttribute('aria-label', `View ${painting.title} details`);

        const motion = document.createElement('span');
        motion.className = 'artwork-motion';
        motion.style.setProperty('--art-rotation', `${rotations[index % rotations.length]}deg`);

        const frame = document.createElement('span');
        frame.className = 'artwork-frame';

        const image = document.createElement('img');
        image.className = 'artwork-image';
        image.alt = '';
        image.decoding = 'async';
        image.loading = 'lazy';
        image.draggable = false;

        frame.append(image, createSketch());
        motion.appendChild(frame);
        link.appendChild(motion);
        article.appendChild(link);

        return { article, link, motion, frame, image, painting };
    }

    paintings.forEach((painting, index) => {
        const card = makeCard(painting, index);
        cards.push(card);
        track.appendChild(card.article);
    });

    function padIndex(value) {
        const digits = Math.max(2, String(paintings.length).length);
        return String(value).padStart(digits, '0');
    }

    function addMetaRow(label, value) {
        if (!value) return;
        const row = document.createElement('div');
        row.className = 'exhibition-meta-row';
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = label;
        description.textContent = value;
        row.append(term, description);
        metaElement.appendChild(row);
    }

    function paintingYear(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : String(date.getFullYear());
    }

    function updateInfo(index, announce = false) {
        const painting = paintings[index];
        const story = painting.description?.trim()
            || painting.caption?.trim()
            || 'No story has been added for this work yet.';

        titleElement.textContent = painting.title;
        storyElement.replaceChildren();
        const paragraph = document.createElement('p');
        paragraph.textContent = story;
        storyElement.appendChild(paragraph);

        metaElement.replaceChildren();
        addMetaRow('Medium', painting.medium);
        addMetaRow('Dimensions', painting.dimensions);
        addMetaRow('Added', paintingYear(painting.created_at));

        adminLink.hidden = !isAdmin;
        if (isAdmin) {
            adminLink.href = `admin.html?edit=painting&id=${encodeURIComponent(painting.id)}#manage`;
        }

        currentElement.textContent = padIndex(index + 1);
        totalElement.textContent = padIndex(paintings.length);
        storyElement.scrollTop = 0;
        scheduleStoryScrollability();

        if (announce) {
            liveStatus.textContent = `Artwork ${index + 1} of ${paintings.length}: ${painting.title}`;
        }
    }

    function updateControls() {
        previousButton.setAttribute('aria-disabled', String(activeIndex === 0));
        nextButton.setAttribute('aria-disabled', String(activeIndex === paintings.length - 1));
    }

    function layoutCards() {
        const focusedArtwork = document.activeElement?.closest?.('.artwork-link');
        cards.forEach((card, index) => {
            const difference = index - activeIndex;
            card.article.classList.remove(
                'is-far-before',
                'is-before',
                'is-active',
                'is-after',
                'is-far-after'
            );

            let position = 'is-far-after';
            if (difference < -1) position = 'is-far-before';
            if (difference === -1) position = 'is-before';
            if (difference === 0) position = 'is-active';
            if (difference === 1) position = 'is-after';
            card.article.classList.add(position);

            const isActive = difference === 0;
            card.article.setAttribute('aria-hidden', String(!isActive));
            card.link.tabIndex = isActive ? 0 : -1;
            card.image.alt = isActive ? card.painting.title : '';
            card.image.loading = isActive ? 'eager' : 'lazy';
            card.image.fetchPriority = isActive ? 'high' : 'low';
        });
        updateControls();
        const activeLink = cards[activeIndex]?.link;
        if (focusedArtwork && activeLink && focusedArtwork !== activeLink) {
            activeLink.focus({ preventScroll: true });
        }
    }

    function pruneDistantImages(centerIndex) {
        cards.forEach((card, index) => {
            const distance = Math.abs(index - centerIndex);
            if (distance > 2 && card.image.hasAttribute('src')) {
                card.image.onload = null;
                card.image.onerror = null;
                card.image.removeAttribute('src');
                delete card.image.dataset.signedUrl;
                card.frame.classList.remove('is-loading', 'is-loaded', 'is-broken');
                card.frame.style.removeProperty('aspect-ratio');
                imageRetries.delete(index);
            }
            if (distance > 4) urlCache.delete(card.painting.storage_path);
        });
    }

    function markImageBroken(index) {
        const card = cards[index];
        if (!card) return;
        card.frame.classList.remove('is-loading', 'is-loaded');
        card.frame.classList.add('is-broken');
    }

    function assignImage(index, url, force = false) {
        const card = cards[index];
        if (!card || !url) {
            markImageBroken(index);
            return;
        }
        if (!force && card.image.dataset.signedUrl === url && card.frame.classList.contains('is-loaded')) return;

        card.frame.classList.remove('is-loaded', 'is-broken');
        card.frame.classList.add('is-loading');
        card.image.dataset.signedUrl = url;

        card.image.onload = () => {
            if (card.image.dataset.signedUrl !== url) return;
            card.frame.classList.remove('is-loading', 'is-broken');
            card.frame.classList.add('is-loaded');
            if (card.image.naturalWidth && card.image.naturalHeight) {
                card.frame.style.aspectRatio = `${card.image.naturalWidth} / ${card.image.naturalHeight}`;
            }
            imageRetries.delete(index);
        };

        card.image.onerror = async () => {
            if (card.image.dataset.signedUrl !== url) return;
            const retries = imageRetries.get(index) || 0;
            if (retries < 1) {
                imageRetries.set(index, retries + 1);
                urlCache.delete(card.painting.storage_path);
                try {
                    await prepareImages([index], true);
                    return;
                } catch {
                    // The permanent fallback below keeps the layout stable.
                }
            }
            markImageBroken(index);
        };

        card.image.src = url;
    }

    async function prepareImages(indexes, force = false) {
        const uniqueIndexes = [...new Set(indexes)]
            .filter((index) => (
                index >= 0
                && index < paintings.length
                && Math.abs(index - activeIndex) <= 2
            ));
        const requestId = ++imageRequestSerial;
        uniqueIndexes.forEach((index) => imageRequestVersions.set(index, requestId));
        const now = Date.now();
        const pathsToSign = [];

        uniqueIndexes.forEach((index) => {
            const path = paintings[index].storage_path;
            const cached = urlCache.get(path);
            if (force || !cached || cached.expiresAt <= now) pathsToSign.push(path);
            const card = cards[index];
            if (card && !card.frame.classList.contains('is-loaded')) {
                card.frame.classList.add('is-loading');
            }
        });

        if (pathsToSign.length) {
            let freshUrls;
            try {
                freshUrls = await signedUrls('artworks', pathsToSign);
            } catch {
                uniqueIndexes.forEach((index) => {
                    if (
                        imageRequestVersions.get(index) === requestId
                        && Math.abs(index - activeIndex) <= 2
                    ) {
                        markImageBroken(index);
                    }
                });
                return;
            }
            pathsToSign.forEach((path) => {
                const url = freshUrls.get(path);
                if (url) urlCache.set(path, { url, expiresAt: Date.now() + urlLifetime });
            });
        }

        uniqueIndexes.forEach((index) => {
            if (
                imageRequestVersions.get(index) !== requestId
                || Math.abs(index - activeIndex) > 2
            ) return;
            const cached = urlCache.get(paintings[index].storage_path);
            if (cached?.url) assignImage(index, cached.url, force);
            else markImageBroken(index);
        });
    }

    function nearbyIndexes(index, radius = 1) {
        const indexes = [];
        for (let offset = -radius; offset <= radius; offset += 1) indexes.push(index + offset);
        return indexes;
    }

    function resetParallax() {
        if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
        parallaxFrame = 0;
        pendingPointer = null;
        cards.forEach((card) => {
            card.motion.style.setProperty('--pointer-x', '0px');
            card.motion.style.setProperty('--pointer-y', '0px');
            card.motion.style.setProperty('--pointer-rotate', '0deg');
        });
    }

    function completeTransition() {
        isTransitioning = false;
        if (queuedIndex === null) return;
        const targetIndex = queuedIndex;
        queuedIndex = null;
        goTo(targetIndex, 'queued');
    }

    function cancelPointerInteraction() {
        if (!pointerState) return;
        const cancelledPointer = pointerState;
        pointerState = null;
        if (stage.hasPointerCapture?.(cancelledPointer.id)) {
            stage.releasePointerCapture(cancelledPointer.id);
        }
        stage.classList.remove('is-dragging');
        cards[cancelledPointer.cardIndex]?.article.style.setProperty('--drag-x', '0px');
        if (cancelledPointer.dragging) {
            window.setTimeout(() => { suppressArtworkClick = false; }, 80);
        }
    }

    function goTo(requestedIndex, source = 'control') {
        const nextIndex = Math.max(0, Math.min(paintings.length - 1, requestedIndex));
        if (source !== 'swipe') cancelPointerInteraction();
        if (nextIndex === activeIndex) {
            if (isTransitioning) queuedIndex = null;
            return;
        }

        if (isTransitioning) {
            queuedIndex = nextIndex;
            return;
        }

        isTransitioning = true;
        stage.classList.add('has-interacted');
        resetParallax();
        infoInner.classList.add('is-changing');
        activeIndex = nextIndex;
        layoutCards();
        pruneDistantImages(activeIndex);
        prepareImages(nearbyIndexes(activeIndex, 1)).catch(() => {});

        const textDelay = reducedMotion ? 0 : 165;
        window.setTimeout(() => {
            updateInfo(activeIndex, source !== 'initial');
            requestAnimationFrame(() => infoInner.classList.remove('is-changing'));
        }, textDelay);

        window.clearTimeout(transitionTimer);
        transitionTimer = window.setTimeout(completeTransition, reducedMotion ? 0 : 940);

        window.setTimeout(() => {
            prepareImages(nearbyIndexes(activeIndex, 2)).catch(() => {});
        }, reducedMotion ? 0 : 980);
    }

    controls.hidden = paintings.length < 2;
    gestureHint.hidden = paintings.length < 2;
    stage.classList.toggle('is-single', paintings.length < 2);
    stage.tabIndex = paintings.length > 1 ? 0 : -1;
    gestureHint.textContent = coarsePointer.matches
        ? 'Swipe the artwork to explore'
        : 'Scroll, drag, or use arrow keys';

    layoutCards();
    updateInfo(0);
    prepareImages(nearbyIndexes(0, 1)).catch(() => {});
    window.setTimeout(() => prepareImages(nearbyIndexes(0, 2)).catch(() => {}), 900);

    previousButton.addEventListener('click', () => {
        if (previousButton.getAttribute('aria-disabled') !== 'true') {
            goTo(activeIndex - 1, 'button');
        }
    });
    nextButton.addEventListener('click', () => {
        if (nextButton.getAttribute('aria-disabled') !== 'true') {
            goTo(activeIndex + 1, 'button');
        }
    });

    stage.addEventListener('keydown', (event) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
        let nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = activeIndex + 1;
        if (event.key === 'ArrowLeft') nextIndex = activeIndex - 1;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = paintings.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        goTo(nextIndex, 'keyboard');
    });

    let wheelDistance = 0;
    let wheelArmed = true;
    let wheelResetTimer = 0;

    window.addEventListener('wheel', (event) => {
        if (paintings.length < 2 || event.ctrlKey) return;
        if (
            navLinks?.classList.contains('open')
            || navLinks?.querySelector('[data-account-menu].open')
        ) return;

        const horizontalGesture = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        if (stackedLayout.matches && !horizontalGesture) return;
        const rawDelta = horizontalGesture ? event.deltaX : event.deltaY;
        const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
        const delta = rawDelta * multiplier;
        if (Math.abs(delta) < .5) return;

        const story = event.target.closest?.('.exhibition-story');
        if (story && !horizontalGesture) {
            const canScrollBack = delta < 0 && story.scrollTop > 1;
            const canScrollForward = delta > 0
                && story.scrollTop + story.clientHeight < story.scrollHeight - 1;
            if (canScrollBack || canScrollForward) return;
        }

        event.preventDefault();
        window.clearTimeout(wheelResetTimer);
        wheelResetTimer = window.setTimeout(() => {
            wheelDistance = 0;
            wheelArmed = true;
        }, 165);

        if (!wheelArmed) return;
        wheelDistance += delta;
        if (Math.abs(wheelDistance) < 58) return;

        wheelArmed = false;
        goTo(activeIndex + (wheelDistance > 0 ? 1 : -1), 'wheel');
        wheelDistance = 0;
    }, { passive: false });

    function applyParallax(event) {
        if (!finePointer.matches || reducedMotion || pointerState) return;
        pendingPointer = event;
        if (parallaxFrame) return;
        parallaxFrame = requestAnimationFrame(() => {
            parallaxFrame = 0;
            const card = cards[activeIndex];
            if (!card || !pendingPointer) return;
            const rect = stage.getBoundingClientRect();
            const x = ((pendingPointer.clientX - rect.left) / rect.width - .5) * 2;
            const y = ((pendingPointer.clientY - rect.top) / rect.height - .5) * 2;
            card.motion.style.setProperty('--pointer-x', `${(x * 5).toFixed(2)}px`);
            card.motion.style.setProperty('--pointer-y', `${(y * 4).toFixed(2)}px`);
            card.motion.style.setProperty('--pointer-rotate', `${(x * .34).toFixed(3)}deg`);
        });
    }

    stage.addEventListener('pointerdown', (event) => {
        if (paintings.length < 2 || event.button !== 0 || event.target.closest('.artwork-control')) return;
        pointerState = {
            id: event.pointerId,
            cardIndex: activeIndex,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastTime: performance.now(),
            velocityX: 0,
            dragging: false,
        };
    });

    stage.addEventListener('pointermove', (event) => {
        if (!pointerState || pointerState.id !== event.pointerId) {
            applyParallax(event);
            return;
        }
        if (!(event.buttons & 1)) {
            releasePointer(event, true);
            applyParallax(event);
            return;
        }

        const deltaX = event.clientX - pointerState.startX;
        const deltaY = event.clientY - pointerState.startY;
        if (!pointerState.dragging && Math.abs(deltaX) > 9 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
            pointerState.dragging = true;
            suppressArtworkClick = true;
            stage.setPointerCapture?.(event.pointerId);
            stage.classList.add('is-dragging', 'has-interacted');
            resetParallax();
        }

        if (!pointerState.dragging) return;
        event.preventDefault();
        const now = performance.now();
        const elapsed = Math.max(1, now - pointerState.lastTime);
        pointerState.velocityX = (event.clientX - pointerState.lastX) / elapsed;
        pointerState.lastX = event.clientX;
        pointerState.lastTime = now;
        const dragDistance = Math.max(-96, Math.min(96, deltaX * .36));
        cards[pointerState.cardIndex].article.style.setProperty('--drag-x', `${dragDistance}px`);
    });

    function releasePointer(event, cancelled = false) {
        if (!pointerState || pointerState.id !== event.pointerId) return;
        const stateAtRelease = pointerState;
        pointerState = null;
        if (stage.hasPointerCapture?.(event.pointerId)) {
            stage.releasePointerCapture(event.pointerId);
        }
        stage.classList.remove('is-dragging');
        cards[stateAtRelease.cardIndex].article.style.setProperty('--drag-x', '0px');

        if (stateAtRelease.dragging && !cancelled && stateAtRelease.cardIndex === activeIndex) {
            const distance = event.clientX - stateAtRelease.startX;
            if (Math.abs(distance) > 52 || Math.abs(stateAtRelease.velocityX) > .42) {
                goTo(activeIndex + (distance < 0 ? 1 : -1), 'swipe');
            }
        }

        if (stateAtRelease.dragging) {
            window.setTimeout(() => { suppressArtworkClick = false; }, 80);
        }
    }

    window.addEventListener('pointerup', (event) => releasePointer(event));
    window.addEventListener('pointercancel', (event) => releasePointer(event, true));
    stage.addEventListener('pointerleave', () => {
        if (!pointerState) resetParallax();
    });
    stage.addEventListener('click', (event) => {
        if (!suppressArtworkClick || !event.target.closest('.artwork-link')) return;
        event.preventDefault();
        event.stopPropagation();
    }, true);

    window.addEventListener('resize', () => {
        resetParallax();
        scheduleStoryScrollability();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) prepareImages(nearbyIndexes(activeIndex, 1)).catch(() => {});
    });
})();
