import { supabaseAdmin } from '../supabase/supabase.client';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

@Injectable()
export class BotsService {
  async ensureProfileAndWorkspace(userId: string, name?: string) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) {
      await supabaseAdmin
        .from('profiles')
        .insert({ id: userId, name: name ?? null });
    }

    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('owner_id', userId)
      .maybeSingle();

    if (ws) return ws.id;

    const { data: created, error } = await supabaseAdmin
      .from('workspaces')
      .insert({ name: 'My Workspace', owner_id: userId })
      .select('id')
      .single();

    if (error) throw new BadRequestException(error.message);
    return created.id;
  }

  async listBots(userId: string) {
    const workspaceId = await this.ensureProfileAndWorkspace(userId);

    const { data, error } = await supabaseAdmin
      .from('bots')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    // Map to your frontend shape
    return (data ?? []).map((b: any) => this.mapBotRow(b));
  }

  async createBot(userId: string, body: any) {
    const workspaceId = await this.ensureProfileAndWorkspace(
      userId,
      body?.userName,
    );

    const name = String(body?.name ?? '').trim();
    const domain = String(body?.domain ?? '').trim();
    const primaryColor = String(body?.primaryColor ?? '#6366f1');
    const welcomeMessage = String(
      body?.welcomeMessage ?? 'Hi! How can I help?',
    );

    if (!name) throw new BadRequestException('name is required');
    if (!domain) throw new BadRequestException('domain is required');

    const embedKey = `bot_${randomUUID().replace(/-/g, '')}`;

    // Insert bot
    const { data: bot, error: botErr } = await supabaseAdmin
      .from('bots')
      .insert({
        workspace_id: workspaceId,
        name,
        domain,
        primary_color: primaryColor,
        welcome_message: welcomeMessage,
        status: 'training',
        embed_key: embedKey,
      })
      .select('*')
      .single();

    if (botErr) throw new BadRequestException(botErr.message);

    // Insert default website source
    const startUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    await supabaseAdmin.from('sources').insert({
      bot_id: bot.id,
      type: 'website',
      start_url: startUrl,
      status: 'queued',
    });

    return {
      id: bot.id,
      name: bot.name,
      domain: bot.domain,
      primaryColor: bot.primary_color,
      welcomeMessage: bot.welcome_message,
      status: 'Training',
      lastCrawl: 'Not yet',
    };
  }

  async getBot(userId: string, botId: string) {
    const workspaceId = await this.ensureProfileAndWorkspace(userId);

    const { data: bot, error } = await supabaseAdmin
      .from('bots')
      .select('*')
      .eq('id', botId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!bot) throw new NotFoundException('Bot not found');

    return this.mapBotRow(bot);
  }

  async updateBot(
    userId: string,
    botId: string,
    patch: Partial<{
      name: string;
      primaryColor: string;
      welcomeMessage: string;
    }>,
  ) {
    const workspaceId = await this.ensureProfileAndWorkspace(userId);

    // Only allow specific fields
    const update: any = {};

    if (typeof patch?.name === 'string') {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      update.name = name;
    }

    if (typeof patch?.primaryColor === 'string') {
      update.primary_color = patch.primaryColor;
    }

    if (typeof patch?.welcomeMessage === 'string') {
      update.welcome_message = patch.welcomeMessage;
    }

    if (Object.keys(update).length === 0) {
      throw new BadRequestException('No valid fields to update');
    }

    const { data: updated, error } = await supabaseAdmin
      .from('bots')
      .update(update)
      .eq('id', botId)
      .eq('workspace_id', workspaceId) // ✅ ownership check
      .select('*')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!updated) throw new NotFoundException('Bot not found');

    return this.mapBotRow(updated);
  }

  private mapBotRow(b: any) {
    return {
      id: b.id,
      name: b.name,
      domain: b.domain,
      primaryColor: b.primary_color,
      welcomeMessage: b.welcome_message,
      status:
        b.status === 'live'
          ? 'Live'
          : b.status === 'training'
            ? 'Training'
            : b.status === 'paused'
              ? 'Paused'
              : 'Error',
      lastCrawl: b.last_crawl_at
        ? new Date(b.last_crawl_at).toLocaleString()
        : 'Not yet',
    };
  }
}
