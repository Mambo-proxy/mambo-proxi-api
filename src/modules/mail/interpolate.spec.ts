import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  interpolate,
  interpolateHtml,
  normalizeVariableName,
  sanitizeValue,
  toHeaderText,
} from './interpolate.js';
import { buildVariables } from './template-definitions.js';

describe('interpolate', () => {
  const variables = { prenom: 'Aurélie', reference: 'MP-2026-0142', service: 'Chef privé' };

  it('remplace les variables du back-office, accents et majuscules compris', () => {
    expect(interpolate('Merci {prénom}, demande {Référence} pour « {service} ».', variables)).toBe(
      'Merci Aurélie, demande MP-2026-0142 pour « Chef privé ».',
    );
  });

  it('accepte aussi la syntaxe à doubles accolades', () => {
    expect(interpolate('Bonjour {{prenom}} ({{ reference }})', variables)).toBe(
      'Bonjour Aurélie (MP-2026-0142)',
    );
  });

  it('retire une variable inconnue ou vide et nettoie la phrase', () => {
    expect(interpolate('Merci {prénom}, votre demande est bien arrivée', {})).toBe(
      'Merci, votre demande est bien arrivée',
    );
    expect(interpolate('{prénom}, ce créneau vous convient-il ?', {})).toBe('Ce créneau vous convient-il ?');
    expect(interpolate('À bientôt {prénom} !', {})).toBe('À bientôt !');
    expect(interpolate('See you soon {prénom}!', {}, 'en')).toBe('See you soon!');
    expect(interpolate('{nom} demande « {service} » à {quartier}.', { nom: 'Paul', service: 'Colis' })).toBe(
      'Paul demande « Colis ».',
    );
    expect(interpolate('Valeur {inconnue} ici', variables)).toBe('Valeur ici');
  });

  it('laisse le HTML d’une valeur sous forme de texte (échappé ensuite par le gabarit)', () => {
    expect(interpolate('Merci {prénom}', { prenom: '<script>alert(1)</script>' })).toBe(
      'Merci <script>alert(1)</script>',
    );
  });

  it('retire les caractères de contrôle des valeurs', () => {
    expect(sanitizeValue(`Aur${String.fromCharCode(0)}élie${String.fromCharCode(0x2028)}`)).toBe('Aurélie');
  });

  it('normalise les noms de variables', () => {
    expect(normalizeVariableName('Événement')).toBe('evenement');
    expect(normalizeVariableName('firstName')).toBe('firstname');
  });
});

describe('interpolateHtml', () => {
  it('échappe chaque valeur insérée dans un corps HTML', () => {
    expect(interpolateHtml('<p>Bonjour {prénom},</p>', { prenom: '<img src=x onerror="alert(1)">' })).toBe(
      '<p>Bonjour &lt;img src=x onerror=&quot;alert(1)&quot;&gt;,</p>',
    );
  });

  it('échappe les cinq caractères spéciaux', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('toHeaderText', () => {
  it('ramène l’objet sur une seule ligne (pas d’injection d’en-tête)', () => {
    expect(toHeaderText('Objet\r\nBcc: pirate@example.com')).toBe('Objet Bcc: pirate@example.com');
  });
});

describe('buildVariables', () => {
  it('relie les variables françaises aux données de la tâche', () => {
    const variables = buildVariables(
      {
        firstName: 'Aurélie',
        lastName: 'Mbarga',
        reference: 'MP-2026-0142',
        serviceName: 'Chef privé',
        startsAt: '2026-11-12T13:00:00.000Z',
      },
      'fr',
    );

    expect(variables).toMatchObject({
      prenom: 'Aurélie',
      nom: 'Aurélie Mbarga',
      reference: 'MP-2026-0142',
      service: 'Chef privé',
      date: 'jeudi 12 novembre 2026 à 14:00',
      heure: '14:00',
      firstname: 'Aurélie',
    });
  });

  it('formate les dates à l’heure de Douala dans la langue du message', () => {
    expect(buildVariables({ startsAt: '2026-11-12T13:00:00.000Z' }, 'en')['date']).toBe(
      'Thursday 12 November 2026 at 14:00',
    );
    expect(buildVariables({ dateLabel: 'demain matin' }, 'fr')['date']).toBe('demain matin');
  });
});
