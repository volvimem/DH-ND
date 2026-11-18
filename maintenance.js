(function (global) {
    'use strict';
    const ROOT = '/dhnd_maintenance';
    const DEFAULT_MESSAGE = 'Estamos atualizando o sistema. Tente novamente em instantes.';
    const CHECKING = 'Verificando disponibilidade e acesso…';
    const UNAVAILABLE = 'Não foi possível verificar o acesso. Confira sua conexão e tente novamente.';
    const cleanCPF = value => String(value || '').replace(/\D/g, '');
    const failure = (code, message) => Object.assign(new Error(message), {code});

    function create(options) {
        const {database, auth} = options;
        const baseURL = String(options.databaseURL || '').replace(/\/+$/, '');
        if (!database || !auth || !baseURL) throw new Error('Configuração de manutenção incompleta.');
        const identity = typeof options.identity === 'function' ? options.identity : () => null;
        const state = {ready:false, enabled:false, allowed:false, admin:false, loginRequested:false, message:CHECKING};
        let authReady = false, sdkConnected = false, epoch = 0, scheduled = null, lastIdentity = '', verifiedIdentity = '', publicHint;
        let pendingSave = null, errorVisible = false;
        const signals = new Map(), inertBefore = new Map();
        let gate, title, message, loginButton, logoutButton;

        function capture() {
            const user = auth.currentUser;
            const profile = identity();
            const cpf = cleanCPF(profile && profile.cpf);
            const uid = user ? String(user.uid || '') : '';
            const email = user ? String(user.email || '').toLowerCase() : '';
            const profileUID = profile && profile.uid ? String(profile.uid) : '';
            return {user, uid, email, cpf, profileUID,
                key:JSON.stringify([uid, email, cpf, profileUID]),
                matches:!!uid && /^\d{11}$/.test(cpf) && email === cpf + '@dhpe.com.br' && (!profileUID || profileUID === uid)};
        }
        function current(actor, version) {
            if (capture().key !== actor.key || (version !== undefined && version !== epoch)) {
                throw failure('maintenance/stale', 'A sessão mudou durante a verificação.');
            }
        }
        function bounded(promise, milliseconds, code, text) {
            return new Promise((resolve, reject) => {
                const timer = global.setTimeout(() => reject(failure(code, text)), milliseconds);
                Promise.resolve(promise).then(value => { global.clearTimeout(timer); resolve(value); }, error => { global.clearTimeout(timer); reject(error); });
            });
        }
        async function read(path, actor, version, denialIsFalse) {
            if (global.navigator && global.navigator.onLine === false) throw failure('maintenance/offline', UNAVAILABLE);
            let token;
            if (actor) {
                if (!actor.user || !actor.uid) throw failure('maintenance/auth', 'Entre novamente para verificar seu acesso.');
                token = await bounded(actor.user.getIdToken(), 10000, 'maintenance/timeout', UNAVAILABLE);
                current(actor, version);
            }
            const url = baseURL + path + '.json' + (token ? '?auth=' + encodeURIComponent(token) : '');
            const operation = Promise.resolve().then(() => global.fetch(url, {method:'GET', cache:'no-store'})).then(async response => {
                if (denialIsFalse && (response.status === 401 || response.status === 403)) return false;
                if (!response.ok) throw failure('maintenance/read', UNAVAILABLE);
                return response.json();
            });
            let value;
            try {value = await bounded(operation, 12000, 'maintenance/timeout', UNAVAILABLE);}
            catch (error) {throw failure(error.code === 'maintenance/timeout' ? error.code : 'maintenance/read', UNAVAILABLE);}
            if (actor) current(actor, version);
            return value;
        }
        function publicPolicy(value) {
            if (value === null || value === false) return {enabled:false, message:DEFAULT_MESSAGE, updatedAt:null};
            if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean') {
                throw failure('maintenance/policy', 'A configuração de manutenção não pôde ser validada.');
            }
            return {enabled:value.enabled, message:typeof value.message === 'string' && value.message.trim() ? value.message : DEFAULT_MESSAGE,
                updatedAt:value.updatedAt === undefined ? null : value.updatedAt};
        }
        function rootPolicy(value) {
            if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) {
                throw failure('maintenance/policy', 'Configuração de manutenção inválida.');
            }
            const raw = value || {};
            const allowedCpfs = {};
            for (const [cpf, allowed] of Object.entries(raw.allowedCpfs || {})) {
                if (/^\d{11}$/.test(cpf) && allowed === true) allowedCpfs[cpf] = true;
            }
            return {public:publicPolicy(raw.public === undefined ? null : raw.public), allowedCpfs, adminAccess:raw.adminAccess === true};
        }
        function render() {
            const doc = global.document;
            if (!doc || !doc.body) return;
            if (!gate) {
                gate = doc.createElement('div'); gate.id = 'dhnd-maintenance-gate';
                gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-modal', 'true');
                gate.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0b1220;color:#fff;padding:28px;box-sizing:border-box;overflow:auto;align-items:center;justify-content:center;text-align:center;flex-direction:column;gap:18px;font-family:Arial,sans-serif;';
                if (gate.style.setProperty) gate.style.setProperty('visibility', 'visible', 'important');
                else gate.style.visibility = 'visible';
                title = doc.createElement('h1'); title.style.fontSize = '24px';
                message = doc.createElement('p'); message.style.maxWidth = '520px'; message.style.whiteSpace = 'pre-wrap';
                loginButton = doc.createElement('button'); loginButton.type = 'button'; loginButton.textContent = 'ENTRAR PARA TESTES';
                logoutButton = doc.createElement('button'); logoutButton.type = 'button'; logoutButton.textContent = 'TROCAR CONTA';
                const retry = doc.createElement('button'); retry.type = 'button'; retry.textContent = 'TENTAR NOVAMENTE';
                for (const button of [loginButton, logoutButton, retry]) button.style.cssText = 'padding:12px 20px;border-radius:8px;border:1px solid #94a3b8;cursor:pointer;font-weight:bold;';
                loginButton.addEventListener('click', beginLogin);
                logoutButton.addEventListener('click', () => { beginLogin(false); if (typeof options.onLogout === 'function') options.onLogout(); });
                retry.addEventListener('click', () => schedule(true));
                for (const child of [title, message, loginButton, logoutButton, retry]) gate.appendChild(child);
                doc.body.appendChild(gate);
            }
            const mode = state.allowed ? 'allowed' : (state.loginRequested ? 'login' : (state.ready || errorVisible ? 'blocked' : 'pending'));
            if (doc.documentElement) doc.documentElement.setAttribute('data-dhnd-maintenance', mode);
            const covered = mode === 'pending' || mode === 'blocked';
            gate.style.display = covered ? 'flex' : 'none';
            title.textContent = errorVisible ? 'ACESSO INDISPONÍVEL' : (state.enabled ? 'SISTEMA EM MANUTENÇÃO' : 'VERIFICANDO ACESSO');
            message.textContent = state.message;
            loginButton.style.display = state.ready && state.enabled ? '' : 'none';
            logoutButton.style.display = auth.currentUser || capture().cpf ? '' : 'none';
            for (const child of Array.from(doc.body.children || [])) {
                if (child === gate) continue;
                if (covered) {
                    if (!inertBefore.has(child)) inertBefore.set(child, !!child.inert);
                    child.inert = true;
                } else if (inertBefore.has(child)) {
                    child.inert = inertBefore.get(child); inertBefore.delete(child);
                }
            }
        }
        function publish(patch) {
            let changed = false;
            for (const [key, value] of Object.entries(patch)) if (state[key] !== value) {state[key] = value; changed = true;}
            render();
            if (changed && typeof options.onChange === 'function') options.onChange({...state});
        }
        function pending() {
            errorVisible = false;
            publish({ready:false, allowed:false, admin:false, message:CHECKING});
        }
        function signal(name, path, baseline) {
            const previous = signals.get(name);
            if (previous && previous.path === path) return;
            if (previous) previous.ref.off('value', previous.callback);
            signals.delete(name);
            if (!path) return;
            const ref = database.ref(path);
            let hint = JSON.stringify(baseline);
            const callback = snapshot => {
                const next = JSON.stringify(snapshot.val());
                if (hint === undefined) {hint = next; return;}
                if (next !== hint) {hint = next; schedule(true);}
            };
            signals.set(name, {path, ref, callback});
            try {ref.on('value', callback, () => schedule(true));} catch (_) {schedule(true);}
        }
        async function verify(version) {
            const actor = capture(); lastIdentity = actor.key;
            try {
                const raw = await read(ROOT + '/public');
                current(actor, version);
                const policy = publicPolicy(raw);
                publicHint = JSON.stringify(raw);
                if (!authReady) {publish({enabled:policy.enabled}); return;}
                if (!sdkConnected) {errorVisible = true; publish({ready:false, enabled:policy.enabled, allowed:false, admin:false, message:UNAVAILABLE}); return;}
                let admin = false, allowed = !policy.enabled, ownAllowed;
                if (actor.matches) {
                    try {admin = await read(ROOT + '/adminAccess', actor, version, true) === true;}
                    catch (error) {if (policy.enabled || error.code === 'maintenance/stale') throw error;}
                    if (policy.enabled) {
                        if (admin) allowed = true;
                        else {ownAllowed = await read(ROOT + '/allowedCpfs/' + actor.cpf, actor, version); allowed = ownAllowed === true;}
                    }
                }
                current(actor, version);
                signal('own', policy.enabled && actor.matches && !admin ? ROOT + '/allowedCpfs/' + actor.cpf : null, ownAllowed);
                signal('admin', admin ? ROOT + '/adminAccess' : null, true);
                current(actor, version);
                verifiedIdentity = actor.key;
                errorVisible = false;
                publish({ready:true, enabled:policy.enabled, allowed, admin, message:policy.message,
                    loginRequested:allowed ? false : state.loginRequested});
            } catch (error) {
                if (error.code === 'maintenance/stale') return;
                if (version !== epoch) return;
                errorVisible = true;
                publish({ready:false, allowed:false, admin:false, message:UNAVAILABLE});
            }
        }
        function schedule(invalidate) {
            if (capture().key !== lastIdentity) invalidate = true;
            if (invalidate) {epoch++; pending();}
            if (scheduled) return scheduled;
            scheduled = Promise.resolve().then(() => {
                scheduled = null;
                return verify(++epoch);
            });
            return scheduled;
        }
        function refreshIdentity() {
            return schedule(capture().key !== lastIdentity);
        }
        function beginLogin(callHandler = true) {
            epoch++;
            publish({allowed:false, admin:false, loginRequested:true});
            if (callHandler !== false && typeof options.onLogin === 'function') options.onLogin();
        }
        function guard() {
            if (!state.ready || !state.allowed) return false;
            if (state.enabled && capture().key !== verifiedIdentity) {schedule(true); return false;}
            return true;
        }
        async function getPolicy() {
            const actor = capture();
            const result = rootPolicy(await read(ROOT, actor));
            current(actor);
            return result;
        }
        async function savePolicy(policy) {
            const actor = capture();
            if (!actor.user || !actor.uid) throw failure('maintenance/auth', 'Entre novamente para salvar.');
            const publicInput = policy && (policy.public || policy);
            if (!publicInput || typeof publicInput.enabled !== 'boolean') throw failure('maintenance/policy', 'Informe se a manutenção está ativada.');
            const nextMessage = String(publicInput.message || DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE;
            if (nextMessage.length > 300) throw failure('maintenance/policy', 'A mensagem deve ter no máximo 300 caracteres.');
            const allowedCpfs = {};
            for (const [key, value] of Object.entries(policy.allowedCpfs || {})) {
                const cpf = cleanCPF(key);
                if (!/^\d{11}$/.test(cpf) || (value !== true && value !== false)) throw failure('maintenance/policy', 'Lista de atletas inválida.');
                if (value === true) allowedCpfs[cpf] = true;
            }
            const next = {public:{enabled:publicInput.enabled, message:nextMessage, updatedAt:Date.now()}, allowedCpfs, adminAccess:true};
            const signature = JSON.stringify({...next, public:{...next.public, updatedAt:null}});
            if (pendingSave && (pendingSave.uid !== actor.uid || pendingSave.signature !== signature)) throw failure('maintenance/pending', 'Uma configuração anterior ainda aguarda confirmação.');
            if (!pendingSave) {
                const write = {uid:actor.uid, signature, payload:next};
                write.promise = Promise.resolve().then(() => {current(actor); return database.ref(ROOT).set(next);});
                pendingSave = write;
                const release = () => {if (pendingSave === write) pendingSave = null;};
                write.promise.then(release, release);
            }
            const write = pendingSave;
            await bounded(write.promise, 20000, 'maintenance/save-timeout', 'O servidor ainda não confirmou a configuração.');
            current(actor);
            await schedule(false);
            return write.payload;
        }

        render();
        auth.onAuthStateChanged(() => {authReady = true; schedule(true);}, () => {authReady = false; epoch++; errorVisible = true; publish({ready:false, allowed:false, admin:false, message:UNAVAILABLE});});
        const publicRef = database.ref(ROOT + '/public');
        publicRef.on('value', snapshot => {
            const hint = JSON.stringify(snapshot.val());
            if (publicHint === undefined) {publicHint = hint; return;}
            if (hint !== publicHint) {publicHint = hint; schedule(true);}
        }, () => schedule(true));
        database.ref('.info/connected').on('value', snapshot => {
            sdkConnected = snapshot.val() === true;
            if (sdkConnected) schedule(true);
            else {epoch++; errorVisible = true; publish({ready:false, allowed:false, admin:false, message:UNAVAILABLE});}
        }, () => {sdkConnected = false; epoch++; errorVisible = true; publish({ready:false, allowed:false, admin:false, message:UNAVAILABLE});});
        global.setInterval(() => schedule(false), 20000);
        if (global.addEventListener) {
            global.addEventListener('offline', () => {epoch++; errorVisible = true; publish({ready:false, allowed:false, admin:false, message:UNAVAILABLE});});
            global.addEventListener('online', () => schedule(true));
        }
        schedule(false);
        return {state, guard, refreshIdentity, beginLogin, getPolicy, savePolicy};
    }
    global.DHNDMaintenance = {create};
})(window);
