import { z } from 'zod';

/** Langues des contenus publics (paramètre `lang` du contrat, `components.parameters.Lang`). */
export const LANGS = ['fr', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/** Langue de référence : celle des colonnes ordinaires et du repli d'un contenu non traduit. */
export const DEFAULT_LANG: Lang = 'fr';

/** `lang` facultatif, `fr` par défaut ; toute autre valeur → 400 `invalid-query` (via `ZodValidationPipe`). */
export const langSchema = z.enum(LANGS).default(DEFAULT_LANG);

/** Paramètres de requête des opérations qui n'acceptent que `lang` (les paramètres inconnus sont ignorés). */
export const langQuerySchema = z.object({ lang: langSchema });
export type LangQuery = z.output<typeof langQuerySchema>;

/** Paramètre `preview` (jeton de prévisualisation du back-office) des pages, rubriques et services. */
export const previewSchema = z.string().max(2000).optional();
