import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SchoolsService } from './schools.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('SchoolsService', () => {
  let prisma: any;
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: SchoolsService;

  const SELECTED = {
    id: 'sch-1',
    code: 'SD-01',
    name: 'SD Harapan',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    _count: { users: 2, students: 10, extracurriculars: 3 },
  };

  beforeEach(() => {
    prisma = {
      school: {
        findUnique: vi.fn().mockResolvedValue(SELECTED),
        findMany: vi.fn().mockResolvedValue([SELECTED]),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn().mockResolvedValue({ id: 'sch-1', code: 'SD-01', name: 'SD Harapan' }),
        update: vi.fn().mockResolvedValue({}),
      },
      role: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 2, code: 'ADMIN' }) },
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'u1', fullName: 'Admin Baru', email: 'a@b.test' }),
      },
      $transaction: vi.fn((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    service = new SchoolsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  });

  describe('create', () => {
    it('kode sudah dipakai → ConflictException', async () => {
      prisma.school.findUnique.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.create(
          { code: 'SD-01', name: 'X', adminFullName: 'A', adminEmail: 'a@b.test', adminPassword: 'Secret123' },
          { id: 'super-1', ip: null },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('email admin sudah dipakai → ConflictException', async () => {
      prisma.school.findUnique.mockResolvedValueOnce(null); // code bebas
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'clash' });
      await expect(
        service.create(
          { code: 'SD-02', name: 'X', adminFullName: 'A', adminEmail: 'a@b.test', adminPassword: 'Secret123' },
          { id: 'super-1', ip: null },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('sukses → school + admin dibuat dalam transaksi, audit CREATE_SCHOOL', async () => {
      prisma.school.findUnique
        .mockResolvedValueOnce(null) // cek kode
        .mockResolvedValueOnce(SELECTED); // getById setelah create
      const res = await service.create(
        {
          code: 'SD-01',
          name: 'SD Harapan',
          adminFullName: 'Admin Satu',
          adminEmail: 'admin@sd01.test',
          adminPassword: 'Secret123',
        },
        { id: 'super-1', ip: '1.2.3.4' },
      );
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ roleId: 2, schoolId: 'sch-1', email: 'admin@sd01.test' }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_SCHOOL', entityId: 'sch-1' }),
      );
      expect(res).toMatchObject({ id: 'sch-1', code: 'SD-01', userCount: 2, studentCount: 10 });
    });
  });

  describe('addAdmin', () => {
    it('sekolah tidak ada → NotFoundException', async () => {
      prisma.school.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.addAdmin(
          'nope',
          { fullName: 'A', email: 'a@b.test', password: 'Secret123' },
          { id: 'super-1', ip: null },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sukses → user ADMIN baru terikat ke school.id, audit CREATE_SCHOOL_ADMIN', async () => {
      prisma.school.findUnique.mockResolvedValueOnce({ id: 'sch-1', isActive: true });
      const res = await service.addAdmin(
        'sch-1',
        { fullName: 'Admin Dua', email: 'admin2@sd01.test', password: 'Secret123' },
        { id: 'super-1', ip: null },
      );
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ schoolId: 'sch-1', roleId: 2 }) }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_SCHOOL_ADMIN' }),
      );
      expect(res).toMatchObject({ id: 'u1' });
    });
  });

  describe('suspend / resume', () => {
    it('suspend → isActive=false + audit SUSPEND_SCHOOL', async () => {
      await service.suspend('sch-1', { id: 'super-1', ip: null });
      expect(prisma.school.update).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
        data: { isActive: false },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUSPEND_SCHOOL' }));
    });

    it('resume → isActive=true + audit RESUME_SCHOOL', async () => {
      await service.resume('sch-1', { id: 'super-1', ip: null });
      expect(prisma.school.update).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
        data: { isActive: true },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RESUME_SCHOOL' }));
    });

    it('sekolah tidak ada → NotFoundException', async () => {
      prisma.school.findUnique.mockResolvedValueOnce(null);
      await expect(service.suspend('nope', { id: 'super-1', ip: null })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('memetakan _count ke userCount/studentCount/extracurricularCount', async () => {
      const res = await service.list({ page: 1, pageSize: 20 } as never);
      expect((res.data as any[])[0]).toMatchObject({
        userCount: 2,
        studentCount: 10,
        extracurricularCount: 3,
      });
    });
  });
});
