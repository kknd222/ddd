import _ from "lodash";

import Request from "@/lib/request/Request.ts";
import { generateImages } from "@/api/controllers/images.ts";
import { tokenSplit } from "@/api/controllers/core.ts";
import util from "@/lib/util.ts";
import logger from "@/lib/logger.ts";

export default {
  prefix: "/v1/images",

  post: {
    "/generations": async (request: Request) => {
      request
        .validate("body.model", v => _.isUndefined(v) || _.isString(v))
        .validate("body.prompt", _.isString)
        .validate("body.negative_prompt", v => _.isUndefined(v) || _.isString(v))
        .validate("body.width", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.height", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.sample_strength", v => _.isUndefined(v) || _.isFinite(v))
        // 兼容 OpenAI 风格的 image 输入（字符串 / 对象 / 数组）
        .validate("body.image", v => _.isUndefined(v) || _.isString(v) || _.isObject(v) || _.isArray(v))
        .validate("body.response_format", v => _.isUndefined(v) || _.isString(v))
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
        negative_prompt: negativePrompt,
        width,
        height,
        sample_strength: sampleStrength,
        response_format,
      } = request.body;
      const responseFormat = _.defaultTo(response_format, "url");
      // 解析 image 字段：支持字符串 / { type: 'image_url', image_url: { url } } / 数组
      const extractImage = (input: any): string | undefined => {
        if (!input) return undefined;
        if (_.isString(input)) return input;
        if (_.isArray(input)) return extractImage(input[0]);
        if (_.isObject(input)) {
          if (
            input.type === "image_url" &&
            input.image_url &&
            _.isString(input.image_url.url)
          )
            return input.image_url.url;
          if (_.isString((input as any).url)) return (input as any).url;
        }
        return undefined;
      };
      const imageInput = extractImage(request.body.image);
      logger.info("responseFormat:", responseFormat);
      const imageUrls = await generateImages(model, prompt, {
        width,
        height,
        sampleStrength,
        negativePrompt,
        image: imageInput,
      }, token);
      let data = [];
      if (responseFormat == "b64_json") {
        data = (
          await Promise.all(imageUrls.map((url) => util.fetchFileBASE64(url)))
        ).map((b64) => ({ b64_json: b64 }));
      } else {
        data = imageUrls.map((url) => ({
          url,
        }));
      }
      return {
        created: util.unixTimestamp(),
        data,
      };
    },
  },
};
