const admin = require('firebase-admin');

let db = null;

const COLLECTION = 'feedback_calls';

/**
 * Initialize Firebase Admin SDK.
 * Requires FIREBASE_SERVICE_ACCOUNT_KEY_PATH in .env
 * pointing to the Firebase service account JSON file.
 */
function init() {
    if (db) return db;

    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
    if (!keyPath) {
        console.warn('[Firebase] FIREBASE_SERVICE_ACCOUNT_KEY_PATH not set — Firebase disabled');
        return null;
    }

    try {
        const serviceAccount = require(require('path').resolve(keyPath));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        db = admin.firestore();
        console.log('[Firebase] Connected to Firestore');
        return db;
    } catch (error) {
        console.warn('[Firebase] Failed to initialize:', error.message);
        return null;
    }
}

/**
 * Save a new call record to Firestore.
 */
async function recordCall(data) {
    if (!db) return;
    try {
        await db.collection(COLLECTION).doc(data.call_id).set({
            ...data,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[Firebase] Saved call ${data.call_id}`);
    } catch (error) {
        console.error('[Firebase] Error saving call:', error.message);
    }
}

/**
 * Update a call record in Firestore.
 */
async function updateCallResult(callId, status, rating, feedbackSummary) {
    if (!db) return false;
    try {
        await db.collection(COLLECTION).doc(callId).update({
            status,
            rating: rating || '',
            feedback_summary: feedbackSummary || '',
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[Firebase] Updated call ${callId}`);
        return true;
    } catch (error) {
        console.error('[Firebase] Error updating call:', error.message);
        return false;
    }
}

/**
 * Get all call records for a seller.
 */
async function getSellerHistory(sellerId) {
    if (!db) return [];
    try {
        const snapshot = await db.collection(COLLECTION)
            .where('seller_id', '==', sellerId)
            .orderBy('created_at', 'desc')
            .get();
        return snapshot.docs.map(doc => doc.data());
    } catch (error) {
        console.error('[Firebase] Error fetching history:', error.message);
        return [];
    }
}

module.exports = { init, recordCall, updateCallResult, getSellerHistory };
