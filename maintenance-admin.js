(function (global) {
    'use strict';

    const instances = new WeakMap();
    const DEFAULT_MESSAGE = 'Estamos em manutenção. Voltaremos em breve.';
    const cpfDigits = value => String(value || '').replace(/\D/g, '');
    const searchable = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    function mount(options) {
        options = options || {};
        const controller = options && options.controller;
        const container = typeof options.container === 'string' ? document.getElementById(options.container) : options.container;
        if (!container || !controller || typeof controller.getPolicy !== 'function' || typeof controller.savePolicy !== 'function') return null;
        const previous = instances.get(container);
        if (previous && previous.controller === controller) {
            previous.setUsers(options.users);
            previous.renderAthletes();
            return previous.api;
        }

        let users = typeof options.users === 'function' ? options.users : () => [];
        let loaded = false;
        let saving = false;
        let selected = new Set();
        let loadVersion = 0;

        function element(tag, text, style) {
            const node = document.createElement(tag);
            if (text !== undefined) node.textContent = text;
            if (style) Object.assign(node.style, style);
            return node;
        }
        const card = element('section', undefined, {marginTop:'15px',padding:'14px',border:'1px solid #cbd5e1',borderRadius:'8px',background:'#f8fafc',color:'#1e293b',fontSize:'12px',lineHeight:'1.5'});
        card.setAttribute('aria-label', 'Modo manutenção');
        card.append(element('h3', 'MODO MANUTENÇÃO', {fontSize:'14px',margin:'0 0 10px',color:'#0038a8'}));
        const switchLabel = element('label', undefined, {display:'flex',gap:'10px',alignItems:'center',fontWeight:'bold',cursor:'pointer'});
        const enabled = element('input');
        enabled.id = 'adm-maintenance-enabled';
        enabled.type = 'checkbox';
        Object.assign(enabled.style, {width:'20px',height:'20px',flexShrink:'0'});
        switchLabel.append(enabled, element('span', 'ATIVAR MANUTENÇÃO PARA O PÚBLICO'));
        card.append(switchLabel);
        card.append(element('p', 'O administrador responsável mantém o acesso. Os atletas marcados abaixo podem entrar com a própria conta para testar.', {margin:'10px 0'}));

        const messageLabel = element('label', 'MENSAGEM PARA O PÚBLICO', {display:'block',fontWeight:'bold',marginBottom:'5px'});
        messageLabel.htmlFor = 'adm-maintenance-message';
        const message = element('textarea');
        message.id = 'adm-maintenance-message';
        message.rows = 3;
        message.maxLength = 300;
        message.className = 'input-field';
        message.placeholder = DEFAULT_MESSAGE;
        Object.assign(message.style, {fontSize:'13px',resize:'vertical',minHeight:'72px',margin:'0'});
        card.append(messageLabel, message);

        const searchLabel = element('label', 'ATLETAS LIBERADOS PARA TESTAR', {display:'block',fontWeight:'bold',margin:'12px 0 5px'});
        searchLabel.htmlFor = 'adm-maintenance-search';
        const search = element('input');
        search.id = 'adm-maintenance-search';
        search.type = 'search';
        search.className = 'input-field';
        search.placeholder = 'Buscar por nome, cidade ou CPF';
        search.autocomplete = 'off';
        Object.assign(search.style, {fontSize:'13px',margin:'0'});
        const count = element('p', '', {margin:'7px 0',fontWeight:'bold'});
        count.id = 'adm-maintenance-selected-count';
        const list = element('div', undefined, {maxHeight:'260px',overflowY:'auto',border:'1px solid #e2e8f0',borderRadius:'5px',background:'white',padding:'5px 10px'});
        list.id = 'adm-maintenance-athletes';
        card.append(searchLabel, search, count, list);

        const status = element('p', 'Carregando a configuração…', {margin:'10px 0',color:'#475569'});
        status.id = 'adm-maintenance-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const retry = element('button', 'TENTAR CARREGAR NOVAMENTE');
        retry.type = 'button';
        retry.className = 'btn';
        Object.assign(retry.style, {display:'none',fontSize:'12px',marginTop:'5px',background:'#475569'});
        const save = element('button', 'SALVAR MODO MANUTENÇÃO');
        save.id = 'adm-maintenance-save';
        save.type = 'button';
        save.className = 'btn';
        Object.assign(save.style, {fontSize:'13px',marginTop:'8px',background:'#0038a8'});
        card.append(status, retry, save, element('p', 'As alterações só valem após salvar.', {margin:'7px 0 0',color:'#64748b'}));
        container.replaceChildren(card);

        function controls() {
            enabled.disabled = !loaded || saving;
            message.disabled = !loaded || saving;
            search.disabled = !loaded || saving;
            save.disabled = !loaded || saving;
            save.textContent = saving ? 'SALVANDO…' : 'SALVAR MODO MANUTENÇÃO';
            list.querySelectorAll('input').forEach(input => { input.disabled = !loaded || saving; });
        }
        function renderAthletes() {
            let records;
            try { records = users(); } catch (_) { records = []; }
            if (!Array.isArray(records)) records = Object.values(records || {});
            const byCpf = new Map();
            records.forEach(user => {
                if (!user) return;
                const cpf = cpfDigits(user.cpf);
                if (cpf.length !== 11 || byCpf.has(cpf)) return;
                byCpf.set(cpf, {cpf, name:String(user.nome || user.name || 'Atleta sem nome'), city:String(user.city || user.cidade || '')});
            });
            selected.forEach(cpf => {
                if (!byCpf.has(cpf)) byCpf.set(cpf, {cpf,name:'Atleta selecionado — cadastro indisponível',city:''});
            });
            const query = searchable(search.value).trim();
            const queryDigits = cpfDigits(query);
            const matches = Array.from(byCpf.values()).filter(user => !query || searchable(user.name+' '+user.city+' '+user.cpf).includes(query) || (queryDigits.length > 0 && user.cpf.includes(queryDigits))).sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
            list.replaceChildren();
            count.textContent = selected.size+' atleta(s) selecionado(s) para teste';
            if (!loaded) {
                list.append(element('p', 'Aguarde o carregamento da configuração.', {margin:'6px 0',color:'#64748b'}));
                return;
            }
            if (!matches.length) list.append(element('p', 'Nenhum atleta encontrado.', {margin:'6px 0',color:'#64748b'}));
            matches.slice(0,100).forEach(user => {
                const label = element('label', undefined, {display:'flex',alignItems:'center',gap:'9px',padding:'8px 0',borderBottom:'1px solid #f1f5f9',cursor:'pointer',margin:'0'});
                const checkbox = element('input');
                checkbox.type = 'checkbox';
                checkbox.checked = selected.has(user.cpf);
                checkbox.setAttribute('aria-label', user.name+' — '+user.cpf);
                checkbox.disabled = saving;
                Object.assign(checkbox.style, {width:'18px',height:'18px',flexShrink:'0'});
                const text = element('span', undefined, {minWidth:'0',overflowWrap:'anywhere'});
                text.append(element('b',user.name,{display:'block',fontSize:'12px'}),element('span',[user.city,user.cpf].filter(Boolean).join(' · '),{fontSize:'12px',color:'#64748b'}));
                checkbox.addEventListener('change', () => {
                    if (saving || !loaded) return;
                    if (checkbox.checked) selected.add(user.cpf); else selected.delete(user.cpf);
                    count.textContent = selected.size+' atleta(s) selecionado(s) para teste';
                    status.textContent = 'Escolhas alteradas. Clique em SALVAR MODO MANUTENÇÃO para aplicar.';
                    status.style.color = '#475569';
                });
                label.append(checkbox,text);
                list.append(label);
            });
            if (matches.length > 100) list.append(element('p','Mostrando 100 de '+matches.length+' atletas. Refine a busca para encontrar os demais.',{margin:'7px 0',color:'#64748b'}));
        }
        function changed() {
            if (!loaded || saving) return;
            status.textContent = 'Configuração alterada. Clique em SALVAR MODO MANUTENÇÃO para aplicar.';
            status.style.color = '#475569';
        }
        async function load() {
            const version = ++loadVersion;
            loaded = false;
            retry.style.display = 'none';
            status.textContent = 'Carregando a configuração…';
            status.style.color = '#475569';
            controls();
            renderAthletes();
            try {
                const policy = await controller.getPolicy();
                if (version !== loadVersion || instances.get(container)?.controller !== controller) return;
                if (!policy || !policy.public || typeof policy.public.enabled !== 'boolean') throw new Error('INVALID_POLICY');
                selected = new Set(Object.entries(policy.allowedCpfs || {}).filter(([cpf,value]) => value === true && cpfDigits(cpf).length === 11).map(([cpf]) => cpfDigits(cpf)));
                enabled.checked = policy.public.enabled === true;
                message.value = String(policy.public.message || DEFAULT_MESSAGE).slice(0,300);
                loaded = true;
                status.textContent = enabled.checked ? 'Manutenção ativada. Somente o administrador e os atletas liberados entram.' : 'Manutenção desativada. O app está disponível ao público.';
            } catch (_) {
                if (version !== loadVersion) return;
                status.textContent = 'Não foi possível carregar a configuração. Confira sua conexão e o acesso de administrador.';
                status.style.color = '#b91c1c';
                retry.style.display = 'block';
            }
            controls();
            renderAthletes();
        }
        async function submit() {
            if (!loaded || saving) return;
            saving = true;
            controls();
            status.textContent = 'Aguardando a confirmação da gravação…';
            status.style.color = '#475569';
            const allowedCpfs = {};
            selected.forEach(cpf => { allowedCpfs[cpf] = true; });
            const payload = {enabled:enabled.checked === true,message:message.value.trim().slice(0,300) || DEFAULT_MESSAGE,allowedCpfs};
            try {
                await controller.savePolicy(payload);
                status.textContent = payload.enabled ? 'Modo manutenção salvo. Público em manutenção; atletas selecionados liberados para testar.' : 'Modo manutenção salvo e desativado. App disponível ao público.';
                status.style.color = '#15803d';
            } catch (_) {
                status.textContent = 'Não foi possível confirmar a gravação. Suas escolhas foram mantidas. Tente salvar novamente.';
                status.style.color = '#b91c1c';
            }
            saving = false;
            controls();
        }
        search.addEventListener('input', renderAthletes);
        enabled.addEventListener('change', changed);
        message.addEventListener('input', changed);
        save.addEventListener('click', submit);
        retry.addEventListener('click', load);
        const api = {reload:load,renderAthletes};
        instances.set(container,{controller,api,renderAthletes,setUsers:callback=>{if(typeof callback === 'function')users=callback;}});
        controls();
        load();
        return api;
    }
    global.DHNDMaintenanceAdmin = {mount};
})(window);
