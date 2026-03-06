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

### ⚠️ Recommended: Filter BEFORE calling the webhook

The Zoop backend should **check `success_stream_count` before calling the webhook** — this avoids sending unnecessary requests to the feedback service.

```javascript
const axios = require('axios');

const FEEDBACK_SERVICE_URL = 'https://your-feedback-server.com';

async function onStreamEnded(sellerId, liveId, streamDurationMinutes) {
  // 1. Only proceed if stream was > 5 minutes
  if (streamDurationMinutes < 5) return;

  // 2. Query seller_store_table
  const seller = await db.query(
    'SELECT seller_id, seller_name, phone, success_stream_count FROM seller_store_table WHERE seller_id = $1',
    [sellerId]
  );

  // 3. ✅ Check BEFORE calling webhook — skip if past limit
  if (seller.success_stream_count < 1 || seller.success_stream_count > 5) {
    return; // No webhook call needed — saves an HTTP request
  }

  // 4. Only call webhook for streams 1-5
  await axios.post(`${FEEDBACK_SERVICE_URL}/webhook/livestream-ended`, {
    seller_id: seller.seller_id,
    seller_name: seller.seller_name,
    phone: seller.phone,              // E.164 format: +919876543210
    live_id: liveId,
    success_stream_count: seller.success_stream_count,
  });
}
```

> **Note:** The feedback service also has the same check as a safety net, but filtering at the source is recommended to reduce traffic.

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

## Local Testing

### Step 1: Configure `.env`

```env
BOLNA_API_KEY=your_real_bolna_api_key
BOLNA_AGENT_ID=your_real_agent_id
PORT=3000
FEEDBACK_CALL_LIMIT=5
CALL_DELAY_MINUTES=0    # ← Set to 0 for instant testing (no 5-min wait)
```

### Step 2: Start the server

```bash
npm run dev
```

### Step 3: Test — trigger a feedback call

Replace `+91XXXXXXXXXX` with your real phone number:

**PowerShell:**
```powershell
Invoke-RestMethod -Uri http://localhost:3000/webhook/livestream-ended `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"seller_id": "test_seller_1", "seller_name": "Test Seller", "phone": "+91XXXXXXXXXX", "live_id": "test_live_1", "success_stream_count": 1}'
```

**curl:**
```bash
curl -X POST http://localhost:3000/webhook/livestream-ended \
  -H "Content-Type: application/json" \
  -d '{"seller_id": "test_seller_1", "seller_name": "Test Seller", "phone": "+91XXXXXXXXXX", "live_id": "test_live_1", "success_stream_count": 1}'
```

**Expected:** Your phone rings with the Bolna AI feedback agent.

### Step 4: Test — verify the 5-call limit

Send 5 requests, changing `live_id` and `success_stream_count` each time:

```powershell
# Call 2
Invoke-RestMethod -Uri http://localhost:3000/webhook/livestream-ended -Method Post -ContentType 'application/json' -Body '{"seller_id": "test_seller_1", "phone": "+91XXXXXXXXXX", "live_id": "test_live_2", "success_stream_count": 2}'

# Call 3
Invoke-RestMethod -Uri http://localhost:3000/webhook/livestream-ended -Method Post -ContentType 'application/json' -Body '{"seller_id": "test_seller_1", "phone": "+91XXXXXXXXXX", "live_id": "test_live_3", "success_stream_count": 3}'

# ... continue up to 5

# Call 6 — should be SKIPPED
Invoke-RestMethod -Uri http://localhost:3000/webhook/livestream-ended -Method Post -ContentType 'application/json' -Body '{"seller_id": "test_seller_1", "phone": "+91XXXXXXXXXX", "live_id": "test_live_6", "success_stream_count": 6}'
# Expected: {"success": true, "action": "skipped", "message": "...past the 5-stream feedback window."}
```

### Step 5: Check results

```powershell
# View seller history
Invoke-RestMethod -Uri http://localhost:3000/seller/test_seller_1/history | ConvertTo-Json -Depth 5

# View queue stats
Invoke-RestMethod -Uri http://localhost:3000/queue/stats | ConvertTo-Json

# View CSV file directly
Get-Content data/calls.csv
```

### Step 6: Test the Bolna callback

Simulate a Bolna call completion (to test result storage):

```powershell
Invoke-RestMethod -Uri http://localhost:3000/webhook/bolna-call-complete `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"call_id": "your_bolna_call_id_here", "status": "completed", "transcript": "The stream went great. I had no issues. I rate it 4 out of 5."}'
```

Check `data/calls.csv` — the matching row should now have status=`completed`, rating=`4`.

> **Tip:** For real Bolna callbacks, you'll need to expose your localhost via [ngrok](https://ngrok.com). Run `ngrok http 3000` and set the ngrok URL as your Bolna webhook.

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

