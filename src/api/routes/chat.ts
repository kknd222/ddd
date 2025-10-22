import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import { createCompletion, createCompletionStream } from '@/api/controllers/chat.ts';
import { createCapcutConversation, createCapcutConversationStream } from '@/api/controllers/capcut.ts';

export default {

    prefix: '/v1/chat',

    post: {

        '/completions': async (request: Request) => {
            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.messages', _.isArray)
                .validate('headers.authorization', _.isString)
            // refresh_token切分
            const tokens = tokenSplit(request.headers.authorization);
            // 随机挑选一个refresh_token
            const token = _.sample(tokens);
            const { model, messages, stream, params } = request.body;
            const useCapcut = (model || '').toLowerCase() === 'agent';
            if (stream) {
                const streamResponse = useCapcut
                    ? await createCapcutConversationStream(messages, token, params)
                    : await createCompletionStream(messages, token, model);
                return new Response(streamResponse, {
                    type: "text/event-stream",
                    headers: {
                        "Content-Type": "text/event-stream; charset=utf-8",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive"
                    }
                });
            } else {
                return useCapcut
                    ? await createCapcutConversation(messages, token, params)
                    : await createCompletion(messages, token, model);
            }
        }

    }

}
