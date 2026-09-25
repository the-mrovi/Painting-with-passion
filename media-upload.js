(function () {
    const instances = new WeakMap();
    const activeInstances = new Set();

    function acceptsFile(input, file) {
        const accepted = (input.accept || '').split(',').map((value) => value.trim()).filter(Boolean);
        if (!accepted.length) return true;
        return accepted.some((value) => {
            if (value.endsWith('/*')) return file.type.startsWith(value.slice(0, -1));
            if (value.startsWith('.')) return file.name.toLowerCase().endsWith(value.toLowerCase());
            return file.type === value;
        });
    }

    class MediaUpload {
        constructor(root) {
            this.root = root;
            this.input = root.querySelector('input[type="file"]');
            this.dropzone = root.querySelector('[data-media-dropzone]');
            this.emptyState = root.querySelector('[data-media-empty]');
            this.selectButton = root.querySelector('[data-media-select]');
            this.previewState = root.querySelector('[data-media-preview]');
            this.previewSlot = root.querySelector('[data-media-preview-slot]');
            this.fileName = root.querySelector('[data-media-file-name]');
            this.changeButton = root.querySelector('[data-media-change]');
            this.removeButton = root.querySelector('[data-media-remove]');
            this.file = null;
            this.objectUrl = '';
            this.form = root.closest('form');

            if (!this.input || !this.dropzone || !this.previewSlot) return;

            this.onInputChange = () => this.setFile(this.input.files?.[0] || null);
            this.onSelectClick = () => this.input.click();
            this.onDragOver = (event) => {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
                this.root.classList.add('is-dragging');
            };
            this.onDragLeave = (event) => {
                if (!this.root.contains(event.relatedTarget)) this.root.classList.remove('is-dragging');
            };
            this.onDrop = (event) => {
                event.preventDefault();
                this.root.classList.remove('is-dragging');
                const file = event.dataTransfer?.files?.[0] || null;
                if (file) this.setFile(file);
            };
            this.onChangeClick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.input.click();
            };
            this.onRemoveClick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.clear();
                this.input.focus();
            };
            this.onFormReset = () => window.setTimeout(() => this.clear(false), 0);

            this.input.addEventListener('change', this.onInputChange);
            this.selectButton?.addEventListener('click', this.onSelectClick);
            this.dropzone.addEventListener('dragenter', this.onDragOver);
            this.dropzone.addEventListener('dragover', this.onDragOver);
            this.dropzone.addEventListener('dragleave', this.onDragLeave);
            this.dropzone.addEventListener('drop', this.onDrop);
            this.changeButton?.addEventListener('click', this.onChangeClick);
            this.removeButton?.addEventListener('click', this.onRemoveClick);
            this.form?.addEventListener('reset', this.onFormReset);
        }

        setFile(file) {
            if (!file) {
                this.clear();
                return;
            }
            if (!acceptsFile(this.input, file)) {
                this.root.dispatchEvent(new CustomEvent('mediauploaderror', {
                    bubbles: true,
                    detail: { message: 'This file type is not supported.' },
                }));
                return;
            }

            this.revokePreview();
            this.file = file;
            if (this.input.files?.[0] !== file && typeof DataTransfer === 'function') {
                const transfer = new DataTransfer();
                transfer.items.add(file);
                this.input.files = transfer.files;
            }
            this.objectUrl = URL.createObjectURL(file);
            this.previewSlot.replaceChildren();

            const preview = file.type.startsWith('video/')
                ? document.createElement('video')
                : document.createElement('img');
            preview.src = this.objectUrl;
            preview.className = 'media-upload-preview-media';
            if (preview instanceof HTMLVideoElement) {
                preview.controls = true;
                preview.muted = true;
                preview.playsInline = true;
                preview.preload = 'metadata';
                preview.setAttribute('aria-label', `Preview of ${file.name}`);
            } else {
                preview.alt = `Preview of ${file.name}`;
                preview.decoding = 'async';
            }
            this.previewSlot.appendChild(preview);
            if (this.fileName) this.fileName.textContent = file.name;
            this.emptyState?.setAttribute('hidden', '');
            this.previewState?.removeAttribute('hidden');
            this.root.classList.add('has-file');
            this.root.dispatchEvent(new CustomEvent('mediachange', { bubbles: true, detail: { file } }));
        }

        clear(resetInput = true) {
            this.previewSlot?.querySelector('video')?.pause();
            this.revokePreview();
            this.file = null;
            if (resetInput && this.input) this.input.value = '';
            this.previewSlot?.replaceChildren();
            if (this.fileName) this.fileName.textContent = '';
            this.previewState?.setAttribute('hidden', '');
            this.emptyState?.removeAttribute('hidden');
            this.root.classList.remove('has-file', 'is-dragging');
            this.root.dispatchEvent(new CustomEvent('mediachange', { bubbles: true, detail: { file: null } }));
        }

        revokePreview() {
            if (!this.objectUrl) return;
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = '';
        }

        destroy() {
            this.revokePreview();
            this.input?.removeEventListener('change', this.onInputChange);
            this.selectButton?.removeEventListener('click', this.onSelectClick);
            this.dropzone?.removeEventListener('dragenter', this.onDragOver);
            this.dropzone?.removeEventListener('dragover', this.onDragOver);
            this.dropzone?.removeEventListener('dragleave', this.onDragLeave);
            this.dropzone?.removeEventListener('drop', this.onDrop);
            this.changeButton?.removeEventListener('click', this.onChangeClick);
            this.removeButton?.removeEventListener('click', this.onRemoveClick);
            this.form?.removeEventListener('reset', this.onFormReset);
            activeInstances.delete(this);
        }
    }

    function init(root) {
        if (!root) return null;
        if (instances.has(root)) return instances.get(root);
        const instance = new MediaUpload(root);
        instances.set(root, instance);
        activeInstances.add(instance);
        return instance;
    }

    function initAll(scope = document) {
        return [...scope.querySelectorAll('[data-media-upload]')].map(init);
    }

    function get(target) {
        const root = target?.matches?.('[data-media-upload]')
            ? target
            : target?.closest?.('[data-media-upload]');
        return root ? instances.get(root) || init(root) : null;
    }

    window.PaintingMediaUpload = { init, initAll, get };
    document.addEventListener('mediauploaderror', (event) => {
        window.PaintingApp?.showToast?.(event.detail?.message || 'That media file cannot be used.', 'error');
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initAll(), { once: true });
    else initAll();
    window.addEventListener('pagehide', () => activeInstances.forEach((instance) => instance.destroy()), { once: true });
})();
