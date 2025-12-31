import { BadRequestException, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { supabaseAdmin } from '../supabase/supabase.client';
import { BotsService } from '../bots/bots.service';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

@Injectable()
export class ChatService {
  constructor(private botsService: BotsService) {}

  private async assertBotOwned(userId: string, botId: string) {
    const workspaceId =
      await this.botsService.ensureProfileAndWorkspace(userId);

    const { data, error } = await supabaseAdmin
      .from('bots')
      .select('id, name')
      .eq('id', botId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Bot not found');
    return data;
  }

  async chat(userId: string, botId: string, body: any) {
    const bot = await this.assertBotOwned(userId, botId);

    const message = String(body?.message ?? '').trim();
    if (!message) throw new BadRequestException('message is required');

    // 0) Get or create conversation
    let conversationId = body?.conversationId
      ? String(body.conversationId)
      : null;

    if (conversationId) {
      // validate it belongs to this bot+user
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('bot_id', botId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);
      if (!data) conversationId = null;
    }

    if (!conversationId) {
      const { data: created, error } = await supabaseAdmin
        .from('conversations')
        .insert({ bot_id: botId, user_id: userId })
        .select('id')
        .single();

      if (error) throw new BadRequestException(error.message);
      conversationId = created.id;
    }

    // 1) Save user message
    {
      const { error } = await supabaseAdmin
        .from('conversation_messages')
        .insert({
          conversation_id: conversationId,
          role: 'user',
          content: message,
        });
      if (error) throw new BadRequestException(error.message);
    }

    // 2) Load recent history (last 10 messages)
    const { data: history, error: histErr } = await supabaseAdmin
      .from('conversation_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(12);

    if (histErr) throw new BadRequestException(histErr.message);

    // 3) Embed latest user message
    const embedModel =
      process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
    const emb = await openai.embeddings.create({
      model: embedModel,
      input: message.slice(0, 8000),
    });
    const queryEmbedding = emb.data?.[0]?.embedding;
    if (!queryEmbedding) throw new BadRequestException('Failed to embed query');

    // 4) Retrieve chunks
    const { data: chunks, error: matchErr } = await supabaseAdmin.rpc(
      'match_chunks',
      {
        bot: botId,
        query_embedding: queryEmbedding,
        match_count: 8,
      },
    );
    if (matchErr) throw new BadRequestException(matchErr.message);

    const top = (chunks ?? []) as Array<{
      url: string;
      content: string;
      similarity: number;
    }>;

    const context = top
      .map((c, i) => `Source ${i + 1} (${c.url})\n${c.content}`)
      .join('\n\n---\n\n');

    // 5) Build messages with history
    const chatModel = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

    const messages = [
      {
        role: 'system' as const,
        content:
          `You are ${bot.name}, a helpful support assistant. ` +
          `Use the provided context for factual details. ` +
          `Maintain conversation continuity using the chat history. ` +
          `If user says "yes/no", infer what it refers to from history and respond accordingly. ` +
          `If it's truly ambiguous, ask one short clarifying question.`,
      },
      {
        role: 'system' as const,
        content: `CONTEXT:\n${context || 'No context found.'}`,
      },

      // history
      ...(history ?? []).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content as string,
      })),
    ];

    const completion = await openai.chat.completions.create({
      model: chatModel,
      temperature: 0.2,
      messages,
    });

    const answer =
      completion.choices?.[0]?.message?.content ??
      'Sorry, I could not generate a response.';

    // 6) Save assistant message
    {
      const { error } = await supabaseAdmin
        .from('conversation_messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: answer,
        });
      if (error) throw new BadRequestException(error.message);
    }

    return {
      answer,
      conversationId,
      sources: top.slice(0, 5).map((c) => ({
        url: c.url,
        similarity: c.similarity,
        snippet: c.content.slice(0, 220),
      })),
    };
  }
}
