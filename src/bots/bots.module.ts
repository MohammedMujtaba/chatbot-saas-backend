import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';

@Module({
  imports: [AuthModule],
  controllers: [BotsController],
  providers: [BotsService],
  exports: [BotsService],
})
export class BotsModule {}
