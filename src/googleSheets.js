const { google } = require('googleapis');
const path = require('path');

let sheetsClient = null;
const SHEET_NAME = 'FeedbackCalls';
const HEADERS = ['seller_id', 'seller_name', 'phone', 'live_id', 'call_id', 'stream_number', 'status', 'rating', 'feedback_summary', 'called_at'];

/**
 * Initialize Google Sheets API client.
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY_PATH and GOOGLE_SHEETS_ID in .env.
 */
async function init() {
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    const sheetId = process.env.GOOGLE_SHEETS_ID;

    if (!keyPath || !sheetId) {
        console.warn('[Sheets] GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SHEETS_ID not set — Google Sheets disabled');
        return null;
    }

    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.resolve(keyPath),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        sheetsClient = google.sheets({ version: 'v4', auth });

        // Ensure header row exists
        const res = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `${SHEET_NAME}!A1:J1`,
        });
        if (!res.data.values || res.data.values.length === 0) {
            await sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: `${SHEET_NAME}!A1:J1`,
                valueInputOption: 'RAW',
                requestBody: { values: [HEADERS] },
            });
        }

        console.log('[Sheets] Connected to Google Sheets');
        return sheetsClient;
    } catch (error) {
        console.warn('[Sheets] Failed to initialize:', error.message);
        sheetsClient = null;
        return null;
    }
}

/**
 * Append a new call record row to Google Sheets.
 */
async function recordCall(data) {
    if (!sheetsClient) return;
    try {
        await sheetsClient.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            range: `${SHEET_NAME}!A:J`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [[
                    data.seller_id,
                    data.seller_name || '',
                    data.phone,
                    data.live_id,
                    data.call_id,
                    data.stream_number,
                    data.status,
                    '',
                    '',
                    data.called_at,
                ]],
            },
        });
        console.log(`[Sheets] Appended call ${data.call_id}`);
    } catch (error) {
        console.error('[Sheets] Error appending row:', error.message);
    }
}

/**
 * Update a call result row in Google Sheets (find by call_id in column E).
 */
async function updateCallResult(callId, status, rating, feedbackSummary) {
    if (!sheetsClient) return false;
    try {
        const sheetId = process.env.GOOGLE_SHEETS_ID;
        const res = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `${SHEET_NAME}!E:E`,
        });

        const rows = res.data.values || [];
        let rowIndex = -1;
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === callId) {
                rowIndex = i + 1;
                break;
            }
        }

        if (rowIndex === -1) return false;

        // Update columns G (status), H (rating), I (feedback_summary)
        await sheetsClient.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `${SHEET_NAME}!G${rowIndex}:I${rowIndex}`,
            valueInputOption: 'RAW',
            requestBody: { values: [[status, rating || '', feedbackSummary || '']] },
        });

        console.log(`[Sheets] Updated call ${callId}`);
        return true;
    } catch (error) {
        console.error('[Sheets] Error updating row:', error.message);
        return false;
    }
}

module.exports = { init, recordCall, updateCallResult };
