import { Module } from '@nestjs/common';
import { SupabaseJwtGuard } from './supabase-jwt.guard';

@Module({
  providers: [SupabaseJwtGuard],
  exports: [SupabaseJwtGuard],
})
export class AuthModule {}
