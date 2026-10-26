/**
 * Politique des mots de passe (`SetPasswordInput` du contrat) : 12 à 256 caractères, refusé s'il figure dans une
 * liste de mots de passe compromis. La liste embarquée reprend les mots de passe de 12 caractères ou plus les plus
 * fréquents des fuites publiques (et leurs variantes françaises courantes) ; elle se complète sans changer l'API.
 * S'y ajoutent les suites triviales (un seul caractère répété, suite de chiffres ou de lettres du clavier) et le
 * mot de passe identique à l'adresse e-mail ou à sa partie locale.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const COMPROMISED_PASSWORD_MESSAGE =
  'Ce mot de passe est trop courant ou déjà paru dans une fuite de données. Choisissez-en un autre.';

const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456123456',
  '123123123123',
  '111111111111',
  '000000000000',
  '987654321012',
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'password!234',
  'p@ssw0rd1234',
  'p@ssword1234',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwerty123456',
  'qwertyqwerty',
  'azertyuiop12',
  'azertyuiop123',
  'azerty123456',
  'azertyazerty',
  'motdepasse12',
  'motdepasse123',
  'motdepasse1234',
  'motdepasse!123',
  'iloveyou1234',
  'jetaime123456',
  'welcome12345',
  'bienvenue123',
  'bienvenue1234',
  'administrator',
  'administrateur',
  'admin1234567',
  'adminadmin123',
  'changeme1234',
  'letmein12345',
  'football1234',
  'princess1234',
  'sunshine1234',
  'superman1234',
  'trustno1trustno1',
  'abcdefghijkl',
  'abc123abc123',
  'abcd12345678',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'zaq12wsxcde3',
  'qazwsxedcrfv',
  'mamboproxi123',
  'mamboproxi2026',
]);

const KEYBOARD_ROWS = [
  '1234567890',
  'azertyuiop',
  'qwertyuiop',
  'qsdfghjklm',
  'asdfghjkl',
  'abcdefghijklmnopqrstuvwxyz',
];

function isTrivialSequence(value: string): boolean {
  if (/^(.)\1+$/u.test(value)) return true;
  return KEYBOARD_ROWS.some((row) => {
    const repeated = row.repeat(Math.ceil(value.length / row.length) + 1);
    return repeated.includes(value) || [...repeated].reverse().join('').includes(value);
  });
}

/** Le mot de passe doit-il être refusé (liste, suite triviale, adresse e-mail) ? */
export function isCompromisedPassword(password: string, email?: string): boolean {
  const normalized = password.normalize('NFKC').toLowerCase();
  if (COMMON_PASSWORDS.has(normalized) || isTrivialSequence(normalized)) return true;
  if (email) {
    const address = email.toLowerCase();
    const local = address.split('@')[0] ?? '';
    if (normalized === address || (local.length >= PASSWORD_MIN_LENGTH && normalized === local)) return true;
  }
  return false;
}
