import _ from 'lodash';
import Exception from './Exception.ts';
import APIException from './APIException.ts';
import EX from '../consts/exceptions.ts';

/**
 * 异常处理工具类
 */
export default class ExceptionHandler {
    
    /**
     * 创建异常实例
     * @param exception 异常定义
     * @param message 自定义消息
     * @param context 上下文信息
     */
    static createException(
        exception: [number, string], 
        message?: string, 
        context?: Record<string, any>
    ): Exception {
        return new Exception(exception, message, context);
    }

    /**
     * 创建API异常实例
     * @param exception 异常定义
     * @param message 自定义消息
     * @param context 上下文信息
     */
    static createAPIException(
        exception: [number, string], 
        message?: string, 
        context?: Record<string, any>
    ): APIException {
        return new APIException(exception, message, context);
    }

    /**
     * 包装异步操作，自动处理异常
     * @param operation 异步操作
     * @param fallback 失败时的回退值
     * @param context 上下文信息
     */
    static async safeAsync<T>(
        operation: () => Promise<T>, 
        fallback?: T, 
        context?: Record<string, any>
    ): Promise<T | undefined> {
        try {
            return await operation();
        } catch (error) {
            const exception = this.wrapError(error, context);
            console.error('Safe async operation failed:', exception.toJSON());
            return fallback;
        }
    }

    /**
     * 包装同步操作，自动处理异常
     * @param operation 同步操作
     * @param fallback 失败时的回退值
     * @param context 上下文信息
     */
    static safeSync<T>(
        operation: () => T, 
        fallback?: T, 
        context?: Record<string, any>
    ): T | undefined {
        try {
            return operation();
        } catch (error) {
            const exception = this.wrapError(error, context);
            console.error('Safe sync operation failed:', exception.toJSON());
            return fallback;
        }
    }

    /**
     * 重试机制
     * @param operation 操作函数
     * @param maxRetries 最大重试次数
     * @param delay 重试延迟（毫秒）
     * @param context 上下文信息
     */
    static async retry<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        delay: number = 1000,
        context?: Record<string, any>
    ): Promise<T> {
        let lastError: any;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                const exception = this.wrapError(error, { ...context, attempt });
                
                // 如果不是可重试的异常，直接抛出
                if (exception instanceof Exception && !exception.isRetryable()) {
                    throw exception;
                }
                
                // 如果是最后一次尝试，抛出异常
                if (attempt === maxRetries) {
                    throw exception;
                }
                
                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
        
        throw lastError;
    }

    /**
     * 包装错误为异常实例
     * @param error 原始错误
     * @param context 上下文信息
     */
    static wrapError(error: any, context?: Record<string, any>): Exception {
        if (error instanceof Exception || error instanceof APIException) {
            if (context) {
                Object.assign(error.context, context);
            }
            return error;
        }
        
        if (_.isError(error)) {
            return new Exception(EX.SYSTEM_ERROR, error.message, {
                ...context,
                originalError: error.name,
                originalStack: error.stack
            });
        }
        
        return new Exception(EX.SYSTEM_ERROR, String(error), context);
    }

    /**
     * 验证参数并抛出异常
     * @param condition 验证条件
     * @param exception 异常定义
     * @param message 自定义消息
     * @param context 上下文信息
     */
    static assert(
        condition: any, 
        exception: [number, string], 
        message?: string, 
        context?: Record<string, any>
    ): asserts condition {
        if (!condition) {
            throw new Exception(exception, message, context);
        }
    }

    /**
     * 验证参数存在性
     * @param value 要验证的值
     * @param name 参数名称
     * @param context 上下文信息
     */
    static requireParam(
        value: any, 
        name: string, 
        context?: Record<string, any>
    ): void {
        if (_.isNil(value)) {
            throw new APIException(
                EX.API_REQUEST_PARAMS_INVALID, 
                `参数 ${name} 不能为空`, 
                { ...context, paramName: name }
            );
        }
    }

    /**
     * 验证参数类型
     * @param value 要验证的值
     * @param expectedType 期望类型
     * @param name 参数名称
     * @param context 上下文信息
     */
    static requireType(
        value: any, 
        expectedType: string, 
        name: string, 
        context?: Record<string, any>
    ): void {
        const actualType = typeof value;
        if (actualType !== expectedType) {
            throw new APIException(
                EX.API_REQUEST_PARAMS_INVALID, 
                `参数 ${name} 类型错误，期望 ${expectedType}，实际 ${actualType}`, 
                { ...context, paramName: name, expectedType, actualType }
            );
        }
    }

    /**
     * 记录异常到日志
     * @param error 异常
     * @param level 日志级别
     * @param context 额外上下文
     */
    static logError(
        error: any, 
        level: 'error' | 'warn' | 'info' = 'error', 
        context?: Record<string, any>
    ): void {
        const exception = this.wrapError(error, context);
        const logData = {
            ...exception.toJSON(),
            level,
            timestamp: new Date().toISOString()
        };
        
        switch (level) {
            case 'error':
                console.error('Exception occurred:', logData);
                break;
            case 'warn':
                console.warn('Exception occurred:', logData);
                break;
            case 'info':
                console.info('Exception occurred:', logData);
                break;
        }
    }
}
