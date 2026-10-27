-- Clés de recherche sans accents ni casse, tenues à jour par l'API (`src/common/text/search-key.ts`) :
-- recherche `q` des demandes et des contacts, filtre `district` (« quartier » en début de ville) et indicateur
-- « Douala et environs » du back-office. Évite l'extension `unaccent` (filtres Prisma ordinaires).

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "city_key" TEXT,
ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- Valeurs des lignes existantes (mêmes règles que l'API pour les lettres accentuées latines courantes).
UPDATE "contacts"
SET "search_text" = btrim(regexp_replace(lower(translate(concat_ws(' ', "full_name", "email", "organization"), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿŸ', 'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyY')), '\s+', ' ', 'g')),
    "city_key" = btrim(regexp_replace(lower(translate("city", 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿŸ', 'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyY')), '\s+', ' ', 'g'));

UPDATE "requests"
SET "search_text" = btrim(regexp_replace(lower(translate(concat_ws(' ', "reference", "subject"), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿŸ', 'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyY')), '\s+', ' ', 'g'));
