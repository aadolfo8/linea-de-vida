import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { GoogleOAuthClient, GoogleOAuthProvider, OAuthStateService } from './oauth';

@Module({
  controllers: [AuthController],
  providers: [OAuthStateService, { provide: GoogleOAuthClient, useClass: GoogleOAuthProvider }],
  exports: [OAuthStateService, GoogleOAuthClient],
})
export class AuthModule {}
