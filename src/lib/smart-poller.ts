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
 * 轮询配置
 */
export const POLLING_CONFIG = {
  MAX_POLL_COUNT: 900,    // 最大轮询次数 (15分钟)
  POLL_INTERVAL: 5000,    // 基础轮询间隔 (5秒)
  STABLE_ROUNDS: 5,       // 稳定轮次
  TIMEOUT_SECONDS: 900,   // 超时时间 (15分钟)
};

/**
 * 轮询状态接口
 */
export interface PollingStatus {
  status: number;
  failCode?: string;
  itemCount: number;
  finishTime?: number;
  historyId?: string;
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
}

/**
 * 轮询结果接口
 */
export interface PollingResult {
  status: number;
  failCode?: string;
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
  private options: Required<PollingOptions>;
  
  constructor(options: PollingOptions = {}) {
    this.options = {
      maxPollCount: options.maxPollCount ?? POLLING_CONFIG.MAX_POLL_COUNT,
      pollInterval: options.pollInterval ?? POLLING_CONFIG.POLL_INTERVAL,
      stableRounds: options.stableRounds ?? POLLING_CONFIG.STABLE_ROUNDS,
      timeoutSeconds: options.timeoutSeconds ?? POLLING_CONFIG.TIMEOUT_SECONDS,
      expectedItemCount: options.expectedItemCount ?? 4,
      type: options.type ?? 'image'
    };
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
    logger.info(`🔄 开始智能轮询: historyId=${historyId || 'N/A'}, 最大轮询=${this.options.maxPollCount}, 期望结果=${this.options.expectedItemCount}`);
    
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
        logger.info(`📊 轮询 ${this.pollCount}/${this.options.maxPollCount}: status=${status.status}(${this.getStatusName(status.status)}), items=${status.itemCount}, elapsed=${elapsedTime}s, stable=${this.stableItemCountRounds}/${this.options.stableRounds}`);
        
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
            const failMsg = `${this.options.type === 'image' ? '图像' : '视频'}生成失败: status=30, failCode=${status.failCode || 'unknown'}`;
            logger.error(failMsg);
            if (status.failCode === '2038') {
              throw new APIException(EX.API_CONTENT_FILTERED, '内容违规被过滤');
            }
            throw new APIException(
              this.options.type === 'image' ? EX.API_IMAGE_GENERATION_FAILED : EX.API_VIDEO_GENERATION_FAILED,
              failMsg
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
          logger.info(`⏳ ${this.options.type === 'image' ? '图像' : '视频'}生成进度: 第 ${this.pollCount} 次轮询，状态: ${this.getStatusName(status.status)}，已等待 ${elapsedTime} 秒...`);
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
      itemCount: lastStatus.itemCount,
      elapsedTime: finalElapsedTime,
      pollCount: this.pollCount,
      exitReason: this.shouldExitPolling(lastStatus).reason
    };
    
    logger.info(`🎉 ${this.options.type === 'image' ? '图像' : '视频'}生成完成: 成功生成 ${lastStatus.itemCount} 个结果，总耗时 ${finalElapsedTime} 秒，最终状态: ${this.getStatusName(lastStatus.status)}`);
    
    return { result, data: lastData! };
  }
}

