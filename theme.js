(function () {
    const storageKey = 'painting-with-passion-theme';
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function storedTheme() {
        try {
            const value = localStorage.getItem(storageKey);
            return value === 'light' || value === 'dark' ? value : null;
        } catch {
            return null;
        }
    }

    function preferredTheme() {
        return storedTheme() || (media.matches ? 'dark' : 'light');
    }

    function updateButtons(theme) {
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.textContent = theme === 'dark' ? 'Light' : 'Dark';
            button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
            button.setAttribute('aria-pressed', String(theme === 'dark'));
        });
        document.querySelectorAll('[data-theme-choice]').forEach((button) => {
            button.classList.toggle('active', button.dataset.themeChoice === theme);
            button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
        });
    }

    function apply(theme, persist = false) {
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
        if (persist) {
            try { localStorage.setItem(storageKey, theme); } catch { /* storage can be unavailable */ }
        }
        updateButtons(theme);
        window.dispatchEvent(new CustomEvent('painting-theme-change', { detail: { theme } }));
    }

    apply(preferredTheme());

    document.addEventListener('DOMContentLoaded', () => {
        updateButtons(root.dataset.theme);
        document.addEventListener('click', (event) => {
            const toggle = event.target.closest('[data-theme-toggle]');
            if (toggle) {
                apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
                return;
            }
            const choice = event.target.closest('[data-theme-choice]');
            if (choice) apply(choice.dataset.themeChoice, true);
        });
    });

    media.addEventListener('change', (event) => {
        if (!storedTheme()) apply(event.matches ? 'dark' : 'light');
    });

    window.PaintingTheme = { apply, current: () => root.dataset.theme };
})();
