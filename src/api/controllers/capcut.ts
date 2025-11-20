import _ from "lodash";
import { PassThrough } from "stream";
import { StringDecoder } from "string_decoder";
import { createParser } from "eventsource-parser";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";
import { request, ensureMsToken } from "@/api/controllers/core.ts";

// 最大重试次数与重试间隔
const MAX_RETRY_COUNT = 3;
const RETRY_DELAY = 5000;

/**
 * 简化解析 OpenAI 风格消息，仅提取文本
 */
function parseOpenAIMessageContent(content: any): { text: string } {
  if (_.isString(content)) return { text: content };
  if (_.isArray(content)) {
    const text = content
      .filter((it: any) => it?.type === "text" && _.isString(it?.text))
      .map((it: any) => it.text)
      .join("");
    return { text };
  }
  if (_.isObject(content) && _.isString((content as any).content)) return { text: (content as any).content };
  return { text: "" };
}

/**
 * 将 CapCut SSE 响应转换为 OpenAI 流式 chat.completion.chunk
 */
export async function createCapcutConversationStream(
  messages: any[],
  refreshToken: string,
  params: Record<string, any> = {},
  retryCount = 0
) {
  return (async () => {
    if (!messages?.length) {
      const stream = new PassThrough();
      stream.end("data: [DONE]\n\n");
      return stream;
    }

    const conversation_id = params?.conversation_id || util.uuid();

    // 预拉取 msToken 与区域域名信息
    await ensureMsToken(refreshToken);

    // 处理系统提示词和多轮对话
    const capcutMessages: any[] = [];
    let systemPrompt = "";
    
    for (const msg of messages) {
      const role = msg?.role?.toLowerCase();
      const { text } = parseOpenAIMessageContent(msg?.content);
      
      if (!text) continue;
      
      // 收集系统提示词
      if (role === "system") {
        systemPrompt = systemPrompt ? `${systemPrompt}\n${text}` : text;
        continue;
      }
      
      // 转换为 CapCut 消息格式
      if (role === "user" || role === "assistant") {
        capcutMessages.push({
          author: { role: role === "assistant" ? "assistant" : "user" },
          id: util.uuid(),
          content: { content_parts: [{ text }] },
          metadata: {
            is_visually_hidden_from_conversation: false,
            conversation_id,
            parent_message_id: "",
          },
          create_time: util.unixTimestamp() * 1000,
          tools: [],
        });
      }
    }

    // 如果有系统提示词，将其融入第一条用户消息
    if (systemPrompt && capcutMessages.length > 0) {
      // 找到第一条用户消息
      const firstUserMsgIndex = capcutMessages.findIndex(m => m.author.role === "user");
      if (firstUserMsgIndex !== -1) {
        const firstUserMsg = capcutMessages[firstUserMsgIndex];
        const originalText = firstUserMsg.content.content_parts[0]?.text || "";
        // 将系统提示词作为前缀添加到第一条用户消息中
        firstUserMsg.content.content_parts[0].text = `${systemPrompt}\n\n${originalText}`;
      } else {
        // 如果没有用户消息，创建一个包含系统提示词的用户消息
        capcutMessages.unshift({
          author: { role: "user" },
          id: util.uuid(),
          content: { content_parts: [{ text: systemPrompt }] },
          metadata: {
            is_visually_hidden_from_conversation: false,
            conversation_id,
            parent_message_id: "",
          },
          create_time: util.unixTimestamp() * 1000,
          tools: [],
        });
      }
    }

    // 确保至少有一条消息
    if (capcutMessages.length === 0) {
      capcutMessages.push({
        author: { role: "user" },
        id: util.uuid(),
        content: { content_parts: [{ text: "Hello" }] },
        metadata: {
          is_visually_hidden_from_conversation: false,
          conversation_id,
          parent_message_id: "",
        },
        create_time: util.unixTimestamp() * 1000,
        tools: [],
      });
    }

    const body = {
      conversation_id,
      messages: capcutMessages,
      version: "3.0.0",
    };

    // 请求 CapCut SSE 接口
    const defaultParams = {
      region: (params?.region || '').toString() || 'US',
      web_version: params?.web_version || '7.5.0',
      da_version: params?.da_version || '3.1.3',
      web_component_open_flag: 1,
    };

    const axiosResp = await request(
      "POST",
      "/mweb/v1/creation_agent/v2/conversation",
      refreshToken,
      {
        params: { device_platform: "web", ...(defaultParams), ...(params || {}) },
        data: body,
        responseType: "stream",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
      }
    );

    const stream = new PassThrough();
    let started = false;
    let finished = false;
    let currentToolCallId: string | null = null;

    const onEvent = (event: string | undefined, data: string) => {
      if (!event) return;
      try {
        if (event === "system") {
          const obj = util.ignoreJSONParse(data);
          if (obj?.type === "stream_complete") {
            if (!finished) {
              stream.end("data: [DONE]\n\n");
              finished = true;
            }
          }
          return;
        }
        if (event === "message") {
          const obj = util.ignoreJSONParse(data);
          if (!started && obj?.status === "in_progress") {
            // 发送起始 chunk（role）
            stream.write(
              "data: " +
                JSON.stringify({
                  id: util.uuid(),
                  object: "chat.completion.chunk",
                  model: "agent",
                  choices: [
                    { index: 0, delta: { role: "assistant", content: "" }, finish_reason: null },
                  ],
                }) +
                "\n\n"
            );
            started = true;
            return;
          }
          // 记录最近的工具消息上下文
          if (obj?.author?.role === 'tool') {
            currentToolCallId = obj?.metadata?.tool_call_id || null;
          }
          const text = (() => {
            try {
              const cp = obj?.content?.content_parts;
              if (_.isArray(cp)) return cp.map((p: any) => p?.text).filter(Boolean).join("");
              return "";
            } catch { return ""; }
          })();
          if (text) {
            stream.write(
              "data: " +
                JSON.stringify({
                  id: util.uuid(),
                  object: "chat.completion.chunk",
                  model: "agent",
                  choices: [
                    { index: 0, delta: currentToolCallId ? { role: 'tool', content: text, tool_call_id: currentToolCallId } : { content: text }, finish_reason: null },
                  ],
                }) +
                "\n\n"
            );
          }
          if (obj?.status === "finished_successfully" && !finished) {
            // 结束
            stream.write(
              "data: " +
                JSON.stringify({
                  id: util.uuid(),
                  object: "chat.completion.chunk",
                  model: "agent",
                  choices: [
                    { index: 0, delta: {}, finish_reason: "stop" },
                  ],
                }) +
                "\n\n"
            );
            stream.end("data: [DONE]\n\n");
            finished = true;
            return;
          }
          return;
        }
        if (event === "delta") {
          const obj = util.ignoreJSONParse(data);
          // 仅处理 append 文本增量
          if (obj?.path && /\/message\/tool_calls\/(\d+)$/.test(obj.path) && obj?.op === 'add' && _.isString(obj?.value)) {
            // 新的工具调用加入
            const tc = util.ignoreJSONParse(obj.value);
            if (tc && tc.func && tc.func.name) {
              const toolDelta = {
                tool_calls: [
                  {
                    index: Number(RegExp.$1),
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.func.name, arguments: tc.func.arguments || '' },
                  },
                ],
              } as any;
              stream.write(
                "data: " +
                  JSON.stringify({
                    id: util.uuid(),
                    object: "chat.completion.chunk",
                    model: "agent",
                    choices: [
                      { index: 0, delta: toolDelta, finish_reason: null },
                    ],
                  }) +
                  "\n\n"
              );
            }
            return;
          }
          if (obj?.op === "append" && _.isString(obj?.value)) {
            stream.write(
              "data: " +
                JSON.stringify({
                  id: util.uuid(),
                  object: "chat.completion.chunk",
                  model: "agent",
                  choices: [
                    { index: 0, delta: currentToolCallId ? { role: 'tool', content: obj.value, tool_call_id: currentToolCallId } : { content: obj.value }, finish_reason: null },
                  ],
                }) +
                "\n\n"
            );
          }
          return;
        }
      } catch (e) {
        logger.warn("Capcut SSE parse error:", e);
      }
    };

    const parser = createParser((evt) => {
      if (evt.type === "event") onEvent(evt.event, evt.data);
    });

    // 使用 StringDecoder 处理多字节 UTF-8 字符边界问题
    const decoder = new StringDecoder("utf8");
    axiosResp.data.on("data", (chunk: Buffer) => {
      const str = decoder.write(chunk);
      parser.feed(str);
    });
    axiosResp.data.on("end", () => {
      // 处理 decoder 中剩余的字节
      const remaining = decoder.end();
      if (remaining) parser.feed(remaining);
      if (!finished) stream.end("data: [DONE]\n\n");
    });
    axiosResp.data.on("error", (err: any) => {
      stream.destroy(err);
    });

    return stream;
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Capcut stream error: ${err?.stack || err}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCapcutConversationStream(messages, refreshToken, params, retryCount + 1);
      })();
    }
    throw err;
  });
}

/**
 * 非流式：聚合 CapCut SSE 文本并返回 OpenAI chat.completion
 */
export async function createCapcutConversation(
  messages: any[],
  refreshToken: string,
  params: Record<string, any> = {},
  retryCount = 0
) {
  return (async () => {
    const stream = await createCapcutConversationStream(messages, refreshToken, params);
    return await new Promise((resolve, reject) => {
      let content = "";
      let done = false;
      const toolCalls: any[] = [];
      stream.on("data", (buf: Buffer) => {
        const line = buf.toString("utf8");
        if (line.startsWith("data:")) {
          const payload = line.replace(/^data:\s*/, "").trim();
          if (payload === "[DONE]") return;
          const obj = util.ignoreJSONParse(payload);
          const delta = obj?.choices?.[0]?.delta;
          if (delta?.content) content += String(delta.content);
          // 聚合工具调用（非流式场景返回在 assistant.message.tool_calls）
          if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const data = {
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || '',
                },
              };
              // 去重（按 id）
              if (!toolCalls.find(x => x.id === data.id)) toolCalls.push(data);
            }
          }
        }
      });
      stream.on("end", () => {
        if (done) return;
        done = true;
        resolve({
          id: util.uuid(),
          object: "chat.completion",
          model: "agent",
          choices: [
            { index: 0, message: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: content.length || 1, total_tokens: (content.length || 1) + 1 },
          created: util.unixTimestamp(),
        });
      });
      stream.on("error", reject);
    });
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Capcut non-stream error: ${err?.stack || err}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCapcutConversation(messages, refreshToken, params, retryCount + 1);
      })();
    }
    throw new APIException(EX.API_REQUEST_FAILED, `[Capcut代理失败]: ${err?.message || err}`);
  });
}
