import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard'
import { SourcesService } from './sources.service'

@Controller()
@UseGuards(SupabaseJwtGuard)
export class SourcesController {
  constructor(private sourcesService: SourcesService) {}

  @Get('bots/:id/sources')
  async list(@Req() req: any, @Param('id') botId: string) {
    return this.sourcesService.listSources(req.user.id, botId)
  }

  @Post('bots/:id/recrawl')
  async recrawl(@Req() req: any, @Param('id') botId: string) {
    return this.sourcesService.recrawl(req.user.id, botId)
  }
}
