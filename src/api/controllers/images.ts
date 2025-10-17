import _ from "lodash";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request, ensureMsToken, generateCookie, uploadFile, getMsToken, getRegionConfig } from "./core.ts";
import logger from "@/lib/logger.ts";

const DEFAULT_ASSISTANT_ID = "513641";
const CN_ASSISTANT_ID = "513695";
export const DEFAULT_MODEL = "jimeng-3.1";
// 草稿最小版本（纯文生图）
const DRAFT_VERSION = "3.0.2";
// 混合/参考图最小版本（根据抓包对齐）
const BLEND_MIN_VERSION = "3.2.5";
// 数据层版本（示例展示为 3.2.8）
const DA_VERSION = "3.2.8";
// Web 版本（示例展示为 6.6.0）
const WEB_VERSION = "6.6.0";
const MODEL_MAP = {
  // 与示例保持一致（去掉 _fangzhou 后缀）
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.1": "high_aes_general_v30l_art:general_v3.0_18b",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
  "jimeng-2.1": "high_aes_general_v21_L:general_v2.1_L",
  "jimeng-2.0-pro": "high_aes_general_v20_L:general_v2.0_L",
  "jimeng-2.0": "high_aes_general_v20:general_v2.0",
  // 对齐为 high_aes_v14_dreamina:general_v1.4
  "jimeng-1.4": "high_aes_v14_dreamina:general_v1.4",
  "jimeng-xl-pro": "text2img_xl_sft",
};

export function getModel(model: string) {
  return MODEL_MAP[model] || MODEL_MAP[DEFAULT_MODEL];
}

function getRegionAwareModel(model: string, isCN: boolean) {
  if (!isCN) return getModel(model);
  // CN 侧不支持 3.1 的 art 分支，回退到 3.0
  if (model === "jimeng-3.1") return MODEL_MAP["jimeng-3.0"];
  // CN 侧 1.4 使用 general_v14
  if (model === "jimeng-1.4") return "high_aes_general_v14:general_v1.4";
  return getModel(model);
}

export async function generateImages(
  _model: string,
  prompt: string,
  {
    width = 2048,
    height = 2048,
    sampleStrength = 0.5,
    negativePrompt = "",
    image,
  }: {
    width?: number;
    height?: number;
    sampleStrength?: number;
    negativePrompt?: string;
    image?: string; // URL or data URL (base64)
  },
  refreshToken: string
) {
  // 分辨率类型（与示例靠拢，可为空）
  const resolutionType = ((): string | undefined => {
    if (width === 1024 && height === 1024) return "1k";
    if (width === 2048 && height === 2048) return "2k";
    if (width === 4096 && height === 4096) return "4k";
    return undefined;
  })();

  // 每次生成图片前先请求 user_info 以获取新的 msToken
  await ensureMsToken(refreshToken);
  const regionCfg = getRegionConfig(refreshToken);
  const isCN = (regionCfg?.countryCode || "").toUpperCase() === "CN";
  const model = getRegionAwareModel(_model, isCN);
  logger.info(`使用模型: ${_model} 映射模型: ${model} ${width}x${height} 分辨率: ${resolutionType} 精细度: ${sampleStrength}`);
  logger.info('-------------> modified_1 <----------')

  // 图片输入支持：国际区仅 jimeng-3.0；CN 区支持 jimeng-3.0 与 jimeng-4.0
  const allowImage = _model === "jimeng-3.0" || _model === "jimeng-4.0";
  if (image && !allowImage) {
    throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "该模型不支持图片，请使用 jimeng-3.0 或 jimeng-4.0");
  }

  const { totalCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0)
    await receiveCredit(refreshToken);

  const componentId = util.uuid();
  const country = (regionCfg?.countryCode || "US").toUpperCase();

  // CN 区域
  if (isCN) {

    // CN 参数与版本
    const CN_DA_VERSION = "3.2.9";
    const cnWidth = width === 1024 && height === 1024 ? 2048 : width;
    const cnHeight = width === 1024 && height === 1024 ? 2048 : height;
    const cnResolutionType = cnWidth === 2048 && cnHeight === 2048 ? "2k" : undefined;
    const cnModel = "high_aes_general_v40";

    // 如携带图片，先上传，支持 CN 区域 blend
    let uploadedImageCN: { storeUri: string; width?: number; height?: number; mimeType?: string } | null = null;
    if (image) {
      try {
        uploadedImageCN = await uploadFile(image, refreshToken, false, country);
        logger.info("[CN] 参考图已上传:", uploadedImageCN.storeUri);
      } catch (e) {
        logger.warn("[CN] 参考图上传失败，忽略图片输入: ", e?.message || e);
      }
    }

    // 组件与核心参数（根据是否有参考图选择 generate 或 blend）
    const baseCoreParamCN: any = {
      type: "",
      id: util.uuid(),
      model: cnModel,
      prompt: uploadedImageCN && !/^##/.test(prompt) ? `##${prompt}` : prompt,
      ...(uploadedImageCN ? {} : { negative_prompt: negativePrompt }),
      seed: Math.floor(Math.random() * 100000000) + 2500000000,
      sample_strength: sampleStrength,
      image_ratio: 1,
      large_image_info: {
        type: "",
        id: util.uuid(),
        height: cnHeight,
        width: cnWidth,
        ...(cnResolutionType ? { resolution_type: cnResolutionType } : {}),
      },
      intelligent_ratio: false,
    };

    const imgFormatCN = (() => {
      const mt = uploadedImageCN?.mimeType || "";
      if (/jpeg|jpg/i.test(mt)) return "jpeg";
      if (/png/i.test(mt)) return "png";
      if (/gif/i.test(mt)) return "gif";
      if (/webp/i.test(mt)) return "webp";
      return "jpeg";
    })();

    const componentForGenerateCN = {
      type: "image_base_component",
      id: componentId,
      min_version: DRAFT_VERSION,
      generate_type: "generate",
      aigc_mode: "workbench",
      abilities: {
        type: "",
        id: util.uuid(),
        generate: {
          type: "",
          id: util.uuid(),
          core_param: baseCoreParamCN,
          history_option: { type: "", id: util.uuid() },
        },
      },
    } as any;

    const componentForBlendCN = {
      type: "image_base_component",
      id: componentId,
      min_version: DRAFT_VERSION,
      generate_type: "blend",
      aigc_mode: "workbench",
      abilities: {
        type: "",
        id: util.uuid(),
        blend: {
          type: "",
          id: util.uuid(),
          min_version: BLEND_MIN_VERSION,
          min_features: [],
          core_param: baseCoreParamCN,
          ability_list: [
            {
              type: "",
              id: util.uuid(),
              name: "byte_edit",
              image_uri_list: [uploadedImageCN?.storeUri],
              image_list: [
                {
                  type: "image",
                  id: util.uuid(),
                  source_from: "upload",
                  platform_type: 1,
                  name: "",
                  image_uri: uploadedImageCN?.storeUri,
                  uri: uploadedImageCN?.storeUri,
                  ...(uploadedImageCN?.width && uploadedImageCN?.height
                    ? { width: uploadedImageCN.width, height: uploadedImageCN.height, format: imgFormatCN }
                    : { format: imgFormatCN }),
                },
              ],
              strength: sampleStrength,
            },
          ],
          prompt_placeholder_info_list: [
            { type: "", id: util.uuid(), ability_index: 0 },
          ],
          postedit_param: { type: "", id: util.uuid(), generate_type: 0 },
        },
      },
    } as any;

    const componentListCN = [uploadedImageCN ? componentForBlendCN : componentForGenerateCN];
    const draftMinVersionCN = uploadedImageCN ? BLEND_MIN_VERSION : DRAFT_VERSION;
    logger.info("[CN] generate params:", JSON.stringify({
      region: "cn",
      da_version: CN_DA_VERSION,
      web_component_open_flag: 1,
      web_version: WEB_VERSION,
      model: cnModel,
      size: { w: cnWidth, h: cnHeight, resolution_type: cnResolutionType || null },
    }));
    const submitIdCN = util.uuid();
    const { aigc_data } = await request(
      "post",
      `/mweb/v1/aigc_draft/generate`,
      refreshToken,
      {
        params: {
          region: "cn",
          da_version: CN_DA_VERSION,
          web_component_open_flag: 1,
          web_version: WEB_VERSION,
          aigc_features: "app_lip_sync",
          babi_param: encodeURIComponent(
            JSON.stringify({
              scenario: "image_video_generation",
              feature_key: "aigc_to_image",
              feature_entrance: "to_image",
              feature_entrance_detail: "to_image-" + cnModel,
            })
          ),
        },
        data: {
          extend: {
            root_model: cnModel,
            template_id: "",
          },
          submit_id: submitIdCN,
          metrics_extra: JSON.stringify({
            promptSource: "custom",
            generateCount: 1,
            enterFrom: "click",
            generateId: submitIdCN,
            isRegenerate: !!uploadedImageCN,
          }),
          draft_content: JSON.stringify({
            type: "draft",
            id: util.uuid(),
            min_version: draftMinVersionCN,
            is_from_tsn: true,
            version: CN_DA_VERSION,
            main_component_id: componentId,
            component_list: componentListCN,
          }),
          http_common_info: {
            aid: Number(CN_ASSISTANT_ID),
          },
        },
      }
    );
    const historyId = aigc_data.history_record_id;
    if (!historyId)
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");
    let status = 20, failCode, item_list: any[] = [];
    let guardCount = 0;
    while (true) {
      // 自适应轮询间隔（CN 返回里可能包含建议的间隔配置）
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await request("post", `/mweb/v1/get_history_by_ids`, refreshToken, {
        params: {
          region: "cn",
          da_version: CN_DA_VERSION,
          web_version: WEB_VERSION,
          aigc_features: "app_lip_sync",
        },
        data: {
          // CN 使用 submit_ids 查询
          submit_ids: [submitIdCN],
        },
      });
      const entry = result?.[submitIdCN] || {};
      const pollInfo = entry?.queue_info?.polling_config;
      logger.info("[CN] history poll:", JSON.stringify({
        keys: Object.keys(result || {}),
        entryStatus: entry?.status ?? entry?.task?.status,
        itemCount: (entry?.item_list || entry?.task?.item_list || []).length,
        interval: pollInfo?.interval_seconds,
      }));
      if (!entry || Object.keys(entry).length === 0)
        throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");
      status = entry.status ?? entry.task?.status ?? status;
      failCode = entry.fail_code ?? entry.task?.fail_code;
      item_list = entry.item_list ?? entry.task?.item_list ?? [];
      const totalCount = entry.total_image_count ?? 1;
      const finishedCount = entry.finished_image_count ?? 0;
      // 状态含义：50完成、30失败、45处理中；根据实际图片数量判断是否完成
      // 当 status=50 或 (status=45 且所有图片已生成) 时认为完成
      if (status === 50 || (item_list.length > 0 && finishedCount >= totalCount)) break;
      if (status === 30) {
        if (failCode === '2038') throw new APIException(EX.API_CONTENT_FILTERED);
        throw new APIException(EX.API_IMAGE_GENERATION_FAILED);
      }
      // 动态调整下一次轮询间隔
      const nextInterval = Number(pollInfo?.interval_seconds);
      if (nextInterval && nextInterval > 1 && nextInterval < 120) {
        await new Promise((resolve) => setTimeout(resolve, nextInterval * 1000));
      }
      if (++guardCount > 120) {
        throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "轮询超时");
      }
    }
    return item_list.map((item) => {
      if(!item?.image?.large_images?.[0]?.image_url)
        return item?.common_attr?.cover_url || null;
      return item.image.large_images[0].image_url;
    });
  }

  const submitId = util.uuid();
  const generateId = submitId;

  // 如有图片，先上传，便于后续在服务端调试使用（具体引用字段待对齐）
  let uploadedImage: { storeUri: string; width?: number; height?: number; mimeType?: string } | null = null;
  if (image && allowImage) {
    try {
      // 允许 base64 或 URL
      uploadedImage = await uploadFile(image, refreshToken, false, country);
      logger.info("参考图已上传:", uploadedImage.storeUri);
    } catch (e) {
      logger.warn("参考图上传失败，忽略图片输入: ", e?.message || e);
    }
  }

  // 组装 component_list：根据是否有参考图分 generate/blend 两种
  // US 区域 1k 方图需使用 1328x1328
  const adjustDimsForRegion = (w: number, h: number): { width: number; height: number } => {
    if (country === "US" && resolutionType === "1k" && w === h) return { width: 1328, height: 1328 };
    return { width: w, height: h };
  };
  const { width: adjWidth, height: adjHeight } = adjustDimsForRegion(width, height);

  const baseCoreParam = {
    type: "",
    id: util.uuid(),
    model,
    prompt: uploadedImage && !/^##/.test(prompt) ? `##${prompt}` : prompt,
    // 仅文生图携带负向词，blend 不强制
    ...(uploadedImage ? {} : { negative_prompt: negativePrompt }),
    seed: Math.floor(Math.random() * 100000000) + 2500000000,
    sample_strength: sampleStrength,
    image_ratio: 1,
    large_image_info: {
      type: "",
      id: util.uuid(),
      height: adjHeight,
      width: adjWidth,
      ...(resolutionType ? { resolution_type: resolutionType } : {}),
    },
  } as any;

  const componentForGenerate = {
    type: "image_base_component",
    id: componentId,
    min_version: DRAFT_VERSION,
    aigc_mode: "workbench",
    metadata: {
      type: "",
      id: util.uuid(),
      created_platform: 3,
      created_platform_version: "",
      created_time_in_ms: String(Date.now()),
      created_did: "",
    },
    generate_type: "generate",
    abilities: {
      type: "",
      id: util.uuid(),
      generate: {
        type: "",
        id: util.uuid(),
        core_param: baseCoreParam,
      },
    },
  };

  const imgFormat = (() => {
    const mt = uploadedImage?.mimeType || "";
    if (/jpeg|jpg/i.test(mt)) return "jpeg";
    if (/png/i.test(mt)) return "png";
    if (/gif/i.test(mt)) return "gif";
    if (/webp/i.test(mt)) return "webp";
    return "jpeg"; // 默认按示例给 jpeg
  })();

  const componentForBlend = {
    type: "image_base_component",
    id: componentId,
    min_version: DRAFT_VERSION,
    aigc_mode: "workbench",
    metadata: {
      type: "",
      id: util.uuid(),
      created_platform: 3,
      created_platform_version: "",
      created_time_in_ms: String(Date.now()),
      created_did: "",
    },
    generate_type: "blend",
    abilities: {
      type: "",
      id: util.uuid(),
      blend: {
        type: "",
        id: util.uuid(),
        min_version: BLEND_MIN_VERSION,
        min_features: [],
        core_param: baseCoreParam,
        ability_list: [
          {
            type: "",
            id: util.uuid(),
            name: "byte_edit",
            image_uri_list: [uploadedImage?.storeUri],
            image_list: [
              {
                type: "image",
                id: util.uuid(),
                source_from: "upload",
                platform_type: 1,
                name: "",
                image_uri: uploadedImage?.storeUri,
                uri: uploadedImage?.storeUri,
                // 尽可能补齐宽高与格式
                ...(uploadedImage?.width && uploadedImage?.height
                  ? { width: uploadedImage.width, height: uploadedImage.height, format: imgFormat }
                  : { format: imgFormat }),
              },
            ],
            strength: sampleStrength,
          },
        ],
        prompt_placeholder_info_list: [
          { type: "", id: util.uuid(), ability_index: 0 },
        ],
        postedit_param: { type: "", id: util.uuid(), generate_type: 0 },
      },
    },
  } as any;

  const component_list = [uploadedImage ? componentForBlend : componentForGenerate];
  const draftMinVersion = uploadedImage ? BLEND_MIN_VERSION : DRAFT_VERSION;

  // 根据地区切换域名（US 使用 dreamina-api.us.capcut.com，需要 msToken 作为 query）
  const apiHost = regionCfg?.mwebHost || "https://mweb-api-sg.capcut.com";
  const webComponentOpenFlag = uploadedImage ? 1 : 0;
  const { aigc_data } = await request(
    "post",
    `${apiHost}/mweb/v1/aigc_draft/generate`,
    refreshToken,
    {
      params: {
        region: country,
        da_version: DA_VERSION,
        web_component_open_flag: webComponentOpenFlag,
        web_version: WEB_VERSION,
        aigc_features: "app_lip_sync",
        ...(country === "US" && getMsToken(refreshToken) ? { msToken: getMsToken(refreshToken)! } : {}),
      },
      data: {
        extend: {
          root_model: model,
        },
        submit_id: submitId,
        metrics_extra: JSON.stringify(
          uploadedImage
            ? {
                promptSource: "custom",
                generateCount: 1,
                generateId,
                templateId: "0",
                enterFrom: "click",
                isRegenerate: true,
              }
            : {
                promptSource: "custom",
                generateCount: 1,
                enterFrom: "click",
                generateId,
                isRegenerate: false,
              }
        ),
        draft_content: JSON.stringify({
          type: "draft",
          id: util.uuid(),
          min_version: draftMinVersion,
          min_features: [],
          is_from_tsn: true,
          version: DA_VERSION,
          main_component_id: componentId,
          component_list,
        }),
        http_common_info: {
          aid: Number(DEFAULT_ASSISTANT_ID),
        },
      },
    }
  );
  const historyId = aigc_data.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");
  let status = 20, failCode, item_list = [];
  // 选择历史查询主机与查询键（US 使用 submit_id，其他使用 history_id）
  const historyApiHost = regionCfg?.mwebHost || "https://mweb-api-sg.capcut.com";
  const pollKey = country === "US" ? submitId : historyId;
  let guardCount = 0;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await request("post", `${historyApiHost}/mweb/v1/get_history_by_ids`, refreshToken, {
      params: {
        region: country,
        da_version: DA_VERSION,
        web_version: WEB_VERSION,
        aigc_features: "app_lip_sync",
      },
      data: country === "US" ? { submit_ids: [submitId] } : {
        history_ids: [historyId],
        image_info: {
          width: 2048,
          height: 2048,
          format: "webp",
          image_scene_list: [
            { scene: "smart_crop", width: 360,  height: 360,  uniq_key: "smart_crop-w:360-h:360", format: "webp" },
            { scene: "smart_crop", width: 480,  height: 480,  uniq_key: "smart_crop-w:480-h:480", format: "webp" },
            { scene: "smart_crop", width: 720,  height: 720,  uniq_key: "smart_crop-w:720-h:720", format: "webp" },
            { scene: "smart_crop", width: 720,  height: 480,  uniq_key: "smart_crop-w:720-h:480", format: "webp" },
            { scene: "smart_crop", width: 360,  height: 240,  uniq_key: "smart_crop-w:360-h:240", format: "webp" },
            { scene: "smart_crop", width: 240,  height: 320,  uniq_key: "smart_crop-w:240-h:320", format: "webp" },
            { scene: "smart_crop", width: 480,  height: 640,  uniq_key: "smart_crop-w:480-h:640", format: "webp" },
            { scene: "normal",     width: 2400, height: 2400, uniq_key: "2400",                      format: "webp" },
            { scene: "normal",     width: 1080, height: 1080, uniq_key: "1080",                      format: "webp" },
            { scene: "normal",     width: 720,  height: 720,  uniq_key: "720",                       format: "webp" },
            { scene: "normal",     width: 480,  height: 480,  uniq_key: "480",                       format: "webp" },
            { scene: "normal",     width: 360,  height: 360,  uniq_key: "360",                       format: "webp" },
          ],
        },
        http_common_info: { aid: Number(DEFAULT_ASSISTANT_ID) },
      },
    });
    if (!result[pollKey])
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");
    const entry = result[pollKey];
    const pollInfo = entry?.queue_info?.polling_config;
    logger.info(`[国际区] history poll: status=${entry.status}, itemCount=${(entry.item_list || []).length}, totalCount=${entry.total_image_count ?? 1}, finishedCount=${entry.finished_image_count ?? 0}`);

    status = entry.status;
    failCode = entry.fail_code;
    item_list = entry.item_list || [];
    const totalCount = entry.total_image_count ?? 1;
    const finishedCount = entry.finished_image_count ?? 0;

    // 状态含义：50完成、30失败、45/20等处理中；根据实际图片数量判断是否完成
    // 当 status=50 或 (所有图片已生成) 时认为完成
    if (status === 50 || (item_list.length > 0 && finishedCount >= totalCount)) break;
    if (status === 30) {
      if (failCode === '2038') throw new APIException(EX.API_CONTENT_FILTERED);
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED);
    }

    // 动态调整下一次轮询间隔
    const nextInterval = Number(pollInfo?.interval_seconds);
    if (nextInterval && nextInterval > 1 && nextInterval < 120) {
      await new Promise((resolve) => setTimeout(resolve, nextInterval * 1000));
    }

    if (++guardCount > 120) {
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "轮询超时");
    }
  }
  return item_list.map((item) => {
    if(!item?.image?.large_images?.[0]?.image_url)
      return item?.common_attr?.cover_url || null;
    return item.image.large_images[0].image_url;
  });
}

export default {
  generateImages,
};
