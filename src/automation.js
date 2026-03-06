const bolna = require('./bolna');
const storage = require('./sheets');
const CallQueue = require('./queue');

const CALL_LIMIT = parseInt(process.env.FEEDBACK_CALL_LIMIT || '5', 10);
const DELAY_MINUTES = parseInt(process.env.CALL_DELAY_MINUTES || '5', 10);

// Queue: 2 parallel calls max, 2s gap between each
const callQueue = new CallQueue(2, 2000);

// Track pending events to avoid duplicates if webhook fires twice rapidly
const pendingEvents = new Set();

/**
 * Handle a "livestream ended" event.
 *
 * Uses `success_stream_count` from the Zoop database (seller_store_table)
 * to decide whether to trigger a feedback call.
 * A "successful stream" = duration > 5 minutes.
 *
 * Calls are triggered when: 1 <= success_stream_count <= CALL_LIMIT (5)
 *
 * @param {object} params
 * @param {string} params.sellerId    - Unique seller/store identifier
 * @param {string} params.phone       - Seller phone in E.164 format (+919876543210)
 * @param {string} params.liveId      - Unique livestream identifier
 * @param {number} params.streamCount - success_stream_count from seller_store_table
 * @param {string} [params.sellerName] - Seller name (optional, for logging)
 * @returns {{action: string, message: string}}
 */
function onLivestreamEnded({ sellerId, phone, liveId, streamCount, sellerName }) {
    // Prevent duplicate processing for same seller + livestream
    const key = `${sellerId}-${liveId}`;
    if (pendingEvents.has(key)) {
        console.log(`[Automation] Duplicate event ignored — seller: ${sellerId}, live: ${liveId}`);
        return { action: 'skipped', message: 'Duplicate event — already processing this livestream' };
    }

    pendingEvents.add(key);
    // Auto-cleanup the dedup key after 10 minutes
    setTimeout(() => pendingEvents.delete(key), 10 * 60 * 1000);

    // ── Check success_stream_count against limit ──
    console.log(`[Automation] Seller ${sellerId} (${sellerName || 'unknown'}) — success_stream_count: ${streamCount}`);

    if (streamCount > CALL_LIMIT) {
        console.log(`[Automation] Seller ${sellerId} has ${streamCount} successful streams — past limit (${CALL_LIMIT}). Skipping.`);
        pendingEvents.delete(key);
        return {
            action: 'skipped',
            message: `Seller has ${streamCount} successful streams — past the ${CALL_LIMIT}-stream feedback window.`,
        };
    }

    if (streamCount < 1) {
        console.log(`[Automation] Seller ${sellerId} has 0 successful streams — stream was under 5 min. Skipping.`);
        pendingEvents.delete(key);
        return {
            action: 'skipped',
            message: 'Stream was not successful (duration < 5 minutes). No feedback call needed.',
        };
    }

    // ── Queue the call ──
    const delayMs = DELAY_MINUTES * 60 * 1000;

    callQueue.enqueue({
        sellerId,
        phone,
        liveId,
        execute: async () => {
            // Wait the configured delay before making the call
            if (delayMs > 0) {
                console.log(`[Automation] Waiting ${DELAY_MINUTES} min before calling seller ${sellerId}...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            await executeFeedbackCall(sellerId, phone, liveId, streamCount, sellerName);
            pendingEvents.delete(key);
        },
    });

    return {
        action: 'queued',
        message: `Feedback call for stream #${streamCount} queued (delay: ${DELAY_MINUTES} min)`,
        queue_stats: callQueue.getStats(),
    };
}

/**
 * Execute the actual feedback call via Bolna AI and record it.
 */
async function executeFeedbackCall(sellerId, phone, liveId, streamCount, sellerName) {
    try {
        const { callId } = await bolna.makeCall(phone);
        storage.recordCall(sellerId, phone, liveId, callId, streamCount, sellerName);
        console.log(`[Automation] ✅ Call triggered — seller: ${sellerId}, stream #${streamCount}, callId: ${callId}`);
    } catch (error) {
        console.error(`[Automation] ❌ Call failed for seller ${sellerId}:`, error.message);
        throw error;
    }
}

/**
 * Handle Bolna AI call completion webhook.
 * Updates local storage with the call result.
 */
function onCallCompleted(webhookData) {
    const callId = webhookData.call_id || webhookData.id;
    const status = webhookData.status || 'unknown';
    const transcript = webhookData.transcript || '';

    // Try to extract rating (1-5) from transcript
    let rating = '';
    const ratingMatch = transcript.match(/\b([1-5])\b.*(?:out of 5|rating|rate)/i)
        || transcript.match(/(?:rating|rate).*\b([1-5])\b/i)
        || transcript.match(/\b([1-5])\s*(?:out of|\/)\s*5\b/i);
    if (ratingMatch) {
        rating = ratingMatch[1];
    }

    const feedbackSummary = transcript.length > 500
        ? transcript.substring(0, 500) + '...'
        : transcript;

    const updated = storage.updateCallResult(callId, status, rating, feedbackSummary);

    if (updated) {
        console.log(`[Automation] Call result saved — callId: ${callId}, status: ${status}, rating: ${rating}`);
    } else {
        console.warn(`[Automation] Could not find call ${callId} in storage`);
    }

    return { updated, callId, status, rating };
}

/**
 * Get current queue statistics.
 */
function getQueueStats() {
    return callQueue.getStats();
}

module.exports = {
    onLivestreamEnded,
    onCallCompleted,
    getQueueStats,
};
