import 'dotenv/config';
import { load } from 'cheerio';
import { supabaseAdmin } from '../supabase/supabase.client';
import OpenAI from 'openai'

// ---- Config (v1 defaults)
const POLL_MS = 3000;
const MAX_PAGES = 25;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_CHARS_PER_PAGE = 50_000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function normalizeUrl(u: string) {
  try {
    const url = new URL(u);
    url.hash = '';
    // optional: drop query to reduce duplicates
    // url.search = ''
    return url.toString();
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin;
  } catch {
    return false;
  }
}

function isProbablyHtmlUrl(u: string) {
  // exclude common asset extensions
  return !/\.(png|jpg|jpeg|gif|svg|webp|css|js|map|ico|pdf|zip|rar|mp4|mp3|woff2?|ttf|eot)$/i.test(
    u,
  );
}

async function fetchHtml(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'ChatbotSaaSBot/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!ct.includes('text/html') && !ct.includes('application/xhtml+xml')) {
      throw new Error(`Not HTML (${ct})`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function extractLinks(baseUrl: string, html: string): string[] {
  const $ = load(html);
  const out = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href) return;
    if (
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:')
    )
      return;

    let abs: string | null = null;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      abs = null;
    }
    if (!abs) return;
    abs = normalizeUrl(abs);
    if (!abs) return;
    if (!sameOrigin(abs, baseUrl)) return;
    if (!isProbablyHtmlUrl(abs)) return;
    out.add(abs);
  });

  return Array.from(out);
}

function extractReadableText(html: string): string {
  const $ = load(html);

  // remove noisy stuff
  $('script,style,noscript,svg,canvas,iframe,form').remove();

  // crude: prefer main/article if present
  const main = $('main').text().trim();
  const article = $('article').text().trim();
  const body = $('body').text().trim();

  const text = (
    main.length > 200 ? main : article.length > 200 ? article : body
  )
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, MAX_CHARS_PER_PAGE);
}

function chunkText(text: string, chunkSize = 1800, overlap = 200) {
  const chunks: string[] = [];
  if (!text) return chunks;
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + chunkSize);
    const chunk = text.slice(i, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    i = end - overlap;
    if (i < 0) i = 0;
    if (end === text.length) break;
  }
  return chunks;
}

async function embedText(text: string): Promise<number[]> {
  const input = text.length > 8000 ? text.slice(0, 8000) : text

  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input,
  })

  const vec = res.data?.[0]?.embedding
  if (!vec || !Array.isArray(vec)) {
    throw new Error('Failed to generate embedding')
  }

  return vec
}

async function pickNextQueuedSource() {
  const { data, error } = await supabaseAdmin
    .from('sources')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0] ?? null;
}

async function markSource(sourceId: string, patch: any) {
  const { error } = await supabaseAdmin
    .from('sources')
    .update(patch)
    .eq('id', sourceId);
  if (error) throw error;
}

async function setBotStatus(botId: string, patch: any) {
  const { error } = await supabaseAdmin
    .from('bots')
    .update(patch)
    .eq('id', botId);
  if (error) throw error;
}

async function runOnce() {
  const source = await pickNextQueuedSource();
  if (!source) return false;

  const sourceId = source.id as string;
  const botId = source.bot_id as string;
  const startUrl = source.start_url as string;

  console.log(
    `[worker] picked source=${sourceId} bot=${botId} url=${startUrl}`,
  );

  await markSource(sourceId, { status: 'crawling', last_error: null });
  await setBotStatus(botId, { status: 'training' });

  try {
    // 1) fetch homepage
    const homepage = normalizeUrl(startUrl) || startUrl;
    const homeHtml = await fetchHtml(homepage);

    // 2) collect links from homepage (depth=1)
    const links = extractLinks(homepage, homeHtml);
    const queue = [homepage, ...links].slice(0, MAX_PAGES);

    console.log(`[worker] crawling ${queue.length} pages...`);

    // 3) crawl & store chunks
    let chunkCount = 0;

    for (const url of queue) {
      let html = '';
      try {
        html = url === homepage ? homeHtml : await fetchHtml(url);
      } catch (e: any) {
        console.log(`[worker] skip ${url}: ${e.message}`);
        continue;
      }

      const text = extractReadableText(html);
      if (!text || text.length < 200) continue;

      const chunks = chunkText(text);
      if (chunks.length === 0) continue;

      for (let idx = 0; idx < chunks.length; idx++) {
        const content = chunks[idx];

        const embedding = await embedText(content);

        const { error } = await supabaseAdmin.from('document_chunks').insert({
          bot_id: botId,
          source_id: sourceId,
          url,
          chunk_index: idx,
          content,
          embedding,
        });

        if (error) throw error;
        chunkCount++;
      }
    }

    console.log(`[worker] inserted ${chunkCount} chunks`);

    await markSource(sourceId, {
      status: 'complete',
      last_crawl_at: new Date().toISOString(),
      last_error: null,
    });

    await setBotStatus(botId, {
      status: 'live',
      last_crawl_at: new Date().toISOString(),
    });

    console.log(`[worker] done source=${sourceId} bot=${botId}`);
    return true;
  } catch (e: any) {
    console.error(`[worker] failed: ${e.message}`);
    await markSource(sourceId, { status: 'error', last_error: e.message });
    await setBotStatus(botId, { status: 'error' });
    return true;
  }
}

async function main() {
  console.log('[worker] started (polling)');
  while (true) {
    try {
      const didWork = await runOnce();
      if (!didWork) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (e: any) {
      console.error('[worker] loop error:', e.message);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main();
