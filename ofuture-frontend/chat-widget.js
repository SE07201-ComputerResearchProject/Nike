// ofuture-frontend/chat-widget.js

document.addEventListener('DOMContentLoaded', () => {
    // 1. Kiểm tra phân quyền: Không hiển thị Widget cho Admin và Seller
    const userStr = localStorage.getItem('user');
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            if (user.role === 'admin' || user.role === 'seller') return;
        } catch(e) {}
    }

    // 2. Tạo cấu trúc HTML & CSS (Scoped CSS không ảnh hưởng trang chính)
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'ofuture-ai-widget';
    widgetContainer.innerHTML = `
        <style>
            /* Reset các element bên trong widget để tránh xung đột */
            #ofuture-ai-widget {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 9999;
                font-family: inherit; /* Kế thừa font chữ hiện tại của dự án */
            }
            #ai-toggle-btn {
                width: 56px;
                height: 56px;
                border-radius: 50%;
                background-color: #2563eb; /* Màu xanh trung tính */
                color: #ffffff;
                border: none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                cursor: pointer;
                font-size: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s ease;
            }
            #ai-toggle-btn:hover {
                transform: scale(1.05);
            }
            #ai-chat-box {
                display: none; /* Ẩn mặc định */
                width: 340px;
                height: 480px;
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.15);
                flex-direction: column;
                overflow: hidden;
                margin-bottom: 16px;
                border: 1px solid #e2e8f0;
            }
            #ai-chat-header {
                background: #2563eb;
                color: #ffffff;
                padding: 16px;
                font-weight: 600;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 15px;
            }
            #ai-close-btn {
                background: none;
                border: none;
                color: #ffffff;
                font-size: 22px;
                cursor: pointer;
                line-height: 1;
            }
            #ai-chat-messages {
                flex: 1;
                padding: 16px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 12px;
                background: #f8fafc;
            }
            .ai-msg {
                max-width: 85%;
                padding: 10px 14px;
                border-radius: 16px;
                font-size: 14px;
                line-height: 1.4;
                word-wrap: break-word;
            }
            .ai-msg.bot {
                background: #e2e8f0;
                color: #1e293b;
                align-self: flex-start;
                border-bottom-left-radius: 4px;
            }
            .ai-msg.user {
                background: #2563eb;
                color: #ffffff;
                align-self: flex-end;
                border-bottom-right-radius: 4px;
            }
            .ai-msg.loading {
                font-style: italic;
                color: #64748b;
            }
            #ai-chat-input-area {
                display: flex;
                padding: 12px;
                background: #ffffff;
                border-top: 1px solid #e2e8f0;
            }
            #ai-chat-input {
                flex: 1;
                padding: 10px 14px;
                border: 1px solid #cbd5e1;
                border-radius: 20px;
                outline: none;
                font-size: 14px;
                font-family: inherit;
            }
            #ai-send-btn {
                background: #2563eb;
                color: #ffffff;
                border: none;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                margin-left: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
        </style>
        
        <div id="ai-chat-box">
            <div id="ai-chat-header">
                <span>O'Future Support</span>
                <button id="ai-close-btn">×</button>
            </div>
            <div id="ai-chat-messages">
                <div class="ai-msg bot">Xin chào! Tôi là trợ lý AI của O'Future. Bạn cần hỗ trợ gì về sản phẩm hay đơn hàng không?</div>
            </div>
            <div id="ai-chat-input-area">
                <input type="text" id="ai-chat-input" placeholder="Nhập câu hỏi..." autocomplete="off">
                <button id="ai-send-btn">➤</button>
            </div>
        </div>
        <button id="ai-toggle-btn">💬</button>
    `;
    
    // Gắn widget vào body của trang hiện tại
    document.body.appendChild(widgetContainer);

    // 3. Khai báo các DOM Elements
    const toggleBtn = document.getElementById('ai-toggle-btn');
    const chatBox = document.getElementById('ai-chat-box');
    const closeBtn = document.getElementById('ai-close-btn');
    const sendBtn = document.getElementById('ai-send-btn');
    const chatInput = document.getElementById('ai-chat-input');
    const messagesContainer = document.getElementById('ai-chat-messages');

    // Mở / Đóng Chatbot
    function toggleChat() {
        chatBox.style.display = chatBox.style.display === 'flex' ? 'none' : 'flex';
        if (chatBox.style.display === 'flex') chatInput.focus();
    }
    toggleBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);

    // Hàm render tin nhắn
    function appendMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-msg ${sender}`;
        msgDiv.textContent = text;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Hàm gửi tin nhắn qua Backend API
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        // Render tin nhắn của User
        appendMessage(text, 'user');
        chatInput.value = '';
        chatInput.disabled = true; // Khóa input khi đang chờ API

        // Tạo cục loading cho Bot
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'ai-msg bot loading';
        loadingDiv.textContent = 'Đang nhập...';
        messagesContainer.appendChild(loadingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        try {
            // Tận dụng fetchAPI từ file api.js. 
            // Endpoint /chat/message được mapping từ file server.ts (app.use('/api/chat', chatRoutes))
            const response = await fetchAPI('/chat/message', {
                method: 'POST',
                body: JSON.stringify({ message: text })
            });
            
            // Xóa cục loading và hiện câu trả lời
            messagesContainer.removeChild(loadingDiv);
            
            // Backend có thể trả về trường 'reply' hoặc 'message', ta bắt cả 2
            const botReply = response.data?.reply || response.data?.message || 'Xin lỗi, tôi đã tiếp nhận yêu cầu nhưng đang gặp sự cố nội bộ.';
            appendMessage(botReply, 'bot');

        } catch (error) {
            messagesContainer.removeChild(loadingDiv);
            appendMessage('Hệ thống AI đang bận hoặc mất kết nối. Vui lòng thử lại sau.', 'bot');
        } finally {
            chatInput.disabled = false;
            chatInput.focus();
        }
    }

    // Lắng nghe sự kiện click và phím Enter
    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});