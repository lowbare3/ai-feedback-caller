require('dotenv').config();

const express = require('express');
const storage = require('./sheets');
const automation = require('./automation');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// Webhook: Livestream Ended (from Zoop backend)
// ─────────────────────────────────────────────
// Expected payload from Zoop backend:
// {
//   "seller_id": "seller_123",           ← from seller_store_table
//   "seller_name": "Ramesh Kumar",       ← optional
//   "phone": "+919876543210",            ← seller phone (E.164 format)
//   "live_id": "live_abc_001",           ← unique livestream identifier
//   "success_stream_count": 3            ← from seller_store_table (streams > 5 min)
// }
//
// DEVELOPER NOTE:
// This webhook should be called from the Zoop backend when a livestream ends
// AND the stream duration was > 5 minutes (i.e., it counts as a "successful" stream).
// Query seller_store_table for the seller's updated success_stream_count
// and include it in the payload.
//
app.post('/webhook/livestream-ended', (req, res) => {
    const { seller_id, phone, live_id, success_stream_count, seller_name } = req.body;

    // Validate required fields
    if (!seller_id || !phone || !live_id || success_stream_count === undefined) {
        return res.status(400).json({
            error: 'Missing required fields',
            required: ['seller_id', 'phone', 'live_id', 'success_stream_count'],
            optional: ['seller_name'],
            received: req.body,
        });
    }

    // Validate phone format
    if (!phone.startsWith('+')) {
        return res.status(400).json({
            error: 'Phone number must be in E.164 format (e.g. +919876543210)',
        });
    }

    // Validate success_stream_count is a number
    const streamCount = parseInt(success_stream_count, 10);
    if (isNaN(streamCount)) {
        return res.status(400).json({
            error: 'success_stream_count must be a number',
        });
    }

    try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`[Webhook] Livestream ended — seller: ${seller_id} (${seller_name || 'N/A'}), stream #${streamCount}`);
        console.log(`${'='.repeat(60)}`);

        const result = automation.onLivestreamEnded({
            sellerId: seller_id,
            phone,
            liveId: live_id,
            streamCount,
            sellerName: seller_name,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[Webhook] Error handling livestream-ended:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─────────────────────────────────────────────
// Webhook: Bolna AI Call Completed
// ─────────────────────────────────────────────
// Bolna sends call result data here after a call ends.
// Set this URL as the webhook in your Bolna AI dashboard.
//
// DEVELOPER NOTE:
// When deploying, set the Bolna webhook URL to:
//   https://your-domain.com/webhook/bolna-call-complete
//
app.post('/webhook/bolna-call-complete', (req, res) => {
    try {
        console.log(`\n${'─'.repeat(60)}`);
        console.log('[Webhook] Bolna call completed:', JSON.stringify(req.body, null, 2));
        console.log(`${'─'.repeat(60)}`);

        const result = automation.onCallCompleted(req.body);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[Webhook] Error handling Bolna callback:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─────────────────────────────────────────────
// GET: Check seller's feedback call history
// ─────────────────────────────────────────────
app.get('/seller/:sellerId/history', (req, res) => {
    try {
        const history = storage.getSellerHistory(req.params.sellerId);
        const callCount = history.length;
        const limit = parseInt(process.env.FEEDBACK_CALL_LIMIT || '5', 10);

        res.json({
            seller_id: req.params.sellerId,
            calls_made: callCount,
            calls_remaining: Math.max(0, limit - callCount),
            limit_reached: callCount >= limit,
            history,
        });
    } catch (error) {
        console.error('[API] Error fetching seller history:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// GET: Queue stats (monitor the call queue)
// ─────────────────────────────────────────────
app.get('/queue/stats', (req, res) => {
    res.json({
        timestamp: new Date().toISOString(),
        ...automation.getQueueStats(),
    });
});

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
async function start() {
    try {
        await storage.ensureHeaders();
        console.log('[Storage] All storage backends initialized');
    } catch (error) {
        console.error('[Storage] Initialization error:', error.message);
    }

    app.listen(PORT, () => {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  Zoop Feedback Automation Service`);
        console.log(`  Running on http://localhost:${PORT}`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`  Endpoints:`);
        console.log(`    POST /webhook/livestream-ended     — Trigger from Zoop`);
        console.log(`    POST /webhook/bolna-call-complete   — Callback from Bolna AI`);
        console.log(`    GET  /seller/:id/history            — Check seller history`);
        console.log(`    GET  /queue/stats                   — Monitor call queue`);
        console.log(`    GET  /health                        — Health check`);
        console.log(`${'═'.repeat(60)}\n`);
    });
}

start();
