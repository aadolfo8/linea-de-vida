import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import { PrismaService } from './prisma.service';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const GOOGLE_LOGIN_SCOPES = ['openid', 'email', 'profile', DRIVE_SCOPE].join(' ');
export type OAuthPurpose = 'login' | 'drive';

export abstract class GoogleOAuthClient {
  abstract exchange(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<{
    refreshToken?: string;
    scopes: string[];
    subject: string;
    email: string;
    displayName: string;
  }>;
  abstract revoke(token: string): Promise<void>;
}

@Injectable()
export class GoogleOAuthProvider implements GoogleOAuthClient {
  private configured() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new ServiceUnavailableException({
        code: 'OAUTH_UNAVAILABLE',
        message: 'Google OAuth is not configured.',
      });
    }
  }
  async exchange(code: string, redirectUri: string, codeVerifier: string) {
    this.configured();
    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri,
    );
    const { tokens } = await oauth.getToken({ code, codeVerifier, redirect_uri: redirectUri });
    oauth.setCredentials(tokens);
    const identity = await google.oauth2({ version: 'v2', auth: oauth }).userinfo.get();
    if (!identity.data.id || !identity.data.email)
      throw new Error('Google did not return an identity.');
    return {
      refreshToken: tokens.refresh_token ?? undefined,
      scopes: tokens.scope?.split(' ').filter(Boolean) ?? [],
      subject: identity.data.id,
      email: identity.data.email,
      displayName: identity.data.name ?? identity.data.email,
    };
  }
  async revoke(token: string) {
    this.configured();
    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    await oauth.revokeToken(token);
  }
}

@Injectable()
export class OAuthStateService {
  constructor(private readonly prisma: PrismaService) {}
  async create(purpose: OAuthPurpose, userId?: string) {
    const id = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.oAuthState.create({
      data: { id, purpose, userId, codeVerifier, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    return { id, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url') };
  }
  async consume(id: string, purpose: OAuthPurpose, userId?: string) {
    const state = await this.prisma.$transaction(async (tx) => {
      const found = await tx.oAuthState.findFirst({
        where: { id, purpose, userId, expiresAt: { gt: new Date() } },
      });
      if (!found) return null;
      await tx.oAuthState.delete({ where: { id: found.id } });
      return found;
    });
    return state;
  }
}
