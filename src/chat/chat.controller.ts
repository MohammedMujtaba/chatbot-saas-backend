import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common'
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard'
import { ChatService } from './chat.service'

@Controller('bots')
@UseGuards(SupabaseJwtGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post(':id/chat')
  async chat(@Req() req: any, @Param('id') botId: string, @Body() body: any) {
    return this.chatService.chat(req.user.id, botId, body)
  }
}
