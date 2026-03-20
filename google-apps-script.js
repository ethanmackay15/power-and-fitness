// ═══════════════════════════════════════════════════════════════════════════
// Google Apps Script — Cut Tracker Sheets Backend
// ═══════════════════════════════════════════════════════════════════════════
// SETUP:
//   1. Create a new Google Sheet
//   2. Go to Extensions → Apps Script
//   3. Paste this entire file into Code.gs (replace any existing code)
//   4. Click Deploy → New deployment
//   5. Select type: Web app
//   6. Set "Execute as" → Me
//   7. Set "Who has access" → Anyone
//   8. Click Deploy and copy the Web App URL
//   9. Paste that URL into the Cut Tracker app settings
// ═══════════════════════════════════════════════════════════════════════════

const SHEET_NAME = 'Weight Log';

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    // Header row
    sheet.appendRow(['Date', 'Weight', 'Notes', 'Updated']);
    sheet.getRange('1:1').setFontWeight('bold');
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 300);
    sheet.setColumnWidth(4, 180);
  }
  return sheet;
}

// Handle GET requests — return all entries as JSON
function doGet(e) {
  try {
    const sheet = getOrCreateSheet();
    const data = sheet.getDataRange().getValues();
    const entries = [];

    // Skip header row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      entries.push({
        date: Utilities.formatDate(new Date(row[0]), 'America/Los_Angeles', 'yyyy-MM-dd'),
        weight: Number(row[1]),
        notes: String(row[2] || '')
      });
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, entries }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handle POST requests — sync entries from the app
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || 'sync';

    if (action === 'sync') {
      return syncEntries(payload.entries || []);
    } else if (action === 'delete') {
      return deleteEntry(payload.date);
    } else if (action === 'update_date') {
      return updateEntryDate(payload.oldDate, payload.newDate);
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function syncEntries(entries) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  // Build a map of existing rows by date
  const rowMap = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const d = Utilities.formatDate(new Date(data[i][0]), 'America/Los_Angeles', 'yyyy-MM-dd');
    rowMap[d] = i + 1; // 1-indexed row number
  }

  entries.forEach(entry => {
    if (!entry.date || !entry.weight) return;
    const existingRow = rowMap[entry.date];

    if (existingRow) {
      // Update existing row
      sheet.getRange(existingRow, 1, 1, 4).setValues([[
        entry.date, entry.weight, entry.notes || '', now
      ]]);
    } else {
      // Append new row
      sheet.appendRow([entry.date, entry.weight, entry.notes || '', now]);
    }
  });

  // Sort by date (column A) after sync
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 4).sort({ column: 1, ascending: true });
  }

  return jsonResponse({ ok: true, synced: entries.length });
}

function deleteEntry(date) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (!data[i][0]) continue;
    const d = Utilities.formatDate(new Date(data[i][0]), 'America/Los_Angeles', 'yyyy-MM-dd');
    if (d === date) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ ok: true, deleted: date });
    }
  }

  return jsonResponse({ ok: true, deleted: null });
}

function updateEntryDate(oldDate, newDate) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const d = Utilities.formatDate(new Date(data[i][0]), 'America/Los_Angeles', 'yyyy-MM-dd');
    if (d === oldDate) {
      sheet.getRange(i + 1, 1).setValue(newDate);
      sheet.getRange(i + 1, 4).setValue(new Date());
      // Re-sort
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, 4).sort({ column: 1, ascending: true });
      }
      return jsonResponse({ ok: true, updated: { from: oldDate, to: newDate } });
    }
  }

  return jsonResponse({ ok: true, updated: null });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
