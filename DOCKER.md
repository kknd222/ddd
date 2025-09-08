# Docker 部署指南

本项目提供了多种Docker部署方式，适用于不同的使用场景。

## 快速开始

### 1. 基础部署（推荐新手）

```bash
# 使用简化配置快速启动
docker-compose -f docker-compose.simple.yml up -d

# 查看日志
docker-compose -f docker-compose.simple.yml logs -f
```

### 2. 标准部署

```bash
# 构建并启动
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 3. 使用 Makefile（推荐）

```bash
# 查看所有可用命令
make help

# 生产环境
make build    # 构建镜像
make up       # 启动服务
make logs     # 查看日志
make down     # 停止服务

# 开发环境
make build-dev  # 构建开发镜像
make up-dev     # 启动开发环境
make logs-dev   # 查看开发日志
make down-dev   # 停止开发环境
```

## 部署环境

### 开发环境

开发环境支持代码热重载，适合本地开发：

```bash
# 启动开发环境
docker-compose -f docker-compose.dev.yml up -d

# 或使用 Makefile
make up-dev
```

特性：
- 支持代码热重载
- 挂载源代码目录
- 使用 `npm run dev` 启动
- 实时代码变更监控

### 生产环境

生产环境包含完整的优化和安全配置：

```bash
# 启动生产环境
docker-compose -f docker-compose.prod.yml up -d

# 或使用 Makefile
make up
```

特性：
- 多阶段构建优化镜像大小
- 非root用户运行
- 健康检查
- 资源限制
- Nginx反向代理（可选）
- 日志轮转

## Dockerfile 优化特性

### 多阶段构建

1. **构建阶段** (`build-stage`): 安装所有依赖并构建应用
2. **依赖阶段** (`deps-stage`): 仅安装生产依赖
3. **运行阶段** (`runtime`): 最终的轻量化镜像

### 缓存优化

- 分离依赖文件复制，优化Docker层缓存
- 使用 `npm ci` 确保确定性安装
- 仅在运行时镜像中包含生产依赖

### 安全特性

- 使用非root用户 (`nodejs:nodejs`)
- 最小化镜像攻击面
- 适当的文件权限设置

## 配置选项

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | `production` | 运行环境 |
| `TZ` | `Asia/Shanghai` | 时区设置 |
| `PORT` | `8000` | 应用端口 |

### 端口映射

- `8000:8000` - API服务端口
- `80:80` - Nginx HTTP端口（仅生产环境）
- `443:443` - Nginx HTTPS端口（仅生产环境）

### 数据卷挂载

#### 开发环境
- `./src:/app/src:ro` - 源代码（只读）
- `./configs:/app/configs:ro` - 配置文件（只读）

#### 生产环境
- `./configs:/app/configs:ro` - 配置文件（只读）
- `./logs:/app/logs` - 日志目录

## 健康检查

应用包含内置健康检查端点：

```bash
# 检查应用健康状态
curl http://localhost:8000/health

# Docker健康检查
docker ps  # 查看HEALTH状态
```

## 故障排除

### 常见问题

1. **端口被占用**
   ```bash
   # 检查端口使用情况
   lsof -i :8000
   
   # 修改端口映射
   # 在docker-compose.yml中修改 "8001:8000"
   ```

2. **权限问题**
   ```bash
   # 检查文件权限
   ls -la configs/
   
   # 修复权限
   sudo chown -R 1001:1001 configs/
   ```

3. **内存不足**
   ```bash
   # 增加资源限制
   # 在docker-compose.prod.yml中调整deploy.resources
   ```

### 日志调试

```bash
# 查看容器日志
docker logs dreamina-free-api-prod

# 实时日志
docker logs -f dreamina-free-api-prod

# 查看系统日志
journalctl -u docker
```

### 性能监控

```bash
# 查看容器资源使用
docker stats dreamina-free-api-prod

# 查看容器进程
docker top dreamina-free-api-prod
```

## 自定义配置

### Nginx配置

如果使用生产环境的Nginx代理，可以修改 `nginx.conf`：

```bash
# 编辑Nginx配置
vim nginx.conf

# 重启服务应用配置
docker-compose -f docker-compose.prod.yml restart nginx
```

### 资源限制

在 `docker-compose.prod.yml` 中调整资源限制：

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'      # 增加CPU限制
      memory: 1024M    # 增加内存限制
```

## 部署最佳实践

1. **监控**: 配置适当的监控和告警
2. **备份**: 定期备份重要配置文件
3. **更新**: 定期更新基础镜像和依赖
4. **安全**: 使用HTTPS和适当的防火墙规则
5. **日志**: 配置集中日志收集

## 相关文档

- [原项目README](./README.md) - 项目介绍和API文档
- [Dockerfile](./Dockerfile) - 容器构建配置
- [docker-compose.yml](./docker-compose.yml) - 标准部署配置
- [Makefile](./Makefile) - 便捷命令集合