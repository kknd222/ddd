import _ from 'lodash';
import Exception from './Exception.ts';

/**
 * 异常监控和统计工具
 */
export default class ExceptionMonitor {
    private static instance: ExceptionMonitor;
    private errorStats: Map<number, { count: number; lastOccurred: number; samples: any[] }> = new Map();
    private maxSamples = 10; // 每个错误码最多保存的样本数

    private constructor() {}

    static getInstance(): ExceptionMonitor {
        if (!ExceptionMonitor.instance) {
            ExceptionMonitor.instance = new ExceptionMonitor();
        }
        return ExceptionMonitor.instance;
    }

    /**
     * 记录异常
     * @param exception 异常实例
     */
    recordException(exception: Exception): void {
        const errcode = exception.errcode;
        const now = Date.now();
        
        if (!this.errorStats.has(errcode)) {
            this.errorStats.set(errcode, {
                count: 0,
                lastOccurred: now,
                samples: []
            });
        }
        
        const stats = this.errorStats.get(errcode)!;
        stats.count++;
        stats.lastOccurred = now;
        
        // 保存异常样本（限制数量）
        if (stats.samples.length < this.maxSamples) {
            stats.samples.push({
                timestamp: now,
                message: exception.errmsg,
                context: exception.context,
                stack: exception.stackTrace
            });
        } else {
            // 替换最旧的样本
            stats.samples.shift();
            stats.samples.push({
                timestamp: now,
                message: exception.errmsg,
                context: exception.context,
                stack: exception.stackTrace
            });
        }
    }

    /**
     * 获取错误统计
     * @param errcode 错误码（可选）
     */
    getErrorStats(errcode?: number): any {
        if (errcode) {
            return this.errorStats.get(errcode) || null;
        }
        
        return Array.from(this.errorStats.entries()).map(([code, stats]) => ({
            errcode: code,
            count: stats.count,
            lastOccurred: stats.lastOccurred,
            samples: stats.samples
        }));
    }

    /**
     * 获取错误率统计
     * @param timeWindow 时间窗口（毫秒）
     */
    getErrorRate(timeWindow: number = 3600000): any {
        const now = Date.now();
        const cutoff = now - timeWindow;
        
        const recentErrors = Array.from(this.errorStats.entries())
            .filter(([_, stats]) => stats.lastOccurred >= cutoff)
            .map(([code, stats]) => ({
                errcode: code,
                count: stats.count,
                lastOccurred: stats.lastOccurred
            }));
        
        const totalErrors = recentErrors.reduce((sum, error) => sum + error.count, 0);
        
        return {
            timeWindow,
            totalErrors,
            errorTypes: recentErrors,
            timestamp: now
        };
    }

    /**
     * 获取高频错误
     * @param threshold 阈值
     */
    getHighFrequencyErrors(threshold: number = 10): any[] {
        return Array.from(this.errorStats.entries())
            .filter(([_, stats]) => stats.count >= threshold)
            .map(([code, stats]) => ({
                errcode: code,
                count: stats.count,
                lastOccurred: stats.lastOccurred,
                samples: stats.samples
            }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * 清理过期数据
     * @param maxAge 最大年龄（毫秒）
     */
    cleanup(maxAge: number = 86400000): void {
        const now = Date.now();
        const cutoff = now - maxAge;
        
        for (const [errcode, stats] of this.errorStats.entries()) {
            if (stats.lastOccurred < cutoff) {
                this.errorStats.delete(errcode);
            } else {
                // 清理过期的样本
                stats.samples = stats.samples.filter(sample => sample.timestamp >= cutoff);
            }
        }
    }

    /**
     * 重置统计
     */
    reset(): void {
        this.errorStats.clear();
    }

    /**
     * 导出统计数据
     */
    export(): any {
        return {
            timestamp: Date.now(),
            stats: this.getErrorStats(),
            errorRate: this.getErrorRate(),
            highFrequencyErrors: this.getHighFrequencyErrors()
        };
    }

    /**
     * 检查是否需要告警
     * @param errcode 错误码
     * @param threshold 阈值
     * @param timeWindow 时间窗口
     */
    shouldAlert(errcode: number, threshold: number = 50, timeWindow: number = 300000): boolean {
        const stats = this.errorStats.get(errcode);
        if (!stats) return false;
        
        const now = Date.now();
        const cutoff = now - timeWindow;
        
        // 统计时间窗口内的错误次数
        const recentCount = stats.samples.filter(sample => sample.timestamp >= cutoff).length;
        
        return recentCount >= threshold;
    }
}
