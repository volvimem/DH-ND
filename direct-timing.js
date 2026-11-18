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

    return {runs, parseClock, calculate, findResult, indexResults, appendResult};
});

(function () {
    'use strict';

    const policy = window.DHNDDirectTiming;
    const element = id => document.getElementById('direct-timing-' + id);
    const dialog = element('dialog');
    const rows = element('rows');
    const search = element('search');
    const eligible = new Set(['CONFIRMADO', 'ISENTO']);
    const comparator = new Intl.Collator('pt-BR', {numeric:true, sensitivity:'base'});
    const simplify = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    const categoryKey = value => simplify(value).replace(/\s*\(EXTRA\)$/, '');
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

    function lockResult(row, result) {
        row.saved = result;
        row.start.value = result.startClock || '';
        row.finish.value = result.finishClock || '';
        row.output.textContent = result.val || result.status || 'Publicado';
        row.start.readOnly = true;
        row.finish.readOnly = true;
        row.retry.hidden = true;
        setRowState(row, 'Publicado');
    }

    function preview(row) {
        if (row.saved || row.pending) return;
        const calculation = policy.calculate(row.start.value, row.finish.value);
        row.output.textContent = calculation?.val || '—';
        row.retry.hidden = true;
        setRowState(row, '');
    }

    async function publish(context, row) {
        if (session !== context || row.saved || row.pending) return;
        if (!row.start.value.trim() || !row.finish.value.trim()) return;
        const calculation = policy.calculate(row.start.value, row.finish.value);
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
            lockResult(row, existing);
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
        const record = {...athlete, ...calculation, status:'OK'};

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
                lockResult(row, confirmed);
                status(result.committed ? 'Tempo publicado no app.' : 'A lista já contém um resultado para este atleta.', 'success');
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
        const row = {key, tr, start, finish, output, note, retry, query:simplify([athlete.num, athlete.name, athlete.cat].join(' '))};
        for (const [field, other] of [[start, finish], [finish, start]]) {
            const commit = () => {
                const clock = policy.parseClock(field.value);
                if (clock) field.value = clock.text;
                void publish(context, row);
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
        let visible = 0;
        for (const row of session.rows.values()) {
            row.tr.hidden = !row.query.includes(query);
            if (!row.tr.hidden) visible++;
        }
        const empty = element('empty');
        empty.hidden = visible > 0;
        empty.textContent = session.rows.size ? 'Nenhum atleta encontrado.' : 'Ainda não há inscritos confirmados ou isentos nesta etapa.';
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
        for (const [key, row] of context.rows) {
            if (!athletes.has(key)) {
                row.tr.remove();
                context.rows.delete(key);
            }
        }
        const ordered = [...athletes].sort((a, b) =>
            comparator.compare(a[1].num || '\uffff', b[1].num || '\uffff') || comparator.compare(a[1].name, b[1].name));
        const resultFor = policy.indexResults(db.tempos);
        for (const [key, athlete] of ordered) {
            let row = context.rows.get(key);
            if (!row) {
                row = createRow(context, key, athlete);
                context.rows.set(key, row);
                rows.append(row.tr);
            }
            const result = resultFor(athlete);
            if (result && result !== row.saved) lockResult(row, result);
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
        session = context;
        rows.replaceChildren();
        search.value = '';
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
    window.DHNDDirectDesk = {open, refresh, close:() => { if (dialog.open) dialog.close(); }};
})();
