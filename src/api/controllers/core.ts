import { PassThrough } from "stream";
import path from "path";
import _ from "lodash";
import mime from "mime";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import { createParser } from "eventsource-parser";
import { AuthContext } from "./chat.ts";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";

// 模型名称
const MODEL_NAME = "jimeng";
// 默认的AgentID
const DEFAULT_ASSISTANT_ID = "513695";
// 版本号
const VERSION_CODE = "5.8.0";
// 平台代码
const PLATFORM_CODE = "7";
// 设备ID
const DEVICE_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// WebID
const WEB_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// 用户ID
const USER_ID = util.uuid(false);
// 最大重试次数
const MAX_RETRY_COUNT = 3;
// 重试延迟
const RETRY_DELAY = 5000;
// 伪装headers
const FAKE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-language": "zh-CN,zh;q=0.9",
  "Cache-control": "no-cache",
  "Last-event-id": "undefined",
  Appid: DEFAULT_ASSISTANT_ID,
  Appvr: VERSION_CODE,
  Origin: "https://dreamina.capcut.com",
  Pragma: "no-cache",
  Priority: "u=1, i",
  Referer: "https://dreamina.capcut.com/",
  Pf: PLATFORM_CODE,
  "Sec-Ch-Ua":
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  // "Sec-Fetch-Site": "same-origin", 
  "Sec-Fetch-Site": "same-site", 
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
};
// 文件最大大小
const FILE_MAX_SIZE = 100 * 1024 * 1024;

/**
 * 获取缓存中的access_token
 *
 * 目前jimeng的access_token是固定的，暂无刷新功能
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function acquireToken(refreshToken: string): Promise<string> {
  return refreshToken;
}

/**
 * 生成cookie
 */
export function generateCookie(refreshToken: string) {
  return [
    `_tea_web_id=${WEB_ID}`,
    `is_staff_user=false`,
    `sid_guard=${refreshToken}%7C${util.unixTimestamp()}%7C5184000%7CMon%2C+03-Feb-2025+08%3A17%3A09+GMT`,
    `uid_tt=${USER_ID}`,
    `uid_tt_ss=${USER_ID}`,
    `sid_tt=${refreshToken}`,
    `sessionid=${refreshToken}`,
    `sessionid_ss=${refreshToken}`,
    `store-idc=alisg`, 
    `store-country-code=us`, 
    `store-country-code-src=uid`
  ].join("; ");
}

/**
 * 获取积分信息
 *
 * @param auth 认证上下文
 */
export async function getCredit(auth: AuthContext) {
  const data = await request("POST", "/commerce/v1/benefits/user_credit_history", auth, {
    data: {
      "count": 20,
      "cursor": "0"
    },
    headers: {
      Referer: "https://dreamina.capcut.com/",
    }
  });

  logger.info("收到 user_credit_history 接口的响应:", data);

  // 根据新的API响应格式调整检查逻辑
  if (!data || !_.isFinite(data.total_credit)) {
    logger.error("获取积分信息失败，上游API返回数据中缺少 `total_credit` 字段。", data);
    throw new APIException(EX.API_REQUEST_FAILED, "获取积分信息失败: 无效的响应格式");
  }

  const totalCredit = data.total_credit;

  logger.info(`\n积分信息: \n总积分: ${totalCredit}`);
  return {
    // 由于新接口不返回分类积分，这里返回0以保持兼容
    giftCredit: 0,
    purchaseCredit: 0,
    vipCredit: 0,
    totalCredit: totalCredit
  }
}

/**
 * 接收今日积分
 *
 * @param auth 认证上下文
 */
export async function receiveCredit(auth: AuthContext) {
  logger.info("正在收取今日积分...")
  const { cur_total_credits, receive_quota  } = await request("POST", "/commerce/v1/benefits/credit_receive", auth, {
    data: {
      time_zone: "Asia/Shanghai"
    },
    headers: {
      Referer: "https://dreamina.capcut.com/ai-tool/image/generate"
    }
  });
  logger.info(`\n今日${receive_quota}积分收取成功\n剩余积分: ${cur_total_credits}`);
  return cur_total_credits;
}

/**
 * 请求jimeng
 *
 * @param method 请求方法
 * @param uri 请求路径
 * @param params 请求参数
 * @param headers 请求头
 */
export async function request(
  method: string,
  uri: string,
  auth: AuthContext,
  options: AxiosRequestConfig = {}
) {
  const url = uri.startsWith("https://") ? uri : `https://jimeng.jianying.com${uri}`;

  logger.info(
    "request function: | uri:", url,
    " | sign:", auth.sign,
    " | deviceTime:", auth.device_time
    )

  const response = await axios.request({
    method,
    url: url,
    params: {
      aid: DEFAULT_ASSISTANT_ID,
      device_platform: "web",
      region: "cn",
      web_id: WEB_ID,
      ...(options.params || {}),
    },
    headers: {
      ...FAKE_HEADERS,
      Cookie: auth.cookie,
      "Device-Time": auth.device_time,
      Sign: auth.sign,
      "Sign-Ver": "1",
      ...(options.headers || {}),
    },
    timeout: 15000,
    validateStatus: () => true,
    ..._.omit(options, "params", "headers"),
  });
  // logger.info("request response:", response.data)
  // 流式响应直接返回response
  if (options.responseType == "stream") return response;
  return checkResult(response);
}

/**
 * 预检查文件URL有效性
 *
 * @param fileUrl 文件URL
 */
export async function checkFileUrl(fileUrl: string) {
  if (util.isBASE64Data(fileUrl)) return;
  const result = await axios.head(fileUrl, {
    timeout: 15000,
    validateStatus: () => true,
  });
  if (result.status >= 400)
    throw new APIException(
      EX.API_FILE_URL_INVALID,
      `File ${fileUrl} is not valid: [${result.status}] ${result.statusText}`
    );
  // 检查文件大小
  if (result.headers && result.headers["content-length"]) {
    const fileSize = parseInt(result.headers["content-length"], 10);
    if (fileSize > FILE_MAX_SIZE)
      throw new APIException(
        EX.API_FILE_EXECEEDS_SIZE,
        `File ${fileUrl} is not valid`
      );
  }
}

/**
 * 上传文件
 *
 * @param fileUrl 文件URL
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param isVideoImage 是否是用于视频图像
 */
export async function uploadFile(
  fileUrl: string,
  refreshToken: string,
  isVideoImage: boolean = false
) {
  // 预检查远程文件URL可用性
  await checkFileUrl(fileUrl);

  let filename, fileData, mimeType;
  // 如果是BASE64数据则直接转换为Buffer
  if (util.isBASE64Data(fileUrl)) {
    mimeType = util.extractBASE64DataFormat(fileUrl);
    const ext = mime.getExtension(mimeType);
    filename = `${util.uuid()}.${ext}`;
    fileData = Buffer.from(util.removeBASE64DataHeader(fileUrl), "base64");
  }
  // 下载文件到内存，如果您的服务器内存很小，建议考虑改造为流直传到下一个接口上，避免停留占用内存
  else {
    filename = path.basename(fileUrl);
    ({ data: fileData } = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      // 100M限制
      maxContentLength: FILE_MAX_SIZE,
      // 60秒超时
      timeout: 60000,
    }));
  }

  // 获取文件的MIME类型
  mimeType = mimeType || mime.getType(filename);

  // 待开发
}

/**
 * 检查请求结果
 *
 * @param result 结果
 */
export function checkResult(result: AxiosResponse) {
  const { ret, errmsg, data } = result.data;
  if (!_.isFinite(Number(ret))) return result.data;
  if (ret === '0') {
    // 健壮性修复：如果响应成功但没有data字段，则返回整个响应体
    return data !== undefined ? data : result.data;
  }
  if (ret === '5000')
    throw new APIException(EX.API_IMAGE_GENERATION_INSUFFICIENT_POINTS, `[无法生成图像]: 即梦积分可能不足，${errmsg}`);
  throw new APIException(EX.API_REQUEST_FAILED, `[请求jimeng失败]: ${errmsg}`);
}

/**
 * Token切分
 *
 * @param authorization 认证字符串
 */
export function tokenSplit(authorization: string) {

  return authorization.replace("Bearer ", "").split(",");
}

/**
 * 获取Token存活状态
 */
export async function getTokenLiveStatus(auth: AuthContext) {
  const result = await request(
    "POST",
    "/passport/account/info/v2",
    auth,
    {
      params: {
        account_sdk_source: "web",
      },
    }
  );
  try {
    logger.info("getTokenLiveStatus:", result)
    const { user_id } = checkResult(result);
    return !!user_id;
  } catch (err) {
    return false;
  }
}
