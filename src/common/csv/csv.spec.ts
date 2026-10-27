import { describe, expect, it } from 'vitest';
import { attachmentDisposition, csvCell, toCsv } from './csv.js';

describe('csvCell', () => {
  it('met chaque valeur entre guillemets et double les guillemets', () => {
    expect(csvCell('Dîner « 60 ans »')).toBe('"Dîner « 60 ans »"');
    expect(csvCell('Il a dit "oui"')).toBe('"Il a dit ""oui"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
  });

  it('neutralise les formules (=, +, -, @, tabulation, retour chariot)', () => {
    expect(csvCell('=HYPERLINK("https://x.invalid")')).toBe('"\'=HYPERLINK(""https://x.invalid"")"');
    expect(csvCell('+SUM(A1:A2)')).toBe('"\'+SUM(A1:A2)"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
    expect(csvCell('@cmd')).toBe('"\'@cmd"');
    expect(csvCell('\tcalc')).toBe('"\'\tcalc"');
  });

  it('laisse lisibles les nombres et numéros de téléphone', () => {
    expect(csvCell('+237612345678')).toBe('"+237612345678"');
    expect(csvCell('-12,5')).toBe('"-12,5"');
    expect(csvCell('Akwa, Douala')).toBe('"Akwa, Douala"');
  });
});

describe('toCsv', () => {
  it('écrit le BOM, l’en-tête et des lignes CRLF séparées par des points-virgules', () => {
    expect(
      toCsv(
        ['Nom', 'Ville'],
        [
          ['Aurélie', 'Douala'],
          ['Paul', null],
        ],
      ),
    ).toBe(`${String.fromCharCode(0xfeff)}"Nom";"Ville"\r\n"Aurélie";"Douala"\r\n"Paul";""`);
  });
});

describe('attachmentDisposition', () => {
  it('donne un nom de fichier ASCII', () => {
    expect(attachmentDisposition('demandes-2026-10-27.csv')).toBe(
      'attachment; filename="demandes-2026-10-27.csv"',
    );
    expect(attachmentDisposition('données "x".json')).toBe('attachment; filename="donn_es__x_.json"');
  });
});
