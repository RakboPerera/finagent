// backend/routes/downloads.js
// Per-table download: empty template OR current data, as .xlsx
import { Router } from 'express';
import * as XLSX from 'xlsx';
import { CANONICAL_SCHEMAS } from '../schema.js';

export function createDownloadsRouter(db) {
  const router = Router();

  // GET /api/tables/:name/download?mode=template|data
  router.get('/:name/download', (req, res) => {
    const tableName = req.params.name;
    const mode = req.query.mode || 'template'; // 'template' | 'data'
    const def = CANONICAL_SCHEMAS[tableName];
    if (!def) return res.status(404).json({ error: 'Unknown table' });

    const wb = XLSX.utils.book_new();

    // ---------- SHEET 1: Data ----------
    const headers = def.fields.map(f => f.name);

    let dataRows;
    if (mode === 'data') {
      // Pull current rows (excluding system columns)
      const rows = db.prepare(`SELECT * FROM ${tableName} ORDER BY id`).all();
      dataRows = rows.map(r => headers.map(h => r[h] ?? null));
    } else {
      // Empty template — give one blank row so Excel auto-detects the table
      dataRows = [headers.map(() => '')];
    }

    const dataSheetMatrix = [headers, ...dataRows];
    const dataWs = XLSX.utils.aoa_to_sheet(dataSheetMatrix);

    // Column widths — wider for known long fields
    dataWs['!cols'] = headers.map(h => {
      if (h.includes('name') || h.includes('description') || h === 'line_item') return { wch: 32 };
      if (h === 'period' || h === 'currency' || h === 'status') return { wch: 12 };
      if (h.includes('amount') || h.includes('balance') || h === 'variance') return { wch: 16 };
      return { wch: 18 };
    });

    // Style header row (basic — XLSX cell styles)
    for (let i = 0; i < headers.length; i++) {
      const addr = XLSX.utils.encode_cell({ c: i, r: 0 });
      if (dataWs[addr]) {
        dataWs[addr].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '1E3A5F' } },
          alignment: { vertical: 'center' },
        };
      }
    }
    dataWs['!freeze'] = { xSplit: 0, ySplit: 1 };

    XLSX.utils.book_append_sheet(wb, dataWs, 'Data');

    // ---------- SHEET 2: Instructions ----------
    const instructionsHeader = ['Column', 'Type', 'Required', 'Description', 'Allowed values / format', 'References'];
    const instructionRows = def.fields.map(f => [
      f.name,
      sqliteTypeToFriendly(f.type),
      f.required ? 'YES' : 'no',
      f.description || '',
      f.enum ? f.enum.join(', ') : (f.name === 'period' ? 'YYYY-MM (e.g. 2024-03)' : ''),
      f.references || '',
    ]);

    const intro = [
      [`${def.label} — Upload Template`],
      [def.description],
      [],
      ['How to use this template:'],
      ['1. Fill in your data on the "Data" sheet, starting from row 2.'],
      ['2. Required columns are marked YES below — every row must have a value for these.'],
      ['3. "Period" must be in YYYY-MM format (e.g. 2024-03 for March 2024).'],
      ['4. Foreign keys (the "References" column) must match an existing entity_id or account_code.'],
      ['5. Save the file, then upload it via the "Upload file" button in the FinAgent workspace.'],
      ['6. The agent pipeline will detect the schema, validate, and load your data.'],
      [],
      ['Column reference:'],
      [],
      instructionsHeader,
      ...instructionRows,
    ];
    const instWs = XLSX.utils.aoa_to_sheet(intro);
    instWs['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 50 }, { wch: 30 }, { wch: 24 }];
    // Bold the title row
    if (instWs['A1']) instWs['A1'].s = { font: { bold: true, sz: 14 } };
    // Bold the column header row
    const headerRowIdx = intro.length - instructionRows.length - 1;
    for (let i = 0; i < instructionsHeader.length; i++) {
      const addr = XLSX.utils.encode_cell({ c: i, r: headerRowIdx });
      if (instWs[addr]) instWs[addr].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1E3A5F' } },
      };
    }
    XLSX.utils.book_append_sheet(wb, instWs, 'Instructions');

    // ---------- SHEET 3: Lookups (only for tables with FK fields) ----------
    const fkFields = def.fields.filter(f => f.references);
    if (fkFields.length > 0) {
      const lookups = [['Field', 'Valid values from your existing data']];
      for (const f of fkFields) {
        const [refTable, refField] = f.references.split('.');
        try {
          const vals = db.prepare(`SELECT DISTINCT ${refField} AS v FROM ${refTable} ORDER BY ${refField} LIMIT 200`).all();
          lookups.push([`${f.name} (refs ${f.references})`, vals.map(r => r.v).join(', ')]);
        } catch { /* skip */ }
      }
      // Also add enum field options
      for (const f of def.fields.filter(x => x.enum)) {
        lookups.push([`${f.name} (enum)`, f.enum.join(', ')]);
      }
      const lookupWs = XLSX.utils.aoa_to_sheet(lookups);
      lookupWs['!cols'] = [{ wch: 28 }, { wch: 80 }];
      XLSX.utils.book_append_sheet(wb, lookupWs, 'Allowed Values');
    }

    // ---------- Output ----------
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    const filename = mode === 'data'
      ? `${tableName}_export_${new Date().toISOString().slice(0, 10)}.xlsx`
      : `${tableName}_template.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  });

  return router;
}

function sqliteTypeToFriendly(t) {
  switch (t) {
    case 'TEXT': return 'Text';
    case 'INTEGER': return 'Whole number';
    case 'REAL': return 'Number';
    default: return t;
  }
}
