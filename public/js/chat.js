/**
 * ============================================================================
 * SYNCPARTY CHAT ENGINE
 * Kesintisiz Canlı Sohbet ve Mesaj İçi Emoji Seçici
 * ============================================================================
 */

class ChatEngine {
  constructor(socket) {
    this.socket = socket;
    this.chatMessagesContainer = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('btn-send-msg');
    this.emojiToggleBtn = document.getElementById('btn-emoji-toggle');
    this.emojiPickerPopup = document.getElementById('emoji-picker-popup');
    this.emojiGrid = document.getElementById('emoji-grid');

    this.init();
  }

  init() {
    // Mesaj Gönderme
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    
    // Enter Tuşu (Video Oynatmayı Kesinlikle Durdurmaz/Etkilemez)
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Videonun klavye kısayollarını tetiklemesini engelle
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Emoji Seçici Aç/Kapa
    this.emojiToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.emojiPickerPopup.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!this.emojiPickerPopup.contains(e.target) && e.target !== this.emojiToggleBtn) {
        this.emojiPickerPopup.classList.add('hidden');
      }
    });

    // Emoji Seçildiğinde Mesaj Kutusuna Ekle
    this.emojiGrid.querySelectorAll('span').forEach(span => {
      span.addEventListener('click', () => {
        this.chatInput.value += span.textContent;
        this.chatInput.focus();
        this.emojiPickerPopup.classList.add('hidden');
      });
    });

    // Socket Mesaj Dinleyicisi
    this.socket.on('chat-message-broadcast', (msg) => {
      this.renderMessage(msg);
    });
  }

  sendMessage() {
    const text = this.chatInput.value.trim();
    if (!text) return;

    this.socket.emit('chat-message', { text });
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  renderMessage(msg) {
    const isOwn = msg.userId === this.socket.id;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isOwn ? 'own-message' : ''}`;

    const senderRow = document.createElement('div');
    senderRow.className = 'chat-sender-info';
    senderRow.style.color = msg.avatarColor || '#b3001e';

    let senderHtml = `<span>${this.escapeHtml(msg.username)}</span>`;
    if (msg.isHost) {
      senderHtml += `<span class="chat-host-tag">HOST</span>`;
    }
    senderHtml += `<span class="chat-time">${msg.time}</span>`;
    senderRow.innerHTML = senderHtml;

    const textDiv = document.createElement('div');
    textDiv.className = 'chat-text';
    textDiv.textContent = msg.text;

    bubble.appendChild(senderRow);
    bubble.appendChild(textDiv);
    this.chatMessagesContainer.appendChild(bubble);

    // Otomatik alta kaydır
    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
