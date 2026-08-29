import ExcelJS from 'exceljs';

import type { AttendanceReportDataset } from './attendance-dataset.js';

/**
 * Format Excel: data mentah tabular (satu baris per siswa per ekskul), header
 * kolom jelas, siap diolah lebih lanjut oleh sekolah.
 */
export async function renderAttendanceXlsx(ds: AttendanceReportDataset): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ekosistem Presensi & Perkembangan Ekstrakurikuler SD';
  wb.created = new Date();

  const meta = wb.addWorksheet('Info');
  meta.columns = [
    { header: 'Parameter', key: 'k', width: 22 },
    { header: 'Nilai', key: 'v', width: 48 },
  ];
  meta.addRows([
    { k: 'Jenis laporan', v: 'Kehadiran & perkembangan ekstrakurikuler' },
    { k: 'Rentang tanggal', v: `${ds.filters.dateFrom} s/d ${ds.filters.dateTo}` },
    { k: 'Filter kelas', v: ds.filters.classGrade ?? '(semua)' },
    { k: 'Filter ekskul', v: ds.filters.extracurricularId ?? '(semua)' },
    { k: 'Jumlah baris', v: ds.rows.length },
    { k: 'Dibuat pada', v: ds.generatedAt },
  ]);
  meta.getRow(1).font = { bold: true };

  const ws = wb.addWorksheet('Data');
  ws.columns = [
    { header: 'NIS', key: 'nis', width: 16 },
    { header: 'Nama Siswa', key: 'studentName', width: 28 },
    { header: 'Kelas', key: 'classGrade', width: 8 },
    { header: 'Ekstrakurikuler', key: 'extracurricularName', width: 22 },
    { header: 'Kategori', key: 'category', width: 14 },
    { header: 'Pembina', key: 'coachName', width: 22 },
    { header: 'Total Sesi', key: 'totalSessions', width: 11 },
    { header: 'Sesi Tercatat', key: 'recordedSessions', width: 13 },
    { header: 'Hadir', key: 'present', width: 8 },
    { header: 'Izin', key: 'izin', width: 8 },
    { header: 'Sakit', key: 'sakit', width: 8 },
    { header: 'Alpa', key: 'alpa', width: 8 },
    { header: '% Kehadiran', key: 'attendancePct', width: 12 },
    { header: 'Rata2 Keaktifan', key: 'avgActiveness', width: 15 },
    { header: 'Catatan Pembina', key: 'notes', width: 60 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const r of ds.rows) {
    ws.addRow({
      nis: r.nis,
      studentName: r.studentName,
      classGrade: r.classGrade,
      extracurricularName: r.extracurricularName,
      category: r.category ?? '',
      coachName: r.coachName ?? '',
      totalSessions: r.totalSessions,
      recordedSessions: r.recordedSessions,
      present: r.present,
      izin: r.izin,
      sakit: r.sakit,
      alpa: r.alpa,
      attendancePct: r.attendancePct,
      avgActiveness: r.avgActiveness ?? '',
      notes: r.notes.join(' | '),
    });
  }
  ws.autoFilter = { from: 'A1', to: 'O1' };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
