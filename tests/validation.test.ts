import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fsPromises from 'fs/promises';
import {
  isPathInsideVault,
  isAllowedHost,
  isAllowedOrigin,
  ConfigSchema,
  RefineVaultSchema,
  DuplicatesResolveSchema,
  ArchiveDuplicatesSchema,
  DirectoryAuditSchema
} from '../src/server/validation';

describe('A3: Security & Validation', () => {
  const testVault = path.join(process.cwd(), 'tests', '_temp_vault_sec');

  beforeEach(async () => {
    await fsPromises.rm(testVault, { recursive: true, force: true });
    await fsPromises.mkdir(testVault, { recursive: true });
  });

  afterEach(async () => {
    await fsPromises.rm(testVault, { recursive: true, force: true });
  });

  describe('Host & Origin Verification', () => {
    it('allows localhost and 127.0.0.1 hosts', () => {
      expect(isAllowedHost('localhost')).toBe(true);
      expect(isAllowedHost('localhost:3000')).toBe(true);
      expect(isAllowedHost('127.0.0.1')).toBe(true);
      expect(isAllowedHost('127.0.0.1:3000')).toBe(true);
      expect(isAllowedHost('0.0.0.0:3000')).toBe(true);
    });

    it('rejects external/evil Host headers', () => {
      expect(isAllowedHost('evil.com')).toBe(false);
      expect(isAllowedHost('evil.com:3000')).toBe(false);
      expect(isAllowedHost('attacker.net')).toBe(false);
      expect(isAllowedHost(undefined)).toBe(false);
    });

    it('allows localhost, 127.0.0.1 and omitted origins', () => {
      expect(isAllowedOrigin(undefined)).toBe(true);
      expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
      expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
    });

    it('rejects malicious origins', () => {
      expect(isAllowedOrigin('http://evil.com')).toBe(false);
      expect(isAllowedOrigin('https://malicious-site.org')).toBe(false);
      expect(isAllowedOrigin('not-a-valid-url')).toBe(false);
    });
  });

  describe('isPathInsideVault', () => {
    it('accepts paths strictly within vault', () => {
      const validNote = path.join(testVault, '01_Projects', 'note.md');
      expect(isPathInsideVault(validNote, testVault)).toBe(true);
      expect(isPathInsideVault('01_Projects/note.md', testVault)).toBe(true);
    });

    it('rejects path traversal attempts', () => {
      expect(isPathInsideVault('/etc/passwd', testVault)).toBe(false);
      expect(isPathInsideVault('../../etc/passwd', testVault)).toBe(false);
      expect(isPathInsideVault(path.join(testVault, '..', 'secret.txt'), testVault)).toBe(false);
      expect(isPathInsideVault(testVault, testVault)).toBe(false); // Vault root itself is not an inside file
      expect(isPathInsideVault(testVault, testVault, true)).toBe(true); // When allowRoot is true, vault root is accepted
    });
  });

  describe('ConfigSchema validation', () => {
    it('validates a correct configuration', () => {
      const valid = {
        vaultPath: testVault,
        llamaUrl: 'http://127.0.0.1:8080',
        timeoutSeconds: 120,
        maxContextChars: 2000,
      };
      const res = ConfigSchema.safeParse(valid);
      expect(res.success).toBe(true);
    });

    it('rejects relative or non-existent vaultPath', () => {
      const invalid = {
        vaultPath: '../../etc',
        llamaUrl: 'http://127.0.0.1:8080',
        timeoutSeconds: 120,
        maxContextChars: 2000,
      };
      const res = ConfigSchema.safeParse(invalid);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].path).toContain('vaultPath');
      }
    });

    it('rejects invalid llamaUrl with path traversal or bad protocol', () => {
      const invalid = {
        vaultPath: testVault,
        llamaUrl: 'ftp://localhost:8080/../api',
        timeoutSeconds: 120,
        maxContextChars: 2000,
      };
      const res = ConfigSchema.safeParse(invalid);
      expect(res.success).toBe(false);
    });

    it('enforces bounds on timeoutSeconds and maxContextChars', () => {
      const invalidTimeout = {
        vaultPath: testVault,
        llamaUrl: 'http://127.0.0.1:8080',
        timeoutSeconds: 0,
        maxContextChars: 2000,
      };
      expect(ConfigSchema.safeParse(invalidTimeout).success).toBe(false);

      const invalidChars = {
        vaultPath: testVault,
        llamaUrl: 'http://127.0.0.1:8080',
        timeoutSeconds: 120,
        maxContextChars: 100, // < 500
      };
      expect(ConfigSchema.safeParse(invalidChars).success).toBe(false);
    });
  });

  describe('RefineVaultSchema and DuplicatesResolveSchema', () => {
    it('parses RefineVaultSchema with defaults', () => {
      const res = RefineVaultSchema.parse({});
      expect(res.force).toBe(false);
      expect(res.dryRun).toBe(false);

      const custom = RefineVaultSchema.parse({ force: true, dryRun: true });
      expect(custom.force).toBe(true);
      expect(custom.dryRun).toBe(true);
    });

    it('validates decision model defaults in ConfigSchema', () => {
      const valid = {
        vaultPath: testVault,
        llamaUrl: 'http://127.0.0.1:8080',
        timeoutSeconds: 120,
        maxContextChars: 2000,
      };
      const parsed = ConfigSchema.parse(valid);
      expect(parsed.decisionModelUrl).toBe('http://127.0.0.1:1234');
      expect(parsed.enableDecisionModel).toBe(false);
      expect(parsed.decisionConfidenceThreshold).toBe(0.80);
      expect(parsed.decisionMode).toBe('hybrid');
      expect(parsed.autoMoveEnabled).toBe(false);
      expect(parsed.topLevelCategories).toContain('Project');
      expect(parsed.topLevelCategories).toContain('Poem');
      expect(parsed.typeRoutes['Poem']).toBe('03_Knowledge/Poems');
    });

    it('validates DuplicatesResolveSchema and ArchiveDuplicatesSchema', () => {

      expect(DuplicatesResolveSchema.safeParse({ resolvedPaths: ['note1.md'] }).success).toBe(true);
      expect(DuplicatesResolveSchema.safeParse({ resolvedPaths: [] }).success).toBe(false);

      expect(ArchiveDuplicatesSchema.safeParse({ paths: ['note1.md'] }).success).toBe(true);
      expect(ArchiveDuplicatesSchema.safeParse({ paths: [] }).success).toBe(false);
    });

    it('validates DirectoryAuditSchema accepts empty string for whole vault auditing', () => {
      expect(DirectoryAuditSchema.safeParse({ relativeDir: '' }).success).toBe(true);
      expect(DirectoryAuditSchema.safeParse({}).success).toBe(true);
      expect(DirectoryAuditSchema.safeParse({ relativeDir: '01_Projects' }).success).toBe(true);
    });
  });
});
