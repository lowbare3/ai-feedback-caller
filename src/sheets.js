/**
 * Unified Storage Layer
 *
 * Writes to THREE backends simultaneously:
 * 1. Local JSON + CSV (always on — for development/backup)
 * 2. Firebase Firestore (if configured — production NoSQL storage)
 * 3. Google Sheets (if configured — for team visibility)
 *
 * Each backend is independent — if one fails, the others still work.
 */

const fs = require('fs');
const path = require('path');
const firebase = require('./firebase');
const googleSheets = require('./googleSheets');

// ─── Local File Storage ─────────────────────
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'calls.json');
const CSV_FILE = path.join(DATA_DIR, 'calls.csv');
const HEADERS = ['seller_id', 'seller_name', 'phone', 'live_id', 'call_id', 'stream_number', 'status', 'rating', 'feedback_summary', 'called_at'];

function readAll() {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
}

function writeAll(records) {
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2));
    // Auto-export CSV
    const header = HEADERS.join(',') + '\n';
    const rows = records.map(r =>
        [
            r.seller_id,
            `"${(r.seller_name || '').replace(/"/g, '""')}"`,
            r.phone,
            r.live_id,
            r.call_id,
            r.stream_number,
            r.status,
            r.rating || '',
            `"${(r.feedback_summary || '').replace(/"/g, '""')}"`,
            r.called_at,
        ].join(',')
    ).join('\n');
    fs.writeFileSync(CSV_FILE, header + rows);
}

// ─── Public API ─────────────────────────────

/**
 * Initialize all storage backends.
 */
async function ensureHeaders() {
    // Local files
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
        console.log('[Storage] Created data/calls.json');
    }
    if (!fs.existsSync(CSV_FILE)) {
        fs.writeFileSync(CSV_FILE, HEADERS.join(',') + '\n');
        console.log('[Storage] Created data/calls.csv');
    }

    // Firebase (optional)
    firebase.init();

    // Google Sheets (optional)
    await googleSheets.init();
}

/**
 * Record a new feedback call across all backends.
 */
async function recordCall(sellerId, phone, liveId, callId, streamNumber, sellerName) {
    const data = {
        seller_id: sellerId,
        seller_name: sellerName || '',
        phone,
        live_id: liveId,
        call_id: callId,
        stream_number: streamNumber,
        status: 'initiated',
        rating: '',
        feedback_summary: '',
        called_at: new Date().toISOString(),
    };

    // 1. Local (always)
    const records = readAll();
    records.push(data);
    writeAll(records);
    console.log(`[Storage] Local — saved call ${callId}`);

    // 2. Firebase (if configured)
    await firebase.recordCall(data);

    // 3. Google Sheets (if configured)
    await googleSheets.recordCall(data);
}

/**
 * Update a call result across all backends.
 */
async function updateCallResult(callId, status, rating, feedbackSummary) {
    // 1. Local
    const records = readAll();
    const idx = records.findIndex(r => r.call_id === callId);
    let localUpdated = false;
    if (idx !== -1) {
        records[idx].status = status;
        records[idx].rating = rating || '';
        records[idx].feedback_summary = feedbackSummary || '';
        writeAll(records);
        localUpdated = true;
        console.log(`[Storage] Local — updated call ${callId}`);
    }

    // 2. Firebase (if configured)
    await firebase.updateCallResult(callId, status, rating, feedbackSummary);

    // 3. Google Sheets (if configured)
    await googleSheets.updateCallResult(callId, status, rating, feedbackSummary);

    return localUpdated;
}

/**
 * Get a seller's call count (from local storage).
 */
function getSellerCallCount(sellerId) {
    const records = readAll();
    return records.filter(r => r.seller_id === sellerId).length;
}

/**
 * Get a seller's call history (from local storage).
 */
function getSellerHistory(sellerId) {
    const records = readAll();
    return records.filter(r => r.seller_id === sellerId);
}

module.exports = {
    ensureHeaders,
    recordCall,
    updateCallResult,
    getSellerCallCount,
    getSellerHistory,
};
