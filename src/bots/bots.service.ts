import { supabaseAdmin } from "../supabase/supabase.client";
import { randomUUID } from "crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

@Injectable()
export class BotsService {
  async ensureProfileAndWorkspace(userId: string, name?: string) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (!profile) {
      await supabaseAdmin
        .from("profiles")
        .insert({ id: userId, name: name ?? null });
    }

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();

    if (ws) return ws.id;

    const { data: created, error } = await supabaseAdmin
      .from("workspaces")
      .insert({ name: "My Workspace", owner_id: userId })
      .select("id")
      .single();

    if (error) throw new BadRequestException(error.message);
    return created.id;
  }

  async listBots(userId: string) {
    const workspaceId = await this.ensureProfileAndWorkspace(userId);

    const { data, error } = await supabaseAdmin
      .from("bots")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw new BadRequestException(error.message);

    // Map to your frontend shape
    return (data ?? []).map((b: any) => this.mapBotRow(b));
  }

  async createBot(userId: string, body: any) {
    const workspaceId = await this.ensureProfileAndWorkspace(
      userId,
      body?.userName,
    );

    const name = String(body?.name ?? "").trim();
    const domain = String(body?.domain ?? "").trim();
    const primaryColor = String(body?.primaryColor ?? "#6366f1");
    const welcomeMessage = String(
      body?.welcomeMessage ?? "Hi! How can I help?",
    );

    if (!name) throw new BadRequestException("name is required");
    if (!domain) throw new BadRequestException("domain is required");

    const embedKey = `bot_${randomUUID().replace(/-/g, "")}`;

    // Insert bot
    const { data: bot, error: botErr } = await supabaseAdmin
      .from("bots")
      .insert({
        workspace_id: workspaceId,
        name,
        domain,
        primary_color: primaryColor,
        welcome_message: welcomeMessage,
        status: "training",
        embed_key: embedKey,
      })
      .select("*")
      .single();

    if (botErr) throw new BadRequestException(botErr.message);

    // Insert default website source
    const startUrl = domain.startsWith("http") ? domain : `https://${domain}`;
    await supabaseAdmin.from("sources").insert({
      bot_id: bot.id,
      type: "website",
      start_url: startUrl,
      status: "queued",
    });

    return {
      id: bot.id,
      name: bot.name,
      domain: bot.domain,
      primaryColor: bot.primary_color,
      welcomeMessage: bot.welcome_message,
      status: "Training",
      lastCrawl: "Not yet",
    };
  }

  async getBot(userId: string, botId: string) {
    const workspaceId = await this.getWorkspaceId(userId);

    const { data, error } = await supabaseAdmin
      .from("bots")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", botId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Bot not found");

    return {
      id: data.id,
      name: data.name,
      domain: data.domain,
      primaryColor: data.primary_color,
      welcomeMessage: data.welcome_message,
      embedKey: data.embed_key,
      status:
        data.status === "live"
          ? "Live"
          : data.status === "training"
            ? "Training"
            : "Paused",
      lastCrawl: data.last_crawl_at
        ? new Date(data.last_crawl_at).toLocaleString()
        : "Not yet",
    };
  }

  async updateBot(userId: string, botId: string, patch: any) {
    const workspaceId = await this.getWorkspaceId(userId);

    const updates: any = {};
    if (typeof patch?.name === "string") updates.name = patch.name.trim();
    if (typeof patch?.primaryColor === "string")
      updates.primary_color = patch.primaryColor;
    if (typeof patch?.welcomeMessage === "string")
      updates.welcome_message = patch.welcomeMessage;

    const { data, error } = await supabaseAdmin
      .from("bots")
      .update(updates)
      .eq("workspace_id", workspaceId)
      .eq("id", botId)
      .select("*")
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Bot not found");

    return {
      id: data.id,
      name: data.name,
      domain: data.domain,
      primaryColor: data.primary_color,
      welcomeMessage: data.welcome_message,
      embedKey: data.embed_key,
      status:
        data.status === "live"
          ? "Live"
          : data.status === "training"
            ? "Training"
            : "Paused",
      lastCrawl: data.last_crawl_at
        ? new Date(data.last_crawl_at).toLocaleString()
        : "Not yet",
    };
  }

  async getBotSettings(userId: string, botId: string) {
    const workspaceId = await this.getWorkspaceId(userId);

    const { data, error } = await supabaseAdmin
      .from("bots")
      .select("id, max_context_tokens, languages, only_answer_from_sources")
      .eq("workspace_id", workspaceId)
      .eq("id", botId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Bot not found");

    return {
      botId: data.id,
      maxContextTokens: data.max_context_tokens ?? 3000,
      languages: data.languages ?? "English, Urdu",
      onlyAnswerFromSources: !!data.only_answer_from_sources,
    };
  }

  async updateBotSettings(userId: string, botId: string, body: any) {
    const workspaceId = await this.getWorkspaceId(userId);

    const max = Number(body?.maxContextTokens);
    const languages = String(body?.languages ?? "").trim();
    const only = Boolean(body?.onlyAnswerFromSources);

    if (!Number.isFinite(max) || max < 256 || max > 32000) {
      throw new BadRequestException(
        "maxContextTokens must be between 256 and 32000",
      );
    }
    if (!languages) throw new BadRequestException("languages is required");

    const { data, error } = await supabaseAdmin
      .from("bots")
      .update({
        max_context_tokens: max,
        languages,
        only_answer_from_sources: only,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", botId)
      .select("id, max_context_tokens, languages, only_answer_from_sources")
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Bot not found");

    return {
      botId: data.id,
      maxContextTokens: data.max_context_tokens,
      languages: data.languages,
      onlyAnswerFromSources: !!data.only_answer_from_sources,
    };
  }

  async resetBotData(userId: string, botId: string) {
    const workspaceId = await this.getWorkspaceId(userId);

    // delete chunks + conversations for this bot (adjust tables as per your schema)
    await supabaseAdmin.from("document_chunks").delete().eq("bot_id", botId);
    await supabaseAdmin.from("conversations").delete().eq("bot_id", botId);

    // mark sources queued again
    await supabaseAdmin
      .from("sources")
      .update({ status: "queued", last_error: null, last_crawl_at: null })
      .eq("bot_id", botId);

    // update bot status
    await supabaseAdmin
      .from("bots")
      .update({ status: "training", last_crawl_at: null })
      .eq("workspace_id", workspaceId)
      .eq("id", botId);

    return { ok: true };
  }

  async deleteBot(userId: string, botId: string) {
    const workspaceId = await this.getWorkspaceId(userId);

    // delete children first
    await supabaseAdmin.from("document_chunks").delete().eq("bot_id", botId);
    await supabaseAdmin.from("conversations").delete().eq("bot_id", botId);
    await supabaseAdmin.from("sources").delete().eq("bot_id", botId);

    const { error } = await supabaseAdmin
      .from("bots")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", botId);

    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  private mapBotRow(b: any) {
    return {
      id: b.id,
      name: b.name,
      domain: b.domain,
      primaryColor: b.primary_color,
      welcomeMessage: b.welcome_message,
      status:
        b.status === "live"
          ? "Live"
          : b.status === "training"
            ? "Training"
            : b.status === "paused"
              ? "Paused"
              : "Error",
      lastCrawl: b.last_crawl_at
        ? new Date(b.last_crawl_at).toLocaleString()
        : "Not yet",
      embedKey: b.embed_key,
    };
  }

  private async getWorkspaceId(userId: string) {
    return this.ensureProfileAndWorkspace(userId);
  }
}
