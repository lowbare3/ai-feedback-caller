const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'calls.json');
const CSV_FILE = path.join(DATA_DIR, 'calls.csv');

const HEADERS = ['seller_id', 'seller_name', 'phone', 'live_id', 'call_id', 'stream_number', 'status', 'rating', 'feedback_summary', 'called_at'];

/**
 * Ensure the data directory and files exist.
 */
function ensureHeaders() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
        console.log('[Storage] Created calls.json');
    }
    if (!fs.existsSync(CSV_FILE)) {
        fs.writeFileSync(CSV_FILE, HEADERS.join(',') + '\n');
        console.log('[Storage] Created calls.csv');
    }
}

/**
 * Read all call records.
 */
function readAll() {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
}

/**
 * Write all records back to JSON and regenerate CSV.
 */
function writeAll(records) {
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2));
    exportCsv(records);
}

/**
 * Export all records to CSV.
 */
function exportCsv(records) {
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

/**
 * Get how many feedback calls have been made to a specific seller.
 */
function getSellerCallCount(sellerId) {
    const records = readAll();
    return records.filter(r => r.seller_id === sellerId).length;
}

/**
 * Record a new feedback call.
 * @param {string} sellerId
 * @param {string} phone
 * @param {string} liveId
 * @param {string} callId - Bolna call ID
 * @param {number} streamNumber - success_stream_count from DB
 * @param {string} [sellerName] - Seller name (optional)
 */
function recordCall(sellerId, phone, liveId, callId, streamNumber, sellerName) {
    const records = readAll();
    records.push({
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
    });
    writeAll(records);
    console.log(`[Storage] Recorded — seller: ${sellerId}, stream #${streamNumber}, callId: ${callId}`);
}

/**
 * Update a call's result after Bolna webhook fires.
 */
function updateCallResult(callId, status, rating, feedbackSummary) {
    const records = readAll();
    const idx = records.findIndex(r => r.call_id === callId);
    if (idx === -1) {
        console.warn(`[Storage] Call ID "${callId}" not found`);
        return false;
    }
    records[idx].status = status;
    records[idx].rating = rating || '';
    records[idx].feedback_summary = feedbackSummary || '';
    writeAll(records);
    console.log(`[Storage] Updated — callId: ${callId}, status: ${status}, rating: ${rating}`);
    return true;
}

/**
 * Get all call records for a specific seller.
 */
function getSellerHistory(sellerId) {
    const records = readAll();
    return records.filter(r => r.seller_id === sellerId);
}

module.exports = {
    ensureHeaders,
    getSellerCallCount,
    recordCall,
    updateCallResult,
    getSellerHistory,
};
