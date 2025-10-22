import { Context, Next } from 'koa';
import _ from 'lodash';
import Exception from '../exceptions/Exception.ts';
import APIException from '../exceptions/APIException.ts';
import ExceptionHandler from '../exceptions/ExceptionHandler.ts';
import ExceptionMonitor from '../exceptions/ExceptionMonitor.ts';
import logger from '../logger.ts';

/**
 * 异常处理中间件
 */
export default function exceptionMiddleware() {
    return async (ctx: Context, next: Next) => {
        const startTime = Date.now();
        
        try {
            await next();
        } catch (error) {
            const duration = Date.now() - startTime;
            
            // 记录请求信息
            const requestInfo = {
                method: ctx.method,
                url: ctx.url,
                userAgent: ctx.get('User-Agent'),
                ip: ctx.ip,
                duration,
                timestamp: new Date().toISOString()
            };
            
            // 处理不同类型的异常
            let exception: Exception;
            
            if (error instanceof Exception || error instanceof APIException) {
                exception = error;
                // 添加请求上下文
                exception.setContext('request', requestInfo);
            } else {
                // 包装为系统异常
                exception = ExceptionHandler.wrapError(error, {
                    request: requestInfo,
                    originalError: error?.name || 'Unknown',
                    originalMessage: error?.message || String(error)
                });
            }
            
            // 记录异常
            ExceptionHandler.logError(exception, 'error', requestInfo);
            
            // 设置响应
            ctx.status = exception.httpStatusCode || 500;
            ctx.body = {
                code: exception.errcode,
                message: exception.errmsg,
                data: exception.data,
                timestamp: exception.timestamp,
                requestId: requestInfo.requestId || ctx.requestId
            };
            
            // 记录到监控系统
            ExceptionMonitor.getInstance().recordException(exception);
            
            // 检查是否需要告警
            if (ExceptionMonitor.getInstance().shouldAlert(exception.errcode)) {
                logger.warn('High frequency error detected:', {
                    errcode: exception.errcode,
                    message: exception.errmsg,
                    request: requestInfo
                });
            }
        }
    };
}

/**
 * 错误边界中间件 - 捕获未处理的异常
 */
export function errorBoundaryMiddleware() {
    return async (ctx: Context, next: Next) => {
        try {
            await next();
        } catch (error) {
            // 记录未捕获的异常
            logger.error('Uncaught exception:', {
                error: error,
                stack: error?.stack,
                request: {
                    method: ctx.method,
                    url: ctx.url,
                    ip: ctx.ip
                }
            });
            
            // 返回通用错误响应
            ctx.status = 500;
            ctx.body = {
                code: -1000,
                message: 'Internal server error',
                timestamp: Date.now()
            };
        }
    };
}

/**
 * 超时处理中间件
 */
export function timeoutMiddleware(timeout: number = 30000) {
    return async (ctx: Context, next: Next) => {
        const timeoutId = setTimeout(() => {
            if (!ctx.res.headersSent) {
                ctx.status = 408;
                ctx.body = {
                    code: -1003,
                    message: 'Request timeout',
                    timestamp: Date.now()
                };
            }
        }, timeout);
        
        try {
            await next();
        } finally {
            clearTimeout(timeoutId);
        }
    };
}
