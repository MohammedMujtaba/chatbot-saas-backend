import { Module } from '@nestjs/common'
import { BotsModule } from '../bots/bots.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'

@Module({
  imports: [BotsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
