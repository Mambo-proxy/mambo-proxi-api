-- Empreintes des textes français traduits en anglais (nom, description, réponse, textes des quartiers) : statut
-- « à revoir » des traductions des zones (`AdminZone.translationStatus`). Les zones existantes gardent `NULL` :
-- leurs traductions sont considérées à jour, puis suivies dès le prochain enregistrement.

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "translation_hashes" JSONB;
