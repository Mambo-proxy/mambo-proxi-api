/**
 * Valeurs du design system utilisées par les e-mails (tokens résolus du dossier de pilotage,
 * `tokens/tokens.ts` ; `docs/02-design-system.md` et `docs/05-api-contract.md` §5 pour le gabarit).
 * Les clients de messagerie ne lisent pas les variables CSS : les valeurs sont recopiées ici, au même nom.
 */
export const mailColors = {
  /** `neutral/100` : fond de la page. */
  pageBackground: '#F1EFEC',
  /** `neutral/0` : carte. */
  card: '#FFFFFF',
  /** `neutral/50` : récapitulatif et pied de page. */
  sunken: '#F8F7F5',
  /** `text/main`. */
  text: '#1C1A18',
  /** `text/muted` (contraste 6,4:1 sur `neutral/50`). */
  textMuted: '#5E5952',
  /** `border/default`. */
  border: '#E4E1DC',
  /** `brand/primary` : bouton, étoiles. */
  primary: '#FF7A00',
  /** `text/on-primary` : texte du bouton orange (contraste 7,5:1). */
  onPrimary: '#1C1A18',
  /** `text/brand` : liens dans le texte (jamais `#FF7A00` pour du texte sur fond clair). */
  textBrand: '#AD5300',
  /** `orange/50`. */
  primarySubtle: '#FDF4EC',
  /** Couleur moyenne de `gradient/lien`, pour les clients qui ignorent les dégradés. */
  ribbonFallback: '#C9A814',
} as const;

/** `gradient/lien` : ruban de 4 px sous l'en-tête. */
export const ribbonGradient = 'linear-gradient(90deg, #7DB928 0%, #C9A814 50%, #FF7A00 100%)';

/** Poppins (titres) et Inter (texte), avec des polices système de repli (la plupart des clients bloquent les polices web). */
export const mailFonts = {
  brand: "Poppins, 'Segoe UI', Helvetica, Arial, sans-serif",
  ui: "Inter, 'Segoe UI', Helvetica, Arial, sans-serif",
} as const;

export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600&display=swap';

/**
 * Logo horizontal du site (`mambo-proxi-web/public/brand/`), affiché en 144 × 40. Version PNG (576 × 160, rendue à
 * partir du SVG) : Gmail et Outlook n'affichent pas les images SVG.
 */
export const LOGO_PATH = '/brand/logo-horizontal.png';
export const LOGO_WIDTH = 144;
export const LOGO_HEIGHT = 40;

/** Largeur de la carte (maquettes : 600 px). */
export const CARD_WIDTH = 600;
