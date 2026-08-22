import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const key = () => {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error('TOKEN_ENCRYPTION_KEY is required when Google OAuth is enabled.');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes.');
  return decoded;
};
export const encryptSecret = (value: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
};
export const decryptSecret = (value: string) => {
  const bytes = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
};
