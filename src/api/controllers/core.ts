import { PassThrough } from "stream";
import path from "path";
import _ from "lodash";
import mime from "mime";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import crypto from "crypto";
import CRC32 from "crc-32";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import { createParser } from "eventsource-parser";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";

// 配置axios代理
if (process.env.PROXY) {
  const proxyUrl = new URL(process.env.PROXY);
  axios.defaults.proxy = {
    host: proxyUrl.hostname,
    port: parseInt(proxyUrl.port),
    auth: proxyUrl.username ? {
      username: proxyUrl.username,
      password: proxyUrl.password
    } : undefined,
    protocol: proxyUrl.protocol
  };
}

// 模型名称
const MODEL_NAME = "jimeng";
// 默认的AgentID（海外）
const DEFAULT_ASSISTANT_ID = "513641"; 
// CN 站点 AgentID
const CN_ASSISTANT_ID = "513695";
// 版本号
const VERSION_CODE = "5.8.0";
// App SDK 版本
const APP_SDK_VERSION = "48.0.0";
// 平台代码
const PLATFORM_CODE = "7";
// 设备ID
const DEVICE_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// WebID
const WEB_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// 用户ID
const USER_ID = util.uuid(false);
// msToken（由 user_info 接口下发的校验 Cookie）
const MS_TOKEN_MAP = new Map<string, string>();
export function getMsToken(refreshToken: string) { return MS_TOKEN_MAP.get(refreshToken) || null; }

type RegionConfig = {
  countryCode: string; // e.g. US, EG
  webIdc?: string;     // e.g. useast5, sg1
  regionKey?: string;  // parsed from web_domain, e.g. us, sg
  mwebHost?: string;   // resolved API host for /mweb/* endpoints
  webDomain?: string;
  commerceDomain?: string;
  frontierDomain?: string;
  ttsDomain?: string;
};
const REGION_CFG_MAP = new Map<string, RegionConfig>();
export function getRegionConfig(refreshToken: string): RegionConfig | null {
  const cfg = REGION_CFG_MAP.get(refreshToken);
  if (cfg) return cfg;
  // Fallback: default to US region when not resolved yet
  return {
    countryCode: 'US',
    webIdc: undefined,
    regionKey: 'us',
    mwebHost: 'https://dreamina-api.us.capcut.com',
    webDomain: undefined,
    commerceDomain: undefined,
    frontierDomain: undefined,
    ttsDomain: undefined,
  };
}
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
  const { token } = parseTokenRegion(refreshToken);
  return token;
}

/**
 * 生成cookie
 */
export function generateCookie(refreshToken: string, region?: string) {
  const { token: baseToken } = parseTokenRegion(refreshToken);
  const regionUpper = (region || "").toUpperCase();
  const cfg = getRegionConfig(refreshToken);
  const msToken = getMsToken(refreshToken);
  const cookieParts = [
    `_tea_web_id=${WEB_ID}`,
    `is_staff_user=false`,
    `sid_guard=${baseToken}%7C${util.unixTimestamp()}%7C5184000%7CMon%2C+03-Feb-2025+08%3A17%3A09+GMT`,
    `uid_tt=${USER_ID}`,
    `uid_tt_ss=${USER_ID}`,
    `sid_tt=${baseToken}`,
    `sessionid=${baseToken}`,
    `sessionid_ss=${baseToken}`,
  ];
  // CN 按 jimeng-free-api：使用 store-region
  if (regionUpper === "CN") {
    cookieParts.push(`store-region=cn-gd`);
    cookieParts.push(`store-region-src=uid`);
  } else {
    const countryCode = regionUpper ? regionUpper.toLowerCase() : "us";
    const idc = cfg?.webIdc || (regionUpper === "US" ? "useast5" : "alisg");
    cookieParts.push(`store-idc=${idc}`);
    cookieParts.push(`store-country-code=${countryCode}`);
    cookieParts.push(`store-country-code-src=uid`);
    // US 目标机房标记（可选）：仅附带 cc-target-idc，tt-target-idc-sign 不再自动获取
    if (regionUpper === "US") cookieParts.push(`cc-target-idc=useast5`);
  }
  if (msToken && regionUpper !== "CN") cookieParts.push(`msToken=${msToken}`);
  return cookieParts.join("; ");
}

/**
 * 预拉取 msToken（每次生成图片前调用）
 *
 * 说明：请求 dreamina.capcut.com 的 user_info 接口，
 * 读取响应头 Set-Cookie 中的 msToken 并缓存，用于后续请求拼接到 Cookie。
 */
export async function ensureMsToken(refreshToken: string) {
  // 区域后缀覆盖（如 token:cn），CN 无 user_info，直接配置区域映射并返回
  const { region: overrideRegion } = parseTokenRegion(refreshToken);
  if (overrideRegion && overrideRegion.toUpperCase() === "CN") {
    const cnCfg: RegionConfig = {
      countryCode: "CN",
      webIdc: "cn1",
      regionKey: "cn",
      // jimeng-free-api 以 jimeng.jianying.com 为统一域
      mwebHost: "https://jimeng.jianying.com",
      webDomain: "https://jimeng.jianying.com",
      commerceDomain: "https://jimeng.jianying.com",
      frontierDomain: undefined,
      ttsDomain: undefined,
    };
    REGION_CFG_MAP.set(refreshToken, cnCfg);
    return;
  }
  const uri = "/lv/v1/user/web/user_info";
  const url = `https://dreamina.capcut.com${uri}`;
  const deviceTime = util.unixTimestamp();
  const sign = util.md5(`9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`);

  const cookieStr = `sessionid=${refreshToken}; sessionid_ss=${refreshToken}`;

  // 从 Accept-Language 推导 Lan
  const acceptLang = "zh-CN,zh;q=0.9";
  const lan = acceptLang.split(",")[0]?.split("-")[0] || "en";

  const headers = {
    ...FAKE_HEADERS,
    // 与示例保持一致但来源于已有常量或计算
    "App-Sdk-Version": APP_SDK_VERSION,
    Appid: DEFAULT_ASSISTANT_ID,
    Appvr: VERSION_CODE,
    Pf: PLATFORM_CODE,
    Origin: "https://dreamina.capcut.com",
    Referer: "https://dreamina.capcut.com/ai-tool/home",
    Cookie: cookieStr,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Device-Time": deviceTime,
    Sign: sign,
    "Sign-Ver": "1",
    Did: String(DEVICE_ID),
    "Content-Type": "application/json"
  } as Record<string, string | number>;

  try {
    const resp = await axios.request({
      method: "POST",
      url,
      data: {
        sem_info: {
          is_sem: false,
          medium: "Direct",
          register_source: "direct",
          register_second_source: "enter_url",
        },
      },
      headers,
      timeout: 15000,
      validateStatus: () => true,
    });

    const setCookies = resp.headers?.["set-cookie"] as string[] | undefined;
    if (setCookies && setCookies.length) {
      const tokenPair = setCookies
        .flatMap((sc) => sc.split(";"))
        .find((kv) => kv.trim().startsWith("msToken="));
      if (tokenPair) {
        const ms = tokenPair.trim().split("=")[1];
        MS_TOKEN_MAP.set(refreshToken, ms);
        logger.info("msToken 已获取");
      } else {
        logger.warn("未在 Set-Cookie 中找到 msToken");
      }
    } else {
      logger.warn("响应未包含 Set-Cookie，无法获取 msToken");
    }

    // 提取区域与域名信息，避免硬编码
    const data = resp.data?.data;
    const rawCountry = (data?.location?.code || "").toString().toUpperCase();
    const countryCode = rawCountry || "US"; // 若缺失则默认 US
    const webIdc = data?.location?.web_idc || undefined;
    const webDomain: string | undefined = data?.location?.domain?.web_domain;
    const commerceDomain: string | undefined = data?.location?.domain?.commerce_domain;
    const frontierDomain: string | undefined = data?.location?.domain?.frontier_domain;
    const ttsDomain: string | undefined = data?.location?.domain?.tts_domain;
    let regionKey: string | undefined;
    let mwebHost: string | undefined;
    if (webDomain) {
      // 形如 edit-api-sg.capcut.com 或 edit-api-us.capcut.com
      const m = webDomain.match(/edit-api-([^.]+)\.capcut\.com$/);
      regionKey = m?.[1];
      if (regionKey) {
        mwebHost = regionKey.startsWith("us")
          ? `https://dreamina-api.${regionKey.split(/[-]/)[0]}.capcut.com`
          : `https://mweb-api-${regionKey}.capcut.com`;
      }
    }
    // 当 user_info 未返回域名时，按国家兜底 mweb 主机
    if (!mwebHost) {
      if (countryCode.toUpperCase() === 'US') {
        mwebHost = 'https://dreamina-api.us.capcut.com';
      } else if (regionKey) {
        mwebHost = `https://mweb-api-${regionKey}.capcut.com`;
      } else {
        mwebHost = 'https://mweb-api-sg.capcut.com';
      }
    }
    const cfg: RegionConfig = {
      countryCode,
      webIdc,
      regionKey,
      mwebHost,
      webDomain,
      commerceDomain,
      frontierDomain,
      ttsDomain,
    };
    REGION_CFG_MAP.set(refreshToken, cfg);
    logger.info("区域信息:", cfg);

    // 已移除自动获取 tt-target-idc-sign 的逻辑
  } catch (err) {
    logger.warn("获取 msToken 失败", err);
  }
}

/**
 * 获取积分信息
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function getCredit(refreshToken: string) {
  const cfg = getRegionConfig(refreshToken);
  const commerceHost = cfg?.commerceDomain || "https://commerce-api-sg.capcut.com";
  const {
    credit: { gift_credit, purchase_credit, vip_credit }
  } = await request("POST", `${commerceHost}/commerce/v1/benefits/user_credit`, refreshToken, {
    data: {},
  });
  logger.info(`\n积分信息: \n赠送积分: ${gift_credit}, 购买积分: ${purchase_credit}, VIP积分: ${vip_credit}`);
  return {
    giftCredit: gift_credit,
    purchaseCredit: purchase_credit,
    vipCredit: vip_credit,
    totalCredit: gift_credit + purchase_credit + vip_credit
  }
}

/**
 * 接收今日积分
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function receiveCredit(refreshToken: string) {
  logger.info("正在收取今日积分...")
  const cfg = getRegionConfig(refreshToken);
  const commerceHost = cfg?.commerceDomain || "https://commerce-api-sg.capcut.com";
  try {
    const data = await request("POST", `${commerceHost}/commerce/v1/benefits/credit_receive`, refreshToken, {
      data: {
        time_zone: "Asia/Shanghai"
      },
    });
    console.log("data", data)
  } catch (error) {
    console.log("error", error)
  }
  // logger.info(`\n今日${receive_quota}积分收取成功\n剩余积分: ${cur_total_credits}`);
  // return 0;
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
  refreshToken: string,
  options: AxiosRequestConfig = {}
) {
  const token = await acquireToken(refreshToken);
  // 依据 ensureMsToken 的域名配置动态拼接 /mweb/* 的 Host
  let url = uri;
  if (!uri.startsWith("https://")) {
    if (uri.startsWith("/mweb/")) {
      const cfg = getRegionConfig(refreshToken);
      const host = cfg?.mwebHost || "https://mweb-api-sg.capcut.com";
      url = `${host}${uri}`;
    } else {
      url = `https://mweb-api-sg.capcut.com${uri}`;
    }
  }
  const deviceTime = util.unixTimestamp();
  // 使用真实请求路径计算签名（兼容绝对URL与相对路径）
  const pathForSign = (() => {
    try {
      const u = new URL(url);
      return u.pathname || "/";
    } catch {
      try {
        const u2 = new URL(`${url.startsWith("http") ? url : `https://dummy${url.startsWith('/') ? '' : '/'}${url}`}`);
        return u2.pathname || "/";
      } catch {
        return "/";
      }
    }
  })();
  const sign = util.md5(
    `9e2c|${pathForSign.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`
  );
  const isMwebHost = /mweb-api/.test(url);
  const isJimengHost = url.includes("jimeng.jianying.com");
  const regionParam = (options.params as any)?.region as string | undefined;
  logger.info(
    "request function: | token:", token,
    " | uri:", url,
    " | sign:", sign, 
    " | deviceTime:", deviceTime
    )
  const paramsObj = {
    aid: isJimengHost ? CN_ASSISTANT_ID : DEFAULT_ASSISTANT_ID,
    device_platform: "web",
    ...(isJimengHost ? { webId: WEB_ID } : { web_id: WEB_ID }),
    ...(options.params || {}),
  } as Record<string, any>;
  try {
    logger.info(
      "request params:", JSON.stringify({
        host: isJimengHost ? "jimeng" : (isMwebHost ? "mweb" : "other"),
        region: regionParam,
        aid: paramsObj.aid,
        webId: paramsObj.webId || paramsObj.web_id,
        keys: Object.keys(paramsObj),
      })
    );
  } catch {}
  const response = await axios.request({
    method,
    url,
    params: paramsObj,
    headers: {
      ...FAKE_HEADERS,
      Cookie: generateCookie(token, regionParam || getRegionConfig(refreshToken)?.countryCode),
      "Device-Time": deviceTime,
      // US 域名也接受 Sign，这里统一附带
      Sign: sign,
      "Sign-Ver": "1",
      // 针对 CN: 使用 jimeng.jianying.com 的站点头
      ...(isJimengHost
        ? {
            Origin: "https://jimeng.jianying.com",
            Referer: "https://jimeng.jianying.com",
            "Sec-Fetch-Site": "same-origin",
            lan: "zh-Hans",
            loc: "cn",
            Appid: CN_ASSISTANT_ID,
          }
        : {
            Origin: "https://dreamina.capcut.com",
            Referer: "https://dreamina.capcut.com/",
            "Sec-Fetch-Site": "same-site",
          }),
      ...(options.headers || {}),
    },
    timeout: 15000,
    validateStatus: () => true,
    ..._.omit(options, "params", "headers"),
  });
  // logger.info("request response:", response)
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
  isVideoImage: boolean = false,
  country?: string
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

  // 获取文件的MIME类型（宽高由服务端在 CN Commit 返回，不再本地解析）
  mimeType = mimeType || mime.getType(filename);

  // 1) 获取上传临时凭证
  const uploadToken = await getUploadToken(refreshToken, country);
  const {
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
    session_token: sessionToken,
    space_name: serviceId,
    upload_domain: uploadDomain,
    region: regionShort,
  } = uploadToken;

  // 2) 申请上传（ApplyImageUpload）
  const fileSize = Buffer.byteLength(fileData);
  const { UploadAddress } = await applyImageUpload({
    uploadDomain,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    serviceId,
    fileSize,
    regionShort,
  });
  if (!UploadAddress || !UploadAddress.StoreInfos?.length)
    throw new APIException(EX.API_REQUEST_FAILED, "获取上传地址失败");
  const storeInfo = UploadAddress.StoreInfos[0];
  const uploadHost = (UploadAddress.UploadHosts && UploadAddress.UploadHosts[0]) || UploadAddress.UploadHost;
  if (!uploadHost) throw new APIException(EX.API_REQUEST_FAILED, "缺少上传主机");

  // 3) 上传二进制到 TOS
  await uploadToTOS({
    host: uploadHost,
    storeUri: storeInfo.StoreUri,
    auth: storeInfo.Auth,
    filename,
    data: fileData,
    originHost: regionShort === 'cn' ? 'jimeng' : 'dreamina',
  });

  // 4) CommitImageUpload（所有区域均调用，用于拿到图片宽高等信息）
  let commitMeta: { width?: number; height?: number } = {};
  try {
    const endpoint = uploadDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const sessionKey = UploadAddress.SessionKey || '';
    // 解析签名区域，复用 ApplyImageUpload 的逻辑
    const regionAws = (() => {
      if (regionShort === 'cn') return 'cn-north-1';
      if (regionShort === 'sg') return 'ap-singapore-1';
      const m = uploadDomain.match(/imagex-([^.]+)\./);
      if (m?.[1]) return m[1];
      if (/bytedanceapi\.com$/.test(uploadDomain)) return 'cn-north-1';
      return 'ap-singapore-1';
    })();
    commitMeta = await commitImageUpload({
      endpoint,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      serviceId,
      sessionKey,
      regionAws,
      originHost: regionShort === 'cn' ? 'jimeng' : 'dreamina',
    });
  } catch (e) {
    // Commit 失败不阻断主流程，但无法获得宽高
    logger.warn('CommitImageUpload 失败（忽略）:', e?.message || e);
  }

  return {
    storeUri: storeInfo.StoreUri,
    uploadHost,
    serviceId,
    size: fileSize,
    mimeType,
    width: commitMeta.width,
    height: commitMeta.height,
  };
}

/** 获取 ImageX 上传临时凭证 */
export async function getUploadToken(refreshToken: string, country?: string) {
  await ensureMsToken(refreshToken);
  const cfg = getRegionConfig(refreshToken);
  const params: any = {
    web_version: "6.6.0",
    da_version: "3.2.8",
    aigc_features: "app_lip_sync",
    ...(country ? { region: country } : {}),
    ...(cfg?.countryCode === "US" && getMsToken(refreshToken) ? { msToken: getMsToken(refreshToken)! } : {}),
  };
  // 网络偶发 TLS 握手失败，做少量重试
  let lastErr: any;
  for (let i = 0; i < 3; i++) {
    try {
      const result = await request(
        "POST",
        `/mweb/v1/get_upload_token`,
        refreshToken,
        {
          params,
          data: { scene: 2 },
        }
      );
      return result;
    } catch (err: any) {
      lastErr = err;
      const msg = `${err?.code || ''} ${err?.message || err}`;
      if (/TLS|ECONNRESET|ECONNABORTED|ETIMEDOUT/i.test(msg) && i < 2) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

/** 申请上传地址（ApplyImageUpload） */
async function applyImageUpload({
  uploadDomain,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  serviceId,
  fileSize,
  regionShort,
}: {
  uploadDomain: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  serviceId: string; // space_name
  fileSize: number;
  regionShort?: string; // e.g., 'cn', 'sg'
}) {
  // 解析签名区域
  let region = (() => {
    if (regionShort === 'cn') return 'cn-north-1';
    if (regionShort === 'sg') return 'ap-singapore-1';
    const m = uploadDomain.match(/imagex-([^.]+)\./);
    if (m?.[1]) return m[1];
    if (/bytedanceapi\.com$/.test(uploadDomain)) return 'cn-north-1';
    return 'ap-singapore-1';
  })();
  const query: Record<string, string | number> = {
    Action: "ApplyImageUpload",
    Version: "2018-08-01",
    ServiceId: serviceId,
    FileSize: fileSize,
    device_platform: "web",
  };
  const url = `https://${uploadDomain}/`;
  const { headers: sigHeaders } = signAwsV4({
    method: "GET",
    service: "imagex",
    region,
    host: uploadDomain,
    path: "/",
    query,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  });
  const resp = await axios.request({
    method: "GET",
    url,
    params: query,
    headers: sigHeaders,
    timeout: 15000,
    validateStatus: () => true,
  });
  if (resp.status >= 400)
    throw new APIException(EX.API_REQUEST_FAILED, `ApplyImageUpload失败: [${resp.status}] ${resp.statusText}`);
  if (resp.data?.ResponseMetadata?.Action !== "ApplyImageUpload")
    throw new APIException(EX.API_REQUEST_FAILED, "ApplyImageUpload返回异常");
  return resp.data.Result || {};
}

/** 上传到 TOS */
async function uploadToTOS({
  host,
  storeUri,
  auth,
  filename,
  data,
  originHost,
}: {
  host: string;
  storeUri: string;
  auth: string;
  filename: string;
  data: Buffer;
  originHost?: 'jimeng' | 'dreamina';
}) {
  const crc = CRC32.buf(Uint8Array.from(data)) >>> 0; // unsigned
  const crcHex = crc.toString(16).padStart(8, "0");
  const url = `https://${host}/upload/v1/${storeUri}`;
  const resp = await axios.request({
    method: "POST",
    url,
    data,
    headers: {
      Authorization: auth,
      "Content-CRC32": crcHex,
      "Content-Disposition": `attachment; filename="${filename || "file"}"`,
      "Content-Type": "application/octet-stream",
      Origin: originHost === 'jimeng' ? 'https://jimeng.jianying.com' : 'https://dreamina.capcut.com',
      Referer: originHost === 'jimeng' ? 'https://jimeng.jianying.com/' : 'https://dreamina.capcut.com/',
    },
    timeout: 60000,
    maxContentLength: FILE_MAX_SIZE,
    validateStatus: () => true,
  });
  if (resp.status >= 400 || resp.data?.code !== 2000)
    throw new APIException(EX.API_REQUEST_FAILED, `上传失败: [${resp.status}] ${resp.statusText}`);
  return true;
}

/** 简化版 AWS SigV4（用于 ImageX） */
function signAwsV4({
  method,
  service,
  region,
  host,
  path,
  query,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  payloadSha256,
  includeContentSha256,
}: {
  method: string;
  service: string;
  region: string;
  host: string;
  path: string;
  query: Record<string, string | number>;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  payloadSha256?: string; // hex string
  includeContentSha256?: boolean;
}) {
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const date = amzDate.slice(0, 8);

  const qs = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(query[k]))}`)
    .join("&");

  const contentSha = includeContentSha256 ? (payloadSha256 || crypto.createHash('sha256').update('').digest('hex')) : undefined;
  const canonicalHeaders =
    (includeContentSha256 ? `x-amz-content-sha256:${contentSha}\n` : '') +
    `x-amz-date:${amzDate}\n` +
    `x-amz-security-token:${sessionToken}\n`;
  const signedHeaders = (includeContentSha256 ? 'x-amz-content-sha256;' : '') + 'x-amz-date;x-amz-security-token';
  const payloadHash = includeContentSha256 ? contentSha! : crypto.createHash("sha256").update("").digest("hex");
  const canonicalRequest = [method.toUpperCase(), path, qs, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const canonicalRequestHash = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${canonicalRequestHash}`;

  // Ensure ArrayBufferView compatible keys for createSecretKey
  const toArrayView = (src: Buffer | string) =>
    typeof src === 'string' ? Uint8Array.from(Buffer.from(src)) : Uint8Array.from(src);

  const kDate = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView("AWS4" + secretAccessKey)))
    .update(date)
    .digest();
  const kRegion = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView(kDate)))
    .update(region)
    .digest();
  const kService = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView(kRegion)))
    .update(service)
    .digest();
  const kSigning = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView(kService)))
    .update("aws4_request")
    .digest();
  const signature = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView(kSigning)))
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      Host: host,
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-security-token": sessionToken,
      ...(includeContentSha256 ? { 'x-amz-content-sha256': payloadHash } : {}),
    },
  };
}

/** Commit 上传（CN 需要） */
async function commitImageUpload({
  endpoint,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  serviceId,
  sessionKey,
  regionAws,
  originHost,
}: {
  endpoint: string; // imagex host
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  serviceId: string;
  sessionKey: string;
  regionAws: string;
  originHost?: 'jimeng' | 'dreamina';
}): Promise<{ width?: number; height?: number }> {
  const url = `https://${endpoint}/`;
  const query = {
    Action: 'CommitImageUpload',
    Version: '2018-08-01',
    ServiceId: serviceId,
  } as Record<string, string>;
  const body = JSON.stringify({ SessionKey: sessionKey });
  const bodySha = crypto.createHash('sha256').update(body).digest('hex');
  const { headers: sigHeaders } = signAwsV4({
    method: 'POST',
    service: 'imagex',
    region: regionAws,
    host: endpoint,
    path: '/',
    query,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    payloadSha256: bodySha,
    includeContentSha256: true,
  });
  const resp = await axios.request({
    method: 'POST',
    url,
    params: query,
    data: body,
    headers: {
      ...sigHeaders,
      'Content-Type': 'application/json',
      Origin: originHost === 'jimeng' ? 'https://jimeng.jianying.com' : 'https://dreamina.capcut.com',
      Referer: originHost === 'jimeng' ? 'https://jimeng.jianying.com/' : 'https://dreamina.capcut.com/',
    },
    timeout: 15000,
    validateStatus: () => true,
  });
  if (resp.status >= 400 || resp.data?.ResponseMetadata?.Action !== 'CommitImageUpload')
    throw new APIException(EX.API_REQUEST_FAILED, `CommitImageUpload失败: [${resp.status}] ${resp.statusText}`);
  const plugin = resp.data?.Result?.PluginResult?.[0];
  return {
    width: plugin?.ImageWidth,
    height: plugin?.ImageHeight,
  };
}

/**
 * 解析 refreshToken 可选区域后缀（例如 "<token>:cn"）
 */
function parseTokenRegion(refreshToken: string): { token: string; region?: string } {
  const m = refreshToken?.match(/^(.*?):([a-zA-Z]+)$/);
  if (m) return { token: m[1], region: m[2] };
  return { token: refreshToken };
}



/**
 * 检查请求结果
 *
 * @param result 结果
 */
export function checkResult(result: AxiosResponse) {
  const { ret, errmsg, data } = result.data;
  if (!_.isFinite(Number(ret))) return result.data;
  if (ret === '0') return data;
  if (ret === '5000')
    throw new APIException(EX.API_IMAGE_GENERATION_INSUFFICIENT_POINTS, `[无法生成图像]: 即梦积分可能不足，${errmsg}`)
      .setHTTPStatusCode(402);
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
export async function getTokenLiveStatus(refreshToken: string) {
  const result = await request(
    "POST",
    "/passport/account/info/v2",
    refreshToken,
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
