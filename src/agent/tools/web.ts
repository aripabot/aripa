import { google } from "@ai-sdk/google";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText, tool } from "ai";
import type { LogLayer } from "loglayer";
import * as z from "zod";
import { DEFAULT_MODEL_CONFIG } from "@/config/config.ts";
import { log as defaultLog } from "@/config/logger.ts";

const WEB_SEARCH_EMPTY_RESULT_MESSAGE =
  "I couldn't find enough grounded information to answer that clearly.";
const WEB_SEARCH_ERROR_MESSAGE =
  "Sorry, I ran into an error while trying to get grounded information from the web.";

const webToolPromptUrl = new URL("../prompts/web_tool.md", import.meta.url);
let cachedWebPromptPromise: Promise<string> | null = null;

export const webSearchInputSchema = z.object({
  question: z.string().trim().min(1).describe("The question to answer with grounded web search."),
});

export interface WebSearchSource {
  url: string;
  title?: string;
}

export interface WebSearchResult {
  type: "web_result";
  ok: boolean;
  question: string;
  answer: string;
  sources: WebSearchSource[];
  error?: "empty_result" | "web_search_failed";
}

export interface WebSearchToolDependencies {
  log?: LogLayer;
  logPrivacy?: boolean;
  loadPrompt?: () => Promise<string>;
  runWebSearch?: WebSearchRunner;
  model?: LanguageModelV3;
}

export interface ExecuteWebSearchOptions extends WebSearchToolDependencies {
  question: string;
  abortSignal?: AbortSignal;
}

export type WebSearchRunner = (
  question: string,
  options: {
    prompt: string;
    model?: LanguageModelV3;
    abortSignal?: AbortSignal;
  },
) => Promise<{
  text: string;
  sources?: readonly WebSourceLike[];
}>;

interface WebSourceLike {
  type?: string;
  sourceType?: string;
  url?: string;
  title?: string;
}

export function createWebSearchTool(dependencies: WebSearchToolDependencies = {}) {
  return tool({
    description:
      "Get grounded, current information from the web and return a concise answer for the main chat agent.",
    inputSchema: webSearchInputSchema,
    execute: async ({ question }, { abortSignal }) =>
      executeWebSearch({
        ...dependencies,
        question,
        abortSignal,
      }),
  });
}

export async function executeWebSearch({
  question,
  abortSignal,
  log = defaultLog,
  logPrivacy = true,
  loadPrompt = loadWebPrompt,
  runWebSearch = runWebSearchWithGoogle,
  model,
}: ExecuteWebSearchOptions): Promise<WebSearchResult> {
  const parsed = webSearchInputSchema.parse({ question });
  const questionMetadata = createWebSearchQuestionLogMetadata(parsed.question, { logPrivacy });

  log.withMetadata(questionMetadata).info("Web search requested.");

  try {
    const prompt = await loadPrompt();
    const result = await runWebSearch(parsed.question, {
      prompt,
      model,
      abortSignal,
    });
    const answer = result.text.trim();
    const sources = mapWebSources(result.sources);

    if (answer.length === 0) {
      log.withMetadata(questionMetadata).warn("Web search returned an empty result.");
      return {
        type: "web_result",
        ok: false,
        question: parsed.question,
        answer: WEB_SEARCH_EMPTY_RESULT_MESSAGE,
        sources,
        error: "empty_result",
      };
    }

    log
      .withMetadata({
        ...questionMetadata,
        sourceCount: sources.length,
      })
      .info("Web search completed.");

    return {
      type: "web_result",
      ok: true,
      question: parsed.question,
      answer,
      sources,
    };
  } catch (error) {
    log.withError(error).withMetadata(questionMetadata).error("Web search failed.");

    return {
      type: "web_result",
      ok: false,
      question: parsed.question,
      answer: WEB_SEARCH_ERROR_MESSAGE,
      sources: [],
      error: "web_search_failed",
    };
  }
}

function createWebSearchQuestionLogMetadata(
  question: string,
  options: { logPrivacy?: boolean } = {},
): Record<string, unknown> {
  return options.logPrivacy ? { questionRedacted: true } : { question };
}

export function loadWebPrompt(): Promise<string> {
  cachedWebPromptPromise ??= Bun.file(webToolPromptUrl)
    .text()
    .then((content) => content.trim());

  return cachedWebPromptPromise;
}

export async function runWebSearchWithGoogle(
  question: string,
  options: {
    prompt: string;
    model?: LanguageModelV3;
    abortSignal?: AbortSignal;
  },
): Promise<{
  text: string;
  sources?: readonly WebSourceLike[];
}> {
  const result = await generateText({
    model: options.model ?? google(DEFAULT_MODEL_CONFIG.web.model),
    system: options.prompt,
    prompt: `Question: ${question}`,
    abortSignal: options.abortSignal,
    temperature: 0,
    tools: {
      google_search: google.tools.googleSearch({
        searchTypes: {
          webSearch: {},
        },
      }),
    },
  });

  return {
    text: result.text,
    sources: result.sources,
  };
}

function mapWebSources(sources: readonly WebSourceLike[] | undefined): WebSearchSource[] {
  if (!sources) {
    return [];
  }

  return sources.filter(isUrlWebSource).map((source) => ({
    url: source.url,
    title: source.title,
  }));
}

function isUrlWebSource(
  source: WebSourceLike,
): source is WebSourceLike & { sourceType: "url"; url: string } {
  return source.sourceType === "url" && typeof source.url === "string";
}
