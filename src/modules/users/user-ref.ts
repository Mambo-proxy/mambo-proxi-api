import { userInitials } from '../auth/user-identity.js';

/** Schéma `UserRef` du contrat (membre de l'équipe : assignation, auteur d'une note, d'un événement). */
export interface UserRef {
  id: string;
  name: string;
  initials: string;
}

export const USER_REF_SELECT = { id: true, name: true } as const;

export function toUserRef(user: { id: string; name: string }): UserRef {
  return { id: user.id, name: user.name, initials: userInitials(user.name) };
}
