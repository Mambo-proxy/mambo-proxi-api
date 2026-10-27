import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth/auth.types.js';
import { permissionsOf } from '../auth/permissions.js';
import { requestFiltersWhere, requestViewer } from './request-filters.js';
import {
  assigneeIdsOf,
  compareByUrgency,
  eventLabel,
  isOverdue,
  requestFields,
  requestPayload,
  requestWhatsappUrl,
} from './request.mapper.js';
import { listRequestsQuerySchema, updateRequestInputSchema } from './request.schemas.js';

const NOW = new Date('2026-10-27T09:00:00.000Z');
const names = new Map([['usr_paul', 'Paul Ngando']]);

function auth(role: 'ADMIN' | 'AGENT'): AuthContext {
  return {
    user: {
      id: `usr_${role.toLowerCase()}`,
      email: 'x@example.com',
      name: 'X',
      role,
      isActive: true,
      activatedAt: NOW,
      lastLoginAt: null,
      lastActiveAt: null,
    },
    sessionId: 'ses_1',
    permissions: permissionsOf(role),
  };
}

describe('eventLabel', () => {
  it('calcule le libellé de chaque événement à partir de `data`', () => {
    expect(eventLabel('RECEIVED', null, names)).toBe('Demande reçue via le formulaire');
    expect(eventLabel('STATUS_CHANGED', { from: 'NOUVELLE', to: 'EN_COURS' }, names)).toBe(
      'Statut : Nouvelle → En cours',
    );
    expect(eventLabel('ASSIGNED', { assignedToId: 'usr_paul' }, names)).toBe('Assignée à Paul Ngando');
    expect(eventLabel('ASSIGNED', { assignedToId: 'usr_x', assignedToName: 'Ancien' }, names)).toBe(
      'Assignée à Ancien',
    );
    expect(eventLabel('ASSIGNED', { assignedToId: null }, names)).toBe('Assignation retirée');
    expect(eventLabel('SURVEY_SCHEDULED', { delayHours: 24 }, names)).toBe(
      'Questionnaire de satisfaction programmé (dans 24 h)',
    );
    expect(eventLabel('EMAIL_SENT', { template: 'team-assignment' }, names)).toBe(
      'E-mail d’assignation envoyé',
    );
    expect(eventLabel('DUPLICATED', { fromReference: 'MP-2026-0142' }, names)).toBe(
      'Copie de la demande MP-2026-0142',
    );
    expect(eventLabel('ANONYMIZED', null, names)).toBe('Demande anonymisée (RGPD)');
  });

  it('retrouve les personnes assignées citées dans l’historique', () => {
    expect(
      assigneeIdsOf([
        { kind: 'ASSIGNED', data: { assignedToId: 'usr_paul' } },
        { kind: 'ASSIGNED', data: { assignedToId: null } },
        { kind: 'ASSIGNED', data: { assignedToId: 'usr_paul' } },
        { kind: 'RECEIVED', data: null },
      ]),
    ).toEqual(['usr_paul']);
  });
});

describe('détail d’une demande', () => {
  it('sépare les champs affichés des valeurs du formulaire', () => {
    const payload = {
      needs: { guests: 12 },
      fields: [{ key: 'guests', label: 'Personnes', value: '12' }, { label: 'sans valeur' }],
    };
    expect(requestFields(payload)).toEqual([{ key: 'guests', label: 'Personnes', value: '12' }]);
    expect(requestPayload(payload)).toEqual({ needs: { guests: 12 } });
    expect(requestFields(null)).toEqual([]);
  });

  it('prépare le lien WhatsApp de l’exemple du contrat', () => {
    expect(
      requestWhatsappUrl(
        { phone: '+237 6 12 34 56 78', fullName: 'Aurélie Kamga', firstName: null },
        'MP-2026-0142',
      ),
    ).toBe(
      'https://wa.me/237612345678?text=Bonjour%20Aur%C3%A9lie%2C%20c%27est%20Mambo%20Proxi%20au%20sujet%20de%20votre%20demande%20MP-2026-0142.',
    );
    expect(requestWhatsappUrl({ phone: null, fullName: 'X', firstName: null }, 'MP-2026-0142')).toBeNull();
  });

  it('classe les demandes ouvertes par urgence', () => {
    const at = (hours: number | null) =>
      hours === null ? null : new Date(NOW.getTime() + hours * 3_600_000);
    const rows = [
      { id: 'sans', status: 'NOUVELLE' as const, dueAt: at(null), createdAt: NOW },
      { id: 'demain', status: 'EN_COURS' as const, dueAt: at(24), createdAt: NOW },
      { id: 'retard', status: 'EN_COURS' as const, dueAt: at(-2), createdAt: NOW },
      { id: 'bientot', status: 'NOUVELLE' as const, dueAt: at(1), createdAt: NOW },
    ];
    expect([...rows].sort((a, b) => compareByUrgency(a, b, NOW)).map((row) => row.id)).toEqual([
      'retard',
      'bientot',
      'demain',
      'sans',
    ]);
    expect(isOverdue({ status: 'CLOTUREE', dueAt: at(-2) }, NOW)).toBe(false);
  });
});

describe('filtres de la liste', () => {
  it('valide les paramètres et applique les valeurs par défaut', () => {
    expect(listRequestsQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: { field: 'createdAt', direction: 'desc' },
    });
    expect(listRequestsQuerySchema.parse({ sort: 'reference', q: '' })).toMatchObject({
      sort: { field: 'reference', direction: 'asc' },
      q: undefined,
    });
    expect(listRequestsQuerySchema.safeParse({ sort: '-email' }).success).toBe(false);
    expect(listRequestsQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(listRequestsQuerySchema.safeParse({ assignee: 'none' }).success).toBe(true);
  });

  it('limite le chargé de clientèle à ses demandes, toujours sans les demandes anonymisées', () => {
    const agent = requestFiltersWhere({}, requestViewer(auth('AGENT')), NOW);
    expect(agent).toEqual({ AND: [{ anonymizedAt: null, assignedToId: 'usr_agent' }] });
    const admin = requestFiltersWhere(
      { district: 'Makèpè', q: 'Hervé', assignee: 'me' },
      requestViewer(auth('ADMIN')),
      NOW,
    );
    expect(admin).toEqual({
      AND: [
        { anonymizedAt: null },
        { contact: { cityKey: { startsWith: 'makepe' } } },
        { assignedToId: 'usr_admin' },
        { OR: [{ searchText: { contains: 'herve' } }, { contact: { searchText: { contains: 'herve' } } }] },
      ],
    });
  });

  it('borne « aujourd’hui » à la journée de Douala', () => {
    const where = requestFiltersWhere({ due: 'today' }, requestViewer(auth('ADMIN')), NOW);
    expect(where.AND).toContainEqual({
      status: { in: ['NOUVELLE', 'EN_COURS'] },
      dueAt: { gte: new Date('2026-10-26T23:00:00.000Z'), lt: new Date('2026-10-27T23:00:00.000Z') },
    });
  });

  it('exige au moins une modification', () => {
    expect(updateRequestInputSchema.safeParse({}).success).toBe(false);
    expect(updateRequestInputSchema.safeParse({ assignedToId: null }).success).toBe(true);
    expect(updateRequestInputSchema.safeParse({ dueAt: '2026-12-01T09:00:00+01:00' }).success).toBe(true);
  });
});
