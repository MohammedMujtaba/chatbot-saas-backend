import { BadRequestException, Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { supabaseAdmin } from "../supabase/supabase.client";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MIN_SIMILARITY = Number(process.env.MIN_SIMILARITY ?? "0.22");
const MAX_CONTEXT_CHUNKS = Number(process.env.MAX_CONTEXT_CHUNKS ?? "6");

function stripHardBreaks(md: string) {
  return md.replace(/[ \t]+\n/g, "\n");
}

function isUrlRequest(message: string) {
  const m = message.toLowerCase();
  return (
    /\b(url|link)\b/.test(m) ||
    (m.includes("page") &&
      (m.includes("give") || m.includes("send") || m.includes("need"))) ||
    m.includes("where can i find")
  );
}

function extractPageHint(message: string) {
  const m = message.toLowerCase();

  const hints = [
    "about",
    "pricing",
    "price",
    "plans",
    "blog",
    "blogs",
    "resources",
    "insights",
    "contact",
    "support",
    "help",
    "faq",
    "terms",
    "privacy",
    "refund",
    "returns",
    "careers",
    "jobs",
    "join",
    "login",
    "signup",
    "features",
    "documentation",
    "docs",
  ];

  return hints.find((h) => m.includes(h)) ?? null;
}

function normalizePath(u: string) {
  try {
    const url = new URL(u);
    let p = url.pathname || "/";
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p.toLowerCase();
  } catch {
    return "/";
  }
}

function isHomepage(u: string) {
  const p = normalizePath(u);
  return p === "/" || p === "";
}

function pickBestUrlForQuery(
  message: string,
  top: Array<{ url: string; title?: string | null; content: string }>,
) {
  const hint = extractPageHint(message);
  const q = message.toLowerCase();

  const uniq: Array<{ url: string; title?: string | null; content: string }> =
    [];
  const seen = new Set<string>();
  for (const c of top) {
    if (!c.url) continue;
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    uniq.push(c);
  }

  const scored = uniq.map((c) => {
    const urlLower = c.url.toLowerCase();
    const path = normalizePath(c.url);
    const title = (c.title ?? "").toLowerCase();
    const snippet = c.content.slice(0, 400).toLowerCase();

    let score = 0;

    if (hint) {
      if (path.includes(`/${hint}`)) score += 100;
      if (urlLower.includes(hint)) score += 40;
      if (title.includes(hint)) score += 25;
      if (snippet.includes(hint)) score += 10;

      if ((hint === "plans" || hint === "price") && path.includes("/pricing"))
        score += 80;
      if (
        (hint === "blogs" || hint === "blog") &&
        (path.includes("/blog") || path.includes("/blogs"))
      )
        score += 80;
    }

    for (const token of q.split(/\s+/).filter(Boolean)) {
      if (token.length < 4) continue;
      if (urlLower.includes(token)) score += 3;
      if (title.includes(token)) score += 2;
      if (snippet.includes(token)) score += 1;
    }

    if (hint && isHomepage(c.url)) score -= 25;

    score -= Math.min(urlLower.length / 80, 2);

    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.url ?? null;
}

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

    const embedModel =
      process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
    const emb = await openai.embeddings.create({
      model: embedModel,
      input: message.slice(0, 8000),
    });
    const queryEmbedding = emb.data?.[0]?.embedding;
    if (!queryEmbedding) throw new BadRequestException("Failed to embed query");

    const wantsUrl = isUrlRequest(message);

    const { data: chunks, error: matchErr } = await supabaseAdmin.rpc(
      "match_chunks_v2",
      {
        bot: bot.id,
        query_embedding: queryEmbedding,
        match_count: wantsUrl ? 20 : 8,
      },
    );
    if (matchErr) throw new BadRequestException(matchErr.message);

    const candidates = (chunks ?? []) as Array<{
      url: string;
      content: string;
      title: string | null;
      similarity: number;
    }>;

    const top = candidates.slice(0, MAX_CONTEXT_CHUNKS);

    const topScore = top[0]?.similarity ?? 0;
    if (!top.length || topScore < MIN_SIMILARITY) {
      const refusal =
        "I can only answer using information from this website’s content, and I couldn’t find anything relevant to your question yet. " +
        "Try asking about a specific page/topic from the site.";
      await supabaseAdmin.from("widget_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: refusal,
      });

      return {
        answer: refusal,
        conversationId,
        sources: [],
      };
    }

    if (wantsUrl) {
      const url = pickBestUrlForQuery(message, candidates);
      const answer = url
        ? `Here is the most relevant page:\n${url}`
        : `I couldn’t find a matching page URL in the content I’ve indexed yet. Try re-crawling or ask using a page name from the site.`;

      await supabaseAdmin.from("widget_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: answer,
      });

      return {
        answer,
        conversationId,
        sources: top.slice(0, 5).map((c) => ({
          url: c.url,
          title: c.title ?? undefined,
          similarity: c.similarity,
        })),
      };
    }

    const context = top
      .map((c, i) => {
        const t = (c.title ?? "").trim();
        const header = t
          ? `Source ${i + 1}: ${t} (${c.url})`
          : `Source ${i + 1}: ${c.url}`;
        return `${header}\n${c.content}`;
      })
      .join("\n\n---\n\n");

    const chatModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
    const completion = await openai.chat.completions.create({
      model: chatModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            `You are ${bot.name}, an assistant that answers ONLY using the provided CONTEXT sources.\n` +
            `Rules:\n` +
            `- If the answer is not supported by CONTEXT, say: "I don’t have that information in the website content I’m trained on."\n` +
            `- NEVER say you "don't have access to websites" or "can't browse". You DO have CONTEXT.\n` +
            `- Keep answers concise: max 120 words OR max 5 bullet points.\n` +
            `- When relevant, include 1–3 source URLs from the CONTEXT.\n` +
            `- Do not paste large chunks of text. Summarize.\n` +
            `- Always format the answer in MARKDOWN.\n` +
            `- If the user asks for a URL/page, provide the most relevant one from CONTEXT.\n` +
            `- Do not mention 'CONTEXT' in the answer.\n` +
            `When answering pricing questions:\n` +
            `- List plans briefly\n- Show price once per plan\n- Do NOT repeat features excessively\n- Prefer a short summary + pricing page URL\n`,
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
      answer: stripHardBreaks(answer),
      conversationId,
      sources: top.slice(0, 5).map((c) => ({
        url: c.url,
        title: c.title ?? undefined,
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
