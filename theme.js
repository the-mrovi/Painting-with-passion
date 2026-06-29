(function () {
    const storageKey = 'painting-with-passion-theme';
    const root = document.documentElement;

    function getSystemTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }

    function getStoredTheme() {
        try {
            return localStorage.getItem(storageKey);
        } catch (error) {
            return null;
        }
    }

    function storeTheme(theme) {
        try {
            localStorage.setItem(storageKey, theme);
        } catch (error) {
            return;
        }
    }

    function updateToggleLabels(theme) {
        const label = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.textContent = label;
            button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
        });
    }

    function applyTheme(theme, persist) {
        root.setAttribute('data-theme', theme);
        root.style.colorScheme = theme;
        updateToggleLabels(theme);

        if (persist) {
            storeTheme(theme);
        }
    }

    function createToggleButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theme-toggle';
        button.setAttribute('data-theme-toggle', 'true');
        button.setAttribute('aria-label', 'Toggle color theme');
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            const nextTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            applyTheme(nextTheme, true);
        });
        return button;
    }

    function attachToggle(container) {
        if (!container || container.querySelector('[data-theme-toggle]')) {
            return;
        }

        const button = createToggleButton();
        const navLinks = container.querySelector('.nav-links');
        const navMenu = container.querySelector('.nav-menu');
        const menuToggle = container.querySelector('.menu-toggle');

        if (navLinks) {
            container.insertBefore(button, navLinks);
            return;
        }

        if (navMenu) {
            container.insertBefore(button, navMenu);
            return;
        }

        if (menuToggle) {
            container.insertBefore(button, menuToggle.nextSibling);
            return;
        }

        container.appendChild(button);
    }

    function init() {
        const preferredTheme = getStoredTheme() || getSystemTheme();
        applyTheme(preferredTheme, false);

        document.querySelectorAll('.navbar').forEach(attachToggle);
        document.querySelectorAll('.sidebar').forEach(attachToggle);
        document.querySelectorAll('.story-info').forEach(attachToggle);

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
            if (!getStoredTheme()) {
                applyTheme(event.matches ? 'dark' : 'light', false);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();