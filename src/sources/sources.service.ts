import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { supabaseAdmin } from '../supabase/supabase.client';
import { BotsService } from '../bots/bots.service';

@Injectable()
export class SourcesService {
  constructor(private botsService: BotsService) {}

  private async ensureBotOwned(userId: string, botId: string) {
    const workspaceId =
      await this.botsService.ensureProfileAndWorkspace(userId);

    const { data: bot, error } = await supabaseAdmin
      .from('bots')
      .select('id, workspace_id, status')
      .eq('id', botId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!bot) throw new NotFoundException('Bot not found');

    return { workspaceId, bot };
  }

  async listSources(userId: string, botId: string) {
    await this.ensureBotOwned(userId, botId);

    const { data, error } = await supabaseAdmin
      .from('sources')
      .select('*')
      .eq('bot_id', botId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    return (data ?? []).map((s: any) => ({
      id: s.id,
      botId: s.bot_id,
      type: s.type,
      startUrl: s.start_url,
      status: s.status,
      lastCrawlAt: s.last_crawl_at,
      lastError: s.last_error,
      createdAt: s.created_at,
    }));
  }

  async recrawl(userId: string, botId: string) {
    await this.ensureBotOwned(userId, botId);

    const { error: delErr } = await supabaseAdmin
      .from('document_chunks')
      .delete()
      .eq('bot_id', botId);

    if (delErr) throw new BadRequestException(delErr.message);

    const { data: sources, error: srcErr } = await supabaseAdmin
      .from('sources')
      .update({
        status: 'queued',
        last_error: null,
      })
      .eq('bot_id', botId)
      .select('*');

    if (srcErr) throw new BadRequestException(srcErr.message);

    const { error: botErr } = await supabaseAdmin
      .from('bots')
      .update({ status: 'training' })
      .eq('id', botId);

    if (botErr) throw new BadRequestException(botErr.message);

    return {
      ok: true,
      queued: (sources ?? []).length,
    };
  }
}
