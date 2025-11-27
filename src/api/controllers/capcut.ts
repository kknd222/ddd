import _ from "lodash";
import { PassThrough } from "stream";
import { StringDecoder } from "string_decoder";
import { createParser } from "eventsource-parser";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";
import { request, ensureMsToken, getRegionConfig, getCredit, receiveCredit, parseTokenRegion } from "@/api/controllers/core.ts";
import { SmartPoller, PollingStatus } from "@/lib/smart-poller.ts";

// 最大重试次数与重试间隔
const MAX_RETRY_COUNT = 3;
const RETRY_DELAY = 5000;

// Agent 工具调用信息
interface AgentToolCall {
  id: string;
  type: string;
  func: {
    name: string;
    arguments: string;
    extra?: {
      resource_type?: string;
      submit_id?: string;
    };
  };
}

// 工具执行结果缓存
const toolResultCache = new Map<string, any>();

/**
 * 轮询 Agent 工具执行结果（根据 submit_id）
 */
async function pollToolResult(submitId: string, resourceType: string, refreshToken: string): Promise<string[]> {
  logger.info(`🔄 开始轮询 Agent 工具结果: submitId=${submitId}, type=${resourceType}`);
  
  // 🔥 等待 2 秒，让 Agent 后台有时间创建记录
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const regionCfg = getRegionConfig(refreshToken);
  const country = (regionCfg?.countryCode || "US").toUpperCase();
  const apiHost = regionCfg?.mwebHost || "https://mweb-api-sg.capcut.com";
  const { token: sessionId } = parseTokenRegion(refreshToken);
  
  const poller = new SmartPoller({
    maxPollCount: resourceType === 'video' ? 900 : 600,
    pollInterval: resourceType === 'video' ? 2000 : 1000,
    expectedItemCount: 1,
    type: resourceType === 'video' ? 'video' : 'image',
    sessionId
  });

  let retryCount = 0;
  const { data: finalTaskInfo } = await poller.poll(async () => {
    const result = await request("post", `${apiHost}/mweb/v1/get_history_by_ids`, refreshToken, {
      params: {
        region: country,
        da_version: "3.3.2",
        web_version: "7.5.0",
        aigc_features: "app_lip_sync",
      },
      data: { submit_ids: [submitId] },
    });

    // 🔍 调试：打印返回结果的键
    logger.info(`📊 查询结果的键: ${Object.keys(result || {}).join(', ')}, 期望的key: ${submitId}`);

    // 🔥 记录不存在时，前几次不抛异常，给后台时间
    if (!result[submitId]) {
      retryCount++;
      if (retryCount < 10) {
        logger.info(`⏳ 记录暂未创建，等待中... (${retryCount}/10)`);
        // 返回处理中状态，继续轮询
        return {
          status: {
            status: 20,
            failCode: undefined,
            itemCount: 0,
            finishTime: 0,
            historyId: submitId
          } as PollingStatus,
          data: { item_list: [], task: { item_list: [] } }
        };
      }
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");
    }

    const entry = result[submitId];
    const currentStatus = entry.status ?? entry.task?.status ?? 20;
    const currentFailCode = entry.fail_code ?? entry.task?.fail_code;
    const currentItemList = entry.item_list ?? entry.task?.item_list ?? [];

    logger.info(`📊 获取到记录: status=${currentStatus}, itemCount=${currentItemList.length}`);

    return {
      status: {
        status: currentStatus,
        failCode: currentFailCode,
        itemCount: currentItemList.length,
        finishTime: 0,
        historyId: submitId
      } as PollingStatus,
      data: entry
    };
  }, submitId);

  const item_list = finalTaskInfo.item_list ?? finalTaskInfo.task?.item_list ?? [];
  
  if (resourceType === 'video') {
    // 提取视频 URL
    const urls = item_list.map((item: any) => {
      const videoUrl = item?.video?.transcoded_video?.origin?.video_url;
      if (!videoUrl) {
        logger.warn("视频URL不存在");
        return null;
      }
      return videoUrl;
    }).filter(Boolean);
    logger.info(`✅ 轮询完成，获取到 ${urls.length} 个视频`);
    return urls;
  } else {
    // 提取图片 URL
    const urls = item_list.map((item: any) => {
      if (item?.image?.large_images?.[0]?.image_url) {
        return item.image.large_images[0].image_url;
      }
      return item?.common_attr?.cover_url || null;
    }).filter(Boolean);
    logger.info(`✅ 轮询完成，获取到 ${urls.length} 张图片`);
    return urls;
  }
}

/**
 * 将 URL 数组转换为 Markdown 格式
 */
function urlsToMarkdown(urls: string[], resourceType: string): string {
  if (resourceType === 'video') {
    return urls.map((url, i) => 
      `\n\n<video controls="controls" width="100%">\n  <source src="${url}" type="video/mp4">\n</video>\n\n[下载视频 ${i + 1}](${url})`
    ).join('');
  } else {
    return urls.map((url, i) => 
      `\n\n![生成的图片 ${i + 1}](${url})`
    ).join('');
  }
}

/**
 * 简化解析 OpenAI 风格消息，仅提取文本
 */
function parseOpenAIMessageContent(content: any): { text: string} {
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

    // 🔥 在调用 Agent 前先检查和领取积分
    try {
      const { totalCredit } = await getCredit(refreshToken);
      logger.info(`💰 当前积分: ${totalCredit}`);
      if (totalCredit <= 0) {
        await receiveCredit(refreshToken);
        logger.info(`✅ 已领取今日积分`);
      }
    } catch (e) {
      logger.warn(`⚠️ 积分检查失败（继续执行）: ${e.message}`);
    }

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
    const pendingToolCalls: AgentToolCall[] = []; // 待处理的工具调用
    let agentFinished = false; // Agent 是否已完成
    let hasProcessedTools = false; // 🔥 是否已处理过工具调用（防止重复）
    let expectedToolCount = 0; // 期望的工具调用数量
    let receivedToolResults = 0; // 已接收的工具结果数量

    const onEvent = (event: string | undefined, data: string) => {
      if (!event) return;
      try {
        if (event === "system") {
          const obj = util.ignoreJSONParse(data);
          if (obj?.type === "stream_complete") {
            agentFinished = true;
            // 🔥 Agent 流完成，开始处理工具调用
            logger.info(`\n🎉 Agent 流完成，检测到 ${pendingToolCalls.length} 个工具调用\n`);
            return;
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
          // 🔥 记录工具消息（包含 submit_id）
          if (obj?.author?.role === 'tool') {
            const toolCallId = obj?.metadata?.tool_call_id || null;
            currentToolCallId = toolCallId;
            
            // 🔥 解析工具执行结果中的 submit_id（关键！）
            try {
              const toolResultText = obj?.content?.content_parts?.[0]?.text;
              if (toolResultText) {
                const toolResult = JSON.parse(toolResultText);
                const submitId = toolResult.submit_id;
                
                logger.info(`📝 收到工具结果: toolCallId=${toolCallId}, submitId=${submitId}, type=${toolResult.resource_type}`);
                
                if (submitId && toolCallId) {
                  // 🔥 将 submit_id 更新到对应的 toolCall
                  const toolCall = pendingToolCalls.find(tc => tc.id === toolCallId);
                  if (toolCall) {
                    if (!toolCall.func.extra) toolCall.func.extra = {};
                    toolCall.func.extra.submit_id = submitId;
                    toolCall.func.extra.resource_type = toolResult.resource_type || 'image';
                    receivedToolResults++;
                    logger.info(`✅ 更新工具调用: ${toolCall.func.name}, submitId=${submitId} (${receivedToolResults}/${expectedToolCount})`);
                    
                    // 🔥 当所有工具结果都收到后，立即开始处理（不等 stream_complete）
                    if (receivedToolResults === expectedToolCount && expectedToolCount > 0) {
                      logger.info(`\n🎯 所有工具结果已收到（${receivedToolResults}个），立即开始处理\n`);
                      setTimeout(() => handlePendingTools(), 100); // 稍微延迟确保所有数据接收完
                    }
                  }
                }
              }
            } catch (e) {
              logger.warn("⚠️ 解析工具结果失败:", e);
            }
          }
          
          const text = (() => {
            try {
              const cp = obj?.content?.content_parts;
              if (_.isArray(cp)) return cp.map((p: any) => p?.text).filter(Boolean).join("");
              return "";
            } catch { return ""; }
          })();
          
          // 推送 Agent 的文本回复
          if (text) {
            // 🔥 过滤掉工具结果的 JSON（包含 submit_id 等技术信息）
            const isToolResult = obj?.author?.role === 'tool';
            const looksLikeToolResult = text.includes('submit_id') && text.includes('history_id');
            
            if (!isToolResult && !looksLikeToolResult) {
              // 只推送 Agent 的正常文本回复
              stream.write(
                "data: " +
                  JSON.stringify({
                    id: util.uuid(),
                    object: "chat.completion.chunk",
                    model: "agent",
                    choices: [
                      { index: 0, delta: { content: text }, finish_reason: null },
                    ],
                  }) +
                  "\n\n"
              );
            } else {
              logger.info(`🔇 过滤工具结果文本（不推送给客户端）: ${text.substring(0, 100)}...`);
            }
          }
          
          // 检测 Agent 完成标记
          if (obj?.status === "finished_successfully" && obj?.end_turn) {
            agentFinished = true;
            logger.info("🎯 Agent 已完成，准备处理工具调用");
            return;
          }
          return;
        }
        if (event === "delta") {
          const obj = util.ignoreJSONParse(data);
          
          // 🔥 检测工具调用（核心逻辑）
          if (obj?.path && /\/message\/tool_calls\/(\d+)$/.test(obj.path) && obj?.op === 'add' && _.isString(obj?.value)) {
            const tc = util.ignoreJSONParse(obj.value) as AgentToolCall;
            
            if (tc && tc.func && tc.func.name) {
              // 🔥 防止重复添加（基于 id 去重）
              if (!pendingToolCalls.find(t => t.id === tc.id)) {
                pendingToolCalls.push(tc);
                expectedToolCount++;
                logger.info(`🔧 检测到工具调用 #${pendingToolCalls.length}: ${tc.func.name} (等待工具执行结果...)`);
              }
            }
            return;
          }
          
          // 推送文本增量
          if (obj?.op === "append" && _.isString(obj?.value)) {
            // 🔥 过滤包含技术信息的文本
            const looksLikeToolResult = obj.value.includes('submit_id') || obj.value.includes('history_id');
            
            if (!looksLikeToolResult) {
              stream.write(
                "data: " +
                  JSON.stringify({
                    id: util.uuid(),
                    object: "chat.completion.chunk",
                    model: "agent",
                    choices: [
                      { index: 0, delta: { content: obj.value }, finish_reason: null },
                    ],
                  }) +
                  "\n\n"
              );
            }
          }
          
          // 🔥 检测工具结果的 replace 操作（包含 submit_id）
          if (obj?.op === "replace" && _.isString(obj?.value) && obj?.path?.includes('/content_parts/')) {
            try {
              const toolResult = JSON.parse(obj.value);
              if (toolResult.submit_id) {
                const submitId = toolResult.submit_id;
                const resourceType = toolResult.resource_type || 'image';
                
                logger.info(`📝 检测到工具结果（replace）: submitId=${submitId}, type=${resourceType}, toolCallId=${currentToolCallId}`);
                
                // 🔥 使用当前的 tool_call_id 更新工具调用
                if (currentToolCallId) {
                  const toolCall = pendingToolCalls.find(tc => tc.id === currentToolCallId);
                  if (toolCall) {
                    if (!toolCall.func.extra) toolCall.func.extra = {};
                    toolCall.func.extra.submit_id = submitId;
                    toolCall.func.extra.resource_type = resourceType;
                    receivedToolResults++;
                    logger.info(`✅ 更新工具调用: ${toolCall.func.name}, submitId=${submitId} (${receivedToolResults}/${expectedToolCount})`);
                    
                    // 🔥 当所有工具结果都收到后，立即开始处理
                    if (receivedToolResults === expectedToolCount && expectedToolCount > 0) {
                      logger.info(`\n🎯 所有工具结果已收到（${receivedToolResults}个），立即开始处理\n`);
                      setTimeout(() => handlePendingTools(), 100);
                    }
                  }
                }
              }
            } catch (e) {
              // 不是 JSON，忽略
            }
          }
          return;
        }
      } catch (e) {
        logger.warn("Capcut SSE parse error:", e);
      }
    };

    // 🔥 处理待执行的工具调用（异步）
    const handlePendingTools = () => {
      // 🔥 防止重复处理
      if (hasProcessedTools) {
        logger.info("⚠️ 工具已处理过，跳过重复执行");
        return;
      }
      hasProcessedTools = true;
      
      if (pendingToolCalls.length === 0) {
        logger.info("✅ 无工具调用需要处理");
        if (!finished) {
          stream.end("data: [DONE]\n\n");
          finished = true;
        }
        return;
      }
      
      logger.info(`\n🎯 开始处理 ${pendingToolCalls.length} 个工具调用\n`);
      
      // 🔥 不显示分隔线和任务提示，保持 Agent 文本的连贯性
      // 只在后台静默处理，直接插入图片
      
      // 🚀 异步处理所有工具调用
      (async () => {
        try {
          for (let i = 0; i < pendingToolCalls.length; i++) {
            const toolCall = pendingToolCalls[i];
            const submitId = toolCall.func.extra?.submit_id;
            const resourceType = toolCall.func.extra?.resource_type || 'image';
            
            if (!submitId) {
              logger.warn(`⚠️ 工具调用 #${i + 1} 没有 submitId，跳过`);
              continue;
            }
            
            // 🔥 静默处理，不显示进度（保持文本流畅）
            logger.info(`⏳ 任务 ${i + 1}/${pendingToolCalls.length}: 开始轮询 ${resourceType}...`);
            
            try {
              // 轮询获取结果
              const urls = await pollToolResult(submitId, resourceType, refreshToken);
              
              if (urls.length > 0) {
                // 转换为 Markdown（直接插入，不加进度提示）
                const markdown = urlsToMarkdown(urls, resourceType);
                
                // 🔥 直接推送图片 Markdown
                stream.write(
                  "data: " +
                    JSON.stringify({
                      id: util.uuid(),
                      object: "chat.completion.chunk",
                      model: "agent",
                      choices: [
                        { index: 0, delta: { content: markdown }, finish_reason: null },
                      ],
                    }) +
                    "\n\n"
                );
                
                logger.info(`✅ 任务 ${i + 1}/${pendingToolCalls.length} 完成: 获取到 ${urls.length} 个资源`);
              } else {
                logger.warn(`⚠️ 任务 ${i + 1}: 未获取到资源`);
              }
            } catch (error) {
              logger.error(`❌ 工具执行失败 #${i + 1}: ${error.message}`);
            }
          }
          
          // 所有工具处理完成（静默结束，不额外提示）
          logger.info(`🎉 所有 ${pendingToolCalls.length} 个任务处理完成`);
          
          if (!finished) {
            stream.end("data: [DONE]\n\n");
            finished = true;
          }
          
        } catch (error) {
          logger.error(`❌ 工具处理出错: ${error.message}`);
          if (!finished) {
            stream.end("data: [DONE]\n\n");
            finished = true;
          }
        }
      })();
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
      
      // 🔥 Agent SSE 流结束后，处理所有工具调用
      if (agentFinished && pendingToolCalls.length > 0) {
        logger.info(`\n🚀 Agent 流结束，开始异步处理 ${pendingToolCalls.length} 个工具调用\n`);
        handlePendingTools();
      } else if (!finished) {
        // 无工具调用，直接结束
        stream.end("data: [DONE]\n\n");
        finished = true;
      }
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
 * 🔥 自动处理工具调用并轮询结果
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
          // 聚合工具调用
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
