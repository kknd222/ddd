import _ from 'lodash';

import Body from './Body.ts';
import Exception from '../exceptions/Exception.ts';
import APIException from '../exceptions/APIException.ts';
import EX from '../consts/exceptions.ts';
import HTTP_STATUS_CODES from '../http-status-codes.ts';
import ExceptionMonitor from '../exceptions/ExceptionMonitor.ts';

export default class FailureBody extends Body {
    
    constructor(error: APIException | Exception | Error, _data?: any, requestContext?: any) {
        let errcode, errmsg, data = _data, httpStatusCode = HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
        let errorType = 'Unknown';
        let timestamp = Date.now();
        let context = {};
        
        if(_.isString(error)) {
            error = new Exception(EX.SYSTEM_ERROR, error);
        } else if(error instanceof APIException || error instanceof Exception) {
            ({ errcode, errmsg, data, httpStatusCode } = error);
            errorType = error.type || error.constructor.name;
            timestamp = error.timestamp || Date.now();
            context = error.context || {};
        } else if(_.isError(error)) {
            const exception = new Exception(EX.SYSTEM_ERROR, error.message);
            ({ errcode, errmsg, data, httpStatusCode } = exception);
            errorType = exception.type;
            timestamp = exception.timestamp;
            context = exception.context;
        }
        
        // 添加请求上下文信息
        if (requestContext) {
            context.requestId = requestContext.requestId;
            context.userAgent = requestContext.userAgent;
            context.ip = requestContext.ip;
            context.url = requestContext.url;
            context.method = requestContext.method;
        }
        
        // 若异常未显式设置 HTTP 状态码，则根据错误类型设置
        if (!_.isFinite(httpStatusCode) || Number(httpStatusCode) < 400) {
            if (errcode >= -2000 && errcode < -1000) {
                // 客户端错误
                httpStatusCode = HTTP_STATUS_CODES.BAD_REQUEST;
            } else if (errcode === -2002) {
                // Token失效
                httpStatusCode = HTTP_STATUS_CODES.UNAUTHORIZED;
            } else if (errcode === -2009) {
                // 积分不足
                httpStatusCode = HTTP_STATUS_CODES.PAYMENT_REQUIRED;
            } else {
                httpStatusCode = HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
            }
        }
        
        super({
            code: errcode || -1,
            message: errmsg || 'Internal error',
            data,
            statusCode: httpStatusCode,
            type: errorType,
            timestamp,
            context
        });

        // 记录异常到监控系统
        if (error instanceof Exception || error instanceof APIException) {
            ExceptionMonitor.getInstance().recordException(error);
        }
    }

    static isInstance(value) {
        return value instanceof FailureBody;
    }

}
