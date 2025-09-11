# 第一阶段：构建阶段
FROM node:lts AS build-stage

# 设置工作目录
WORKDIR /app

# 复制依赖文件（优化缓存层）
COPY package*.json ./

# 安装所有依赖（包含开发依赖，用于构建）
RUN npm ci --registry https://registry.npmmirror.com/ --ignore-engines

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 第二阶段：生产依赖安装
FROM node:lts-alpine AS deps-stage

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 仅安装生产依赖
RUN npm ci --registry https://registry.npmmirror.com/ --ignore-engines --only=production && \
    npm cache clean --force

# 第三阶段：运行时镜像
FROM node:lts-alpine AS runtime

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 设置工作目录
WORKDIR /app

# 复制生产依赖
COPY --from=deps-stage --chown=nodejs:nodejs /app/node_modules ./node_modules

# 复制构建产物和配置文件
COPY --from=build-stage --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build-stage --chown=nodejs:nodejs /app/package.json ./package.json
COPY --from=build-stage --chown=nodejs:nodejs /app/configs ./configs
COPY --from=build-stage --chown=nodejs:nodejs /app/public ./public

# 修复权限问题：将 /app 目录的所有权赋予 nodejs 用户
# 这样应用在运行时就有权限创建 logs 等子目录
RUN chown -R nodejs:nodejs /app

# 切换到非root用户
USER nodejs

# 暴露端口
EXPOSE 8000

# 添加健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# 启动应用
CMD ["npm", "start"]