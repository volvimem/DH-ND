(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const android = navigator.userAgentData?.platform === 'Android' || /Android/i.test(navigator.userAgent);
    const touch = android || navigator.maxTouchPoints > 0 || matchMedia('(any-pointer: coarse)').matches;
    if (!touch) return;

    // Mantém o espaço para as barras do sistema e a margem já salva pelos atletas.
    if (android && document.getElementById('main-app-container')) {
        const mode = matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)');
        const embedded = /; wv\)/i.test(navigator.userAgent) || document.referrer.startsWith('android-app://');
        function fitApp() {
            const installed = mode.matches || embedded;
            let extra = false;
            try {
                const storage = installed ? localStorage : sessionStorage;
                extra = storage.getItem('dhnd-extra-system-bar-space') === '1';
            } catch (_) { /* As margens automáticas também funcionam sem armazenamento. */ }
            root.toggleAttribute('data-android-system-bars', installed || extra);
            root.toggleAttribute('data-extra-system-bars', extra);
            if ((installed || extra) && viewport?.height > 0 && Math.abs(viewport.scale - 1) < 0.01) {
                root.style.setProperty('--app-visible-height', viewport.height + 'px');
            } else {
                root.style.removeProperty('--app-visible-height');
            }
        }
        fitApp();
        mode.addEventListener?.('change', fitApp);
        window.addEventListener('pageshow', fitApp);
        window.addEventListener('resize', fitApp);
        viewport?.addEventListener('resize', fitApp);
    }

    const textTypes = new Set(['text', 'search', 'tel', 'url', 'email', 'password', 'number']);
    function acceptsTyping(el) {
        if (!(el instanceof HTMLElement) || el.inputMode === 'none') return false;
        if (el.isContentEditable) return true;
        if (el.disabled || el.readOnly) return false;
        return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && textTypes.has(el.type));
    }

    const keyboard = navigator.virtualKeyboard;
    const visibleHeight = () => Math.min(window.innerHeight, viewport?.height || window.innerHeight);
    let restingHeight = visibleHeight();
    let smallestHeight = restingHeight;
    let lastWidth = window.innerWidth;
    let keyboardOpened = false;

    function measureKeyboard() {
        const height = visibleHeight();
        const editing = acceptsTyping(document.activeElement);
        if (window.innerWidth !== lastWidth || !editing) {
            lastWidth = window.innerWidth;
            restingHeight = smallestHeight = height;
            keyboardOpened = false;
            if (!editing) root.removeAttribute('data-mobile-editing');
            return;
        }
        // Tanto a janela quanto a área visual podem encolher, conforme o navegador.
        smallestHeight = Math.min(smallestHeight, height);
        const lostHeight = restingHeight - height;
        if (keyboard?.boundingRect.height > 0 || lostHeight > 90) {
            root.setAttribute('data-mobile-editing', '');
            keyboardOpened = true;
        } else if ((keyboardOpened && lostHeight < 60) || (!keyboardOpened && height - smallestHeight > 90)) {
            // O botão Voltar do Android fecha o teclado sem tirar o foco do campo.
            root.removeAttribute('data-mobile-editing');
            keyboardOpened = false;
            restingHeight = smallestHeight = height;
        }
    }

    function startEditing(event) {
        if (acceptsTyping(event.target)) root.setAttribute('data-mobile-editing', '');
    }
    document.addEventListener('focusin', startEditing);
    document.addEventListener('pointerdown', startEditing);
    document.addEventListener('focusout', () => requestAnimationFrame(measureKeyboard));
    window.addEventListener('resize', measureKeyboard);
    viewport?.addEventListener('resize', measureKeyboard);
    keyboard?.addEventListener('geometrychange', measureKeyboard);
    window.addEventListener('pageshow', measureKeyboard);
    if (acceptsTyping(document.activeElement)) root.setAttribute('data-mobile-editing', '');
})();
