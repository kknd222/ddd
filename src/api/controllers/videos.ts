import _ from "lodash";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request, ensureMsToken, uploadFile, getMsToken, getRegionConfig } from "./core.ts";
import logger from "@/lib/logger.ts";
import { VIDEO_MODEL_MAP } from "@/api/routes/models.ts";

const DEFAULT_ASSISTANT_ID = "513641";
const CN_ASSISTANT_ID = "513695";
export const DEFAULT_VIDEO_MODEL = "jimeng-video-3.0";
// 草稿最小版本
const DRAFT_VERSION = "3.0.5";
// 数据层版本
const DA_VERSION = "3.3.2";
// Web 版本
const WEB_VERSION = "7.5.0";

// 支持的宽高比
const VALID_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
// 支持的时长（秒）
const VALID_DURATIONS = [5, 10];

export function getVideoModel(model: string) {
  return VIDEO_MODEL_MAP[model] || VIDEO_MODEL_MAP[DEFAULT_VIDEO_MODEL];
}

/**
 * 解析提示词中的参数
 * 支持格式: "提示词 -ar 16:9 -d 5"
 * @param prompt 原始提示词
 * @returns 解析后的提示词和参数
 */
export function parsePromptParams(prompt: string): {
  cleanPrompt: string;
  aspectRatio: string;
  duration: number;
} {
  let cleanPrompt = prompt;
  let aspectRatio = "16:9"; // 默认宽高比
  let duration = 5; // 默认时长（秒）

  // 解析 -ar 参数
  const arMatch = prompt.match(/-ar\s+([\d:]+)/i);
  if (arMatch) {
    const ar = arMatch[1];
    if (VALID_ASPECT_RATIOS.includes(ar)) {
      aspectRatio = ar;
    } else {
      logger.warn(`无效的宽高比参数: ${ar}, 使用默认值: ${aspectRatio}`);
    }
    cleanPrompt = cleanPrompt.replace(/-ar\s+[\d:]+/gi, "");
  }

  // 解析 -d 参数
  const dMatch = prompt.match(/-d\s+(\d+)/i);
  if (dMatch) {
    const d = parseInt(dMatch[1]);
    if (VALID_DURATIONS.includes(d)) {
      duration = d;
    } else {
      logger.warn(`无效的时长参数: ${d}, 使用默认值: ${duration}`);
    }
    cleanPrompt = cleanPrompt.replace(/-d\s+\d+/gi, "");
  }

  // 清理多余空格
  cleanPrompt = cleanPrompt.trim().replace(/\s+/g, " ");

  logger.info(`参数解析: 原始="${prompt}" -> 清理后="${cleanPrompt}", 宽高比=${aspectRatio}, 时长=${duration}s`);

  return { cleanPrompt, aspectRatio, duration };
}

/**
 * 生成视频
 * @param _model 模型名称
 * @param prompt 提示词（支持 -ar 和 -d 参数）
 * @param options 视频生成选项
 * @param refreshToken 刷新令牌
 */
export async function generateVideo(
  _model: string,
  prompt: string,
  {
    firstFrameImage,
    videoAspectRatio,
    fps = 24,
    duration,
    videoMode = 2,
  }: {
    firstFrameImage?: string; // URL or data URL (base64)
    videoAspectRatio?: string; // 21:9, 16:9, 4:3, 1:1, 3:4, 9:16
    fps?: number; // 24
    duration?: number; // 5 or 10 seconds
    videoMode?: number; // 2 for first_frame mode
  },
  refreshToken: string
) {
  // 解析提示词中的参数
  const parsed = parsePromptParams(prompt);
  const cleanPrompt = parsed.cleanPrompt;
  const finalAspectRatio = videoAspectRatio || parsed.aspectRatio;
  const finalDuration = duration || parsed.duration;
  const durationMs = finalDuration * 1000;

  // 验证参数
  if (!VALID_ASPECT_RATIOS.includes(finalAspectRatio)) {
    throw new APIException(
      EX.API_REQUEST_PARAMS_INVALID,
      `无效的宽高比: ${finalAspectRatio}, 支持的值: ${VALID_ASPECT_RATIOS.join(", ")}`
    ).setHTTPStatusCode(400);
  }

  if (!VALID_DURATIONS.includes(finalDuration)) {
    throw new APIException(
      EX.API_REQUEST_PARAMS_INVALID,
      `无效的时长: ${finalDuration}, 支持的值: ${VALID_DURATIONS.join(", ")}`
    ).setHTTPStatusCode(400);
  }

  // 每次生成视频前先请求 user_info 以获取新的 msToken
  await ensureMsToken(refreshToken);
  const regionCfg = getRegionConfig(refreshToken);
  const isCN = (regionCfg?.countryCode || "").toUpperCase() === "CN";
  const model = getVideoModel(_model);

  logger.info(
    `使用视频模型: ${_model} 映射模型: ${model} 宽高比: ${finalAspectRatio} FPS: ${fps} 时长: ${finalDuration}s`
  );

  // 检查是否需要首帧图片
  if (!firstFrameImage) {
    throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "视频生成需要提供首帧图片").setHTTPStatusCode(400);
  }

  const { totalCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0) {
    await receiveCredit(refreshToken);
  }

  const componentId = util.uuid();
  const country = (regionCfg?.countryCode || "US").toUpperCase();

  // 上传首帧图片
  let uploadedImage: { storeUri: string; width?: number; height?: number; mimeType?: string };
  try {
    uploadedImage = await uploadFile(firstFrameImage, refreshToken, false, country);
    logger.info(`首帧图片已上传: ${uploadedImage.storeUri}, 尺寸: ${uploadedImage.width}x${uploadedImage.height}`);
  } catch (e) {
    throw new APIException(
      EX.API_REQUEST_PARAMS_INVALID,
      "首帧图片上传失败: " + (e?.message || e)
    ).setHTTPStatusCode(400);
  }

  const submitId = util.uuid();
  const seed = Math.floor(Math.random() * 100000000) + 1000000000;

  // 确定图片格式
  const imageFormat = (() => {
    const mt = uploadedImage.mimeType || "";
    if (/png/i.test(mt)) return "png";
    if (/jpeg|jpg/i.test(mt)) return "jpeg";
    if (/webp/i.test(mt)) return "webp";
    return "png";
  })();

  // 构建视频生成组件
  const component = {
    type: "video_base_component",
    id: componentId,
    min_version: "1.0.0",
    aigc_mode: "workbench",
    metadata: {
      type: "",
      id: util.uuid(),
      created_platform: 3,
      created_platform_version: "",
      created_time_in_ms: String(Date.now()),
      created_did: "",
    },
    generate_type: "gen_video",
    abilities: {
      type: "",
      id: util.uuid(),
      gen_video: {
        type: "",
        id: util.uuid(),
        text_to_video_params: {
          type: "",
          id: util.uuid(),
          video_gen_inputs: [
            {
              type: "",
              id: util.uuid(),
              min_version: DRAFT_VERSION,
              prompt: cleanPrompt,
              first_frame_image: {
                type: "image",
                id: util.uuid(),
                source_from: "upload",
                platform_type: 1,
                name: "",
                image_uri: uploadedImage.storeUri,
                width: uploadedImage.width || 1024,
                height: uploadedImage.height || 1536,
                format: imageFormat,
                uri: uploadedImage.storeUri,
              },
              video_mode: videoMode,
              fps: fps,
              duration_ms: durationMs,
              idip_meta_list: [],
            },
          ],
          video_aspect_ratio: finalAspectRatio,
          seed: seed,
          model_req_key: model,
          priority: 0,
        },
        video_task_extra: JSON.stringify({
          promptSource: "custom",
          isDefaultSeed: 1,
          originSubmitId: submitId,
          isRegenerate: false,
          enterFrom: "click",
          functionMode: "first_last_frames",
        }),
      },
    },
    process_type: 1,
  };

  // 根据地区切换域名
  const apiHost = regionCfg?.mwebHost || "https://mweb-api-sg.capcut.com";
  const assistantId = isCN ? CN_ASSISTANT_ID : DEFAULT_ASSISTANT_ID;

  logger.info("视频生成请求参数:", JSON.stringify({
    region: country,
    model: model,
    prompt: cleanPrompt,
    aspectRatio: finalAspectRatio,
    fps: fps,
    duration: finalDuration,
    submitId: submitId,
  }));

  const { aigc_data } = await request(
    "post",
    `${apiHost}/mweb/v1/aigc_draft/generate`,
    refreshToken,
    {
      params: {
        region: country,
        da_version: DA_VERSION,
        web_component_open_flag: 1,
        web_version: WEB_VERSION,
        aigc_features: "app_lip_sync",
        ...(country === "US" && getMsToken(refreshToken) ? { msToken: getMsToken(refreshToken)! } : {}),
      },
      data: {
        extend: {
          root_model: model,
          m_video_commerce_info: {
            benefit_type: "basic_video_operation_vgfm_v_three",
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc",
          },
          m_video_commerce_info_list: [
            {
              benefit_type: "basic_video_operation_vgfm_v_three",
              resource_id: "generate_video",
              resource_id_type: "str",
              resource_sub_type: "aigc",
            },
          ],
        },
        submit_id: submitId,
        metrics_extra: JSON.stringify({
          promptSource: "custom",
          isDefaultSeed: 1,
          originSubmitId: submitId,
          isRegenerate: false,
          enterFrom: "click",
          functionMode: "first_last_frames",
        }),
        draft_content: JSON.stringify({
          type: "draft",
          id: util.uuid(),
          min_version: DRAFT_VERSION,
          min_features: [],
          is_from_tsn: true,
          version: DA_VERSION,
          main_component_id: componentId,
          component_list: [component],
        }),
        http_common_info: {
          aid: Number(assistantId),
        },
      },
    }
  );

  const historyId = aigc_data.history_record_id;
  if (!historyId) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");
  }

  let status = 20;
  let failCode;
  let item_list: any[] = [];
  let guardCount = 0;

  // 轮询视频生成状态（视频生成统一使用 submit_ids 查询）
  logger.info(`开始轮询视频生成状态, historyId: ${historyId}, submitId: ${submitId}`);

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // 视频生成较慢，使用2秒间隔

    const result = await request(
      "post",
      `${apiHost}/mweb/v1/get_history_by_ids`,
      refreshToken,
      {
        params: {
          region: country,
          da_version: DA_VERSION,
          web_version: WEB_VERSION,
          aigc_features: "app_lip_sync",
        },
        data: { submit_ids: [submitId] }, // 视频生成统一使用 submit_ids
      }
    );

    if (!result[submitId]) {
      logger.error(`轮询结果中未找到 submitId: ${submitId}, 返回的键: ${Object.keys(result).join(", ")}`);
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");
    }

    const entry = result[submitId];
    const pollInfo = entry?.queue_info?.polling_config;
    status = entry.status ?? entry.task?.status ?? status;
    failCode = entry.fail_code ?? entry.task?.fail_code;
    item_list = entry.item_list ?? entry.task?.item_list ?? [];

    logger.info(
      `视频生成轮询 [${guardCount + 1}]: status=${status}, itemCount=${item_list.length}, ` +
      `totalCount=${entry.total_image_count ?? 1}, finishedCount=${entry.finished_image_count ?? 0}`
    );

    // 状态含义：50完成、30失败、20/45处理中
    if (status === 50 && item_list.length > 0) {
      logger.info("视频生成完成");
      break;
    }

    if (status === 30) {
      if (failCode === "2038") throw new APIException(EX.API_CONTENT_FILTERED);
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `视频生成失败, failCode: ${failCode}`);
    }

    // 动态调整轮询间隔
    const nextInterval = Number(pollInfo?.interval_seconds);
    if (nextInterval && nextInterval > 1 && nextInterval < 120) {
      await new Promise((resolve) => setTimeout(resolve, nextInterval * 1000));
    }

    if (++guardCount > 300) {
      // 视频生成时间较长，最多轮询300次（约10分钟）
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "轮询超时");
    }
  }

  // 提取视频URL
  return item_list.map((item) => {
    const videoUrl = item?.video?.transcoded_video?.origin?.video_url;
    if (!videoUrl) {
      logger.error("视频URL不存在, item结构:", JSON.stringify(item));
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "视频URL不存在");
    }
    logger.info(`视频生成成功: ${videoUrl}`);
    return videoUrl;
  });
}

export default {
  generateVideo,
};
