import _ from "lodash";
import { PassThrough } from "stream";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";
import { generateImages, DEFAULT_MODEL } from "./images.ts";
import { generateVideo, DEFAULT_VIDEO_MODEL } from "./videos.ts";

// 最大重试次数
const MAX_RETRY_COUNT = 3;
// 重试延迟
const RETRY_DELAY = 5000;

/**
 * 判断是否为视频模型
 */
function isVideoModel(model: string): boolean {
  return model.startsWith("jimeng-video-");
}

/**
 * 解析模型
 *
 * @param model 模型名称
 * @returns 模型信息
 */
function parseModel(model: string) {
  const [_model, size] = model.split(":");

  if (!size) {
    // 4.0 模型默认使用 2k 尺寸
    const is4_0Model = _model.includes("4.0");
    // 3.x 模型默认使用 2k 尺寸
    const is3_xModel = _model.includes("3.");

    let defaultDimension = 1024;
    if (is4_0Model) {
      defaultDimension = 4096;
    } else if (is3_xModel) {
      defaultDimension = 2048;
    }

    return {
      model: _model,
      width: defaultDimension,
      height: defaultDimension,
    };
  }

  // 处理 1k, 2k, 4k 格式
  const kMatch = /^(\d+)k$/i.exec(size);
  if (kMatch) {
    const k = parseInt(kMatch[1]);
    const dimension = k * 1024;
    return {
      model: _model,
      width: dimension,
      height: dimension,
    };
  }

  // 处理传统的 widthxheight 格式
  const [_, width, height] = /(\d+)[\W\w](\d+)/.exec(size) ?? [];
  return {
    model: _model,
    width: width ? Math.ceil(parseInt(width) / 2) * 2 : 1024,
    height: height ? Math.ceil(parseInt(height) / 2) * 2 : 1024,
  };
}

/**
 * 解析 OpenAI 风格消息，提取文本与所有图片 URL
 */
function parseOpenAIMessageContent(content: any): { text: string; images?: string[] } {
  if (_.isString(content)) return { text: content };
  if (_.isArray(content)) {
    let textParts: string[] = [];
    let images: string[] = [];
    for (const item of content) {
      if (item?.type === "text" && _.isString(item?.text)) {
        textParts.push(item.text);
      } else if (
        item?.type === "image_url" &&
        item?.image_url &&
        _.isString(item?.image_url?.url)
      ) {
        images.push(item.image_url.url);
      }
    }
    return { text: textParts.join(""), images: images.length > 0 ? images : undefined };
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

    // 解析最后一条用户消息，支持 text + image_url
    const last = messages[messages.length - 1];
    const { text: promptText, images } = parseOpenAIMessageContent(last?.content);

    // 判断是否为视频模型
    if (isVideoModel(_model)) {
      logger.info("检测到视频模型，使用视频生成");

      // 视频生成需要首帧图片
      if (!images || images.length === 0) {
        throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "视频生成需要提供首帧图片");
      }

      const videoUrls = await generateVideo(
        _model,
        promptText,
        {
          firstFrameImage: images[0],
        },
        refreshToken
      );

      return {
        id: util.uuid(),
        model: _model,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: videoUrls.reduce(
                (acc, url, i) => acc + `<video controls="controls">\n    ${url}\n</video>\n\n[Download Video](${url})\n\n`,
                ""
              ),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        created: util.unixTimestamp(),
      };
    }

    // 图像生成
    const { model, width, height } = parseModel(_model);
    logger.info(messages);

    const imageUrls = await generateImages(
      model,
      promptText,
      {
        width,
        height,
        images,
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
  if (messages.length === 0) {
    throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "消息不能为空");
  }

  const last = messages[messages.length - 1];
  const { text: promptText, images } = parseOpenAIMessageContent(last?.content);

  // 判断是否为视频模型
  if (isVideoModel(_model)) {
    logger.info("检测到视频模型，使用视频生成（流式）");

    // 视频生成需要首帧图片
    if (!images || images.length === 0) {
      throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "视频生成需要提供首帧图片");
    }

    // 先生成视频，失败会抛异常返回 500
    const videoUrls = await generateVideo(
      _model,
      promptText,
      {
        firstFrameImage: images[0],
      },
      refreshToken
    );

    const stream = new PassThrough();

    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i];
      stream.write(
        "data: " +
          JSON.stringify({
            id: util.uuid(),
            model: _model,
            object: "chat.completion.chunk",
            choices: [
              {
                index: i,
                delta: { role: "assistant", content: `<video controls="controls">\n    ${url}\n</video>\n\n[Download Video](${url})\n\n` },
                finish_reason: i < videoUrls.length - 1 ? null : "stop",
              },
            ],
          }) +
          "\n\n"
      );
    }
    stream.end("data: [DONE]\n\n");
    return stream;
  }

  // 图像生成（流式）
  const { model, width, height } = parseModel(_model);
  logger.info(messages);

  // 先生成图片，失败会抛异常返回 500
  const imageUrls = await generateImages(model, promptText, { width, height, images }, refreshToken);

  const stream = new PassThrough();

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
              index: i,
              delta: { role: "assistant", content: `![image_${i}](${url})\n` },
              finish_reason: i < imageUrls.length - 1 ? null : "stop",
            },
          ],
        }) +
        "\n\n"
    );
  }
  stream.end("data: [DONE]\n\n");
  return stream;
}
