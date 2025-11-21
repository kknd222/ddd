#!/bin/bash

# Agent 功能测试脚本
# 
# 使用方法:
#   ./scripts/test-agent.sh YOUR_SESSION_ID

set -e

SESSION_ID=${1:-""}
API_URL="http://localhost:8000"

if [ -z "$SESSION_ID" ]; then
    echo "❌ 错误: 请提供 SESSION_ID"
    echo "使用方法: $0 YOUR_SESSION_ID"
    exit 1
fi

echo "🤖 开始测试 Agent 功能"
echo "================================================"
echo ""

# 测试1: 单张图片生成
echo "📝 测试 1: Agent 单张图片生成"
echo "------------------------------------------------"
echo "请求: 画一只可爱的柴犬"
echo ""

curl -X POST "$API_URL/v1/chat/completions" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -N \
  --silent \
  --max-time 180 \
  -d '{
    "model": "agent",
    "stream": true,
    "messages": [
      {"role": "user", "content": "画一只可爱的柴犬"}
    ]
  }' 2>&1 | while IFS= read -r line; do
    if [[ $line == data:* ]]; then
        data="${line#data: }"
        if [[ $data == "[DONE]" ]]; then
            echo ""
            echo "✅ 流结束"
            break
        fi
        # 提取内容
        content=$(echo "$data" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)
        if [ -n "$content" ]; then
            echo -n "$content"
        fi
    fi
done

echo ""
echo ""
echo "================================================"
echo ""

# 测试2: 多张图片生成（核心需求）
echo "📝 测试 2: Agent 多张图片生成（画三张哈士奇 16:9）"
echo "------------------------------------------------"
echo "请求: 画三张哈士奇 16:9"
echo ""

curl -X POST "$API_URL/v1/chat/completions" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -N \
  --silent \
  --max-time 300 \
  -d '{
    "model": "agent",
    "stream": true,
    "messages": [
      {"role": "user", "content": "画三张哈士奇 16:9"}
    ]
  }' 2>&1 | while IFS= read -r line; do
    if [[ $line == data:* ]]; then
        data="${line#data: }"
        if [[ $data == "[DONE]" ]]; then
            echo ""
            echo "✅ 流结束"
            break
        fi
        # 提取内容
        content=$(echo "$data" | grep -o '"content":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$content" ]; then
            echo -n "$content"
        fi
    fi
done

echo ""
echo ""
echo "================================================"
echo ""

# 测试3: 非流式测试
echo "📝 测试 3: Agent 非流式请求"
echo "------------------------------------------------"

response=$(curl -X POST "$API_URL/v1/chat/completions" \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  --silent \
  --max-time 120 \
  -d '{
    "model": "agent",
    "stream": false,
    "messages": [
      {"role": "user", "content": "画一只可爱的猫咪"}
    ]
  }')

echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"

echo ""
echo "================================================"
echo ""
echo "🎉 Agent 测试完成!"
echo ""
echo "📊 预期行为:"
echo "  1. Agent 理解用户意图"
echo "  2. Agent 返回文本回复"
echo "  3. Agent 调用工具（creative_agent_mcp_gen_text2image_v3）"
echo "  4. 🔥 项目拦截工具调用"
echo "  5. 🔥 项目用 submit_id 轮询结果"
echo "  6. 🔥 项目获取图片并转换为 Markdown"
echo "  7. ✅ 用户直接看到图片"
echo ""
echo "================================================"

