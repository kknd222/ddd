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
        aspect_ratio,
        duration,
        fps,
        stream,
        response_format,
      } = request.body;

      const responseFormat = _.defaultTo(response_format, "url");

      // 解析 first_frame_image 字段：支持字符串 / { type: 'image_url', image_url: { url } } / 对象
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

      const firstFrameImage = extractImage(first_frame_image);

      logger.info("视频生成请求:", {
        model,
        prompt,
        hasFirstFrame: !!firstFrameImage,
        aspectRatio: aspect_ratio,
        duration,
        fps,
        responseFormat,
      });

      // 流式：先生成成功，再建立 SSE；失败将抛异常由全局返回500
      if (stream) {
        const videoUrls = await generateVideo(model, prompt, {
          firstFrameImage,
          videoAspectRatio: aspect_ratio,
          duration,
          fps,
        }, token);

        const pass = new PassThrough();

        let data = [] as any[];
        if (responseFormat === "b64_json") {
          data = (
            await Promise.all(videoUrls.map((url) => util.fetchFileBASE64(url)))
          ).map((b64) => ({ b64_json: b64 }));
        } else {
          data = videoUrls.map((url) => ({ url }));
        }

        pass.write(
          "data: " +
            JSON.stringify({ created: util.unixTimestamp(), data }) +
            "\n\n"
        );
        pass.end("data: [DONE]\n\n");
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
