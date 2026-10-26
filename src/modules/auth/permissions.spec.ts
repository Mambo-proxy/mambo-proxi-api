import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  PERMISSIONS,
  ROLES,
  hasAnyPermission,
  isAssignableRole,
  permissionsOf,
  roleDefinitions,
} from './permissions.js';

interface Contract {
  components: { schemas: Record<string, { enum?: string[]; description?: string }> };
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
}

const CONTRACT = parse(
  readFileSync(new URL('../../../contracts/openapi.yaml', import.meta.url), 'utf8'),
) as Contract;

/** Matrice du tableau Markdown de la description du schéma `Role` : permission → rôles cochés. */
function contractMatrix(): Map<string, string[]> {
  const description = CONTRACT.components.schemas['Role']?.description ?? '';
  const lines = description.split('\n').filter((line) => line.startsWith('| `'));
  return new Map(
    lines.map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      const permission = (cells[0] ?? '').replaceAll('`', '');
      const roles = ROLES.filter((_, index) => cells[index + 1] === '✓');
      return [permission, roles];
    }),
  );
}

describe('permissions du back-office', () => {
  it("reprennent exactement l'énumération Permission du contrat, dans le même ordre", () => {
    expect([...PERMISSIONS]).toEqual(CONTRACT.components.schemas['Permission']?.enum);
    expect([...ROLES]).toEqual(CONTRACT.components.schemas['Role']?.enum);
  });

  it('appliquent la matrice rôle → permissions du schéma Role', () => {
    const matrix = contractMatrix();
    expect([...matrix.keys()].sort()).toEqual([...PERMISSIONS].sort());
    for (const role of ROLES) {
      const expected = PERMISSIONS.filter((permission) => matrix.get(permission)?.includes(role));
      expect(permissionsOf(role), role).toEqual(expected);
    }
  });

  it("correspondent à l'exemple de GET /v1/admin/roles (libellés, descriptions, permissions)", () => {
    const response = CONTRACT.paths['/v1/admin/roles']?.['get']?.responses['200'] as {
      content: { 'application/json': { examples: { default: { value: unknown } } } };
    };
    expect(roleDefinitions()).toEqual(response.content['application/json'].examples.default.value);
  });

  it('gardent à l’EDITOR l’assignation et l’anonymisation, et au MANAGER les contenus en lecture seule', () => {
    expect(hasAnyPermission('EDITOR', ['requests:assign'])).toBe(true);
    expect(hasAnyPermission('EDITOR', ['requests:anonymize'])).toBe(true);
    expect(hasAnyPermission('MANAGER', ['content:read'])).toBe(true);
    expect(hasAnyPermission('MANAGER', ['content:write', 'media:write'])).toBe(false);
  });

  it('suffisent avec une seule des permissions demandées', () => {
    expect(hasAnyPermission('AGENT', ['requests:read', 'requests:read-assigned'])).toBe(true);
    expect(hasAnyPermission('WRITER', ['requests:read', 'requests:read-assigned'])).toBe(false);
    expect(hasAnyPermission('ADMIN', ['users:manage'])).toBe(true);
    expect(hasAnyPermission('MANAGER', ['users:manage'])).toBe(false);
  });

  it('désignent les rôles assignables (demandes complètes ou assignées)', () => {
    expect(ROLES.filter(isAssignableRole)).toEqual(['ADMIN', 'MANAGER', 'AGENT', 'EDITOR']);
  });
});
