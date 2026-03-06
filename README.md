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
        Results saved to:
          • Firebase Firestore (NoSQL)
          • Google Sheets (team visibility)
          • Local JSON + CSV (backup)
```

## Project Structure

```
├── src/
│   ├── index.js         ← Express server (webhook endpoints)
│   ├── automation.js    ← Core logic (stream count check, delay, dedup)
│   ├── bolna.js         ← Bolna AI outbound call API
│   ├── queue.js         ← Call queue (concurrency control)
│   ├── sheets.js        ← Unified storage orchestrator
│   ├── firebase.js      ← Firebase Firestore backend
│   └── googleSheets.js  ← Google Sheets backend
├── data/                ← Auto-created (local backup)
│   ├── calls.json
│   └── calls.csv
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Storage Backends

Results are stored in **three places simultaneously**:

| Backend | Purpose | Required? |
|---|---|---|
| **Local JSON + CSV** | Always-on backup, dev/testing | ✅ Always on |
| **Firebase Firestore** | Production NoSQL, queryable | Optional |
| **Google Sheets** | Team can view/edit in browser | Optional |

Each backend is independent — if one isn't configured or fails, the others still work.

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
# Required
BOLNA_API_KEY=your_bolna_api_key
BOLNA_AGENT_ID=your_feedback_agent_id
PORT=3000
FEEDBACK_CALL_LIMIT=5
CALL_DELAY_MINUTES=5

# Optional — Firebase Firestore
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./firebase-service-account.json

# Optional — Google Sheets
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./google-service-account.json
GOOGLE_SHEETS_ID=your_sheet_id
```

### 3. Firebase Setup (for developers)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a project (or use existing)
3. Go to **Project Settings → Service Accounts**
4. Click **Generate New Private Key** → download JSON
5. Save as `firebase-service-account.json` in the project root
6. Firestore will auto-create a `feedback_calls` collection

### 4. Google Sheets Setup (for developers)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Sheets API**
3. Create a **Service Account** → download JSON key
4. Save as `google-service-account.json` in the project root
5. Create a Google Sheet with a tab named **`FeedbackCalls`**
6. **Share the sheet** with the service account email (Editor access)
7. Copy the Sheet ID from the URL and add to `.env`

### 5. Start the Server

```bash
npm run dev
```

---

## API Endpoints

### `POST /webhook/livestream-ended`

**Main webhook — Zoop backend calls this when a seller's successful stream ends.**

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
| `seller_name` | string | ❌ | Seller name (for logging) |

**Responses:**

```json
// Queued (stream count 1-5)
{ "success": true, "action": "queued", "message": "Feedback call for stream #3 queued (delay: 5 min)" }

// Skipped — past limit
{ "success": true, "action": "skipped", "message": "Seller has 7 successful streams — past the 5-stream feedback window." }

// Skipped — stream too short
{ "success": true, "action": "skipped", "message": "Stream was not successful (duration < 5 minutes)." }
```

### `POST /webhook/bolna-call-complete`

**Bolna AI callback.** Set this URL in the Bolna dashboard.

### `GET /seller/:sellerId/history`

Check a seller's feedback call history.

### `GET /queue/stats`

Monitor the call queue: `{ "queued": 12, "running": 2, "processed": 45, "failed": 1 }`

### `GET /health`

Health check.

---

## Developer Integration Guide

### Backend Integration (PostgreSQL)

When a livestream ends with duration > 5 minutes:

```javascript
const axios = require('axios');

async function onStreamEnded(sellerId, liveId) {
  // 1. Query seller_store_table
  const seller = await db.query(
    'SELECT seller_id, seller_name, phone, success_stream_count FROM seller_store_table WHERE seller_id = $1',
    [sellerId]
  );

  // 2. POST to feedback service
  await axios.post('https://your-feedback-server.com/webhook/livestream-ended', {
    seller_id: seller.seller_id,
    seller_name: seller.seller_name,
    phone: seller.phone,              // E.164 format: +919876543210
    live_id: liveId,
    success_stream_count: seller.success_stream_count,
  });
}
```

### Firebase Firestore Structure

Collection: `feedback_calls`
Document ID: Bolna call ID

```
feedback_calls/
  └── {call_id}/
        ├── seller_id: "store_123"
        ├── seller_name: "Ramesh Kumar"
        ├── phone: "+919876543210"
        ├── live_id: "live_abc_001"
        ├── stream_number: 3
        ├── status: "completed"
        ├── rating: "4"
        ├── feedback_summary: "Stream went well..."
        ├── called_at: "2026-03-06T..."
        └── created_at: <server timestamp>
```

### Queue Behavior

- Max **2 parallel** Bolna API calls
- **2-second gap** between batches
- 200 simultaneous webhooks handled safely
- Duplicate events auto-ignored

---

## Bolna AI Agent Configuration

**Prompt:**

> You are a friendly feedback assistant for Zoop Live. The seller just finished a livestream. Your job is to:
> 1. Ask how the stream went overall
> 2. Ask if they faced any difficulties during the stream
> 3. Ask them to rate their experience from 1 to 5
>
> Keep the conversation brief and friendly. Thank them at the end.

**Welcome message:**
> "Hi! This is Zoop. You just finished a great live session! We'd love your quick feedback — it'll only take a minute."

**Webhook URL:** `https://your-server.com/webhook/bolna-call-complete`
