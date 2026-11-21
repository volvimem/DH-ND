const {createHash, randomBytes, randomInt, scrypt, timingSafeEqual} = require('node:crypto');
const {promisify} = require('node:util');

const GRANTS = 'dhnd_auth_recovery_v1';
const USERS = 'dhpe_v25_final_stable_fix/users';
const EXPIRATION_MS = 5 * 60 * 1000;
const PIN_COOLDOWN_MS = 45 * 1000;
const deriveKey = promisify(scrypt);

function normalizeCpf(value) {
    if (typeof value !== 'string') return null;
    const cpf = value.trim();
    if (/^\d{11}$/.test(cpf)) return cpf;
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf)) return cpf.replace(/\D/g, '');
    return null;
}

function formatCpf(cpf) {
    return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}

function hasStaffRole(role) {
    return ['ADMIN', 'SUPERADMIN', 'SUPER-ADM', 'ORGANIZER'].includes(String(role || '').trim().toUpperCase());
}

function isActiveGrant(grant, currentTime) {
    return typeof grant?.uid === 'string' && Number.isSafeInteger(grant.expiresAt) && grant.expiresAt > currentTime;
}

function equalDigest(stored, candidate) {
    return typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored) &&
        timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(candidate, 'hex'));
}

function matchesLongGrant(grant, codeDigest, currentTime) {
    return isActiveGrant(grant, currentTime) && !grant.format && equalDigest(grant.codeDigest, codeDigest);
}

function isActivePinGrant(grant, currentTime) {
    return isActiveGrant(grant, currentTime) && grant.format === 'pin' &&
        typeof grant.pinSalt === 'string' && /^[a-f0-9]{32}$/.test(grant.pinSalt) &&
        typeof grant.pinDigest === 'string' && /^[a-f0-9]{64}$/.test(grant.pinDigest) &&
        (grant.nextAttemptAt == null || (Number.isSafeInteger(grant.nextAttemptAt) && grant.nextAttemptAt >= 0));
}

function matchesPinGrant(current, issued, currentTime) {
    return isActivePinGrant(current, currentTime) && current.uid === issued.uid &&
        current.pinSalt === issued.pinSalt && current.pinDigest === issued.pinDigest;
}

async function digestPin(pin, salt) {
    const key = await deriveKey(pin, Buffer.from(salt, 'hex'), 32);
    return key.toString('hex');
}

function extractResetCode(link) {
    const url = new URL(link);
    const [mode, ...otherModes] = url.searchParams.getAll('mode');
    const [code, ...otherCodes] = url.searchParams.getAll('oobCode');
    if (url.protocol !== 'https:' || mode !== 'resetPassword' || otherModes.length ||
        otherCodes.length || !code || !/^[A-Za-z0-9_-]{16,2048}$/.test(code)) {
        throw Object.assign(new Error('Invalid Firebase reset link'), {code: 'invalid-reset-link'});
    }
    return code;
}

function dependencyFailureCategory(error) {
    const code = String(error?.code ?? '').toLowerCase();
    const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
    const message = typeof error?.message === 'string' ? error.message : '';
    if (code === 'invalid-reset-link' || code === 'err_invalid_url') return 'invalid-response';
    if (code === 'invalid-configuration') return 'configuration';
    if (/^index not defined\b/i.test(message)) return 'index-missing';
    if (status === 403 || ['7', 'permission-denied', 'permission_denied', 'auth/insufficient-permission'].includes(code) ||
        /^permission[ _]denied\b/i.test(message)) return 'permission';
    if (status === 401 || ['16', 'unauthenticated', 'auth/invalid-credential', 'app/invalid-credential'].includes(code)) {
        return 'authentication';
    }
    if (status === 429 || ['8', 'resource-exhausted', 'auth/quota-exceeded', 'auth/too-many-requests'].includes(code)) {
        return 'quota';
    }
    if (status === 408 || status === 504 || ['4', 'deadline-exceeded', 'etimedout'].includes(code)) return 'timeout';
    if ((status >= 500 && status < 600) ||
        ['14', 'unavailable', 'enotfound', 'econnrefused', 'econnreset', 'eai_again', 'app/network-error'].includes(code)) {
        return 'unavailable';
    }
    return 'unknown';
}

function createRecoveryHandlers({
    auth, getDatabase, getAdminUid, HttpsError, now = Date.now, randomInteger = randomInt, reportFailure = () => {},
}) {
    function unavailable(stage, error) {
        reportFailure({stage, category: dependencyFailureCategory(error)});
        return new HttpsError('unavailable', 'A recuperação de acesso está indisponível. Tente novamente.');
    }

    function invalidCode() {
        return new HttpsError('permission-denied', 'Código temporário inválido, expirado ou já utilizado.');
    }

    function pinCooldown() {
        return new HttpsError('resource-exhausted', 'Aguarde um pouco antes de tentar o código novamente.');
    }

    function configuredAdmin(stage) {
        let uid;
        try {
            uid = getAdminUid();
        } catch (error) {
            throw unavailable(stage, error);
        }
        if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
            throw unavailable(stage, {code: 'invalid-configuration'});
        }
        return uid;
    }

    async function serviceCall(stage, operation) {
        try {
            return await operation();
        } catch (error) {
            throw unavailable(stage, error);
        }
    }

    async function findAuthUser(stage, operation) {
        try {
            return await operation();
        } catch (error) {
            if (error?.code === 'auth/user-not-found') return null;
            throw unavailable(stage, error);
        }
    }

    async function eligibleAthlete(database, account, cpf, adminUid, stage) {
        if (!account || !account.uid || account.disabled || account.uid === adminUid) return false;
        const claims = account.customClaims;
        if (claims?.admin || claims?.superAdmin || claims?.organizer || hasStaffRole(claims?.role)) return false;
        const roster = database.ref(USERS);
        const matches = await serviceCall(stage, () => Promise.all([
            roster.orderByChild('uid').equalTo(account.uid).get(),
            roster.orderByChild('cpf').equalTo(cpf).get(),
            roster.orderByChild('cpf').equalTo(formatCpf(cpf)).get(),
        ]));
        const profiles = new Map(matches.flatMap(snapshot => Object.entries(snapshot.val() || {})));
        const entries = [...profiles.values()];
        if (entries.some(profile => hasStaffRole(profile?.role))) return false;
        const cpfProfiles = entries.filter(profile => normalizeCpf(profile?.cpf) === cpf);
        return cpfProfiles.some(profile => profile.uid === account.uid) ||
            (cpfProfiles.length === 1 && !cpfProfiles[0].uid);
    }

    function grantReference(database, cpf) {
        return database.ref(GRANTS + '/' + digest(cpf));
    }

    function updateGrant(reference, stage, update) {
        // RTDB can first call the update function with an empty local cache.
        return serviceCall(stage, () => reference.transaction(current => update(current) ?? current ?? null, undefined, false));
    }

    async function verifyPinAttempt(reference, grant, pin) {
        const startedAt = now();
        if (!isActivePinGrant(grant, startedAt)) throw invalidCode();
        if (grant.nextAttemptAt > startedAt) throw pinCooldown();

        // Reserve the cooldown before running scrypt so concurrent guesses cannot bypass it.
        const reservation = randomBytes(16).toString('base64url');
        const result = await updateGrant(reference, 'redeem_pin_reserve', current => {
            const currentTime = now();
            if (!matchesPinGrant(current, grant, currentTime) || current.nextAttemptAt > currentTime) return;
            return {...current, nextAttemptAt: currentTime + PIN_COOLDOWN_MS, reservation};
        });
        const reserved = result.snapshot.val();
        if (!result.committed || reserved?.reservation !== reservation) {
            const currentTime = now();
            if (matchesPinGrant(reserved, grant, currentTime) && reserved.nextAttemptAt > currentTime) throw pinCooldown();
            throw invalidCode();
        }

        const submittedDigest = await serviceCall('redeem_pin_hash', () => digestPin(pin, grant.pinSalt));
        if (!equalDigest(grant.pinDigest, submittedDigest)) throw invalidCode();
    }

    async function issue(request) {
        const adminUid = configuredAdmin('issue_config');
        const denied = () => new HttpsError('permission-denied', 'Apenas a administração autorizada pode gerar códigos.');
        if (request.auth?.uid !== adminUid) throw denied();
        const administrator = await findAuthUser('issue_admin_lookup', () => auth.getUser(adminUid));
        if (!administrator || administrator.disabled) throw denied();

        const cpf = normalizeCpf(request.data?.cpf);
        if (!cpf) throw new HttpsError('invalid-argument', 'Informe um CPF com 11 dígitos.');
        const database = await serviceCall('issue_database_connect', getDatabase);
        const account = await findAuthUser('issue_athlete_lookup', () => auth.getUserByEmail(cpf + '@dhpe.com.br'));
        if (!await eligibleAthlete(database, account, cpf, adminUid, 'issue_roster_read')) {
            throw new HttpsError('failed-precondition', 'Não foi possível gerar um código para esta conta.');
        }

        let code;
        let credentials;
        if (request.data?.format === 'pin') {
            code = String(randomInteger(0, 1_000_000)).padStart(6, '0');
            const pinSalt = randomBytes(16).toString('hex');
            const pinDigest = await serviceCall('issue_pin_hash', () => digestPin(code, pinSalt));
            credentials = {format: 'pin', pinSalt, pinDigest, attempts: 0};
        } else {
            code = 'DHND-' + randomBytes(16).toString('base64url');
            credentials = {codeDigest: digest(code)};
        }
        await serviceCall('issue_grant_write', () => grantReference(database, cpf).set({
            uid: account.uid,
            ...credentials,
            expiresAt: now() + EXPIRATION_MS,
        }));
        return {code};
    }

    async function redeem(request) {
        const cpf = normalizeCpf(request.data?.cpf);
        const code = typeof request.data?.code === 'string' ? request.data.code.trim() : '';
        const isPin = /^\d{6}$/.test(code);
        if (!cpf || (!isPin && !/^DHND-[A-Za-z0-9_-]{22}$/.test(code))) throw invalidCode();

        const adminUid = configuredAdmin('redeem_config');
        const database = await serviceCall('redeem_database_connect', getDatabase);
        const reference = grantReference(database, cpf);
        const grant = (await serviceCall('redeem_grant_read', () => reference.get())).val();
        const codeDigest = isPin ? null : digest(code);
        if (isPin) {
            await verifyPinAttempt(reference, grant, code);
        } else if (!matchesLongGrant(grant, codeDigest, now())) {
            throw invalidCode();
        }

        const claim = randomBytes(16).toString('base64url');
        const result = await updateGrant(reference, 'redeem_grant_claim', current => {
            const matches = isPin
                ? matchesPinGrant(current, grant, now())
                : current?.uid === grant.uid && matchesLongGrant(current, codeDigest, now());
            if (!matches) return;
            return {claim};
        });
        if (!result.committed || result.snapshot.val()?.claim !== claim) throw invalidCode();

        const email = cpf + '@dhpe.com.br';
        const account = await findAuthUser('redeem_athlete_lookup', () => auth.getUserByEmail(email));
        if (account?.uid !== grant.uid || !await eligibleAthlete(database, account, cpf, adminUid, 'redeem_roster_read')) {
            throw invalidCode();
        }
        const resetLink = await serviceCall('redeem_reset_link', () => auth.generatePasswordResetLink(email));
        const resetCode = await serviceCall('redeem_reset_link_parse', () => extractResetCode(resetLink));
        const updatedAccount = await findAuthUser('redeem_athlete_recheck', () => auth.getUserByEmail(email));
        if (updatedAccount?.uid !== account.uid || updatedAccount.disabled) throw invalidCode();
        const retained = await serviceCall('redeem_claim_recheck', () => reference.get());
        if (retained.val()?.claim !== claim) throw invalidCode();
        return {resetCode, uid: account.uid};
    }

    return {issue, redeem};
}

module.exports = {createRecoveryHandlers};
