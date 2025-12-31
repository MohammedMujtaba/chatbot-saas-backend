import { Module } from '@nestjs/common'
import { BotsModule } from '../bots/bots.module'
import { SourcesController } from './sources.controller'
import { SourcesService } from './sources.service'

@Module({
  imports: [BotsModule],
  controllers: [SourcesController],
  providers: [SourcesService],
})
export class SourcesModule {}
