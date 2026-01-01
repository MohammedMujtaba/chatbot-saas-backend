import { BadRequestException, Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { supabaseAdmin } from "../supabase/supabase.client";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

@Injectable()
export class WidgetService {
  async chat(body: any) {
    const embedKey = String(body?.embedKey ?? "").trim();
    const message = String(body?.message ?? "").trim();
    const visitorId = String(body?.visitorId ?? "").trim() || "anon";

    if (!embedKey) throw new BadRequestException("embedKey is required");
    if (!message) throw new BadRequestException("message is required");

    // 1) Find bot by embed_key
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

    const embedModel =
      process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
    const emb = await openai.embeddings.create({
      model: embedModel,
      input: message.slice(0, 8000),
    });
    const queryEmbedding = emb.data?.[0]?.embedding;
    if (!queryEmbedding) throw new BadRequestException("Failed to embed query");

    const { data: chunks, error: matchErr } = await supabaseAdmin.rpc(
      "match_chunks",
      {
        bot: bot.id,
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
      .join("\n\n---\n\n");

    const chatModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
    const completion = await openai.chat.completions.create({
      model: chatModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            `You are ${bot.name}, a helpful website assistant. ` +
            `Use the provided context and maintain conversation continuity. ` +
            `If info isn't in context, say so briefly.`,
        },
        {
          role: "system",
          content: `CONTEXT:\n${context || "No context found."}`,
        },
        ...(history ?? []).map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
      ],
    });

    const answer =
      completion.choices?.[0]?.message?.content ??
      "Sorry, I could not generate a response.";

    {
      const { error } = await supabaseAdmin.from("widget_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
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
