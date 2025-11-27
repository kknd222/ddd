import logger from "@/lib/logger.ts";
import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";

/**
 * 状态码映射
 */
const STATUS_CODE_MAP: Record<number, string> = {
  10: "SUCCESS",
  20: "PROCESSING",
  30: "FAILED",
  42: "POST_PROCESSING",
  45: "FINALIZING",
  50: "COMPLETED",
};

/**
 * failCode 错误消息映射
 */
const FAIL_CODE_MESSAGES: Record<string, string> = {
  "-7": "AI 代理提交失败：无法生成图片/视频",
  "-6": "操作已中止",
  "-5": "客户端混合参数不可用",
  "-4": "客户端发生通用错误",
  "-3": "文件加载失败",
  "-2": "网络离线/断开：请检查您的互联网连接并重试",
  "-1": "请求正在处理中",
  "0": "操作成功",
  "1": "已达到请求速率限制",
  "1000": "输入参数无效",
  "1001": "输入参数无效",
  "1002": "无法生成，请稍后重试",
  "1006": "剩余积分不足",
  "1014": "登录/注册失败，请稍后重试",
  "1015": "无法登录，请稍后重试",
  "1018": "您已达到今日生成限制，请明日再试",
  "1019": "账号存在风险，无法通过安全检查",
  "1021": "商业行为存在风险，已被拦截",
  "1057": "当前生成人数过多或尝试次数过多，请稍后重试",
  "1063": "提示语可能包含违反社区准则的内容，请修改后重试",
  "1157": "当前正在生成的用户过多，请稍后重试",
  "1158": "所选声音不支持该语言或输入非文本，请修改后重试",
  "1159": "由于潜在的版权限制，无法上传",
  "1161": "输入内容中包含不支持的中英文混用格式",
  "1162": "文本包含不支持的语言，请修改后重试",
  "1189": "资产状态不正确",
  "1190": "样式代码不可用，请尝试其他代码",
  "2001": "无法加载信息流内容",
  "2002": "发生错误，无法生成，请重试",
  "2003": "上传的图片可能包含违规内容，请尝试其他图片",
  "2004": "生成的视频可能包含不当内容",
  "2005": "提示语可能包含违规内容，请修改后重试",
  "2006": "无法为该随机提示词找到合适的模型",
  "2007": "无法获取用户作品集",
  "2008": "无法获取生成历史记录",
  "2009": "无法发布，请重试",
  "2010": "无法获取主页数据",
  "2011": "视频/图片超分辨率处理失败",
  "2012": "无法获取面板配置信息",
  "2013": "无法获取访问限制配置",
  "2014": "访问权限受限",
  "2015": "该内容已发布",
  "2016": "无法获取邀请状态",
  "2020": "尝试次数过多，请稍后重试",
  "2024": "暂无发布权限，请联系支持团队",
  "2025": "请输入有效的邀请码",
  "2026": "该邀请码已被使用",
  "2027": "邀请码绑定过程失败",
  "2028": "无法授予作者相关权限",
  "2031": "历史生成记录已被删除",
  "2035": "账号活动异常，为保护安全，操作被阻止",
  "2037": "无法下载，请重试",
  "2038": "文本内容可能包含违规内容，请修改",
  "2039": "上传的图片可能包含违规内容，请尝试其他图片",
  "2041": "图片内容严重违规，操作被阻止",
  "2042": "上传的视频可能包含违规内容，请尝试其他视频",
  "2043": "安全验证失败，操作被阻止",
  "2044": "上传的音频可能包含违规内容，请修改",
  "2046": "无法找到有效的分割对象（如人物、物体）",
  "2047": "图像分割操作失败，请重试",
  "2048": "图片可能包含不当内容或版权问题",
  "2049": "您的 IP 或文本触发了风控",
  "2050": "文本内容涉及版权问题",
  "2056": "输入音频包含不允许的英文内容",
  "2203": "上传图片被版权阻止",
  "2204": "生成图片被版权阻止",
  "3021": "当前功能不支持此 Beta 模型",
  "4001": "外部账户积分不足",
  "4003": "缺乏操作所需的权限",
  "4007": "视频无法生成声音效果",
  "4101": "未识别到视频中的人物或角色",
  "4102": "视频/图片尺寸太小",
  "4103": "视频/图片分辨率或文件大小过大",
  "4104": "视频时长不满足最低要求",
  "4105": "视频时长超过最大限制",
  "4106": "角色在图像和视频中的比例不匹配",
  "4107": "视频模板与输入图片不兼容",
  "5000": "剩余积分不足",
  "10020": "非商业区域用户达到速率限制",
};

/**
 * 根据 failCode 获取友好的错误消息
 * @param failCode 错误码
 * @param failMsg 服务器返回的错误消息（兜底使用）
 */
function getFailCodeMessage(failCode?: string, failMsg?: string): string {
  if (!failCode && !failMsg) return "生成失败";
  
  // 优先使用映射表中的消息
  if (failCode && FAIL_CODE_MESSAGES[failCode]) {
    return FAIL_CODE_MESSAGES[failCode];
  }
  
  // 如果映射表中没有，使用服务器返回的 fail_msg
  if (failMsg) {
    return failMsg;
  }
  
  // 兜底：显示错误码
  return failCode ? `生成失败 (错误码: ${failCode})` : "生成失败";
}

/**
 * 轮询配置
 */
export const POLLING_CONFIG = {
  MAX_POLL_COUNT: 900,    // 最大轮询次数 (15分钟)
  POLL_INTERVAL: 5000,    // 基础轮询间隔 (5秒)
  STABLE_ROUNDS: 5,       // 稳定轮次
  TIMEOUT_SECONDS: 900,   // 超时时间 (15分钟)
};

/**
 * 队列信息接口
 */
export interface QueueInfo {
  queue_idx?: number;
  priority?: number;
  queue_status?: number;
  queue_length?: number;
}

/**
 * 轮询状态接口
 */
export interface PollingStatus {
  status: number;
  failCode?: string;
  failMsg?: string;
  itemCount: number;
  finishTime?: number;
  historyId?: string;
  queueInfo?: QueueInfo;
}

/**
 * 轮询配置接口
 */
export interface PollingOptions {
  maxPollCount?: number;
  pollInterval?: number;
  stableRounds?: number;
  timeoutSeconds?: number;
  expectedItemCount?: number;
  type?: 'image' | 'video';
  sessionId?: string;
  onProgress?: (message: string) => void; // 进度回调
}

/**
 * 轮询结果接口
 */
export interface PollingResult {
  status: number;
  failCode?: string;
  failMsg?: string;
  itemCount: number;
  elapsedTime: number;
  pollCount: number;
  exitReason: string;
}

/**
 * 智能轮询器
 * 根据状态码智能调整轮询间隔，优化性能
 */
export class SmartPoller {
  private pollCount = 0;
  private startTime = Date.now();
  private lastItemCount = 0;
  private stableItemCountRounds = 0;
  private options: Required<Omit<PollingOptions, 'sessionId' | 'onProgress'>>;
  private sessionId?: string;
  private onProgress?: (message: string) => void;
  
  constructor(options: PollingOptions = {}) {
    this.options = {
      maxPollCount: options.maxPollCount ?? POLLING_CONFIG.MAX_POLL_COUNT,
      pollInterval: options.pollInterval ?? POLLING_CONFIG.POLL_INTERVAL,
      stableRounds: options.stableRounds ?? POLLING_CONFIG.STABLE_ROUNDS,
      timeoutSeconds: options.timeoutSeconds ?? POLLING_CONFIG.TIMEOUT_SECONDS,
      expectedItemCount: options.expectedItemCount ?? 4,
      type: options.type ?? 'image'
    };
    this.sessionId = options.sessionId;
    this.onProgress = options.onProgress;
  }
  
  /**
   * 获取状态名称
   */
  private getStatusName(status: number): string {
    return STATUS_CODE_MAP[status] || `UNKNOWN(${status})`;
  }
  
  /**
   * 根据状态码计算智能轮询间隔
   */
  private getSmartInterval(status: number, itemCount: number): number {
    const baseInterval = this.options.pollInterval;
    
    // 根据状态码调整间隔
    switch (status) {
      case 20: // PROCESSING - 处理中，使用标准间隔
        return baseInterval;
      
      case 42: // POST_PROCESSING - 后处理中，稍微增加间隔
        return baseInterval * 1.2;
      
      case 45: // FINALIZING - 最终处理中，可能需要更多时间
        return baseInterval * 1.5;
      
      case 50: // COMPLETED - 已完成，快速检查
        return baseInterval * 0.5;
      
      case 10: // SUCCESS - 成功，立即返回
        return 0;
      
      case 30: // FAILED - 失败，立即返回
        return 0;
      
      default: // 未知状态，使用标准间隔
        return baseInterval;
    }
  }
  
  /**
   * 检查是否应该退出轮询
   */
  private shouldExitPolling(pollingStatus: PollingStatus): { shouldExit: boolean; reason: string } {
    const { status, itemCount } = pollingStatus;
    const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
    
    // 更新图片数量稳定性检测
    if (itemCount === this.lastItemCount) {
      this.stableItemCountRounds++;
    } else {
      this.stableItemCountRounds = 0;
      this.lastItemCount = itemCount;
    }
    
    // 1. 任务成功完成
    if (status === 10 || status === 50) {
      return { shouldExit: true, reason: '任务成功完成' };
    }
    
    // 2. 任务失败
    if (status === 30) {
      return { shouldExit: true, reason: '任务失败' };
    }
    
    // 3. 已获得期望数量的结果（但必须状态已完成）
    if (itemCount >= this.options.expectedItemCount && (status === 10 || status === 50)) {
      return { shouldExit: true, reason: `已获得完整结果集(${itemCount}/${this.options.expectedItemCount})` };
    }
    
    // 4. 图片数量已稳定
    if (this.stableItemCountRounds >= this.options.stableRounds && itemCount > 0) {
      return { shouldExit: true, reason: `结果数量稳定(${this.stableItemCountRounds}轮)` };
    }
    
    // 5. 轮询次数超限
    if (this.pollCount >= this.options.maxPollCount) {
      return { shouldExit: true, reason: '轮询次数超限' };
    }
    
    // 6. 时间超限但有结果
    if (elapsedTime >= this.options.timeoutSeconds && itemCount > 0) {
      return { shouldExit: true, reason: '时间超限但已有结果' };
    }
    
    return { shouldExit: false, reason: '' };
  }
  
  /**
   * 执行智能轮询
   */
  async poll<T>(
    pollFunction: () => Promise<{ status: PollingStatus; data: T }>,
    historyId?: string
  ): Promise<{ result: PollingResult; data: T }> {
    const sessionPrefix = this.sessionId ? `${this.sessionId} ` : '';
    logger.info(`${sessionPrefix}🔄 开始智能轮询: historyId=${historyId || 'N/A'}, 最大轮询=${this.options.maxPollCount}, 期望结果=${this.options.expectedItemCount}`);
    
    let lastData: T;
    let lastStatus: PollingStatus = { status: 20, itemCount: 0 };
    
    while (true) {
      this.pollCount++;
      const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
      
      try {
        // 执行轮询函数
        const { status, data } = await pollFunction();
        lastStatus = status;
        lastData = data;
        
        // 详细日志
        const sessionPrefix = this.sessionId ? `${this.sessionId} ` : '';
        const statusInfo = status.failCode 
          ? `status=${status.status}(${this.getStatusName(status.status)}), failCode=${status.failCode}(${getFailCodeMessage(status.failCode, status.failMsg)})`
          : `status=${status.status}(${this.getStatusName(status.status)})`;
        logger.info(`${sessionPrefix}📊 轮询 ${this.pollCount}/${this.options.maxPollCount}: ${statusInfo}, items=${status.itemCount}, elapsed=${elapsedTime}s, stable=${this.stableItemCountRounds}/${this.options.stableRounds}`);
        
        // 如果有结果生成，记录详细信息
        if (status.itemCount > 0 && status.itemCount !== this.lastItemCount) {
          logger.info(`✨ 检测到${this.options.type === 'image' ? '图片' : '视频'}生成: 数量=${status.itemCount}, 状态=${this.getStatusName(status.status)}`);
        }
        
        // 检查是否应该退出
        const { shouldExit, reason } = this.shouldExitPolling(status);
        
        if (shouldExit) {
          logger.info(`✅ 退出轮询: ${reason}, 最终${this.options.type === 'image' ? '图片' : '视频'}数量=${status.itemCount}`);
          
          // 处理失败情况
          if (status.status === 30) {
            const userFriendlyMsg = getFailCodeMessage(status.failCode, status.failMsg);
            const debugMsg = `${this.options.type === 'image' ? '图像' : '视频'}生成失败: status=30, failCode=${status.failCode || 'unknown'}, failMsg=${status.failMsg || 'N/A'}, message=${userFriendlyMsg}`;
            logger.error(debugMsg);
            
            // 特殊处理内容违规
            if (status.failCode === '2038' || status.failCode === '2005' || status.failCode === '1063') {
              throw new APIException(EX.API_CONTENT_FILTERED, userFriendlyMsg);
            }
            
            // 特殊处理积分不足
            if (status.failCode === '1006' || status.failCode === '5000') {
              throw new APIException(EX.API_REQUEST_FAILED, userFriendlyMsg);
            }
            
            // 其他失败情况返回友好消息
            throw new APIException(
              this.options.type === 'image' ? EX.API_IMAGE_GENERATION_FAILED : EX.API_VIDEO_GENERATION_FAILED,
              userFriendlyMsg
            );
          }
          
          // 处理超时情况
          if (reason === '轮询次数超限' || reason === '时间超限但已有结果') {
            logger.warn(`⏱️ 轮询超时: ${reason}, pollCount=${this.pollCount}, elapsed=${elapsedTime}s`);
            if (status.itemCount === 0) {
              throw new APIException(
                this.options.type === 'image' ? EX.API_IMAGE_GENERATION_FAILED : EX.API_VIDEO_GENERATION_FAILED,
                `生成超时且无结果，状态码: ${status.status}`
              );
            }
          }
          
          break;
        }
        
        // 未知状态码警告
        if (![20, 42, 45, 10, 30, 50].includes(status.status)) {
          logger.warn(`⚠️ 检测到未知状态码 ${status.status}(${this.getStatusName(status.status)})，继续轮询...`);
        }
        
        // 进度日志（每30秒输出一次）
        if (this.pollCount % 6 === 0) {
          let progressMsg = `⏳ ${this.options.type === 'image' ? '图像' : '视频'}生成进度: 第 ${this.pollCount} 次轮询，状态: ${this.getStatusName(status.status)}，已等待 ${elapsedTime} 秒`;
          
          // 如果有真实队列信息（queue_length > 0），添加到进度消息中
          if (status.queueInfo && status.queueInfo.queue_status === 1 && status.queueInfo.queue_length > 0) {
            progressMsg += `，队列位次: ${status.queueInfo.queue_idx}/${status.queueInfo.queue_length}`;
          }
          
          logger.info(progressMsg);
          // 通过回调通知进度
          if (this.onProgress) {
            this.onProgress(progressMsg);
          }
        }
        
        // 计算下次轮询间隔
        const nextInterval = this.getSmartInterval(status.status, status.itemCount);
        if (nextInterval > 0) {
          await new Promise(resolve => setTimeout(resolve, nextInterval));
        }
        
      } catch (error) {
        logger.error(`❌ 轮询过程中发生错误: ${error.message}`);
        throw error;
      }
    }
    
    const finalElapsedTime = Math.round((Date.now() - this.startTime) / 1000);
    
    const result: PollingResult = {
      status: lastStatus.status,
      failCode: lastStatus.failCode,
      failMsg: lastStatus.failMsg,
      itemCount: lastStatus.itemCount,
      elapsedTime: finalElapsedTime,
      pollCount: this.pollCount,
      exitReason: this.shouldExitPolling(lastStatus).reason
    };
    
    logger.info(`🎉 ${this.options.type === 'image' ? '图像' : '视频'}生成完成: 成功生成 ${lastStatus.itemCount} 个结果，总耗时 ${finalElapsedTime} 秒，最终状态: ${this.getStatusName(lastStatus.status)}`);
    
    return { result, data: lastData! };
  }
}

