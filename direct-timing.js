(function (root, createPolicy) {
    const policy = createPolicy();
    if (typeof module === 'object' && module.exports) module.exports = policy;
    else root.DHNDDirectTiming = policy;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';

    const runs = Object.freeze({'1st':'OFICIAL', qualify:'QUALIFY', '2nd':'2ª DESCIDA'});
    const clockWithSeparators = /^(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{3}))?$/;
    const compactClock = /^(\d{2})(\d{2})(\d{2})(\d{3})?$/;

    function parseClock(value) {
        if (typeof value !== 'string' && !Number.isSafeInteger(value)) return null;
        const text = String(value).trim();
        const match = clockWithSeparators.exec(text) || compactClock.exec(text);
        if (!match) return null;
        const [, hours, minutes, seconds, fraction = '000'] = match;
        if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null;
        const ms = ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(fraction);
        return {ms, text:`${hours}:${minutes}:${seconds}.${fraction}`};
    }

    function completeClock(value, side, previous = null, other = null, random = Math.random) {
        const clock = parseClock(value);
        if (!clock) return null;
        const text = String(value).trim();
        if (previous?.text === text) return previous;
        const supplied = (clockWithSeparators.exec(text) || compactClock.exec(text))[4];
        if (supplied !== undefined) return {...clock, generated:false};

        // Keep the entered seconds unchanged when both clocks have generated milliseconds.
        // Allow entry in either order and ensure the two generated fractions differ.
        const min = side === 'finish' ? (other?.generated ? other.ms % 1000 + 1 : 2) : 1;
        const max = side === 'start' ? (other?.generated ? other.ms % 1000 - 1 : 998) : 999;
        let fraction = min + Math.floor(random() * (max - min + 1));
        if (other && !other.generated && fraction === other.ms % 1000) {
            fraction = fraction === max ? min : fraction + 1;
        }
        return {ms:clock.ms + fraction, text:clock.text.slice(0, -3) + String(fraction).padStart(3, '0'), generated:true};
    }

    function calculate(start, finish) {
        const from = parseClock(start);
        const to = parseClock(finish);
        if (!from || !to || to.ms <= from.ms) return null;
        const elapsed = to.ms - from.ms;
        const minutes = String(Math.floor(elapsed / 60000)).padStart(2, '0');
        const seconds = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
        const fraction = String(elapsed % 1000).padStart(3, '0');
        return {startClock:from.text, finishClock:to.text, val:`${minutes}:${seconds}.${fraction}`};
    }

    function normalize(value) {
        return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
    }

    function runCode(value) {
        switch (normalize(value)) {
            case '':
            case '1ST':
            case 'OFICIAL':
            case '1ª DESCIDA':
            case '1A DESCIDA':
            case 'OFICIAL (1ª DESCIDA)': return '1st';
            case 'QUALIFY':
            case 'CLASSIFICATORIA':
            case 'QUALIFY (CLASSIFICATORIA)': return 'qualify';
            case '2ND':
            case 'SEGUNDA':
            case '2ª DESCIDA':
            case '2A DESCIDA':
            case '2ª DESCIDA (OPCIONAL)': return '2nd';
            default: return '';
        }
    }

    function identityOf(record) {
        if (!record || typeof record !== 'object') return null;
        const evtId = String(record.evtId ?? '').trim();
        const cpf = String(record.cpf ?? '').replace(/\D/g, '');
        const cat = normalize(record.cat ?? record.category).replace(/\s*\((?:EXTRA|OFICIAL)\)$/, '');
        const run = runCode(record.runType);
        if (!evtId || !cpf || cpf.length > 11 || !cat || !run) return null;
        return [evtId, cpf.padStart(11, '0'), cat, run];
    }

    function isCollection(records) {
        return Array.isArray(records) || Object.prototype.toString.call(records) === '[object Object]';
    }

    function findResult(records, identity) {
        const wanted = identityOf(identity);
        if (!wanted || !isCollection(records)) return undefined;
        return Object.values(records).find(record => {
            const actual = identityOf(record);
            return actual && actual.every((value, index) => value === wanted[index]);
        });
    }

    function indexResults(records) {
        const result = new Map();
        if (isCollection(records)) {
            for (const record of Object.values(records)) {
                const identity = identityOf(record);
                if (!identity) continue;
                const key = JSON.stringify(identity);
                if (!result.has(key)) result.set(key, record);
            }
        }
        return identity => result.get(JSON.stringify(identityOf(identity)));
    }

    function appendResult(records, record) {
        if (!identityOf(record) || (records != null && !isCollection(records)) || findResult(records, record)) return undefined;
        if (records == null) return [record];
        if (Array.isArray(records)) {
            const next = records.slice();
            next.push(record);
            return next;
        }

        let highest = -1;
        for (const key of Object.keys(records)) {
            const index = Number(key);
            if (Number.isSafeInteger(index) && index >= 0 && String(index) === key) highest = Math.max(highest, index);
        }
        let index = highest + 1;
        if (!Number.isSafeInteger(index)) {
            index = 0;
            while (Object.prototype.hasOwnProperty.call(records, index)) index++;
        }
        return {...records, [String(index)]:record};
    }

    return {runs, parseClock, completeClock, calculate, findResult, indexResults, appendResult};
});

(function () {
    'use strict';

    const policy = window.DHNDDirectTiming;
    const element = id => document.getElementById('direct-timing-' + id);
    const dialog = element('dialog');
    const rows = element('rows');
    const runningRows = element('running-rows');
    const runningSection = element('started');
    const search = element('search');
    const category = element('category');
    const eligible = new Set(['CONFIRMADO', 'ISENTO']);
    const comparator = new Intl.Collator('pt-BR', {numeric:true, sensitivity:'base'});
    const simplify = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    const categoryKey = value => simplify(value).replace(/\s*\((?:EXTRA|OFICIAL)\)$/, '');
    let session = null;

    function viewerFor(account) {
        if (!account?.uid || !loggedUser || !rosterReady()) return null;
        const cpf = cleanCPF(loggedUser.cpf);
        if (String(account.email || '').toLowerCase() !== cpf + '@dhpe.com.br') return null;
        return selectAuthenticatedProfile(db.users, cpf, account.uid).user;
    }

    function localEvent(context) {
        return getSeasonEvents().find(event => String(event.id) === context.eventId && event.status !== 'CANCELLED');
    }

    function permitted(context) {
        if (!maintenanceAllowsApp() || DB_KEY !== context.root || SYSTEM_YEAR !== context.year || !localEvent(context)) return false;
        const account = auth?.currentUser;
        if (!account || account.uid !== context.uid) return false;
        const viewer = viewerFor(account);
        return !!viewer && (isSuperAdmin(viewer) ||
            (viewer.role === 'ORGANIZER' && Object.values(viewer.allowedEvts || {}).some(id => String(id) === context.eventId)));
    }

    function athletesFor(context) {
        const athletes = new Map();
        for (const profile of db.users) {
            const cpf = cleanCPF(profile.cpf);
            if (!cpf || !profile.nome) continue;
            for (const registration of profile.inscricoes || []) {
                if (String(registration.id) !== context.eventId || !eligible.has(registration.status)) continue;
                const cat = window.normalizeCatName(registration.extraCat || profile.cat);
                const key = cpf + '|' + categoryKey(cat);
                if (athletes.has(key)) continue;
                athletes.set(key, {
                    evtId:context.eventId, runType:context.runType, cpf:profile.cpf, cat,
                    name:profile.nome, city:profile.city || profile.cidade || '',
                    num:getPlacaAtletaEvento(profile, context.eventId, registration)
                });
            }
        }
        return athletes;
    }

    function status(message, state = '') {
        const last = element('status');
        last.textContent = message;
        last.dataset.state = state;
    }

    function setRowState(row, message) {
        row.note.textContent = message;
    }

    function loadDrafts(context) {
        try { return new Map(Object.entries(JSON.parse(sessionStorage.getItem(context.draftKey) || '{}'))); }
        catch (_) { return new Map(); }
    }

    function restoreClock(stored, side) {
        const clock = policy.parseClock(stored?.text);
        if (!clock) return null;
        const ms = clock.ms % 1000;
        const generated = stored.generated === true && (side === 'start' ? ms >= 1 && ms <= 998 : ms >= 2);
        return {...clock, generated};
    }

    function syncDraft(context, row) {
        if (row.saved || (!row.startTime && !row.finishTime)) context.drafts.delete(row.key);
        else context.drafts.set(row.key, {start:row.startTime, finish:row.finishTime});
        try {
            if (context.drafts.size) sessionStorage.setItem(context.draftKey, JSON.stringify(Object.fromEntries(context.drafts)));
            else sessionStorage.removeItem(context.draftKey);
        } catch (_) {}
    }

    function cell(title, contents) {
        const td = document.createElement('td');
        td.dataset.label = title;
        if (typeof contents === 'string') td.textContent = contents;
        else td.append(contents);
        return td;
    }

    function clockField(label, athlete) {
        const field = document.createElement('input');
        field.type = 'text';
        field.inputMode = 'numeric';
        field.autocomplete = 'off';
        field.spellcheck = false;
        field.maxLength = 12;
        field.placeholder = 'HH:MM:SS';
        field.setAttribute('aria-label', label + ' · ' + athlete.name + ' · ' + athlete.cat);
        return field;
    }

    function markPublished(context, row, result) {
        row.saved = result;
        context.confirmed.set(row.key, result);
        syncDraft(context, row);
        row.tr.remove();
        context.rows.delete(row.key);
    }

    function preview(row) {
        if (row.saved || row.pending) return;
        row.output.textContent = '—';
        row.retry.hidden = true;
        setRowState(row, '');
    }

    async function publish(context, row) {
        if (session !== context || row.saved || row.pending) return;
        if (!row.startTime || !row.finishTime) return;
        const calculation = policy.calculate(row.startTime.text, row.finishTime.text);
        if (!calculation) {
            setRowState(row, 'Confira as horas. A chegada precisa ser posterior à largada.');
            return;
        }
        const athlete = athletesFor(context).get(row.key);
        if (!database || !permitted(context) || !athlete || persistScoringModule.pendingWrites?.has(context.root + '/tempos')) {
            row.retry.hidden = false;
            setRowState(row, 'Aguarde a sincronização e tente novamente.');
            return;
        }
        const existing = policy.findResult(db.tempos, athlete);
        if (existing) {
            markPublished(context, row, existing);
            filterRows();
            status('O resultado deste atleta já foi publicado.', 'success');
            return;
        }

        row.start.value = calculation.startClock;
        row.finish.value = calculation.finishClock;
        row.output.textContent = calculation.val;
        row.start.readOnly = true;
        row.finish.readOnly = true;
        row.pending = true;
        row.retry.hidden = true;
        setRowState(row, 'Enviando…');
        const generated = row.startTime.generated || row.finishTime.generated;
        const record = {...athlete, ...calculation, status:'OK', ...(generated && {generatedMilliseconds:true})};

        try {
            const ref = database.ref(context.root + '/tempos');
            const transaction = ref.transaction(current => {
                if (!permitted(context) || !athletesFor(context).has(row.key)) return undefined;
                return policy.appendResult(current, record);
            }, undefined, false);
            const result = await awaitWithTimeout(transaction, 15000, 'timing/pending', 'Confirmação pendente');
            if (session !== context) return;
            const confirmed = result.committed ? record : policy.findResult(result.snapshot?.val(), athlete);
            if (confirmed) {
                markPublished(context, row, confirmed);
                filterRows();
                const timeLabel = confirmed.val || confirmed.status;
                status(result.committed
                    ? `${athlete.name}: ${timeLabel} publicado${confirmed.generatedMilliseconds ? ' · milésimos gerados' : ''}.`
                    : `${athlete.name} já tem resultado publicado: ${timeLabel}.`, 'success');
            } else {
                setRowState(row, 'O tempo não foi confirmado. Confira a etapa e tente novamente.');
            }
        } catch (error) {
            if (session === context && !row.saved) {
                setRowState(row, error?.code === 'timing/pending'
                    ? 'A confirmação demorou. Confira o resultado antes de reenviar.'
                    : 'Falha ao publicar. Confira a conexão e tente novamente.');
            }
        } finally {
            row.pending = false;
            if (session === context && !row.saved) {
                row.start.readOnly = false;
                row.finish.readOnly = false;
                row.retry.hidden = false;
            }
        }
    }

    function createRow(context, key, athlete) {
        const tr = document.createElement('tr');
        const start = clockField('Hora de largada', athlete);
        const finish = clockField('Hora de chegada', athlete);
        const output = document.createElement('output');
        output.className = 'direct-timing-result';
        output.textContent = '—';
        const note = document.createElement('span');
        note.className = 'direct-timing-row-note';
        note.setAttribute('role', 'status');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Tentar novamente';
        retry.hidden = true;
        const resultCell = cell('Resultado', output);
        resultCell.append(note, retry);
        const row = {key, athlete, tr, start, finish, output, note, retry, query:simplify([athlete.num, athlete.name, athlete.cat].join(' '))};
        row.category = categoryKey(athlete.cat);
        const draft = context.drafts.get(key);
        row.startTime = restoreClock(draft?.start, 'start');
        row.finishTime = restoreClock(draft?.finish, 'finish');
        start.value = row.startTime?.text || '';
        finish.value = row.finishTime?.text || '';
        if (row.startTime && row.finishTime) {
            output.textContent = policy.calculate(start.value, finish.value)?.val || '—';
            retry.hidden = false;
        }
        for (const [field, other] of [[start, finish], [finish, start]]) {
            const isStart = field === start;
            const key = isStart ? 'startTime' : 'finishTime';
            const otherKey = isStart ? 'finishTime' : 'startTime';
            const commit = () => {
                if (row.saved || row.pending) return;
                const clock = policy.completeClock(field.value, isStart ? 'start' : 'finish', row[key], row[otherKey]);
                row[key] = clock;
                if (clock) field.value = clock.text;
                syncDraft(context, row);
                filterRows();
                void publish(context, row);
                if (!clock && field.value.trim()) setRowState(row, 'Digite o horário completo.');
            };
            field.addEventListener('input', () => preview(row));
            field.addEventListener('change', commit);
            field.addEventListener('keydown', event => {
                if (event.key === 'Tab') commit();
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commit();
                    if (!other.value) other.focus();
                    else field.blur();
                }
            });
        }
        retry.addEventListener('click', () => void publish(context, row));
        tr.append(cell('Placa', athlete.num || '—'), cell('Atleta', athlete.name), cell('Categoria', athlete.cat),
            cell('Hora de largada', start), cell('Hora de chegada', finish), resultCell);
        return row;
    }

    function filterRows() {
        if (!session) return;
        const query = simplify(search.value);
        const focused = document.activeElement;
        const inProgress = [...session.rows.values()].filter(row => row.startTime)
            .sort((a, b) => a.startTime.ms - b.startTime.ms);
        const waiting = [];
        for (const row of session.rows.values()) {
            row.tr.dataset.inProgress = String(!!row.startTime);
            row.tr.hidden = !row.startTime && (!row.query.includes(query) || (category.value && row.category !== category.value));
            if (!row.startTime) waiting.push(row);
        }
        waiting.sort(({athlete:a}, {athlete:b}) => window.DHNDCategories.compareStartOrder(a.cat, b.cat) ||
            comparator.compare(a.num || '\uffff', b.num || '\uffff') || comparator.compare(a.name, b.name));
        for (const [container, list] of [[runningRows, inProgress], [rows, waiting]]) {
            list.forEach((row, index) => {
                if (container.children[index] !== row.tr) container.insertBefore(row.tr, container.children[index] || null);
            });
        }
        if (focused?.isConnected && focused !== document.activeElement) focused.focus({preventScroll:true});
        runningSection.hidden = !inProgress.length;
        const visible = waiting.some(row => !row.tr.hidden);
        const empty = element('empty');
        empty.hidden = visible;
        if (!session.athleteCount) empty.textContent = 'Ainda não há inscritos confirmados ou isentos nesta etapa.';
        else if (!session.rows.size) empty.textContent = 'Todos os resultados desta volta foram publicados.';
        else if (!waiting.length) empty.textContent = 'Nenhum atleta aguardando a largada.';
        else empty.textContent = 'Nenhum atleta aguardando nesta busca.';
    }

    function refreshCategories(context, athletes) {
        const categories = new Map();
        for (const athlete of athletes.values()) {
            const key = categoryKey(athlete.cat);
            if (!categories.has(key)) categories.set(key, athlete.cat);
        }
        if (context.categories && JSON.stringify([...context.categories]) === JSON.stringify([...categories])) return;
        const selected = category.value;
        context.categories = categories;
        category.replaceChildren();
        for (const [key, label] of [['', 'Todas as categorias'], ...[...categories].sort((a, b) => window.DHNDCategories.compareStartOrder(a[1], b[1]))]) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = label;
            category.append(option);
        }
        category.value = categories.has(selected) ? selected : '';
    }

    function refresh() {
        const context = session;
        if (!context || !dialog.open) return;
        if (!rosterReady()) {
            status('Aguardando atualização dos cadastros…', 'pending');
            return;
        }
        if (!permitted(context)) {
            dialog.close();
            return;
        }
        const athletes = athletesFor(context);
        context.athleteCount = athletes.size;
        refreshCategories(context, athletes);
        for (const [key, row] of context.rows) {
            if (!athletes.has(key)) {
                row.tr.remove();
                context.rows.delete(key);
            }
        }
        const resultFor = policy.indexResults(db.tempos);
        for (const [key, athlete] of athletes) {
            let row = context.rows.get(key);
            const result = resultFor(athlete) || context.confirmed.get(key);
            if (result) {
                if (row) markPublished(context, row, result);
                else if (context.drafts.has(key)) syncDraft(context, {key, saved:result});
                continue;
            }
            if (!row) {
                row = createRow(context, key, athlete);
                context.rows.set(key, row);
                rows.append(row.tr);
            }
        }
        filterRows();
        if (element('status').dataset.state === 'pending') status('');
    }

    function open() {
        const eventId = String(document.getElementById('adm-res-evt').value || '');
        const runType = document.getElementById('adm-res-runtype').value;
        const context = {eventId, runType, root:DB_KEY, year:SYSTEM_YEAR, uid:auth?.currentUser?.uid, rows:new Map()};
        if (!eventId || !policy.runs[runType] || !localEvent(context)) return toast('SELECIONE O EVENTO E O TIPO DE VOLTA.', 'error');
        if (DB_KEY.includes('archive')) return toast('O HISTÓRICO É SOMENTE PARA CONSULTA.', 'error');
        if (!context.uid) return toast('ENTRE NOVAMENTE COM SUA CONTA PARA CRONOMETRAR.', 'error');
        if (!rosterReady()) return toast('AGUARDE A ATUALIZAÇÃO DOS CADASTROS PARA CRONOMETRAR.', 'info');
        if (!permitted(context)) return toast('SEM PERMISSÃO PARA CRONOMETRAR ESTA ETAPA.', 'error');
        context.draftKey = ['dhnd-timing-draft', context.root, context.eventId, context.runType, context.uid].join(':');
        context.drafts = loadDrafts(context);
        context.confirmed = new Map();
        session = context;
        rows.replaceChildren();
        runningRows.replaceChildren();
        search.value = '';
        category.value = '';
        element('event').textContent = localEvent(context).t;
        element('run').textContent = policy.runs[runType] + ' · ' + context.year;
        status('');
        if (!dialog.open) dialog.showModal();
        refresh();
    }

    dialog.addEventListener('close', () => { if (!dialog.open) session = null; });
    element('close').addEventListener('click', () => dialog.close());
    element('download').addEventListener('click', () => {
        if (session && permitted(session)) window.gerarExcelLargada({eventId:session.eventId, runType:session.runType});
    });
    search.addEventListener('input', filterRows);
    category.addEventListener('change', filterRows);
    window.DHNDDirectDesk = {open, refresh, close:() => { if (dialog.open) dialog.close(); }};
})();
