import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { createCompletion, createCompletionStream } from '@/api/controllers/chat.ts';

export default {

    prefix: '/v1/chat',

    post: {

        '/completions': async (request: Request) => {
            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.messages', _.isArray)
                .validate('headers.authorization', _.isString)
            // 直接使用token，不再切分，以支持完整的Cookie字符串
            const token = request.headers.authorization.replace("Bearer ", "");
            const { model, messages, stream } = request.body;
            if (stream) {
                const stream = await createCompletionStream(messages, token, model);
                return new Response(stream, {
                    type: "text/event-stream"
                });
            }
            else
                return await createCompletion(messages, token, model);
        }

    }

}