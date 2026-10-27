import { describe, expect, it } from 'vitest';
import { sanitizeRichText } from './rich-text.js';

describe('sanitizeRichText', () => {
  it('garde les balises autorisées (titres, gras, listes, liens, citations)', () => {
    const html =
      '<h2>Éditeur</h2><p>Le site est édité par <strong>MAMBO Proxi</strong>, <em>Douala</em>.<br>Contact :</p>' +
      '<ul><li><a href="mailto:contact@mamboproxi.com">contact@mamboproxi.com</a></li>' +
      '<li><a href="tel:+237600000000">+237 6 00 00 00 00</a></li></ul><ol><li>Un</li></ol>' +
      '<blockquote>Citation</blockquote><h3>Hébergeur</h3><h4>Détail</h4>';
    expect(sanitizeRichText(html)).toBe(html.replace('<br>', '<br />'));
    // Idempotent : la sauvegarde automatique renvoie le HTML déjà assaini.
    expect(sanitizeRichText(sanitizeRichText(html))).toBe(sanitizeRichText(html));
  });

  it('convertit b et i, retire les attributs autres que href', () => {
    expect(
      sanitizeRichText(
        '<p class="x" style="color:red" onclick="alert(1)"><b>Gras</b> <i>italique</i> <a href="https://exemple.fr" target="_blank" onmouseover="x()">lien</a></p>',
      ),
    ).toBe('<p><strong>Gras</strong> <em>italique</em> <a href="https://exemple.fr">lien</a></p>');
  });

  it('retire les liens dangereux ou vers un autre site sans protocole, en gardant leur texte', () => {
    expect(sanitizeRichText('<p><a href="javascript:alert(1)">piège</a></p>')).toBe('<p>piège</p>');
    expect(sanitizeRichText('<p><a href="JaVaScRiPt:alert(1)">piège</a></p>')).toBe('<p>piège</p>');
    expect(sanitizeRichText('<p><a href="data:text/html;base64,PHNjcmlwdD4=">x</a></p>')).toBe('<p>x</p>');
    expect(sanitizeRichText('<p><a href="//evil.example">x</a></p>')).toBe('<p>x</p>');
    expect(sanitizeRichText('<p><a>sans lien</a></p>')).toBe('<p>sans lien</p>');
    expect(sanitizeRichText('<p><a href="java&#x09;script:alert(1)">x</a></p>')).toBe('<p>x</p>');
  });

  it('accepte les liens relatifs au site et les ancres', () => {
    expect(
      sanitizeRichText(
        '<p><a href="javascript:x()">a</a> <a href="/confidentialite">politique</a> <a href="#cookies">ici</a></p>',
      ),
    ).toBe('<p>a <a href="/confidentialite">politique</a> <a href="#cookies">ici</a></p>');
  });

  it('supprime scripts, styles, iframes et images avec leur contenu', () => {
    expect(
      sanitizeRichText(
        '<p>Texte</p><script>alert(1)</script><style>p{}</style><iframe src="https://x"></iframe><img src=x onerror=alert(1)><div><span>garde</span></div>',
      ),
    ).toBe('<p>Texte</p>garde');
  });

  it('échappe le texte et ferme les balises ouvertes', () => {
    expect(sanitizeRichText('<p>1 < 2 & "ok"')).toBe('<p>1 &lt; 2 &amp; "ok"</p>');
  });
});
