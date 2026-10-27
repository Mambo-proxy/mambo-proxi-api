import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Redirection permanente après le changement d'adresse d'un contenu publié (slug ou rubrique d'un service, slug
 * d'une rubrique), servie par `GET /v1/site/redirects`. Les redirections qui menaient à l'ancienne adresse sont
 * reportées sur la nouvelle (pas de chaîne de redirections) ; une redirection partant de la nouvelle adresse (retour
 * à un ancien slug) est supprimée, pour ne pas créer de boucle.
 */
export async function recordRedirect(
  client: Pick<Prisma.TransactionClient, 'redirect'>,
  from: string,
  to: string,
  entity: { name: string; id: string },
): Promise<boolean> {
  if (from === to || from.includes('#') || to.includes('#')) return false;
  await client.redirect.deleteMany({ where: { fromPath: to } });
  await client.redirect.updateMany({ where: { toPath: from }, data: { toPath: to } });
  await client.redirect.upsert({
    where: { fromPath: from },
    create: { fromPath: from, toPath: to, permanent: true, entity: entity.name, entityId: entity.id },
    update: { toPath: to, permanent: true, entity: entity.name, entityId: entity.id },
    select: { id: true },
  });
  return true;
}
