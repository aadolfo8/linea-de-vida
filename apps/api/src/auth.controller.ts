import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { encryptSecret } from './crypto';
import { CsrfGuard, CurrentUserId, SessionGuard, sessionUserId, setSessionCookie } from './auth';
import { PrismaService } from './prisma.service';
import { DRIVE_SCOPE, GOOGLE_LOGIN_SCOPES, GoogleOAuthClient, OAuthStateService } from './oauth';

@Controller('v1')
export class AuthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoogleOAuthClient) private readonly oauth: GoogleOAuthClient,
    @Inject(OAuthStateService) private readonly states: OAuthStateService,
  ) {}
  private loginRedirectUri() {
    return (
      process.env.GOOGLE_LOGIN_REDIRECT_URI ??
      `${process.env.API_ORIGIN ?? 'http://localhost:3001'}/v1/auth/google/callback`
    );
  }
  @UseGuards(CsrfGuard)
  @Post('auth/development-login')
  @HttpCode(HttpStatus.NO_CONTENT)
  async developmentLogin(@Res({ passthrough: true }) response: Response) {
    if (process.env.GOOGLE_CLIENT_ID) throw new NotFoundException();
    const id = process.env.DEV_USER_ID ?? 'development-user';
    await this.prisma.user.upsert({
      where: { id },
      update: {},
      create: { id, email: 'development@local.invalid', displayName: 'Development archive' },
    });
    setSessionCookie(response, id);
  }
  @UseGuards(CsrfGuard)
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('lv_session', {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  @UseGuards(CsrfGuard)
  @Post('auth/google/authorize')
  async googleLoginAuthorize(@Res({ passthrough: true }) response: Response) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      return { available: false, message: 'Google OAuth is not configured.' };
    const redirectUri = this.loginRedirectUri();
    const state = await this.states.create('login');
    response.cookie('lv_login_state', state.id, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600_000,
    });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_LOGIN_SCOPES,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent select_account',
      state: state.id,
      code_challenge: state.codeChallenge,
      code_challenge_method: 'S256',
    });
    return {
      available: true,
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    };
  }
  @Get('auth/google/callback')
  async googleLoginCallback(
    @Req() request: Request,
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    if (!state || (!code && !error) || request.signedCookies?.lv_login_state !== state)
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'The login state was not accepted.',
      });
    const oauthState = await this.states.consume(state, 'login');
    if (!oauthState)
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'The login state was not accepted.',
      });
    if (error)
      return response.redirect(
        `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/?oauth=${
          error === 'access_denied' ? 'access-denied' : 'login-denied'
        }`,
      );
    const identity = await this.oauth.exchange(
      code,
      this.loginRedirectUri(),
      oauthState.codeVerifier,
    );
    if (!identity.scopes.includes(DRIVE_SCOPE))
      throw new BadRequestException({
        code: 'DRIVE_SCOPE_NOT_GRANTED',
        message: 'Drive read-only access is required.',
      });
    if (!identity.refreshToken)
      throw new BadRequestException({
        code: 'DRIVE_OFFLINE_ACCESS_REQUIRED',
        message: 'Google did not issue an offline refresh token. Re-authorize with consent.',
      });
    const refreshTokenCiphertext = encryptSecret(identity.refreshToken);
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { googleSubject: identity.subject },
        update: { email: identity.email, displayName: identity.displayName },
        create: {
          googleSubject: identity.subject,
          email: identity.email,
          displayName: identity.displayName,
        },
      });
      const connection = await tx.oAuthConnection.upsert({
        where: {
          userId_provider_googleAccountId: {
            userId: user.id,
            provider: 'google-drive',
            googleAccountId: identity.subject,
          },
        },
        update: {
          grantedScopes: identity.scopes,
          refreshTokenCiphertext,
          status: 'ACTIVE',
        },
        create: {
          userId: user.id,
          provider: 'google-drive',
          googleAccountId: identity.subject,
          grantedScopes: identity.scopes,
          refreshTokenCiphertext,
        },
      });
      await tx.photoSource.updateMany({
        where: {
          userId: user.id,
          oauthConnectionId: connection.id,
          status: 'DISCONNECTED',
        },
        data: { status: 'ACTIVE' },
      });
      return user;
    });
    response.clearCookie('lv_login_state');
    setSessionCookie(response, user.id);
    response.redirect(process.env.WEB_ORIGIN ?? 'http://localhost:3000');
  }
  @UseGuards(SessionGuard) @Get('me') async me(@CurrentUserId() userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        connections: {
          where: { status: 'ACTIVE' },
          select: { id: true, provider: true, status: true },
        },
      },
    });
    return {
      user,
      driveConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      developmentMode: !process.env.GOOGLE_CLIENT_ID,
    };
  }
  @UseGuards(SessionGuard, CsrfGuard) @Post('oauth/google/drive/authorize') async driveAuthorize(
    @CurrentUserId() userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      return {
        available: false,
        message: 'Google OAuth is not configured. Development mode never simulates authorization.',
      };
    const state = await this.states.create('drive', userId);
    response.cookie('lv_drive_state', state.id, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600_000,
    });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_DRIVE_REDIRECT_URI!,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: state.id,
      code_challenge: state.codeChallenge,
      code_challenge_method: 'S256',
    });
    return {
      available: true,
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    };
  }
  @Get('oauth/google/drive/callback') async driveCallback(
    @Req() request: Request,
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    const userId = sessionUserId(request);
    if (!userId || !state || (!code && !error) || request.signedCookies?.lv_drive_state !== state)
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'The Drive authorization state was not accepted.',
      });
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      throw new BadRequestException({
        code: 'OAUTH_UNAVAILABLE',
        message: 'Google OAuth is not configured.',
      });
    const oauthState = await this.states.consume(state, 'drive', userId);
    if (!oauthState)
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'The Drive authorization state was not accepted.',
      });
    if (error) {
      response.clearCookie('lv_drive_state');
      return response.redirect(
        `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/ajustes?oauth=drive-denied`,
      );
    }
    const token = await this.oauth.exchange(
      code,
      process.env.GOOGLE_DRIVE_REDIRECT_URI!,
      oauthState.codeVerifier,
    );
    const scopes = token.scopes;
    if (!scopes.includes(DRIVE_SCOPE))
      throw new BadRequestException({
        code: 'DRIVE_SCOPE_NOT_GRANTED',
        message: 'Drive read-only access is required.',
      });
    const existingConnection = await this.prisma.oAuthConnection.findFirst({
      where: { userId, provider: 'google-drive', googleAccountId: token.subject },
    });
    const refreshTokenCiphertext = token.refreshToken
      ? encryptSecret(token.refreshToken)
      : existingConnection?.refreshTokenCiphertext;
    if (!refreshTokenCiphertext)
      throw new BadRequestException({
        code: 'DRIVE_OFFLINE_ACCESS_REQUIRED',
        message: 'Google did not issue an offline refresh token. Re-authorize with consent.',
      });
    await this.prisma.$transaction(async (tx) => {
      const connection = await tx.oAuthConnection.upsert({
        where: {
          userId_provider_googleAccountId: {
            userId,
            provider: 'google-drive',
            googleAccountId: token.subject,
          },
        },
        update: {
          grantedScopes: scopes,
          refreshTokenCiphertext,
          status: 'ACTIVE',
        },
        create: {
          userId,
          provider: 'google-drive',
          googleAccountId: token.subject,
          grantedScopes: scopes,
          refreshTokenCiphertext,
        },
      });
      await tx.photoSource.updateMany({
        where: { userId, oauthConnectionId: connection.id, status: 'DISCONNECTED' },
        data: { status: 'ACTIVE' },
      });
    });
    response.clearCookie('lv_drive_state');
    response.redirect(
      `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/ajustes?oauth=drive-connected`,
    );
  }
}
