/**
 * ============================================================================
 * SYNCPARTY CHAT ENGINE
 * Buğulu (Glassmorphic) Canlı Sohbet, Mesaja Yanıt Verme (Quote Reply) & Emoji
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

    // Yanıt Verme (Quote Reply) UI Elemanları
    this.replyPreview = document.getElementById('chat-reply-preview');
    this.replyToUser = document.getElementById('reply-to-user');
    this.replyToText = document.getElementById('reply-to-text');
    this.cancelReplyBtn = document.getElementById('btn-cancel-reply');
    this.currentReply = null; // { id, username, text }

    this.init();
  }

  init() {
    // Mesaj Gönderme
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    
    // Enter Tuşu (Video Oynatmayı Kesinlikle Durdurmaz/Etkilemez)
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Yanıtı İptal Et Butonu
    if (this.cancelReplyBtn) {
      this.cancelReplyBtn.addEventListener('click', () => this.cancelReply());
    }

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

  setReplyTarget(msg) {
    this.currentReply = {
      id: msg.id,
      username: msg.username,
      text: msg.text.length > 50 ? msg.text.substring(0, 50) + '...' : msg.text
    };

    if (this.replyPreview) {
      this.replyToUser.textContent = this.currentReply.username;
      this.replyToText.textContent = this.currentReply.text;
      this.replyPreview.classList.remove('hidden');
    }
    this.chatInput.focus();
  }

  cancelReply() {
    this.currentReply = null;
    if (this.replyPreview) {
      this.replyPreview.classList.add('hidden');
    }
  }

  sendMessage() {
    const text = this.chatInput.value.trim();
    if (!text) return;

    this.socket.emit('chat-message', {
      text,
      replyTo: this.currentReply
    });

    this.chatInput.value = '';
    this.cancelReply();
    this.chatInput.focus();
  }

  renderMessage(msg) {
    const isOwn = msg.userId === this.socket.id;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isOwn ? 'own-message' : ''}`;
    bubble.dataset.id = msg.id;

    // Alıntılanan / Yanıt Verilen Mesaj Bloğu (Varsa)
    if (msg.replyTo) {
      const quoteDiv = document.createElement('div');
      quoteDiv.className = 'chat-quote-bubble';
      quoteDiv.innerHTML = `
        <div class="quote-header">
          <i class="fa-solid fa-reply"></i>
          <span>${this.escapeHtml(msg.replyTo.username)}</span>
        </div>
        <div class="quote-content">${this.escapeHtml(msg.replyTo.text)}</div>
      `;
      bubble.appendChild(quoteDiv);
    }

    // Gönderen Bilgi Satırı
    const senderRow = document.createElement('div');
    senderRow.className = 'chat-sender-info';
    senderRow.style.color = msg.avatarColor || 'var(--accent-red)';

    let senderHtml = `<span>${this.escapeHtml(msg.username)}</span>`;
    if (msg.isHost) {
      senderHtml += `<span class="chat-host-tag">HOST</span>`;
    }
    senderHtml += `<span class="chat-time">${msg.time}</span>`;
    senderRow.innerHTML = senderHtml;

    // Mesaj Metni
    const textDiv = document.createElement('div');
    textDiv.className = 'chat-text';
    textDiv.textContent = msg.text;

    // Hızlı Yanıt Butonu
    const replyBtn = document.createElement('button');
    replyBtn.className = 'chat-action-reply';
    replyBtn.title = 'Bu mesaja yanıt ver';
    replyBtn.innerHTML = `<i class="fa-solid fa-reply"></i>`;
    replyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setReplyTarget(msg);
    });

    bubble.appendChild(senderRow);
    bubble.appendChild(textDiv);
    bubble.appendChild(replyBtn);

    this.chatMessagesContainer.appendChild(bubble);

    // Otomatik en alta yumuşak kaydır
    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
