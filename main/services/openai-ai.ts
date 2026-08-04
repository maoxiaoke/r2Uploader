import sharp from "sharp";
import type { AiAnalysisResult, SemanticSearchResult } from "../../shared/contracts";
import { AppError } from "../core/app-error";
import { getAssetIndexRecord, listAssetIndex, updateAssetAnalysis } from "./asset-index";
import { getBootstrapState, getOpenAiApiKey, getProfile, setOpenAiApiKey, updatePreferences } from "./config-vault";
import { R2ObjectService } from "./r2-object-service";

const OPENAI_ORIGIN = "https://api.openai.com/v1";
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const EMBEDDING_DIMENSIONS = 512;

type OpenAiErrorBody = { error?: { message?: string; code?: string; type?: string } };

const requestOpenAi = async <T>(apiKey: string, pathname: "/responses" | "/embeddings", body: unknown): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${OPENAI_ORIGIN}${pathname}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new AppError({ kind: "TIMEOUT", code: "OPENAI_TIMEOUT", message: "OpenAI did not respond within 60 seconds.", action: "Check the network and retry the explicit AI action.", retryable: true });
    }
    throw new AppError({ kind: "NETWORK", code: "OPENAI_NETWORK_ERROR", message: "R2Uploader could not reach the OpenAI API.", action: "Check the network or proxy, then retry.", retryable: true });
  }
  if (!response.ok) {
    let payload: OpenAiErrorBody = {};
    try { payload = await response.json() as OpenAiErrorBody; } catch { /* Do not expose an arbitrary upstream body. */ }
    const authentication = response.status === 401 || response.status === 403;
    throw new AppError({
      kind: authentication ? "AUTHENTICATION" : response.status === 429 ? "RATE_LIMIT" : response.status >= 500 ? "UNAVAILABLE" : "VALIDATION",
      code: payload.error?.code || `OPENAI_HTTP_${response.status}`,
      message: payload.error?.message?.slice(0, 1_000) || `OpenAI returned HTTP ${response.status}.`,
      action: authentication ? "Check the OpenAI API key and project permissions in Settings." : "Review the configured model and retry.",
      status: response.status,
      retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
    });
  }
  return await response.json() as T;
};

const createEmbedding = async (apiKey: string, model: string, input: string) => {
  const response = await requestOpenAi<{ data?: Array<{ embedding?: number[] }> }>(apiKey, "/embeddings", {
    model,
    input: input.slice(0, 20_000),
    encoding_format: "float",
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const vector = response.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new AppError({ kind: "UNAVAILABLE", code: "OPENAI_EMBEDDING_INVALID", message: "OpenAI returned an invalid embedding vector.", retryable: true });
  }
  return vector;
};

const readImage = async (service: R2ObjectService, bucket: string, key: string) => {
  const head = await service.headObject(bucket, key);
  const contentTypeByExtension: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  const extension = key.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const contentType = (head.contentType ?? contentTypeByExtension[extension] ?? "").split(";")[0].toLowerCase();
  if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]).has(contentType)) {
    throw new AppError({ kind: "VALIDATION", code: "AI_IMAGE_TYPE_UNSUPPORTED", message: "AI visual indexing supports PNG, JPEG, WebP, and non-animated GIF objects.", retryable: false });
  }
  if (head.size > MAX_SOURCE_BYTES) {
    throw new AppError({ kind: "VALIDATION", code: "AI_IMAGE_TOO_LARGE", message: "This object exceeds R2Uploader's 25 MB AI safety limit.", action: "Create a smaller derivative and analyze that object instead.", retryable: false });
  }
  const object = await service.getObject(bucket, key);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of object.body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_SOURCE_BYTES) {
      object.body.destroy();
      throw new AppError({ kind: "VALIDATION", code: "AI_IMAGE_TOO_LARGE", message: "The downloaded object exceeded R2Uploader's 25 MB AI safety limit.", retryable: false });
    }
    chunks.push(buffer);
  }
  const normalized = await sharp(Buffer.concat(chunks), { animated: false })
    .rotate()
    .resize({ width: 1_568, height: 1_568, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${normalized.toString("base64")}`;
};

const outputText = (response: { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }) => {
  if (response.output_text) return response.output_text;
  return response.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
};

export const configureOpenAi = async (input: { apiKey?: string; enabled: boolean; visionModel: string; embeddingModel: string; test: boolean }) => {
  const providedKey = input.apiKey?.trim();
  const existingKey = getBootstrapState().hasOpenAiApiKey ? getOpenAiApiKey() : undefined;
  const apiKey = providedKey || existingKey;
  if ((input.enabled || input.test) && !apiKey) throw new AppError({ kind: "VALIDATION", code: "OPENAI_API_KEY_REQUIRED", message: "Enter an OpenAI API key before enabling AI indexing.", retryable: false });
  if (input.test && apiKey) await createEmbedding(apiKey, input.embeddingModel, "R2Uploader OpenAI connection test");
  if (input.apiKey?.trim()) setOpenAiApiKey(input.apiKey);
  const ai = { enabled: input.enabled, visionModel: input.visionModel, embeddingModel: input.embeddingModel };
  updatePreferences({ ai });
  return { ...ai, hasApiKey: Boolean(apiKey), tested: input.test };
};

export const analyzeIndexedAsset = async (id: string): Promise<AiAnalysisResult> => {
  const preferences = getBootstrapState().preferences;
  if (!preferences.ai.enabled) throw new AppError({ kind: "VALIDATION", code: "AI_NOT_ENABLED", message: "Enable AI indexing in Settings first.", retryable: false });
  const asset = getAssetIndexRecord(id);
  if (!asset) throw new AppError({ kind: "NOT_FOUND", code: "ASSET_INDEX_RECORD_NOT_FOUND", message: "The selected local index record no longer exists.", retryable: false });
  const apiKey = getOpenAiApiKey();
  const imageUrl = await readImage(new R2ObjectService(getProfile(asset.profileId)), asset.bucket, asset.key);
  const response = await requestOpenAi<{
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  }>(apiKey, "/responses", {
    model: preferences.ai.visionModel,
    store: false,
    max_output_tokens: 500,
    input: [{ role: "user", content: [
      { type: "input_text", text: "Describe this reusable digital asset accurately and concisely. Return 5 to 12 lowercase search tags and one factual description. Do not infer identities, sensitive traits, brands, or locations unless clearly visible." },
      { type: "input_image", image_url: imageUrl, detail: "low" },
    ] }],
    text: { format: { type: "json_schema", name: "asset_index", strict: true, schema: {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string", maxLength: 64 }, minItems: 5, maxItems: 12 },
        description: { type: "string", maxLength: 1_000 },
      },
      required: ["tags", "description"],
      additionalProperties: false,
    } } },
  });
  const text = outputText(response);
  if (!text) throw new AppError({ kind: "UNAVAILABLE", code: "OPENAI_OUTPUT_MISSING", message: "OpenAI returned no asset analysis.", retryable: true });
  let parsed: { tags: string[]; description: string };
  try { parsed = JSON.parse(text) as typeof parsed; } catch { throw new AppError({ kind: "UNAVAILABLE", code: "OPENAI_OUTPUT_INVALID", message: "OpenAI returned an unreadable structured result.", retryable: true }); }
  if (!Array.isArray(parsed.tags) || typeof parsed.description !== "string") throw new AppError({ kind: "UNAVAILABLE", code: "OPENAI_OUTPUT_INVALID", message: "OpenAI returned an incomplete structured result.", retryable: true });
  const tags = parsed.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12);
  const description = parsed.description.trim().slice(0, 1_000);
  const embedding = await createEmbedding(apiKey, preferences.ai.embeddingModel, `${asset.key}\n${description}\n${tags.join(" ")}`);
  const updated = updateAssetAnalysis(id, { tags, aiDescription: description, embedding, embeddingModel: preferences.ai.embeddingModel });
  if (!updated) throw new AppError({ kind: "NOT_FOUND", code: "ASSET_INDEX_RECORD_NOT_FOUND", message: "The local index changed before analysis could be saved.", retryable: true });
  return { asset: updated, usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, totalTokens: response.usage?.total_tokens } };
};

const cosine = (left: number[], right: number[]) => {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
};

export const semanticSearchAssets = async (input: { profileId: string; bucket: string; query: string; limit: number }): Promise<SemanticSearchResult[]> => {
  const preferences = getBootstrapState().preferences;
  if (!preferences.ai.enabled) throw new AppError({ kind: "VALIDATION", code: "AI_NOT_ENABLED", message: "Enable AI indexing in Settings first.", retryable: false });
  const apiKey = getOpenAiApiKey();
  const queryEmbedding = await createEmbedding(apiKey, preferences.ai.embeddingModel, input.query.trim());
  return listAssetIndex({ profileId: input.profileId, bucket: input.bucket })
    .filter((asset) => asset.embeddingModel === preferences.ai.embeddingModel && asset.embedding?.length === queryEmbedding.length)
    .map((asset) => ({ asset, score: cosine(queryEmbedding, asset.embedding as number[]) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit);
};
