import { BadRequestException, Injectable } from "@nestjs/common";
import { supabaseAdmin } from "../supabase/supabase.client";
import { BotsService } from "../bots/bots.service";

@Injectable()
export class ConversationsService {
  constructor(private botsService: BotsService) {}

  private async assertBotOwned(userId: string, botId: string) {
    const workspaceId =
      await this.botsService.ensureProfileAndWorkspace(userId);
    const { data, error } = await supabaseAdmin
      .from("bots")
      .select("id")
      .eq("id", botId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException("Bot not found");
  }

  async stats(userId: string, botId: string, days: number) {
    await this.assertBotOwned(userId, botId);
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { count: convCount, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", botId)
      .eq("user_id", userId)
      .gte("created_at", since);

    if (convErr) throw new BadRequestException(convErr.message);

    const { data: convs, error: convsErr } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("bot_id", botId)
      .eq("user_id", userId)
      .gte("created_at", since);

    if (convsErr) throw new BadRequestException(convsErr.message);

    const ids = (convs ?? []).map((c: any) => c.id);
    let msgCount = 0;
    if (ids.length) {
      const { count, error } = await supabaseAdmin
        .from("conversation_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", ids);
      if (error) throw new BadRequestException(error.message);
      msgCount = count ?? 0;
    }

    const deflectionRate = 0.64; // TODO: compute from escalation flags later
    const avgLatencyMs = 1200; // TODO: measure later

    return {
      days,
      conversations: convCount ?? 0,
      messages: msgCount,
      deflectionRate,
      avgLatencyMs,
    };
  }

  async list(userId: string, botId: string, query: string) {
    await this.assertBotOwned(userId, botId);

    // latest conversations
    const { data: convs, error } = await supabaseAdmin
      .from("conversations")
      .select("id, created_at")
      .eq("bot_id", botId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new BadRequestException(error.message);

    const items = (convs ?? []).map((c: any) => ({
      id: c.id,
      channel: "web",
      createdAt: c.created_at,
    }));

    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter((x) => x.id.toLowerCase().includes(q))
      : items;

    return filtered;
  }
}
