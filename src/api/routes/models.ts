import _ from 'lodash';
import Response from '@/lib/response/Response.ts';
import Request from '@/lib/request/Request.ts';
import { tokenSplit } from '@/api/controllers/core.ts';

export default {

    prefix: '/v1',

    get: {
        '/models': async (request: Request) => {
            // 根据 Authorization 判定区域：CN 使用 suffix ":cn"
            const auth = request?.headers?.authorization as string | undefined;
            const tokens = auth ? tokenSplit(auth) : [];
            const picked = _.sample(tokens) || '';
            const isCN = /:cn$/i.test(picked);

            const COMMON_FIELDS = {
                object: 'model',
                owned_by: 'dreamina-free-api',
            } as const;

            // 国际区模型列表
            const INTL = [
                {
                    id: 'jimeng-3.1',
                    model_name: 'Image 3.1',
                    model_tip: 'Delivers striking visuals with rich, versatile aesthetics.',
                    model_req_key: 'high_aes_general_v30l_art:general_v3.0_18b',
                },
                {
                    id: 'jimeng-3.0',
                    model_name: 'Image 3.0',
                    model_tip: 'Studio quality, precise text generation, native 2K resolution.',
                    model_req_key: 'high_aes_general_v30l:general_v3.0_18b',
                },
                {
                    id: 'jimeng-2.1',
                    model_name: 'Image 2.1',
                    model_tip: 'Great for graphic design. Supports text generation.',
                    model_req_key: 'high_aes_general_v21_L:general_v2.1_L',
                },
                {
                    id: 'jimeng-2.0-pro',
                    model_name: 'Image 2.0 Pro',
                    model_tip: 'Imaginative and creative. Excels at photorealism.',
                    model_req_key: 'high_aes_general_v20_L:general_v2.0_L',
                },
                {
                    id: 'jimeng-1.4',
                    model_name: 'Image 1.4',
                    model_tip: 'Versatile for all styles. Supports natural language prompts.',
                    model_req_key: 'high_aes_v14_dreamina:general_v1.4',
                },
            ].map(m => ({ ...COMMON_FIELDS, ...m }));

            // CN 区域模型列表（对齐到现有格式）
            const CN = [
                {
                    id: 'jimeng-4.0',
                    model_name: '图片 4.0',
                    model_tip: '支持多参考图、系列组图生成',
                    model_req_key: 'high_aes_general_v40',
                },
                {
                    id: 'jimeng-3.1',
                    model_name: '图片 3.1',
                    model_tip: '丰富的美学多样性，画面更鲜明生动',
                    model_req_key: 'high_aes_general_v30l_art_fangzhou:general_v3.0_18b',
                },
                {
                    id: 'jimeng-3.0',
                    model_name: '图片 3.0',
                    model_tip: '影视质感，文字更准，直出2k高清图',
                    model_req_key: 'high_aes_general_v30l:general_v3.0_18b',
                },
                {
                    id: 'jimeng-2.1',
                    model_name: '图片 2.1',
                    model_tip: '平面绘感强，可生成文字海报',
                    model_req_key: 'high_aes_general_v21_L:general_v2.1_L',
                },
                {
                    id: 'jimeng-2.0-pro',
                    model_name: '图片 2.0 Pro',
                    model_tip: '极具想象力，擅长写真摄影',
                    model_req_key: 'high_aes_general_v20_L:general_v2.0_L',
                },
                {
                    id: 'jimeng-2.0',
                    model_name: '图片 2.0',
                    model_tip: '文字遵循高，支持图片参考能力',
                    model_req_key: 'high_aes_general_v20:general_v2.0',
                },
            ].map(m => ({ ...COMMON_FIELDS, ...m }));

            const payload = { data: isCN ? CN : INTL };
            return new Response(payload, {
                headers: {
                    // 缓存 5 分钟，减轻频繁请求带来的 I/O 和日志开销
                    'Cache-Control': 'public, max-age=300'
                }
            });
        }

    }
}
