# Dreamina AI Free 服务
支持即梦超强图像生成能力，零配置部署，多路 token 支持。

与 OpenAI 接口完全兼容。

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

目前支持与 openai 兼容的 `/v1/chat/completions` 接口，可自行使用与 openai 或其他兼容的客户端接入接口，或者使用 [dify](https://dify.ai/) 等线上服务接入使用。该接口已内置图像生成和视频生成：发送文本（可选携带首个 `image_url`）后，返回内容为包含多张图片链接或视频链接的 Markdown 文本。

**POST /v1/chat/completions**

header 需要设置 Authorization 头部：

```
Authorization: Bearer [sessionid]
```

请求数据（图像生成）：

```json
{
  // jimeng-3.0（默认） / jimeng-2.1 / jimeng-2.0-pro / jimeng-2.0 / jimeng-1.4 / jimeng-xl-pro
  "model": "jimeng-3.0",
  "messages": [
    {
      "role": "user",
      "content": "少女祈祷中..."
    }
  ],
  // 如果使用SSE流请设置为true，默认false
  "stream": false
}
```

请求数据（视频生成）：

```json
{
  // jimeng-video-3.0
  "model": "jimeng-video-3.0",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "跑起来 -ar 16:9 -d 5"},
        {"type": "image_url", "image_url": {"url": "https://example.com/first_frame.jpg"}}
      ]
    }
  ],
  "stream": false
}
```

响应数据（`message.content` 为 Markdown 图片列表或视频 HTML）：

**图像生成响应：**
```json
{
  "id": "b400abe0-b4c3-11ef-b2eb-4175f5393bfd",
  "model": "jimeng-3.0",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![image_0](https://.../image0.jpeg)\n![image_1](https://.../image1.jpeg)\n![image_2](https://.../image2.jpeg)\n![image_3](https://.../image3.jpeg)\n"
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

**视频生成响应：**
```json
{
  "id": "b400abe0-b4c3-11ef-b2eb-4175f5393bfd",
  "model": "jimeng-video-3.0",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "<video controls=\"controls\">\n    https://.../video.mp4\n</video>\n\n[Download Video](https://.../video.mp4)\n\n"
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

### 图像生成

图像生成接口，与 openai 的 [images-create-api](https://platform.openai.com/docs/api-reference/images/create) 兼容；同时 `/v1/chat/completions` 亦可直接生成图片并返回 Markdown 图片链接。

**POST /v1/images/generations**

header 需要设置 Authorization 头部：

```
Authorization: Bearer [sessionid]
```

请求数据（默认返回 URL，如需 Base64 请设置 `response_format: "b64_json"`）：

```json
{
  "model": "jimeng-3.0",
  "prompt": "少女祈祷中...",
  "negative_prompt": "",
  "width": 1024,
  "height": 1024,
  "sample_strength": 0.5,
  "image": "https://example.com/ref.jpg",
  "response_format": "url"
}
```

### 视频生成

视频生成接口，支持从首帧图片生成视频。

**POST /v1/videos/generations**

header 需要设置 Authorization 头部：

```
Authorization: Bearer [sessionid]
```

请求数据：

```json
{
  "model": "jimeng-video-3.0",
  "prompt": "跑起来 -ar 16:9 -d 5",
  "first_frame_image": "https://example.com/first_frame.jpg",
  "aspect_ratio": "16:9",
  "duration": 5,
  "fps": 24,
  "response_format": "url"
}
```

参数说明：
- `model`: 视频模型，目前支持 `jimeng-video-3.0`
- `prompt`: 提示词，支持内嵌参数：
  - `-ar <ratio>`: 宽高比，支持 `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`
  - `-d <seconds>`: 时长（秒），支持 `5` 或 `10`
  - 示例：`"跑起来 -ar 16:9 -d 5"` 会自动解析参数
- `first_frame_image`: 首帧图片 URL 或 Base64（必需）
- `aspect_ratio`: 宽高比（可选，如果 prompt 中有 `-ar` 参数则优先使用 prompt 中的）
- `duration`: 时长（秒），可选，默认 5
- `fps`: 帧率，可选，默认 24
- `response_format`: 响应格式，`url` 或 `b64_json`

响应数据：

```json
{
  "created": 1733593810,
  "data": [
    {
      "url": "https://.../video.mp4"
    }
  ]
}
```

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
