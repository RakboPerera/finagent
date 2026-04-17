// backend/agents/ingestion/parser.js
// Agent 1: File Parser. Pure JS — SheetJS, papaparse, pdf-parse.
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

// Tries to find the actual data table within a sheet — skips title rows, blanks.
function findTableStart(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const nonNullCount = row.filter(c => c !== null && c !== '' && c !== undefined).length;
    if (nonNullCount >= 2) {
      // Heuristic: header row is the first row with 2+ values that look like column names
      const looksLikeHeader = row.every(c => c == null || typeof c === 'string' || typeof c === 'number');
      if (looksLikeHeader) return i;
    }
  }
  return 0;
}

function rowsToObjects(rows, headerRowIndex) {
  if (rows.length <= headerRowIndex) return { headers: [], data: [] };
  const headers = rows[headerRowIndex].map((h, i) => {
    if (h == null || h === '') return `__col_${i}`;
    return String(h).trim();
  });
  const data = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c == null || c === '')) continue;
    const obj = {};
    let nonNull = 0;
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] !== undefined ? row[j] : null;
      if (row[j] != null && row[j] !== '') nonNull++;
    }
    if (nonNull > 0) data.push(obj);
  }
  return { headers, data };
}

export async function parseFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const result = { filename: originalName, file_size: stat.size, format: null, sheets: [], errors: [] };

  try {
    if (ext === '.xlsx' || ext === '.xls') {
      result.format = 'excel';
      const buf = fs.readFileSync(filePath);
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        if (!rows || rows.length === 0) {
          result.sheets.push({ name: sheetName, headers: [], data: [], row_count: 0, note: 'empty sheet' });
          continue;
        }
        const headerIdx = findTableStart(rows);
        const { headers, data } = rowsToObjects(rows, headerIdx);
        result.sheets.push({
          name: sheetName, headers, data, row_count: data.length,
          header_row_index: headerIdx,
          sample_rows: data.slice(0, 5),
        });
      }
    } else if (ext === '.csv' || ext === '.tsv') {
      result.format = 'csv';
      const text = fs.readFileSync(filePath, 'utf8');
      const parsed = Papa.parse(text, {
        header: true, skipEmptyLines: true, dynamicTyping: true,
        delimitersToGuess: [',', '\t', ';', '|'],
      });
      const headers = parsed.meta?.fields || [];
      const data = parsed.data || [];
      result.sheets.push({
        name: path.basename(originalName, ext), headers, data, row_count: data.length,
        delimiter: parsed.meta?.delimiter, sample_rows: data.slice(0, 5),
      });
      if (parsed.errors?.length) result.errors.push(...parsed.errors.slice(0, 5).map(e => e.message));
    } else if (ext === '.json') {
      result.format = 'json';
      const text = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : (data.data || data.rows || data.records || [data]);
      const headers = arr.length ? Object.keys(arr[0]) : [];
      result.sheets.push({
        name: path.basename(originalName, ext), headers, data: arr,
        row_count: arr.length, sample_rows: arr.slice(0, 5),
      });
    } else if (ext === '.pdf') {
      result.format = 'pdf';
      // Lazy import — pdf-parse pulls in a lot
      const pdfParse = (await import('pdf-parse')).default;
      const buf = fs.readFileSync(filePath);
      const pdf = await pdfParse(buf);
      // Heuristic table extraction: split lines, look for rows with consistent delimiters
      const lines = pdf.text.split('\n').map(l => l.trim()).filter(Boolean);
      // Try to detect tabular data — rows where columns are separated by 2+ spaces or tabs
      const tableLines = lines.filter(l => /\s{2,}|\t/.test(l));
      if (tableLines.length >= 3) {
        const splitRows = tableLines.map(l => l.split(/\s{2,}|\t+/).map(c => c.trim()));
        const headerIdx = 0;
        const { headers, data } = rowsToObjects(splitRows, headerIdx);
        result.sheets.push({
          name: 'pdf_extracted', headers, data, row_count: data.length, sample_rows: data.slice(0, 5),
          note: 'PDF extraction is heuristic — please verify mapping carefully.',
        });
      } else {
        result.sheets.push({
          name: 'pdf_text', headers: [], data: [], row_count: 0,
          note: 'No tabular data detected. Raw text length: ' + pdf.text.length,
        });
        result.errors.push('PDF appears to be unstructured text, not a table.');
      }
    } else {
      result.errors.push(`Unsupported file format: ${ext}`);
    }
  } catch (e) {
    result.errors.push(`Parse error: ${e.message}`);
  }

  // Filter out completely empty sheets but keep their record
  result.data_sheet_count = result.sheets.filter(s => s.row_count > 0).length;
  return result;
}
