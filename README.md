# Dreamina AI Free 服务
支持即梦超强图像生成能力，零配置部署，多路 token 支持。

与 OpenAI 接口完全兼容。

## 🚀 最新优化（v0.2.0）

**v0.2.0 - Agent 功能增强：**
- ✅ **智能 Agent 自动轮询** - Agent 工具调用后自动轮询生成结果
- ✅ **Markdown 格式返回** - 自动将图片/视频转换为 Markdown
- ✅ **一句话多图生成** - "画三张哈士奇 16:9" → 自动生成3张并返回
- ✅ **OpenAI 完全兼容** - 保持 OpenAI API 格式，内部处理 Agent 工具调用

查看 [AGENT_README.md](./AGENT_README.md) 了解 Agent 完整功能。

**v0.1.0 - 核心性能优化：**
- ✅ **智能轮询机制** - 性能提升 30-50%，自适应轮询间隔
- ✅ **真流式响应** - 响应延迟降低 99.7%（从 30-300秒 → <100ms）
- ✅ **实时进度反馈** - 用户体验显著改善，立即响应+异步生成
- ✅ **详细日志输出** - emoji 友好的结构化日志

查看 [OPTIMIZATION.md](./OPTIMIZATION.md) 了解详细优化说明。

## 目录

- [Dreamina AI Free 服务](#jimeng-ai-free-服务)
  - [目录](#目录)
  - [免责声明](#免责声明)
  - [接入准备](#接入准备)
    - [多账号接入](#多账号接入)
  - [效果展示](#效果展示)
  - [Docker 部署](#docker-部署)
    - [Docker-compose 部署](#docker-compose-部署)
    - [Render 部署](#render-部署)
    - [Vercel 部署](#vercel-部署)
  - [原生部署](#原生部署)
  - [推荐使用客户端](#推荐使用客户端)
 - [接口列表](#接口列表)
    - [图像生成](#图像生成)
    - [CapCut 会话代理](#capcut-会话代理)
  - [Star History](#star-history)

## 免责声明

**逆向 API 是不稳定的，建议前往即梦 AI 官方 https://jimeng.jianying.com/ 体验功能，避免封禁的风险。**

**本组织和个人不接受任何资金捐助和交易，此项目是纯粹研究交流学习性质！**

**仅限自用，禁止对外提供服务或商用，避免对官方造成服务压力，否则风险自担！**

**仅限自用，禁止对外提供服务或商用，避免对官方造成服务压力，否则风险自担！**

**仅限自用，禁止对外提供服务或商用，避免对官方造成服务压力，否则风险自担！**

## 接入准备

从 [即梦](https://jimeng.jianying.com/) 获取 sessionid

如使用国际版：从 [即梦国际版](https://dreamina.capcut.com/) 获取 `sessionid`，同样在浏览器开发者工具的 Application > Cookies 中查看；国际区通常无需追加区域后缀，直接使用即可：

```
Authorization: Bearer sessionid
```

进入即梦登录账号，然后 F12 打开开发者工具，从 Application > Cookies 中找到`sessionid`的值，这将作为 Authorization 的 Bearer Token 值：`Authorization: Bearer sessionid`

中国大陆（CN）区域账号/网络请在 token 末尾追加区域后缀以走 CN 域：

```
Authorization: Bearer sessionid:cn
```

![example0](./doc/example-0.png)

### 多账号接入

你可以通过提供多个账号的 sessionid 并使用`,`拼接提供：

`Authorization: Bearer sessionid1,sessionid2,sessionid3`

如涉及不同区域，可单独为某个账号追加区域后缀，例如：

`Authorization: Bearer sessionid_cn:cn,sessionid_us`

每次请求服务会从中挑选一个。

## 效果展示

```text
可爱的熊猫漫画，熊猫看到地上有一个叫“即梦”的时间机器，然后说了一句“我借用一下没事吧”
```

![example1](./doc/example-1.jpeg)

## Docker 部署

```shell
docker build -t dreamina-free-api:local .
docker run -it -d --init --name dreamina-free-api -p 8000:8000 -e TZ=Asia/Shanghai dreamina-free-api:local
```

查看服务实时日志

```shell
docker logs -f dreamina-free-api
```

重启服务

```shell
docker restart dreamina-free-api
```

停止服务

```shell
docker stop dreamina-free-api
```

### Docker-compose 部署（本地构建）

```yaml
version: "3"

services:
  dreamina-free-api:
    container_name: dreamina-free-api
    # 本地源码构建镜像
    build:
      context: .
      dockerfile: Dockerfile
    restart: always
    ports:
      - "8000:8000"
    environment:
      - TZ=Asia/Shanghai
```

使用仓库根目录已提供的 `docker-compose.yml` 快速启动：

```bash
docker compose up -d
```

（提示）本项目无远程镜像，Compose 方案默认从本地源码构建镜像。

### 本地手动构建镜像

```bash
docker build -t dreamina-free-api:local .
docker run -it -d --init --name dreamina-free-api -p 8000:8000 -e TZ=Asia/Shanghai dreamina-free-api:local
```

### Render 部署

**注意：部分部署区域可能无法连接即梦，如容器日志出现请求超时或无法连接，请切换其他区域部署！**
**注意：免费账户的容器实例将在一段时间不活动时自动停止运行，这会导致下次请求时遇到 50 秒或更长的延迟，建议查看[Render 容器保活](https://github.com/LLM-Red-Team/free-api-hub/#Render%E5%AE%B9%E5%99%A8%E4%BF%9D%E6%B4%BB)**

1. fork 本项目到你的 github 账号下。

2. 访问 [Render](https://dashboard.render.com/) 并登录你的 github 账号。

3. 构建你的 Web Service（New+ -> Build and deploy from a Git repository -> Connect 你 fork 的项目 -> 选择部署区域 -> 选择实例类型为 Free -> Create Web Service）。

4. 等待构建完成后，复制分配的域名并拼接 URL 访问即可。

### Vercel 部署

**注意：Vercel 免费账户的请求响应超时时间为 10 秒，但接口响应通常较久，可能会遇到 Vercel 返回的 504 超时错误！**

请先确保安装了 Node.js 环境。

```shell
npm i -g vercel --registry http://registry.npmmirror.com
vercel login
git clone https://github.com/LLM-Red-Team/dreamina-free-api
cd dreamina-free-api
vercel --prod
```

## 原生部署

请准备一台具有公网 IP 的服务器（外网）并将 8000 端口开放。

请先安装好 Node.js 环境并且配置好环境变量，确认 node 命令可用。

安装依赖

```shell
npm i
```

安装 PM2 进行进程守护

```shell
npm i -g pm2
```

编译构建，看到 dist 目录就是构建完成

```shell
npm run build
```

启动服务

```shell
pm2 start dist/index.js --name "dreamina-free-api"
```

查看服务实时日志

```shell
pm2 logs dreamina-free-api
```

重启服务

```shell
pm2 reload dreamina-free-api
```

停止服务

```shell
pm2 stop dreamina-free-api
```

## 接口列表

目前支持与 OpenAI 兼容的 `/v1/chat/completions` 接口，可自行使用与 OpenAI 或其他兼容的客户端接入接口，或者使用 [dify](https://dify.ai/) 等线上服务接入使用。

### 对话接口（图像生成）

**POST /v1/chat/completions**

header 需要设置 Authorization 头部：

```
Authorization: Bearer [sessionid]
```

**完整请求示例（图像生成）：**

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng-4.0",
    "messages": [
      {
        "role": "user",
        "content": "少女祈祷中... -re 4k -ra 16:9"
      }
    ],
    "stream": false
  }'
```

**完整响应示例：**

```json
{
  "id": "chatcmpl-b400abe0-b4c3-11ef-b2eb-4175f5393bfd",
  "model": "jimeng-4.0",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![image_0](https://p9-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/61bceb3afeb54c1c80ffdd598ac2f72d~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=DUY6jlx4zAXRYJeATyjZ3O6F1Pw%3D&format=.jpeg)\n![image_1](https://p3-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/e37ab3cd95854cd7b37fb697ea2cb4da~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=oKtY400tjZeydKMyPZufjt0Qpjs%3D&format=.jpeg)\n![image_2](https://p9-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/13841ff1c30940cf931eccc22405656b~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=4UffSRMmOeYoC0u%2B5igl9S%2BfYKs%3D&format=.jpeg)\n![image_3](https://p6-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/731c350244b745d5990e8931b79b7fe7~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=ywYjZQeP3t2yyvx6Wlud%2BCB28nU%3D&format=.jpeg)\n"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1,
    "completion_tokens": 1,
    "total_tokens": 2
  },
  "created": 1733593810
}
```

**支持的图像模型：**
- `jimeng-4.0`（默认，推荐）
- `jimeng-3.1` / `jimeng-3.0` / `jimeng-2.1` / `jimeng-2.0-pro` / `jimeng-2.0` / `jimeng-1.4`
- `jimeng-xl-pro`
- `jimeng-nano-banana`（快速生成，固定 1024x1024）

### 对话接口（视频生成）

**POST /v1/chat/completions**

**完整请求示例（视频生成）：**

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng-video-3.0-pro",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "跑起来 -ra 16:9 -d 5"},
          {"type": "image_url", "image_url": {"url": "https://example.com/first_frame.jpg"}}
        ]
      }
    ],
    "stream": false
  }'
```

**完整响应示例：**

```json
{
  "id": "chatcmpl-c500def1-c5d4-22fg-c3fc-5286g6404cgf",
  "model": "jimeng-video-3.0-pro",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "<video controls=\"controls\" width=\"100%\">\n  <source src=\"https://v16-webapp-prime.us.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c003/oQdABfIeNzEgCIBnQgmDEAIgfQnEeB/?a=1988&ch=0&cr=3&dr=0&lr=unwatermarked&cd=0%7C0%7C0%7C3&cv=1&br=1234&bt=617&bti=OTg3MzQzNDU&cs=0&ds=6&ft=iqa.yH-I_Myq8Zmo~R3wKMeuxKsd&mime_type=video_mp4&qs=0&rc=aGc4ZTw6Zzg8OjY4ZDw4OUBpM3RqbGc6ZnJ1cjMzZzczNEBeYzMuYC4yXy8xYC0xYTUvYSNqcWxvcjRnMGRgLS1kMS9zcw%3D%3D&l=20231207123456789012345678901234567890\" type=\"video/mp4\">\n</video>\n\n[Download Video](https://v16-webapp-prime.us.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c003/oQdABfIeNzEgCIBnQgmDEAIgfQnEeB/?a=1988&ch=0&cr=3&dr=0&lr=unwatermarked&cd=0%7C0%7C0%7C3&cv=1&br=1234&bt=617&bti=OTg3MzQzNDU&cs=0&ds=6&ft=iqa.yH-I_Myq8Zmo~R3wKMeuxKsd&mime_type=video_mp4&qs=0&rc=aGc4ZTw6Zzg8OjY4ZDw4OUBpM3RqbGc6ZnJ1cjMzZzczNEBeYzMuYC4yXy8xYC0xYTUvYSNqcWxvcjRnMGRgLS1kMS9zcw%3D%3D&l=20231207123456789012345678901234567890)\n"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1,
    "completion_tokens": 1,
    "total_tokens": 2
  },
  "created": 1733593810
}
```

**支持的视频模型：**
- `jimeng-video-3.0`（默认）
- `jimeng-video-3.0-pro`（专业版，质量更高）

**提示词参数说明：**
- 图像生成支持：
  - `-re <resolution>`: 分辨率，支持 `1k`, `2k`（默认）, `4k`
  - `-ra <ratio>`: 宽高比，支持 `1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `3:2`, `2:3`, `21:9`
- 视频生成支持：
  - `-ra <ratio>`: 宽高比，支持 `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
  - `-d <seconds>`: 时长（秒），支持 `5`（默认）或 `10`

### 图像生成

图像生成接口，与 openai 的 [images-create-api](https://platform.openai.com/docs/api-reference/images/create) 兼容；同时 `/v1/chat/completions` 亦可直接生成图片并返回 Markdown 图片链接。

**POST /v1/images/generations**

header 需要设置 Authorization 头部：

```
Authorization: Bearer [sessionid]
```

**完整请求示例：**

```bash
curl -X POST http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng-4.0",
    "prompt": "少女祈祷中... -re 4k -ra 16:9",
    "negative_prompt": "",
    "sample_strength": 0.5,
    "response_format": "url"
  }'
```

**完整响应示例：**

```json
{
  "created": 1733593810,
  "data": [
    {
      "url": "https://p9-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/61bceb3afeb54c1c80ffdd598ac2f72d~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=DUY6jlx4zAXRYJeATyjZ3O6F1Pw%3D&format=.jpeg"
    },
    {
      "url": "https://p3-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/e37ab3cd95854cd7b37fb697ea2cb4da~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=oKtY400tjZeydKMyPZufjt0Qpjs%3D&format=.jpeg"
    },
    {
      "url": "https://p9-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/13841ff1c30940cf931eccc22405656b~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=4UffSRMmOeYoC0u%2B5igl9S%2BfYKs%3D&format=.jpeg"
    },
    {
      "url": "https://p6-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/731c350244b745d5990e8931b79b7fe7~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=ywYjZQeP3t2yyvx6Wlud%2BCB28nU%3D&format=.jpeg"
    }
  ]
}
```

**参数说明：**

- `model`: 图像模型，支持：
  - `jimeng-4.0`（默认，推荐）
  - `jimeng-3.1` / `jimeng-3.0` / `jimeng-2.1` / `jimeng-2.0-pro` / `jimeng-2.0` / `jimeng-1.4`
  - `jimeng-xl-pro`
  - `jimeng-nano-banana`（快速生成，固定 1024x1024）
- `prompt`: 提示词，支持内嵌参数（忽略大小写）：
  - `-re <resolution>`: 分辨率，支持 `1k`, `2k`（默认）, `4k`
  - `-ra <ratio>`: 宽高比，支持 `1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `3:2`, `2:3`, `21:9`
  - 示例：`"少女祈祷中... -re 4k -ra 16:9"` 会自动解析参数
- `negative_prompt`: 负向提示词（可选）
- `resolution`: 分辨率（可选，如果 prompt 中有 `-re` 参数则优先使用 prompt 中的）
- `ratio`: 宽高比（可选，如果 prompt 中有 `-ra` 参数则优先使用 prompt 中的）
- `width` / `height`: 自定义宽高（可选，优先级低于 resolution + ratio）
- `sample_strength`: 采样强度，范围 0-1，默认 0.5
- `image`: 参考图片 URL 或 Base64（可选，仅 jimeng-3.0 和 jimeng-4.0 支持）
- `response_format`: 响应格式，`url` 或 `b64_json`

### 视频生成

视频生成接口，支持文生视频、图生视频、首尾帧视频三种模式。

**POST /v1/videos/generations**

header 需要设置 Authorization 头部：

```
Authorization: Bearer [sessionid]
```

**完整请求示例（首尾帧视频）：**

```bash
curl -X POST http://localhost:8000/v1/videos/generations \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng-video-3.0-pro",
    "prompt": "跑起来 -ra 16:9 -d 5",
    "images": [
      "https://example.com/first_frame.jpg",
      "https://example.com/end_frame.jpg"
    ],
    "response_format": "url"
  }'
```

**完整响应示例：**

```json
{
  "created": 1733593810,
  "data": [
    {
      "url": "https://v16-webapp-prime.us.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c003/oQdABfIeNzEgCIBnQgmDEAIgfQnEeB/?a=1988&ch=0&cr=3&dr=0&lr=unwatermarked&cd=0%7C0%7C0%7C3&cv=1&br=1234&bt=617&bti=OTg3MzQzNDU&cs=0&ds=6&ft=iqa.yH-I_Myq8Zmo~R3wKMeuxKsd&mime_type=video_mp4&qs=0&rc=aGc4ZTw6Zzg8OjY4ZDw4OUBpM3RqbGc6ZnJ1cjMzZzczNEBeYzMuYC4yXy8xYC0xYTUvYSNqcWxvcjRnMGRgLS1kMS9zcw%3D%3D&l=20231207123456789012345678901234567890"
    }
  ]
}
```

**参数说明：**

- `model`: 视频模型，支持：
  - `jimeng-video-3.0`（默认）
  - `jimeng-video-3.0-pro`（专业版，质量更高）
- `prompt`: 提示词，支持内嵌参数（忽略大小写）：
  - `-ra <ratio>`: 宽高比，支持 `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
  - `-d <seconds>`: 时长（秒），支持 `5`（默认）或 `10`
  - 示例：`"跑起来 -ra 16:9 -d 5"` 会自动解析参数
- `images`: 图片数组（可选），支持自动模式检测：
  - 0 张图片：文生视频模式（纯文本生成）
  - 1 张图片：图生视频模式（从首帧图片生成）
  - 2 张图片：首尾帧视频模式（从首帧和尾帧生成中间过渡）
- `first_frame_image`: 首帧图片 URL 或 Base64（可选，兼容旧参数）
- `end_frame_image`: 尾帧图片 URL 或 Base64（可选，兼容旧参数）
- `aspect_ratio`: 宽高比（可选，如果 prompt 中有 `-ra` 参数则优先使用 prompt 中的）
- `duration`: 时长（秒），可选，默认 5
- `fps`: 帧率，可选，默认 24
- `response_format`: 响应格式，`url` 或 `b64_json`

### CapCut 会话代理（模型名：agent）

通过 OpenAI 兼容的 `/v1/chat/completions` 代理 CapCut 会话 SSE，返回 OpenAI 风格的 `chat.completion` 或流式 `chat.completion.chunk`。

请求示例（流式）：

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H 'Authorization: Bearer <sessionid>' \
  -H 'Content-Type: application/json' \
  -N \
  -d '{
    "model": "agent",
    "stream": true,
    "messages": [
      {"role":"user","content":"讲个20字的笑话"}
    ]
  }'
```

说明：
- 当 `model` 为 `agent` 时，服务将调用 CapCut `/mweb/v1/creation_agent/v2/conversation` 并把 SSE 转换为 OpenAI 风格事件。
- 其余 `model` 使用内置即梦图像生成逻辑。

响应数据：

```json
{
  "created": 1733593745,
  "data": [
    {
      "url": "https://p9-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/61bceb3afeb54c1c80ffdd598ac2f72d~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=DUY6jlx4zAXRYJeATyjZ3O6F1Pw%3D&format=.jpeg"
    },
    {
      "url": "https://p3-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/e37ab3cd95854cd7b37fb697ea2cb4da~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=oKtY400tjZeydKMyPZufjt0Qpjs%3D&format=.jpeg"
    },
    {
      "url": "https://p9-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/13841ff1c30940cf931eccc22405656b~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=4UffSRMmOeYoC0u%2B5igl9S%2BfYKs%3D&format=.jpeg"
    },
    {
      "url": "https://p6-heycan-hgt-sign.byteimg.com/tos-cn-i-3jr8j4ixpe/731c350244b745d5990e8931b79b7fe7~tplv-3jr8j4ixpe-aigc_resize:0:0.jpeg?lk3s=43402efa&x-expires=1735344000&x-signature=ywYjZQeP3t2yyvx6Wlud%2BCB28nU%3D&format=.jpeg"
    }
  ]
}
```
