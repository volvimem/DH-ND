const {initializeApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getDatabase, getDatabaseWithUrl} = require('firebase-admin/database');
const {defineString} = require('firebase-functions/params');
const {HttpsError, onCall} = require('firebase-functions/v2/https');
const {createRecoveryHandlers} = require('./temporary-login');

const app = initializeApp();
const recoveryAdminUid = defineString('DHND_RECOVERY_ADMIN_UID');
const recoveryServiceAccount = defineString('DHND_RECOVERY_SERVICE_ACCOUNT');
const handlers = createRecoveryHandlers({
    auth: getAuth(app),
    getDatabase: () => {
        const url = process.env.DHND_RECOVERY_DATABASE_URL || app.options.databaseURL;
        return url ? getDatabaseWithUrl(url, app) : getDatabase(app);
    },
    getAdminUid: () => recoveryAdminUid.value(),
    HttpsError,
});

const options = {serviceAccount: recoveryServiceAccount};
exports.issueAthleteTemporaryLogin = onCall(options, handlers.issue);
exports.redeemAthleteTemporaryLogin = onCall(options, handlers.redeem);
