# Zoop Feedback Automation

Automatically triggers **AI voice calls** (via [Bolna AI](https://bolna.ai)) to ZoopLive sellers for feedback after their livestreams end. Calls are made for a seller's **first 5 successful streams** (duration > 5 min), then stop automatically.

## How It Works

```
Seller ends livestream (duration > 5 min)
    │
    ▼
Zoop backend queries seller_store_table
for success_stream_count and seller phone
    │
    ▼
POST /webhook/livestream-ended
{seller_id, phone, live_id, success_stream_count}
    │
    ▼
Is success_stream_count between 1 and 5?
    ├── NO  → Skip (no call)
    └── YES → Add to call queue
                │
                ▼
           Wait 5 minutes
                │
                ▼
        Bolna AI calls the seller
        (How was the stream? Any issues? Rate 1-5)
                │
                ▼
        Call result saved to data/calls.csv
```

## Project Structure

```
├── src/
│   ├── index.js        ← Express server (webhook endpoints)
│   ├── automation.js   ← Core logic (stream count check, delay, dedup)
│   ├── bolna.js        ← Bolna AI outbound call API
│   ├── queue.js        ← Call queue with concurrency control
│   └── sheets.js       ← Local JSON + CSV storage
├── data/               ← Auto-created at startup
│   ├── calls.json      ← Structured call records
│   └── calls.csv       ← Same data in CSV (for Excel/sharing)
├── .env.example        ← Environment variable template
├── .gitignore
├── package.json
└── README.md
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOLNA_API_KEY=your_bolna_api_key
BOLNA_AGENT_ID=your_feedback_agent_id
PORT=3000
FEEDBACK_CALL_LIMIT=5
CALL_DELAY_MINUTES=5
```

### 3. Start the Server

```bash
npm run dev
```

---

## API Endpoints

### `POST /webhook/livestream-ended`

**Main webhook — Zoop backend calls this when a seller's successful stream ends.**

**Request:**

```json
{
  "seller_id": "store_123",
  "seller_name": "Ramesh Kumar",
  "phone": "+919876543210",
  "live_id": "live_abc_001",
  "success_stream_count": 3
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `seller_id` | string | ✅ | Seller/store ID from `seller_store_table` |
| `phone` | string | ✅ | Seller phone in E.164 format (`+91...`) |
| `live_id` | string | ✅ | Unique livestream identifier |
| `success_stream_count` | number | ✅ | From `seller_store_table` (streams > 5 min) |
| `seller_name` | string | ❌ | Seller name (for logging/CSV) |

**Responses:**

```json
// Call queued (stream count 1-5)
{ "success": true, "action": "queued", "message": "Feedback call for stream #3 queued (delay: 5 min)" }

// Skipped — past limit
{ "success": true, "action": "skipped", "message": "Seller has 7 successful streams — past the 5-stream feedback window." }

// Skipped — stream too short
{ "success": true, "action": "skipped", "message": "Stream was not successful (duration < 5 minutes)." }
```

---

### `POST /webhook/bolna-call-complete`

**Bolna AI callback — receives call results after a feedback call ends.**

Set this URL in the Bolna AI dashboard as the webhook URL.

---

### `GET /seller/:sellerId/history`

Check a seller's feedback call history and count.

---

### `GET /queue/stats`

Monitor the call queue in real time.

```json
{ "queued": 12, "running": 2, "processed": 45, "failed": 1 }
```

---

### `GET /health`

Health check.

---

## Developer Integration Guide

### What the Zoop backend needs to do

When a livestream ends with **duration > 5 minutes**:

1. Query `seller_store_table` for the seller's:
   - `seller_id` / `store_id`
   - `phone` number
   - Updated `success_stream_count`
   - `seller_name` (optional)

2. POST to this service:

```sql
-- Example: Get seller details after stream ends
SELECT
  seller_id,
  seller_name,
  phone,
  success_stream_count
FROM seller_store_table
WHERE seller_id = :sellerId;
```

```javascript
// Example: Call the webhook from Zoop backend
const axios = require('axios');

async function onStreamEnded(sellerId, liveId) {
  // 1. Get seller details from DB
  const seller = await db.query(
    'SELECT seller_id, seller_name, phone, success_stream_count FROM seller_store_table WHERE seller_id = $1',
    [sellerId]
  );

  // 2. POST to feedback automation service
  await axios.post('https://your-feedback-server.com/webhook/livestream-ended', {
    seller_id: seller.seller_id,
    seller_name: seller.seller_name,
    phone: seller.phone,              // Must be E.164 format: +919876543210
    live_id: liveId,
    success_stream_count: seller.success_stream_count,
  });
}
```

### Queue Behavior

- Max **2 parallel** Bolna API calls at any time
- **2-second gap** between batches
- 200 simultaneous webhooks are handled safely — all queued, processed gradually
- Duplicate events (same `seller_id` + `live_id`) are automatically ignored

### Data Storage

Call records are stored locally in `data/calls.json` and auto-exported to `data/calls.csv`:

| Column | Description |
|---|---|
| seller_id | Seller/store ID |
| seller_name | Seller name |
| phone | Phone number |
| live_id | Livestream ID |
| call_id | Bolna AI call tracking ID |
| stream_number | Which successful stream this was (1-5) |
| status | `initiated` → `completed` / `failed` |
| rating | Seller's rating 1-5 (auto-extracted from transcript) |
| feedback_summary | Call transcript summary |
| called_at | Timestamp |

---

## Bolna AI Agent Configuration

Your Bolna AI agent should be configured with this prompt:

> You are a friendly feedback assistant for Zoop Live. The seller just finished a livestream. Your job is to:
> 1. Ask how the stream went overall
> 2. Ask if they faced any difficulties during the stream
> 3. Ask them to rate their experience from 1 to 5
>
> Keep the conversation brief and friendly. Thank them at the end.

**Welcome message:**
> "Hi! This is Zoop. You just finished a great live session! We'd love your quick feedback — it'll only take a minute."

**Bolna dashboard settings:**
- Set webhook URL to: `https://your-server.com/webhook/bolna-call-complete`
