import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { createCompletion, createCompletionStream, AuthContext } from '@/api/controllers/chat.ts';
import logger from '@/lib/logger.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from "@/api/consts/exceptions.ts";

export default {

    prefix: '/v1/chat',

    post: {

        '/completions': async (request: Request) => {
            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.messages', _.isArray)
                .validate('headers.authorization', _.isString)

            let auth: AuthContext;
            try {
                // 新的认证方式：Bearer token是一个包含cookie, sign, device_time的JSON字符串
                const rawAuth = request.headers.authorization.replace("Bearer ", "");
                auth = JSON.parse(rawAuth);
                if (!auth.cookie || !auth.sign || !auth.device_time) {
                    throw new Error("认证信息不完整，必须包含 cookie, sign, 和 device_time。");
                }
            } catch (e) {
                throw new APIException(EX.API_AUTH_INVALID, "无效的Authorization Header格式。请提供一个包含cookie, sign, 和 device_time的JSON字符串。");
            }

            const { model, messages, stream } = request.body;
            if (stream) {
                const stream = await createCompletionStream(messages, auth, model);
                return new Response(stream, {
                    type: "text/event-stream"
                });
            }
            else
                return await createCompletion(messages, auth, model);
        }

    }

}