import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

type SupabaseJwtPayload = {
  sub: string;
  email?: string;
  role?: string;
  aud?: string;
  iss?: string;
};

@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private jwks = createRemoteJWKSet(
    new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
  );

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    const token = authHeader.slice('Bearer '.length);

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: process.env.SUPABASE_JWT_ISSUER,
        // audience is often "authenticated" but can vary; skip strict aud check for now
      });

      const p = payload as unknown as SupabaseJwtPayload;
      if (!p?.sub) throw new UnauthorizedException('Invalid token');

      // Attach user to request
      req.user = {
        id: p.sub,
        email: p.email,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
