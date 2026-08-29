import PDFDocument from 'pdfkit';

import type { AttendanceReportDataset, AttendanceReportRow } from './attendance-dataset.js';

/**
 * Format PDF: menyerupai lembar rapor ekskul per siswa (nama, kelas, ekskul yang
 * diikuti, persentase kehadiran, ringkasan catatan pembina).
 *
 * Seluruh parameter tampilan dikumpulkan di `THEME` agar mudah di-styling ulang
 * tanpa menyentuh logika layout.
 */
const THEME = {
  margin: 44,
  color: {
    ink: '#1e293b',
    muted: '#64748b',
    line: '#cbd5e1',
    accent: '#0f172a',
    headerBg: '#f1f5f9',
  },
  font: {
    title: 18,
    heading: 13,
    body: 10,
    small: 8.5,
  },
  schoolName: 'SD — Ekosistem Presensi & Perkembangan Ekstrakurikuler',
  reportTitle: 'Laporan Kehadiran & Perkembangan Ekstrakurikuler',
} as const;

function groupByStudent(rows: AttendanceReportRow[]): Map<string, AttendanceReportRow[]> {
  const m = new Map<string, AttendanceReportRow[]>();
  for (const r of rows) {
    const arr = m.get(r.studentId) ?? [];
    arr.push(r);
    m.set(r.studentId, arr);
  }
  return m;
}

export function renderAttendancePdf(ds: AttendanceReportDataset): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: THEME.margin, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width - THEME.margin * 2;
  const byStudent = groupByStudent(ds.rows);

  // ---- Sampul / ringkasan filter ----
  doc.fillColor(THEME.color.accent).fontSize(THEME.font.title).text(THEME.reportTitle);
  doc.moveDown(0.3);
  doc.fillColor(THEME.color.muted).fontSize(THEME.font.small).text(THEME.schoolName);
  doc.moveDown(0.6);
  doc.fillColor(THEME.color.ink).fontSize(THEME.font.body);
  doc.text(`Periode: ${ds.filters.dateFrom} s/d ${ds.filters.dateTo}`);
  doc.text(`Kelas: ${ds.filters.classGrade ?? 'semua kelas'}`);
  doc.text(
    `Ekstrakurikuler: ${ds.filters.extracurricularId ? '1 ekskul terpilih' : 'semua ekskul'}`,
  );
  doc.text(`Jumlah siswa: ${byStudent.size} · baris data: ${ds.rows.length}`);
  doc.text(`Dibuat: ${new Date(ds.generatedAt).toLocaleString('id-ID')}`);

  if (byStudent.size === 0) {
    doc.moveDown(1).fillColor(THEME.color.muted).text('Tidak ada data untuk filter ini.');
    doc.end();
    return done;
  }

  // ---- Satu blok "rapor" per siswa (tiap siswa mulai di halaman baru) ----
  for (const [, studentRows] of byStudent) {
    doc.addPage();
    const s = studentRows[0];

    doc.fillColor(THEME.color.accent).fontSize(THEME.font.heading).text(s.studentName);
    doc
      .fillColor(THEME.color.muted)
      .fontSize(THEME.font.small)
      .text(`Kelas ${s.classGrade}  ·  NIS ${s.nis}`);
    doc.moveDown(0.5);

    // Tabel ekskul
    const cols = [
      { label: 'Ekstrakurikuler', w: 0.26 },
      { label: 'Pembina', w: 0.2 },
      { label: 'Hadir/Sesi', w: 0.13 },
      { label: '% Hadir', w: 0.11 },
      { label: 'Izin', w: 0.07 },
      { label: 'Sakit', w: 0.07 },
      { label: 'Alpa', w: 0.07 },
      { label: 'Keaktifan', w: 0.12 },
    ].map((c) => ({ ...c, width: c.w * pageWidth }));

    const drawRow = (cells: string[], opts: { header?: boolean } = {}) => {
      const y = doc.y;
      const h = opts.header ? 18 : 16;
      if (opts.header) {
        doc.rect(THEME.margin, y, pageWidth, h).fill(THEME.color.headerBg);
      }
      let x = THEME.margin;
      doc
        .fillColor(opts.header ? THEME.color.accent : THEME.color.ink)
        .fontSize(THEME.font.small)
        .font(opts.header ? 'Helvetica-Bold' : 'Helvetica');
      cells.forEach((text, i) => {
        doc.text(text, x + 3, y + 4, { width: cols[i].width - 6, ellipsis: true, lineBreak: false });
        x += cols[i].width;
      });
      doc.font('Helvetica');
      doc
        .moveTo(THEME.margin, y + h)
        .lineTo(THEME.margin + pageWidth, y + h)
        .strokeColor(THEME.color.line)
        .lineWidth(0.5)
        .stroke();
      doc.y = y + h;
    };

    drawRow(
      cols.map((c) => c.label),
      { header: true },
    );
    for (const r of studentRows) {
      drawRow([
        r.extracurricularName,
        r.coachName ?? '-',
        `${r.present}/${r.recordedSessions || r.totalSessions}`,
        `${r.attendancePct}%`,
        String(r.izin),
        String(r.sakit),
        String(r.alpa),
        r.avgActiveness == null ? '-' : r.avgActiveness.toFixed(1),
      ]);
    }

    // Catatan pembina
    doc.moveDown(0.8);
    doc.fillColor(THEME.color.accent).fontSize(THEME.font.body).font('Helvetica-Bold').text('Catatan Pembina');
    doc.font('Helvetica').fillColor(THEME.color.ink).fontSize(THEME.font.small);
    const notes = studentRows.flatMap((r) => r.notes.map((n) => `[${r.extracurricularName}] ${n}`));
    if (notes.length === 0) {
      doc.fillColor(THEME.color.muted).text('Belum ada catatan pembina pada periode ini.');
    } else {
      for (const n of notes) doc.text(`•  ${n}`, { width: pageWidth });
    }
  }

  // ---- Nomor halaman ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .fillColor(THEME.color.muted)
      .fontSize(THEME.font.small)
      .text(
        `Halaman ${i - range.start + 1} dari ${range.count}`,
        THEME.margin,
        doc.page.height - THEME.margin + 10,
        { width: pageWidth, align: 'center' },
      );
  }

  doc.end();
  return done;
}
