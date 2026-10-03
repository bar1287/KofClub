import { Inject, Injectable } from '@nestjs/common';
import { errors, importPKCS8, importSPKI, jwtVerify, KeyLike, SignJWT } from 'jose';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AppError } from '../errors/app-error';
import type { PlatformRole } from '../request-context';

const ALG = 'EdDSA';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  platformRole: PlatformRole;
}

/**
 * Issues and verifies short-lived EdDSA (Ed25519) access tokens. The public
 * key is shared with the realtime gateway, which can verify but not mint.
 */
@Injectable()
export class TokenService {
  private keys?: Promise<{ privateKey: KeyLike; publicKey: KeyLike }>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private loadKeys() {
    this.keys ??= (async () => {
      const privatePem = Buffer.from(this.config.AUTH_JWT_PRIVATE_KEY_B64, 'base64').toString(
        'utf8',
      );
      const publicPem = Buffer.from(this.config.AUTH_JWT_PUBLIC_KEY_B64, 'base64').toString('utf8');
      return {
        privateKey: await importPKCS8(privatePem, ALG),
        publicKey: await importSPKI(publicPem, ALG),
      };
    })();
    return this.keys;
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }> {
    const { privateKey } = await this.loadKeys();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.config.ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ sid: claims.sessionId, prole: claims.platformRole })
      .setProtectedHeader({ alg: ALG, typ: 'at+jwt' })
      .setSubject(claims.userId)
      .setIssuer(this.config.AUTH_JWT_ISSUER)
      .setAudience(this.config.AUTH_JWT_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(privateKey);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const { publicKey } = await this.loadKeys();
    try {
      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: [ALG],
        issuer: this.config.AUTH_JWT_ISSUER,
        audience: this.config.AUTH_JWT_AUDIENCE,
        typ: 'at+jwt',
      });
      const sid = payload.sid;
      const prole = payload.prole;
      if (
        typeof payload.sub !== 'string' ||
        typeof sid !== 'string' ||
        (prole !== 'USER' && prole !== 'PLATFORM_ADMIN')
      ) {
        throw new AppError('AUTH_TOKEN_INVALID', 'Malformed access token');
      }
      return { userId: payload.sub, sessionId: sid, platformRole: prole };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof errors.JWTExpired) {
        throw new AppError('AUTH_TOKEN_EXPIRED', 'Access token expired');
      }
      throw new AppError('AUTH_TOKEN_INVALID', 'Invalid access token');
    }
  }
}
