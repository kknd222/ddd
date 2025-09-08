# Dreamina Free API Docker 管理

.PHONY: help build build-dev build-prod up up-dev up-prod down down-dev down-prod logs clean

# 默认目标
help:
	@echo "可用的命令:"
	@echo "  build     - 构建生产镜像"
	@echo "  build-dev - 构建开发镜像"
	@echo "  up        - 启动生产环境"
	@echo "  up-dev    - 启动开发环境"
	@echo "  down      - 停止生产环境"
	@echo "  down-dev  - 停止开发环境"
	@echo "  logs      - 查看生产环境日志"
	@echo "  logs-dev  - 查看开发环境日志"
	@echo "  clean     - 清理所有镜像和容器"
	@echo "  restart   - 重启生产环境"
	@echo "  restart-dev - 重启开发环境"

# 构建镜像
build:
	docker-compose -f docker-compose.prod.yml build

build-dev:
	docker-compose -f docker-compose.dev.yml build

# 启动服务
up:
	docker-compose -f docker-compose.prod.yml up -d

up-dev:
	docker-compose -f docker-compose.dev.yml up -d

# 停止服务
down:
	docker-compose -f docker-compose.prod.yml down

down-dev:
	docker-compose -f docker-compose.dev.yml down

# 查看日志
logs:
	docker-compose -f docker-compose.prod.yml logs -f

logs-dev:
	docker-compose -f docker-compose.dev.yml logs -f

# 重启服务
restart:
	docker-compose -f docker-compose.prod.yml restart

restart-dev:
	docker-compose -f docker-compose.dev.yml restart

# 清理
clean:
	docker-compose -f docker-compose.yml down --rmi all --volumes --remove-orphans
	docker-compose -f docker-compose.dev.yml down --rmi all --volumes --remove-orphans
	docker-compose -f docker-compose.prod.yml down --rmi all --volumes --remove-orphans
	docker system prune -f

# 健康检查
health:
	curl -f http://localhost:8000/health || exit 1

# 查看服务状态
status:
	docker-compose -f docker-compose.prod.yml ps