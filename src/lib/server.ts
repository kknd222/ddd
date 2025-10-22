import Koa from 'koa';
import KoaRouter from 'koa-router';
import koaRange from 'koa-range';
import koaCors from "koa2-cors";
import koaBody from 'koa-body';
import _ from 'lodash';

import Exception from './exceptions/Exception.ts';
import Request from './request/Request.ts';
import Response from './response/Response.js';
import FailureBody from './response/FailureBody.ts';
import EX from './consts/exceptions.ts';
import logger from './logger.ts';
import config from './config.ts';
import util from './util.ts';

class Server {

    app;
    router;
    
    constructor() {
        this.app = new Koa();
        this.app.use(koaCors());
        // 范围请求支持
        this.app.use(koaRange);
        this.router = new KoaRouter({ prefix: config.service.urlPrefix });
        // 前置处理异常拦截
        this.app.use(async (ctx: any, next: Function) => {
            if(ctx.request.type === "application/xml" || ctx.request.type === "application/ssml+xml")
                ctx.req.headers["content-type"] = "text/xml";
            
            // 添加请求上下文
            const requestContext = {
                requestId: ctx.requestId || util.uuid(),
                userAgent: ctx.get('User-Agent'),
                ip: ctx.ip,
                url: ctx.url,
                method: ctx.method
            };
            ctx.requestContext = requestContext;
            
            try { 
                await next() 
            }
            catch (err) {
                // 记录详细的异常信息
                logger.error('Request failed:', {
                    error: err,
                    request: requestContext,
                    stack: err?.stack
                });
                
                const failureBody = new FailureBody(err, null, requestContext);
                new Response(failureBody).injectTo(ctx);
            }
        });
        // 载荷解析器支持
        this.app.use(koaBody(_.clone(config.system.requestBody)));
        this.app.on("error", (err: any) => {
            // 忽略连接重试、中断、管道、取消错误
            if (["ECONNRESET", "ECONNABORTED", "EPIPE", "ECANCELED"].includes(err.code)) return;
            logger.error(err);
        });
        logger.success("Server initialized");
    }

    /**
     * 附加路由
     * 
     * @param routes 路由列表
     */
    attachRoutes(routes: any[]) {
        routes.forEach((route: any) => {
            const prefix = route.prefix || "";
            for (let method in route) {
                if(method === "prefix") continue;
                if (!_.isObject(route[method])) {
                    logger.warn(`Router ${prefix} ${method} invalid`);
                    continue;
                }
                for (let uri in route[method]) {
                    this.router[method](`${prefix}${uri}`, async ctx => {
                        const { request, response } = await this.#requestProcessing(ctx, route[method][uri]);
                        if(response != null && config.system.requestLog)
                            logger.info(`<- ${request.method} ${request.url} ${response.time - request.time}ms`);
                    });
                }
            }
            logger.info(`Route ${config.service.urlPrefix || ""}${prefix} attached`);
        });
        this.app.use(this.router.routes());
        this.app.use((ctx: any) => {
            const request = new Request(ctx);
            logger.debug(`-> ${ctx.request.method} ${ctx.request.url} request is not supported - ${request.remoteIP || "unknown"}`);
            // const failureBody = new FailureBody(new Exception(EX.SYSTEM_NOT_ROUTE_MATCHING, "Request is not supported"));
            // const response = new Response(failureBody);
            const message = `[请求有误]: 正确请求为 POST -> /v1/chat/completions，当前请求为 ${ctx.request.method} -> ${ctx.request.url} 请纠正`;
            logger.warn(message);
            const failureBody = new FailureBody(new Error(message));
            const response = new Response(failureBody);
            response.injectTo(ctx);
            if(config.system.requestLog)
                logger.info(`<- ${request.method} ${request.url} ${response.time - request.time}ms`);
        });
    }

    /**
     * 请求处理
     * 
     * @param ctx 上下文
     * @param routeFn 路由方法
     */
    #requestProcessing(ctx: any, routeFn: Function): Promise<any> {
        return new Promise(resolve => {
            const request = new Request(ctx);
            const requestContext = ctx.requestContext || {};
            
            try {
                if(config.system.requestLog)
                    logger.info(`-> ${request.method} ${request.url}`, { requestId: requestContext.requestId });
                    
                routeFn(request)
                .then(response => {
                    try {
                        if(!Response.isInstance(response)) {
                            const _response = new Response(response);
                            _response.injectTo(ctx);
                            return resolve({ request, response: _response });
                        }
                        response.injectTo(ctx);
                        resolve({ request, response });
                    }
                    catch(err) {
                        this.#handleRequestError(err, ctx, request, requestContext, resolve);
                    }
                })
                .catch(err => {
                    this.#handleRequestError(err, ctx, request, requestContext, resolve);
                });
            }
            catch(err) {
                this.#handleRequestError(err, ctx, request, requestContext, resolve);
            }
        });
    }

    /**
     * 处理请求错误
     */
    #handleRequestError(
        err: any, 
        ctx: any, 
        request: any, 
        requestContext: any, 
        resolve: Function
    ): void {
        try {
            // 记录详细的错误信息
            logger.error('Request processing failed:', {
                error: err,
                request: requestContext,
                stack: err?.stack,
                url: request?.url,
                method: request?.method
            });
            
            const failureBody = new FailureBody(err, null, requestContext);
            const response = new Response(failureBody);
            response.injectTo(ctx);
            resolve({ request, response });
        }
        catch(handlerErr) {
            // 如果错误处理器本身出错，记录并返回通用错误
            logger.error('Error handler failed:', {
                originalError: err,
                handlerError: handlerErr,
                request: requestContext
            });
            
            const fallbackError = new Exception(EX.SYSTEM_ERROR, 'Internal server error', requestContext);
            const failureBody = new FailureBody(fallbackError, null, requestContext);
            const response = new Response(failureBody);
            response.injectTo(ctx);
            resolve({ request, response });
        }
    }

    /**
     * 监听端口
     */
    async listen() {
        const host = config.service.host;
        const port = config.service.port;
        await Promise.all([
            new Promise((resolve, reject) => {
                if(host === "0.0.0.0" || host === "localhost" || host === "127.0.0.1")
                    return resolve(null);
                this.app.listen(port, "localhost", err => {
                    if(err) return reject(err);
                    resolve(null);
                });
            }),
            new Promise((resolve, reject) => {
                this.app.listen(port, host, err => {
                    if(err) return reject(err);
                    resolve(null);
                });
            })
        ]);
        logger.success(`Server listening on port ${port} (${host})`);
    }

}

export default new Server();