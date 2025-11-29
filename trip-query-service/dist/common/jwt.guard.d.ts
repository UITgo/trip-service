import { CanActivate, ExecutionContext } from '@nestjs/common';
export declare class JwtGuard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean;
}
