import _ from "lodash";
import { PassThrough } from "stream";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";
import { generateImages, DEFAULT_MODEL } from "./images.ts";

// 最大重试次数
const MAX_RETRY_COUNT = 3;
// 重试延迟
const RETRY_DELAY = 5000;

/**
 * 解析模型
 *
 * @param model 模型名称
 * @returns 模型信息
 */
function parseModel(model: string) {
  const [_model, size] = model.split(":");
  const [_, width, height] = /(\d+)[\W\w](\d+)/.exec(size) ?? [];
  return {
    model: _model,
    width: size ? Math.ceil(parseInt(width) / 2) * 2 : 1024,
    height: size ? Math.ceil(parseInt(height) / 2) * 2 : 1024,
  };
}

/**
 * 解析 OpenAI 风格消息，提取文本与首个图片 URL
 */
function parseOpenAIMessageContent(content: any): { text: string; image?: string } {
  if (_.isString(content)) return { text: content };
  if (_.isArray(content)) {
    let textParts: string[] = [];
    let image: string | undefined;
    for (const item of content) {
      if (image) {
        // 已提取到首图，仅继续累积文本
        if (item?.type === "text" && _.isString(item?.text)) textParts.push(item.text);
        continue;
      }
      if (item?.type === "text" && _.isString(item?.text)) textParts.push(item.text);
      else if (
        item?.type === "image_url" &&
        item?.image_url &&
        _.isString(item?.image_url?.url)
      ) {
        image = item.image_url.url;
      }
    }
    return { text: textParts.join(""), image };
  }
  if (_.isObject(content) && _.isString((content as any).content)) return { text: (content as any).content };
  return { text: "" };
}

/**
 * 同步对话补全
 *
 * @param messages 参考gpt系列消息格式，多轮对话请完整提供上下文
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param assistantId 智能体ID，默认使用jimeng原版
 * @param retryCount 重试次数
 */
export async function createCompletion(
  messages: any[],
  refreshToken: string,
  _model = DEFAULT_MODEL,
  retryCount = 0
) {
  return (async () => {
    if (messages.length === 0)
      throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "消息不能为空");

    const { model, width, height } = parseModel(_model);
    logger.info(messages);

    // 解析最后一条用户消息，支持 text + image_url
    const last = messages[messages.length - 1];
    const { text: promptText, image } = parseOpenAIMessageContent(last?.content);

    const imageUrls = await generateImages(
      model,
      promptText,
      {
        width,
        height,
        image,
      },
      refreshToken
    );

    return {
      id: util.uuid(),
      model: _model || model,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: imageUrls.reduce(
              (acc, url, i) => acc + `![image_${i}](${url})\n`,
              ""
            ),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      created: util.unixTimestamp(),
    };
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Response error: ${err.stack}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCompletion(messages, refreshToken, _model, retryCount + 1);
      })();
    }
    throw err;
  });
}

/**
 * 流式对话补全
 *
 * @param messages 参考gpt系列消息格式，多轮对话请完整提供上下文
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param assistantId 智能体ID，默认使用jimeng原版
 * @param retryCount 重试次数
 */
export async function createCompletionStream(
  messages: any[],
  refreshToken: string,
  _model = DEFAULT_MODEL,
  retryCount = 0
) {
  return (async () => {
    const { model, width, height } = parseModel(_model);
    logger.info(messages);

    const stream = new PassThrough();

    if (messages.length === 0) {
      logger.warn("消息为空，返回空流");
      stream.end("data: [DONE]\n\n");
      return stream;
    }

    stream.write(
      "data: " +
        JSON.stringify({
          id: util.uuid(),
          model: _model || model,
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "🎨 图像生成中，请稍候..." },
              finish_reason: null,
            },
          ],
        }) +
        "\n\n"
    );

    const last = messages[messages.length - 1];
    const { text: promptText, image } = parseOpenAIMessageContent(last?.content);

    generateImages(model, promptText, { width, height, image }, refreshToken)
      .then((imageUrls) => {
        for (let i = 0; i < imageUrls.length; i++) {
          const url = imageUrls[i];
          stream.write(
            "data: " +
              JSON.stringify({
                id: util.uuid(),
                model: _model || model,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: i + 1,
                    delta: {
                      role: "assistant",
                      content: `![image_${i}](${url})\n`,
                    },
                    finish_reason: i < imageUrls.length - 1 ? null : "stop",
                  },
                ],
              }) +
              "\n\n"
          );
        }
        stream.write(
          "data: " +
            JSON.stringify({
              id: util.uuid(),
              model: _model || model,
              object: "chat.completion.chunk",
              choices: [
                {
                  index: imageUrls.length + 1,
                  delta: {
                    role: "assistant",
                    content: "图像生成完成！",
                  },
                  finish_reason: "stop",
                },
              ],
            }) +
            "\n\n"
        );
        stream.end("data: [DONE]\n\n");
      })
      .catch((err) => {
        stream.write(
          "data: " +
            JSON.stringify({
              id: util.uuid(),
              model: _model || model,
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 1,
                  delta: {
                    role: "assistant",
                    content: `生成图片失败: ${err.message}`,
                  },
                  finish_reason: "stop",
                },
              ],
            }) +
            "\n\n"
        );
        stream.end("data: [DONE]\n\n");
      });
    return stream;
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Response error: ${err.stack}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCompletionStream(
          messages,
          refreshToken,
          _model,
          retryCount + 1
        );
      })();
    }
    throw err;
  });
}
