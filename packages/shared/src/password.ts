export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { id: 'letter', label: 'At least one letter', test: (p) => /[A-Za-z]/.test(p) },
  { id: 'number', label: 'At least one number', test: (p) => /\d/.test(p) },
  { id: 'max', label: `No more than ${PASSWORD_MAX_LENGTH} characters`, test: (p) => p.length <= PASSWORD_MAX_LENGTH },
];

const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  'qwerty12345',
  'qwertyuiop1',
  '1234567890a',
  'iloveyou123',
  'welcome1234',
  'letmein1234',
  'admin123456',
  'abc123456789',
  'passw0rd123',
  'football123',
  'baseball123',
  'monkey12345',
  'dragon12345',
  'sunshine123',
  'princess123',
  'localy12345',
]);

export function checkPassword(password: string): { valid: boolean; failed: string[] } {
  const failed = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label);
  if (COMMON_PASSWORDS.has(password.toLowerCase())) failed.push('Choose a less common password');
  return { valid: failed.length === 0, failed };
}
