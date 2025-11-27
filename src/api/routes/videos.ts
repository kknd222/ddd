import _ from "lodash";

import Request from "@/lib/request/Request.ts";
import Response from "@/lib/response/Response.ts";
import { PassThrough } from "stream";
import { generateVideo } from "@/api/controllers/videos.ts";
import { tokenSplit } from "@/api/controllers/core.ts";
import util from "@/lib/util.ts";
import logger from "@/lib/logger.ts";

export default {
  prefix: "/v1/videos",

  post: {
    "/generations": async (request: Request) => {
      request
        .validate("body.model", v => _.isUndefined(v) || _.isString(v))
        .validate("body.prompt", _.isString)
        .validate("body.first_frame_image", v => _.isUndefined(v) || _.isString(v) || _.isObject(v))
        .validate("body.end_frame_image", v => _.isUndefined(v) || _.isString(v) || _.isObject(v))
        .validate("body.images", v => _.isUndefined(v) || _.isArray(v))
        .validate("body.aspect_ratio", v => _.isUndefined(v) || _.isString(v))
        .validate("body.duration", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.fps", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.response_format", v => _.isUndefined(v) || _.isString(v))
        .validate("body.stream", v => _.isUndefined(v) || _.isBoolean(v))
        .validate("headers.authorization", _.isString);

      // refresh_token切分
      const tokens = tokenSplit(request.headers.authorization);
      logger.info("tokens:", tokens);
      // 随机挑选一个refresh_token
      const token = _.sample(tokens);
      logger.info("current token:", token);

      const {
        model,
        prompt,
        first_frame_image,
        end_frame_image,
        images,
        aspect_ratio,
        duration,
        fps,
        stream,
        response_format,
      } = request.body;

      const responseFormat = _.defaultTo(response_format, "url");

      // 解析图片字段：支持字符串 / { type: 'image_url', image_url: { url } } / 对象
      const extractImage = (input: any): string | undefined => {
        if (!input) return undefined;
        if (_.isString(input)) return input;
        if (typeof input === "object") {
          const obj = input as any;
          if (
            obj.type === "image_url" &&
            obj.image_url &&
            _.isString(obj.image_url.url)
          ) return obj.image_url.url;
          if (_.isString(obj.url)) return obj.url;
        }
        return undefined;
      };

      // 模式检测：根据图片数量自动判断生成模式
      let firstFrameImage: string | undefined;
      let endFrameImage: string | undefined;
      let videoMode: "text_to_video" | "image_to_video" | "first_last_frames" = "text_to_video";

      // 优先使用 images 数组（支持自动模式检测）
      if (images && _.isArray(images) && images.length > 0) {
        const extractedImages = images.map(extractImage).filter(Boolean);
        if (extractedImages.length === 1) {
          firstFrameImage = extractedImages[0];
          videoMode = "image_to_video";
          logger.info("检测到1张图片 → 图生视频模式");
        } else if (extractedImages.length >= 2) {
          firstFrameImage = extractedImages[0];
          endFrameImage = extractedImages[1];
          videoMode = "first_last_frames";
          logger.info("检测到2张图片 → 首尾帧视频模式");
        }
      }
      // 兼容旧的 first_frame_image 和 end_frame_image 参数
      else {
        firstFrameImage = extractImage(first_frame_image);
        endFrameImage = extractImage(end_frame_image);

        if (firstFrameImage && endFrameImage) {
          videoMode = "first_last_frames";
          logger.info("检测到首帧和尾帧图片 → 首尾帧视频模式");
        } else if (firstFrameImage) {
          videoMode = "image_to_video";
          logger.info("检测到首帧图片 → 图生视频模式");
        } else {
          videoMode = "text_to_video";
          logger.info("未检测到图片 → 文生视频模式");
        }
      }

      // 检查模型是否支持首尾帧模式
      if (videoMode === "first_last_frames" && model !== "jimeng-video-3.0") {
        logger.warn(`模型 ${model} 不支持首尾帧模式，忽略尾帧图片`);
        endFrameImage = undefined; // 忽略尾帧
        videoMode = "image_to_video"; // 降级为图生视频模式
      }

      logger.info("视频生成请求:", {
        model,
        prompt,
        videoMode,
        hasFirstFrame: !!firstFrameImage,
        hasEndFrame: !!endFrameImage,
        aspectRatio: aspect_ratio,
        duration,
        fps,
        responseFormat,
      });

      // 流式：使用reasoning_content返回队列和进度信息
      if (stream) {
        const pass = new PassThrough();
        let videoUrls: string[] = [];
        const reasoningMessages: string[] = [];

        // 启动生成任务（异步）
        (async () => {
          try {
            videoUrls = await generateVideo(model, prompt, {
              firstFrameImage,
              endFrameImage,
              videoAspectRatio: aspect_ratio,
              duration,
              fps,
              onProgress: (message: string) => {
                // 通过reasoning_content返回进度信息
                reasoningMessages.push(message);
                pass.write(
                  "data: " +
                    JSON.stringify({
                      id: util.uuid(),
                      object: "chat.completion.chunk",
                      created: util.unixTimestamp(),
                      model: model || "jimeng-video",
                      choices: [
                        {
                          index: 0,
                          delta: {
                            reasoning_content: message + "\n"
                          },
                          finish_reason: null
                        }
                      ]
                    }) +
                    "\n\n"
                );
              }
            }, token);

            // 生成完成，返回视频数据
            let data = [] as any[];
            if (responseFormat === "b64_json") {
              data = (
                await Promise.all(videoUrls.map((url) => util.fetchFileBASE64(url)))
              ).map((b64) => ({ b64_json: b64 }));
            } else {
              data = videoUrls.map((url) => ({ url }));
            }

            // 返回最终结果（视频在正文）
            pass.write(
              "data: " +
                JSON.stringify({
                  id: util.uuid(),
                  object: "chat.completion.chunk",
                  created: util.unixTimestamp(),
                  model: model || "jimeng-video",
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content: JSON.stringify({ created: util.unixTimestamp(), data })
                      },
                      finish_reason: "stop"
                    }
                  ]
                }) +
                "\n\n"
            );
            pass.end("data: [DONE]\n\n");
          } catch (error) {
            // 先通过reasoning_content返回错误说明
            pass.write(
              "data: " +
                JSON.stringify({
                  id: util.uuid(),
                  object: "chat.completion.chunk",
                  created: util.unixTimestamp(),
                  model: model || "jimeng-video",
                  choices: [
                    {
                      index: 0,
                      delta: {
                        reasoning_content: `❌ 视频生成失败\n错误信息: ${error.message || error}\n`
                      },
                      finish_reason: null
                    }
                  ]
                }) +
                "\n\n"
            );
            
            // 错误详情放在正文
            pass.write(
              "data: " +
                JSON.stringify({
                  id: util.uuid(),
                  object: "chat.completion.chunk",
                  created: util.unixTimestamp(),
                  model: model || "jimeng-video",
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content: JSON.stringify({ error: { message: error.message || error } })
                      },
                      finish_reason: "stop"
                    }
                  ]
                }) +
                "\n\n"
            );
            pass.end("data: [DONE]\n\n");
          }
        })();

        return new Response(pass, {
          type: "text/event-stream",
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      // 非流式
      const videoUrls = await generateVideo(model, prompt, {
        firstFrameImage,
        endFrameImage,
        videoAspectRatio: aspect_ratio,
        duration,
        fps,
      }, token);

      let data = [];
      if (responseFormat === "b64_json") {
        data = (
          await Promise.all(videoUrls.map((url) => util.fetchFileBASE64(url)))
        ).map((b64) => ({ b64_json: b64 }));
      } else {
        data = videoUrls.map((url) => ({ url }));
      }

      return {
        created: util.unixTimestamp(),
        data,
      };
    },
  },
};
