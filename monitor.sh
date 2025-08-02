#!/bin/bash

# 高性能本地AI翻譯系統監控腳本

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日誌函數
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 檢查服務狀態
check_services() {
    echo -e "\n${BLUE}🔍 檢查服務狀態${NC}"
    echo "=================================="
    
    # Docker服務狀態
    if docker-compose ps | grep -q "Up"; then
        log_info "Docker服務運行正常"
        docker-compose ps
    else
        log_error "Docker服務異常"
        return 1
    fi
    
    # Ollama健康檢查
    echo -e "\n${BLUE}🤖 Ollama狀態${NC}"
    if curl -s http://localhost:11434/api/tags > /dev/null; then
        log_info "Ollama服務正常"
        echo "已安裝模型:"
        curl -s http://localhost:11434/api/tags | jq -r '.models[]?.name' 2>/dev/null || echo "無法獲取模型列表"
    else
        log_error "Ollama服務無法連接"
    fi
    
    # 翻譯API健康檢查
    echo -e "\n${BLUE}🌐 翻譯API狀態${NC}"
    if curl -s http://localhost:3000/api/health > /dev/null; then
        log_info "翻譯API服務正常"
        health_data=$(curl -s http://localhost:3000/api/health)
        echo "$health_data" | jq '.' 2>/dev/null || echo "$health_data"
    else
        log_error "翻譯API服務無法連接"
    fi
}

# 性能監控
monitor_performance() {
    echo -e "\n${BLUE}📊 性能監控${NC}"
    echo "=================================="
    
    # 系統資源使用
    echo "🖥️ 系統資源:"
    echo "CPU使用率: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}')%"
    echo "內存使用: $(free -h | awk 'NR==2{printf "%.1f%%", $3*100/$2}')"
    echo "磁盤使用: $(df -h / | awk 'NR==2{print $5}')"
    
    # Docker容器資源使用
    echo -e "\n🐳 Docker容器資源:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
    
    # GPU使用情況（如果有）
    if command -v nvidia-smi &> /dev/null; then
        echo -e "\n🎯 GPU使用情況:"
        nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits
    fi
}

# 檢查翻譯性能
test_translation_performance() {
    echo -e "\n${BLUE}⚡ 翻譯性能測試${NC}"
    echo "=================================="
    
    # 測試文本
    test_texts=(
        "Hello, this is a simple test."
        "Artificial intelligence is transforming the way we interact with technology."
        "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet."
    )
    
    total_time=0
    success_count=0
    
    for i in "${!test_texts[@]}"; do
        text="${test_texts[$i]}"
        echo "測試 $((i+1)): $text"
        
        start_time=$(date +%s%N)
        response=$(curl -s -X POST http://localhost:3000/api/translate \
            -H "Content-Type: application/json" \
            -d "{\"text\": \"$text\", \"target_lang\": \"zh-tw\"}")
        end_time=$(date +%s%N)
        
        duration=$(echo "scale=3; ($end_time - $start_time) / 1000000000" | bc)
        total_time=$(echo "$total_time + $duration" | bc)
        
        if echo "$response" | jq -e '.success' > /dev/null 2>&1; then
            translation=$(echo "$response" | jq -r '.translation')
            cache_hit=$(echo "$response" | jq -r '.from_cache // false')
            echo "  ✅ 耗時: ${duration}s, 快取: $cache_hit"
            echo "  📝 翻譯: $translation"
            success_count=$((success_count + 1))
        else
            echo "  ❌ 翻譯失敗: $response"
        fi
        echo ""
    done
    
    avg_time=$(echo "scale=3; $total_time / ${#test_texts[@]}" | bc)
    success_rate=$(echo "scale=1; $success_count * 100 / ${#test_texts[@]}" | bc)
    
    echo "📈 性能統計:"
    echo "  平均翻譯時間: ${avg_time}s"
    echo "  成功率: ${success_rate}%"
    echo "  總測試數: ${#test_texts[@]}"
    echo "  成功數: $success_count"
}

# 檢查快取統計
check_cache_stats() {
    echo -e "\n${BLUE}💾 快取統計${NC}"
    echo "=================================="
    
    if curl -s http://localhost:3000/api/cache/stats > /dev/null; then
        cache_stats=$(curl -s http://localhost:3000/api/cache/stats)
        echo "$cache_stats" | jq '.' 2>/dev/null || echo "$cache_stats"
    else
        log_error "無法獲取快取統計信息"
    fi
}

# 檢查日誌
check_logs() {
    echo -e "\n${BLUE}📝 最近日誌 (最後50行)${NC}"
    echo "=================================="
    
    echo "🔸 翻譯服務日誌:"
    docker-compose logs --tail=20 translation-service 2>/dev/null || echo "無法獲取翻譯服務日誌"
    
    echo -e "\n🔸 Ollama日誌:"
    docker-compose logs --tail=20 ollama 2>/dev/null || echo "無法獲取Ollama日誌"
}

# 系統診斷
diagnose_system() {
    echo -e "\n${BLUE}🔧 系統診斷${NC}"
    echo "=================================="
    
    # 端口檢查
    echo "🔌 端口檢查:"
    for port in 3000 11434; do
        if netstat -tuln | grep -q ":$port "; then
            log_info "端口 $port 正在監聽"
        else
            log_error "端口 $port 未開放"
        fi
    done
    
    # 磁盤空間檢查
    echo -e "\n💽 磁盤空間檢查:"
    available_space=$(df / | awk 'NR==2 {print $4}')
    if [ "$available_space" -lt 1048576 ]; then  # 小於1GB
        log_warn "可用磁盤空間不足1GB"
    else
        log_info "磁盤空間充足"
    fi
    
    # Docker存儲檢查
    echo -e "\n🐳 Docker存儲:"
    docker system df 2>/dev/null || log_error "無法獲取Docker存儲信息"
}

# 優化建議
optimization_suggestions() {
    echo -e "\n${BLUE}💡 優化建議${NC}"
    echo "=================================="
    
    # CPU使用率檢查
    cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}' | awk -F'.' '{print $1}')
    if [ "$cpu_usage" -gt 80 ]; then
        log_warn "CPU使用率過高 (${cpu_usage}%)，建議:"
        echo "  - 減少並發翻譯請求"
        echo "  - 使用更小的模型（如qwen2:1.5b）"
        echo "  - 增加CPU核心數"
    fi
    
    # 內存使用檢查
    mem_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    if [ "$mem_usage" -gt 85 ]; then
        log_warn "內存使用率過高 (${mem_usage}%)，建議:"
        echo "  - 增加系統內存"
        echo "  - 調整模型量化級別"
        echo "  - 減少快取TTL時間"
    fi
    
    # GPU建議
    if ! command -v nvidia-smi &> /dev/null; then
        echo "💡 如果有NVIDIA GPU，可以顯著提升翻譯速度:"
        echo "  - 安裝NVIDIA驅動和CUDA"
        echo "  - 重新運行setup.sh啟用GPU支持"
    fi
    
    echo -e "\n📚 常用優化命令:"
    echo "  清理Docker: docker system prune -f"
    echo "  清理翻譯快取: curl -X DELETE http://localhost:3000/api/cache"
    echo "  重啟服務: docker-compose restart"
    echo "  查看實時日誌: docker-compose logs -f"
}

# 主菜單
show_menu() {
    echo -e "\n${BLUE}🔍 高性能AI翻譯系統監控${NC}"
    echo "=================================="
    echo "1. 檢查服務狀態"
    echo "2. 性能監控"
    echo "3. 翻譯性能測試"
    echo "4. 快取統計"
    echo "5. 查看日誌"
    echo "6. 系統診斷"
    echo "7. 優化建議"
    echo "8. 完整報告"
    echo "9. 退出"
    echo ""
    read -p "請選擇操作 (1-9): " choice
}

# 完整報告
full_report() {
    log_info "生成完整系統報告..."
    
    check_services
    monitor_performance
    test_translation_performance
    check_cache_stats
    diagnose_system
    optimization_suggestions
    
    echo -e "\n${GREEN}✅ 完整報告生成完成${NC}"
}

# 主循環
main() {
    # 檢查依賴
    for cmd in docker-compose curl jq bc; do
        if ! command -v $cmd &> /dev/null; then
            log_error "缺少依賴: $cmd"
            echo "請安裝缺少的依賴後重新運行"
            exit 1
        fi
    done
    
    while true; do
        show_menu
        case $choice in
            1) check_services ;;
            2) monitor_performance ;;
            3) test_translation_performance ;;
            4) check_cache_stats ;;
            5) check_logs ;;
            6) diagnose_system ;;
            7) optimization_suggestions ;;
            8) full_report ;;
            9) echo "退出監控"; exit 0 ;;
            *) log_error "無效選擇，請重新輸入" ;;
        esac
        
        echo -e "\n按Enter鍵繼續..."
        read
    done
}

# 如果直接運行腳本（不是被source）
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi