#!/bin/bash

# 高性能本地AI翻譯方案部署腳本
# 支持 Ubuntu/Debian/CentOS/macOS

set -e

echo "🚀 開始部署高性能本地AI翻譯方案..."

# 檢測操作系統
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get &> /dev/null; then
            OS="ubuntu"
        elif command -v yum &> /dev/null; then
            OS="centos"
        else
            echo "❌ 不支持的Linux發行版"
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        echo "❌ 不支持的操作系統: $OSTYPE"
        exit 1
    fi
    echo "✅ 檢測到操作系統: $OS"
}

# 檢查是否有GPU
check_gpu() {
    echo "🔍 檢查GPU支持..."
    if command -v nvidia-smi &> /dev/null; then
        GPU_AVAILABLE=true
        echo "✅ 檢測到NVIDIA GPU"
        nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
    else
        GPU_AVAILABLE=false
        echo "ℹ️  未檢測到NVIDIA GPU，將使用CPU模式"
    fi
}

# 安裝Docker
install_docker() {
    echo "📦 安裝Docker..."
    
    if command -v docker &> /dev/null; then
        echo "✅ Docker已安裝"
        return
    fi
    
    case $OS in
        ubuntu)
            curl -fsSL https://get.docker.com -o get-docker.sh
            sudo sh get-docker.sh
            sudo usermod -aG docker $USER
            ;;
        centos)
            sudo yum install -y yum-utils
            sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            sudo yum install -y docker-ce docker-ce-cli containerd.io
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            ;;
        macos)
            echo "請從 https://docs.docker.com/desktop/mac/install/ 安裝Docker Desktop"
            echo "安裝完成後請重新運行此腳本"
            exit 1
            ;;
    esac
    
    echo "✅ Docker安裝完成"
}

# 安裝Docker Compose
install_docker_compose() {
    echo "📦 安裝Docker Compose..."
    
    if command -v docker-compose &> /dev/null || docker compose version &> /dev/null 2>&1; then
        echo "✅ Docker Compose已安裝"
        return
    fi
    
    case $OS in
        ubuntu|centos)
            sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
            sudo chmod +x /usr/local/bin/docker-compose
            ;;
        macos)
            # Docker Desktop for Mac 已包含Docker Compose
            echo "✅ Docker Compose隨Docker Desktop一起安裝"
            ;;
    esac
    
    echo "✅ Docker Compose安裝完成"
}

# 創建項目目錄結構
create_project_structure() {
    echo "📁 創建項目目錄結構..."
    
    mkdir -p ai-translation-system
    cd ai-translation-system
    
    mkdir -p translation-service
    mkdir -p browser-extension/src/background
    mkdir -p browser-extension/manifest
    mkdir -p data/ollama
    mkdir -p logs
    
    echo "✅ 目錄結構創建完成"
}

# 更新Docker Compose配置（GPU支持）
update_docker_compose() {
    if [ "$GPU_AVAILABLE" = true ]; then
        echo "🎯 配置GPU支持..."
        
        # 安裝NVIDIA Container Toolkit
        case $OS in
            ubuntu)
                distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
                curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
                curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
                sudo apt-get update && sudo apt-get install -y nvidia-docker2
                sudo systemctl restart docker
                ;;
            centos)
                distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
                curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.repo | sudo tee /etc/yum.repos.d/nvidia-docker.repo
                sudo yum install -y nvidia-docker2
                sudo systemctl restart docker
                ;;
        esac
        
        # 修改docker-compose.yml啟用GPU
        sed -i 's/# deploy:/deploy:/' docker-compose.yml
        sed -i 's/#   resources:/  resources:/' docker-compose.yml
        sed -i 's/#     reservations:/    reservations:/' docker-compose.yml
        sed -i 's/#       devices:/      devices:/' docker-compose.yml
        sed -i 's/#         - driver: nvidia/        - driver: nvidia/' docker-compose.yml
        sed -i 's/#           count: 1/          count: 1/' docker-compose.yml
        sed -i 's/#           capabilities: \[gpu\]/          capabilities: [gpu]/' docker-compose.yml
        
        echo "✅ GPU支持配置完成"
    fi
}

# 啟動服務
start_services() {
    echo "🚀 啟動翻譯服務..."
    
    # 啟動Docker服務
    docker-compose up -d
    
    echo "⏳ 等待服務啟動..."
    sleep 10
    
    # 檢查服務狀態
    echo "📊 檢查服務狀態..."
    docker-compose ps
    
    # 等待Ollama啟動
    echo "⏳ 等待Ollama服務啟動..."
    until docker-compose exec ollama ollama list &> /dev/null; do
        echo "等待Ollama啟動..."
        sleep 5
    done
    
    echo "✅ 服務啟動完成"
}

# 下載並配置AI模型
setup_ai_models() {
    echo "🤖 下載AI翻譯模型..."
    
    # 下載Qwen2模型
    echo "📥 下載Qwen2-7B模型 (這可能需要幾分鐘)..."
    docker-compose exec ollama ollama pull qwen2:7b-instruct
    
    # 檢查模型是否下載成功
    echo "🔍 檢查已安裝的模型..."
    docker-compose exec ollama ollama list
    
    echo "✅ AI模型配置完成"
}

# 測試翻譯服務
test_translation_service() {
    echo "🧪 測試翻譯服務..."
    
    # 等待翻譯API服務啟動
    echo "⏳ 等待翻譯API服務啟動..."
    until curl -f http://localhost:3000/api/health &> /dev/null; do
        echo "等待翻譯API啟動..."
        sleep 5
    done
    
    # 健康檢查
    echo "🏥 健康檢查..."
    curl -s http://localhost:3000/api/health | jq '.' || echo "無法解析JSON回應"
    
    # 測試翻譯
    echo "🔤 測試英文到繁體中文翻譯..."
    curl -s -X POST http://localhost:3000/api/translate \
        -H "Content-Type: application/json" \
        -d '{"text": "Hello, this is a test.", "target_lang": "zh-tw"}' \
        | jq '.translation' 2>/dev/null || echo "翻譯測試失敗"
    
    echo "✅ 翻譯服務測試完成"
}

# 安裝瀏覽器擴展
install_browser_extension() {
    echo "🌐 準備瀏覽器擴展..."
    
    # 下載EdgeTranslate源碼
    if [ ! -d "EdgeTranslate" ]; then
        echo "📥 下載EdgeTranslate源碼..."
        git clone https://github.com/EdgeTranslate/EdgeTranslate.git
    fi
    
    # 復制我們的自定義翻譯模組
    cp browser-extension/src/background/translation.js EdgeTranslate/packages/EdgeTranslate/src/background/
    
    echo "📋 瀏覽器擴展安裝說明:"
    echo "1. 開啟Chrome/Edge瀏覽器"
    echo "2. 前往 chrome://extensions/ 或 edge://extensions/"
    echo "3. 啟用 '開發者模式'"
    echo "4. 點擊 '載入未封裝項目'"
    echo "5. 選擇 $(pwd)/EdgeTranslate/packages/EdgeTranslate/build/chrome/ 目錄"
    echo "6. 在擴展設置中配置本地翻譯API: http://localhost:3000/api"
    
    echo "✅ 瀏覽器擴展準備完成"
}

# 顯示系統信息
show_system_info() {
    echo ""
    echo "🎉 部署完成！系統信息:"
    echo "=================================="
    echo "翻譯API地址: http://localhost:3000"
    echo "健康檢查: http://localhost:3000/api/health"
    echo "Ollama地址: http://localhost:11434"
    echo "AI模型: qwen2:7b-instruct"
    echo "GPU支持: $GPU_AVAILABLE"
    echo "快取位置: ./data/ollama"
    echo "日誌位置: ./logs"
    echo ""
    echo "🔧 常用命令:"
    echo "查看服務狀態: docker-compose ps"
    echo "查看日誌: docker-compose logs -f"
    echo "重啟服務: docker-compose restart"
    echo "停止服務: docker-compose down"
    echo "清理快取: curl -X DELETE http://localhost:3000/api/cache"
    echo ""
    echo "📖 使用說明:"
    echo "1. 安裝瀏覽器擴展 (參考上面的說明)"
    echo "2. 在擴展設置中配置API端點"
    echo "3. 開始享受高性能本地AI翻譯!"
    echo ""
}

# 主執行流程
main() {
    detect_os
    check_gpu
    install_docker
    install_docker_compose
    create_project_structure
    update_docker_compose
    start_services
    setup_ai_models
    test_translation_service
    install_browser_extension
    show_system_info
}

# 錯誤處理
trap 'echo "❌ 部署過程中發生錯誤，請檢查上面的錯誤信息"; exit 1' ERR

# 執行主函數
main "$@"

echo "🎊 恭喜！高性能本地AI翻譯方案部署成功！"