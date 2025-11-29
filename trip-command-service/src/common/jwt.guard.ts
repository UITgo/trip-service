import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) throw new UnauthorizedException();
    (req as any).user = { sub: 'stub-user' };
    return true;
  }
}
