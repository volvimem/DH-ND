const {createHash, randomBytes, timingSafeEqual} = require('node:crypto');

const GRANTS = 'dhnd_auth_recovery_v1';
const USERS = 'dhpe_v25_final_stable_fix/users';
const EXPIRATION_MS = 5 * 60 * 1000;

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

function matchesGrant(grant, codeDigest, currentTime) {
    return !!(
        grant &&
        typeof grant.uid === 'string' &&
        Number.isSafeInteger(grant.expiresAt) &&
        grant.expiresAt > currentTime &&
        typeof grant.codeDigest === 'string' &&
        /^[a-f0-9]{64}$/.test(grant.codeDigest) &&
        timingSafeEqual(Buffer.from(grant.codeDigest, 'hex'), Buffer.from(codeDigest, 'hex'))
    );
}

function extractResetCode(link) {
    const url = new URL(link);
    const [mode, ...otherModes] = url.searchParams.getAll('mode');
    const [code, ...otherCodes] = url.searchParams.getAll('oobCode');
    if (url.protocol !== 'https:' || mode !== 'resetPassword' || otherModes.length ||
        otherCodes.length || !code || !/^[A-Za-z0-9_-]{16,2048}$/.test(code)) {
        throw new Error('Invalid Firebase reset link');
    }
    return code;
}

function createRecoveryHandlers({auth, getDatabase, getAdminUid, HttpsError, now = Date.now}) {
    function unavailable() {
        return new HttpsError('unavailable', 'A recuperação de acesso está indisponível. Tente novamente.');
    }

    function invalidCode() {
        return new HttpsError('permission-denied', 'Código temporário inválido, expirado ou já utilizado.');
    }

    function configuredAdmin() {
        const uid = getAdminUid();
        if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw unavailable();
        return uid;
    }

    async function serviceCall(operation) {
        try {
            return await operation();
        } catch {
            throw unavailable();
        }
    }

    async function findAuthUser(operation) {
        try {
            return await operation();
        } catch (error) {
            if (error.code === 'auth/user-not-found') return null;
            throw unavailable();
        }
    }

    async function eligibleAthlete(database, account, cpf, adminUid) {
        if (!account || !account.uid || account.disabled || account.uid === adminUid) return false;
        const claims = account.customClaims;
        if (claims?.admin || claims?.superAdmin || claims?.organizer || hasStaffRole(claims?.role)) return false;
        const roster = database.ref(USERS);
        const matches = await serviceCall(() => Promise.all([
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

    async function issue(request) {
        const adminUid = configuredAdmin();
        const denied = () => new HttpsError('permission-denied', 'Apenas a administração autorizada pode gerar códigos.');
        if (request.auth?.uid !== adminUid) throw denied();
        const administrator = await findAuthUser(() => auth.getUser(adminUid));
        if (!administrator || administrator.disabled) throw denied();

        const cpf = normalizeCpf(request.data?.cpf);
        if (!cpf) throw new HttpsError('invalid-argument', 'Informe um CPF com 11 dígitos.');
        const database = await serviceCall(getDatabase);
        const account = await findAuthUser(() => auth.getUserByEmail(cpf + '@dhpe.com.br'));
        if (!await eligibleAthlete(database, account, cpf, adminUid)) {
            throw new HttpsError('failed-precondition', 'Não foi possível gerar um código para esta conta.');
        }

        const code = 'DHND-' + randomBytes(16).toString('base64url');
        await serviceCall(() => grantReference(database, cpf).set({
            uid: account.uid,
            codeDigest: digest(code),
            expiresAt: now() + EXPIRATION_MS,
        }));
        return {code};
    }

    async function redeem(request) {
        const cpf = normalizeCpf(request.data?.cpf);
        const code = typeof request.data?.code === 'string' ? request.data.code.trim() : '';
        if (!cpf || !/^DHND-[A-Za-z0-9_-]{22}$/.test(code)) throw invalidCode();

        const adminUid = configuredAdmin();
        const database = await serviceCall(getDatabase);
        const reference = grantReference(database, cpf);
        const codeDigest = digest(code);
        const grant = (await serviceCall(() => reference.get())).val();
        if (!matchesGrant(grant, codeDigest, now())) throw invalidCode();

        const claim = randomBytes(16).toString('base64url');
        const result = await serviceCall(() => reference.transaction(current => {
            if (current?.uid !== grant.uid || !matchesGrant(current, codeDigest, now())) {
                // RTDB can first call this function with an empty local cache.
                return current ?? null;
            }
            return {claim};
        }, undefined, false));
        if (!result.committed || result.snapshot.val()?.claim !== claim) throw invalidCode();

        const email = cpf + '@dhpe.com.br';
        const account = await findAuthUser(() => auth.getUserByEmail(email));
        if (account?.uid !== grant.uid || !await eligibleAthlete(database, account, cpf, adminUid)) throw invalidCode();
        const resetCode = await serviceCall(async () => extractResetCode(await auth.generatePasswordResetLink(email)));
        const updatedAccount = await findAuthUser(() => auth.getUserByEmail(email));
        if (updatedAccount?.uid !== account.uid || updatedAccount.disabled) throw invalidCode();
        return {resetCode, uid: account.uid};
    }

    return {issue, redeem};
}

module.exports = {createRecoveryHandlers};
