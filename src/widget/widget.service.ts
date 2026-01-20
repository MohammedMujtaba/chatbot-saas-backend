import { BadRequestException, Injectable } from "@nestjs/common";
import { supabaseAdmin } from "../supabase/supabase.client";
import { ragReply } from "src/common/rag/ragChat";

@Injectable()
export class WidgetService {
  async chat(body: any) {
    const embedKey = String(body?.embedKey ?? "").trim();
    const message = String(body?.message ?? "").trim();
    const visitorId = String(body?.visitorId ?? "").trim() || "anon";

    if (!embedKey) throw new BadRequestException("embedKey is required");
    if (!message) throw new BadRequestException("message is required");

    const { data: bot, error: botErr } = await supabaseAdmin
      .from("bots")
      .select("id, name, status")
      .eq("embed_key", embedKey)
      .maybeSingle();

    if (botErr) throw new BadRequestException(botErr.message);
    if (!bot) throw new BadRequestException("Invalid embedKey");

    let conversationId = body?.conversationId
      ? String(body.conversationId)
      : null;

    if (conversationId) {
      const { data, error } = await supabaseAdmin
        .from("widget_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("bot_id", bot.id)
        .eq("visitor_id", visitorId)
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);
      if (!data) conversationId = null;
    }

    if (!conversationId) {
      const { data: created, error } = await supabaseAdmin
        .from("widget_conversations")
        .insert({ bot_id: bot.id, visitor_id: visitorId })
        .select("id")
        .single();

      if (error) throw new BadRequestException(error.message);
      conversationId = created.id;
    }

    {
      const { error } = await supabaseAdmin.from("widget_messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: message,
      });
      if (error) throw new BadRequestException(error.message);
    }

    const { data: history, error: histErr } = await supabaseAdmin
      .from("widget_messages")
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
      botId: bot.id,
      botName: bot.name,
      message,
      history: historyMessages,
    });

    await supabaseAdmin.from("widget_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: answer,
    });

    return { answer, conversationId, sources };
  }

  async getConfig(embedKey: string) {
    const { data: bot, error } = await supabaseAdmin
      .from("bots")
      .select("id, name, primary_color, welcome_message, status")
      .eq("embed_key", embedKey)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!bot) throw new BadRequestException("Invalid embed key");

    return {
      botId: bot.id,
      name: bot.name,
      primaryColor: bot.primary_color,
      welcomeMessage: bot.welcome_message,
      status: bot.status,
    };
  }
}
