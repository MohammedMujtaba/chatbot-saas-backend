import { BadRequestException, Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { supabaseAdmin } from "../supabase/supabase.client";
import { BotsService } from "../bots/bots.service";
import { ragReply } from "src/common/rag/ragChat";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

@Injectable()
export class ChatService {
  constructor(private botsService: BotsService) {}

  private async assertBotOwned(userId: string, botId: string) {
    const workspaceId =
      await this.botsService.ensureProfileAndWorkspace(userId);

    const { data, error } = await supabaseAdmin
      .from("bots")
      .select("id, name")
      .eq("id", botId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException("Bot not found");
    return data;
  }

  async chat(userId: string, botId: string, body: any) {
    const bot = await this.assertBotOwned(userId, botId);

    const message = String(body?.message ?? "").trim();
    if (!message) throw new BadRequestException("message is required");

    // 0) Get or create conversation
    let conversationId = body?.conversationId
      ? String(body.conversationId)
      : null;

    if (conversationId) {
      // validate it belongs to this bot+user
      const { data, error } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("bot_id", botId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);
      if (!data) conversationId = null;
    }

    if (!conversationId) {
      const { data: created, error } = await supabaseAdmin
        .from("conversations")
        .insert({ bot_id: botId, user_id: userId })
        .select("id")
        .single();

      if (error) throw new BadRequestException(error.message);
      conversationId = created.id;
    }

    // 1) Save user message
    {
      const { error } = await supabaseAdmin
        .from("conversation_messages")
        .insert({
          conversation_id: conversationId,
          role: "user",
          content: message,
        });
      if (error) throw new BadRequestException(error.message);
    }

    // 2) Load recent history (last 10 messages)
    const { data: history, error: histErr } = await supabaseAdmin
      .from("conversation_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(12);

    if (histErr) throw new BadRequestException(histErr.message);

    const historyMessages = (history ?? []).map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));

    const { answer, sources } = await ragReply({
      botId,
      botName: bot.name,
      message,
      history: historyMessages,
    });

    await supabaseAdmin.from("conversation_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: answer,
    });

    return { answer, conversationId, sources };
  }
}
