(function (root, createPolicy) {
    const policy = createPolicy();
    if (typeof module === 'object' && module.exports) module.exports = policy;
    else root.DHNDRoster = policy;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';

    function object(value) {
        return value !== null && typeof value === 'object';
    }

    function profile(value) {
        return object(value) && !Array.isArray(value);
    }

    function copy(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function freeze(value) {
        if (object(value)) {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    }

    function clientProfile(record) {
        const result = {...record};
        if (object(result.inscricoes)) result.inscricoes = Object.values(result.inscricoes).filter(Boolean);
        return result;
    }

    // Firebase omits null and empty collections and may return numeric children as arrays or objects.
    function comparable(value) {
        if (!object(value)) return value ?? null;
        const entries = Object.keys(value).sort().map(key => [key, comparable(value[key])]);
        const children = entries.filter(([, child]) => child !== null);
        return children.length ? Object.fromEntries(children) : null;
    }

    function equal(left, right) {
        if (left === right) return true;
        return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
    }

    function cpf(value) {
        return String(value ?? '').replace(/\D/g, '');
    }

    function sameIdentity(left, right) {
        return cpf(left.cpf) === cpf(right.cpf) && equal(left.uid, right.uid);
    }

    function capture(rawUsers) {
        const users = [];
        const records = new Map();
        const keys = new WeakMap();
        for (const [key, record] of Object.entries(rawUsers || {})) {
            if (!profile(record)) continue;
            const user = clientProfile(copy(record));
            users.push(user);
            keys.set(user, key);
            records.set(key, freeze(copy(user)));
        }
        return {users, records, keys, raw:freeze(copy(rawUsers ?? null))};
    }

    function plan(state, currentUsers, options = {}) {
        const result = {changes:[], create:null, remove:null, restore:null, invalid:false};
        if (options.restore != null) {
            result.invalid = !Array.isArray(options.restore) || options.restore.some(user => !profile(user));
            if (!result.invalid) result.restore = {before:state.raw, users:copy(options.restore)};
            return result;
        }
        if (options.create != null) {
            const key = options.createKey;
            result.invalid = !profile(options.create) || !cpf(options.create.cpf) || typeof key !== 'string' ||
                !key || /[.#$\[\]\/\x00-\x1F\x7F]/.test(key) || state.records.has(key);
            if (result.invalid) return result;
            result.create = {key, record:copy(options.create)};
        }
        if (options.remove != null) {
            const key = state.keys.get(options.remove);
            const before = state.records.get(key);
            result.invalid = !before;
            if (result.invalid) return result;
            result.remove = {key, before};
        }
        for (const user of currentUsers || []) {
            if (!profile(user) || user === options.remove) continue;
            const key = state.keys.get(user);
            const before = state.records.get(key);
            if (!before) continue;
            const after = clientProfile(user);
            const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(field => !equal(before[field], after[field]));
            if (fields.length) result.changes.push({key,before,after:copy(after),fields});
        }
        return result;
    }

    function duplicateIdentity(rows, except, wanted, before) {
        const digits = cpf(wanted.cpf);
        const checkCpf = digits && (!before || digits !== cpf(before.cpf));
        const checkUid = wanted.uid && (!before || wanted.uid !== before.uid);
        return [...rows].some(([key, other]) => key !== except && profile(other) &&
            ((checkCpf && digits === cpf(other.cpf)) || (checkUid && wanted.uid === other.uid)));
    }

    function restore(rows, request) {
        if (!equal(Object.fromEntries(rows), request.before)) return undefined;
        const restored = new Map();
        let nextKey = 0;
        for (const user of request.users) {
            const keys = [...rows].filter(([key, existing]) => !restored.has(key) && profile(existing) &&
                sameIdentity(existing, user)).map(([key]) => key);
            if (keys.length === 1) {
                restored.set(keys[0], user);
            } else {
                while (rows.has(String(nextKey)) || restored.has(String(nextKey))) nextKey++;
                restored.set(String(nextKey++), user);
            }
        }
        return restored.size ? Object.fromEntries(restored) : null;
    }

    function apply(rawUsers, request) {
        if (!request || request.invalid || (rawUsers != null && !object(rawUsers))) return undefined;
        const rows = new Map(Object.entries(rawUsers || {}).filter(([, user]) => user != null));
        if (request.restore) return restore(rows, request.restore);

        if (request.remove && rows.has(request.remove.key)) {
            const existing = rows.get(request.remove.key);
            if (!profile(existing) || !equal(clientProfile(existing), request.remove.before)) return undefined;
            rows.delete(request.remove.key);
        }
        for (const edit of request.changes) {
            const existing = rows.get(edit.key);
            if (!profile(existing)) return undefined;
            const current = clientProfile(existing);
            if (sameIdentity(current, edit.after) && edit.fields.every(field => equal(current[field], edit.after[field]))) continue;
            if (!sameIdentity(current, edit.before) || duplicateIdentity(rows, edit.key, edit.after, edit.before)) return undefined;
            const fields = new Map(Object.entries(existing));
            for (const field of edit.fields) {
                if (equal(current[field], edit.after[field])) continue;
                if (!equal(current[field], edit.before[field])) return undefined;
                if (comparable(edit.after[field]) === null) fields.delete(field);
                else fields.set(field, edit.after[field]);
            }
            rows.set(edit.key, Object.fromEntries(fields));
        }
        if (request.create) {
            const {key, record} = request.create;
            const existing = rows.get(key);
            if (rows.has(key)) {
                if (!profile(existing) || !equal(clientProfile(existing), clientProfile(record))) return undefined;
            } else {
                if (duplicateIdentity(rows, key, record)) return undefined;
                rows.set(key, record);
            }
        }
        return rows.size ? Object.fromEntries(rows) : null;
    }

    return {capture, plan, apply};
});
