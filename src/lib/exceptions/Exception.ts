import assert from 'assert';

import _ from 'lodash';

export default class Exception extends Error {

    /** 错误码 */
    errcode: number;
    /** 错误消息 */
    errmsg: string;
    /** 数据 */
    data: any;
    /** HTTP状态码 */
    httpStatusCode: number;
    /** 错误类型 */
    type: string;
    /** 时间戳 */
    timestamp: number;
    /** 堆栈信息 */
    stackTrace: string;
    /** 上下文信息 */
    context: Record<string, any>;

    /**
     * 构造异常
     * 
     * @param exception 异常
     * @param _errmsg 异常消息
     * @param context 上下文信息
     */
    constructor(exception: (string | number)[], _errmsg?: string, context?: Record<string, any>) {
        assert(_.isArray(exception), 'Exception must be Array');
        const [errcode, errmsg] = exception as [number, string];
        assert(_.isFinite(errcode), 'Exception errcode invalid');
        assert(_.isString(errmsg), 'Exception errmsg invalid');
        super(_errmsg || errmsg);
        
        this.errcode = errcode;
        this.errmsg = _errmsg || errmsg;
        this.type = this.constructor.name;
        this.timestamp = Date.now();
        this.stackTrace = this.stack || '';
        this.context = context || {};
        
        // 确保堆栈信息正确
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    compare(exception: (string | number)[]) {
        const [errcode] = exception as [number, string];
        return this.errcode == errcode;
    }

    setHTTPStatusCode(value: number) {
        this.httpStatusCode = value;
        return this;
    }

    setData(value: any) {
        this.data = _.defaultTo(value, null);
        return this;
    }

    setContext(key: string, value: any) {
        this.context[key] = value;
        return this;
    }

    getContext(key?: string) {
        return key ? this.context[key] : this.context;
    }

    /**
     * 序列化为JSON格式
     */
    toJSON() {
        return {
            errcode: this.errcode,
            errmsg: this.errmsg,
            type: this.type,
            timestamp: this.timestamp,
            data: this.data,
            httpStatusCode: this.httpStatusCode,
            context: this.context,
            stack: this.stackTrace
        };
    }

    /**
     * 是否为可重试的异常
     */
    isRetryable(): boolean {
        const retryableCodes = [-2001, -2007, -2008]; // 请求失败、图像生成失败、视频生成失败
        return retryableCodes.includes(this.errcode);
    }

    /**
     * 是否为客户端错误
     */
    isClientError(): boolean {
        return this.errcode >= -2000 && this.errcode < -1000;
    }

    /**
     * 是否为系统错误
     */
    isSystemError(): boolean {
        return this.errcode >= -1000;
    }

}