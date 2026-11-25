
(function () {
  "use strict";

  // Prevent the widget from loading more than once.
  if (window.__RIVETFLOW_WIDGET_LOADED__) return;
  window.__RIVETFLOW_WIDGET_LOADED__ = true;

  const script = document.currentScript;

  if (!script) {
    console.error("RivetFlow: Could not identify the widget script.");
    return;
  }

  const publicKey = script.getAttribute("data-public-key");

  if (!publicKey || !/^[a-f0-9]{64}$/.test(publicKey)) {
    console.error("RivetFlow: A valid public key is required.");
    return;
  }

  const platformUrl = new URL(script.src).origin;
  const apiUrl = platformUrl + "/api/ai-test";
  const storageKey = "rivetflow_conversation_" + publicKey;

  let conversationId = null;
  let isSending = false;

  function createConversationId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (character) {
        const random = Math.random() * 16 | 0;
        const value = character === "x" ? random : (random & 3 | 8);
        return value.toString(16);
      }
    );
  }

  function getConversationId() {
    try {
      const existing = sessionStorage.getItem(storageKey);

      if (
        existing &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
      ) {
        return existing;
      }

      const created = createConversationId();
      sessionStorage.setItem(storageKey, created);
      return created;
    } catch {
      return createConversationId();
    }
  }

  conversationId = getConversationId();

  // Create an isolated widget using Shadow DOM.
  const host = document.createElement("div");
  host.id = "rivetflow-chat-widget";
  host.style.position = "fixed";
  host.style.zIndex = "2147483000";
  host.style.right = "20px";
  host.style.bottom = "20px";

  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const styles = document.createElement("style");

  styles.textContent = `
    :host {
      all: initial;
      font-family: Arial, Helvetica, sans-serif;
      color: #172033;
    }

    * {
      box-sizing: border-box;
    }

    button, input {
      font-family: inherit;
    }

    .launcher {
      width: 62px;
      height: 62px;
      border: none;
      border-radius: 50%;
      background: #172f50;
      color: white;
      font-size: 27px;
      cursor: pointer;
      box-shadow: 0 5px 22px rgba(0,0,0,.24);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .2s, background .2s;
    }

    .launcher:hover {
      transform: scale(1.06);
      background: #244a77;
    }

    .panel {
      position: absolute;
      right: 0;
      bottom: 78px;
      width: 370px;
      height: 540px;
      max-height: calc(100dvh - 110px);
      background: white;
      border-radius: 18px;
      box-shadow: 0 10px 45px rgba(0,0,0,.23);
      overflow: hidden;
      display: none;
      flex-direction: column;
      border: 1px solid #e4e8ef;
    }

    .panel.open {
      display: flex;
    }

    .header {
      background: #172f50;
      color: white;
      padding: 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .header-info {
      min-width: 0;
    }

    .business-name {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .online {
      font-size: 12px;
      opacity: .8;
      margin-top: 3px;
    }

    .close {
      background: transparent;
      color: white;
      border: none;
      font-size: 25px;
      cursor: pointer;
      padding: 2px 5px;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 17px;
      background: #f5f7fa;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }

    .message {
      max-width: 85%;
      padding: 11px 14px;
      border-radius: 15px;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .assistant {
      background: white;
      color: #202b3b;
      align-self: flex-start;
      border: 1px solid #e6eaf0;
      border-bottom-left-radius: 4px;
    }

    .user {
      background: #244a77;
      color: white;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }

    .typing {
      font-size: 13px;
      color: #718096;
      padding: 4px 2px;
    }

    .composer {
      display: flex;
      gap: 9px;
      padding: 13px;
      background: white;
      border-top: 1px solid #e8ecf1;
    }

    .composer input {
      min-width: 0;
      flex: 1;
      height: 44px;
      padding: 0 13px;
      border: 1px solid #dce2ea;
      border-radius: 12px;
      outline: none;
      font-size: 14px;
      color: #172033;
      background: white;
    }

    .composer input:focus {
      border-color: #426c9e;
    }

    .send {
      width: 46px;
      height: 44px;
      border: none;
      border-radius: 12px;
      background: #172f50;
      color: white;
      cursor: pointer;
      font-size: 19px;
    }

    .send:disabled {
      opacity: .5;
      cursor: not-allowed;
    }

    .footer {
      padding: 7px 12px;
      text-align: center;
      font-size: 10px;
      color: #929baa;
      background: white;
    }

    .footer span {
      font-weight: 600;
      color: #65758b;
    }

    @media(max-width: 480px) {
      .panel {
        position: fixed;
        right: 0;
        bottom: 0;
        width: 100vw;
        width: 100dvw;
        height: 100vh;
        height: 100dvh;
        max-height: 100dvh;
        border-radius: 0;
        border: none;
      }

      .launcher {
        width: 58px;
        height: 58px;
      }

      .header {
        padding-top: max(18px, env(safe-area-inset-top));
      }

      .composer {
        padding-bottom: max(13px, env(safe-area-inset-bottom));
      }
    }
  `;

  shadow.appendChild(styles);

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.setAttribute("aria-expanded", "false");
  launcher.textContent = "\uD83D\uDCAC";

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.setAttribute("aria-label", "Customer chat");

  const header = document.createElement("div");
  header.className = "header";

  const headerInfo = document.createElement("div");
  headerInfo.className = "header-info";

  const nameElement = document.createElement("div");
  nameElement.className = "business-name";
  nameElement.textContent = "Chat with us";

  const onlineElement = document.createElement("div");
  onlineElement.className = "online";
  onlineElement.textContent = "Here to help";

  headerInfo.appendChild(nameElement);
  headerInfo.appendChild(onlineElement);

  const closeButton = document.createElement("button");
  closeButton.className = "close";
  closeButton.type = "button";
  closeButton.textContent = "\u00D7";
  closeButton.setAttribute("aria-label", "Close chat");

  header.appendChild(headerInfo);
  header.appendChild(closeButton);

  const messages = document.createElement("div");
  messages.className = "messages";
  messages.setAttribute("aria-live", "polite");

  const composer = document.createElement("form");
  composer.className = "composer";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type your message...";
  input.maxLength = 1500;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Your message");
  input.required = true;

  const sendButton = document.createElement("button");
  sendButton.className = "send";
  sendButton.type = "submit";
  sendButton.textContent = "\u27A4";
  sendButton.setAttribute("aria-label", "Send message");

  composer.appendChild(input);
  composer.appendChild(sendButton);

  const footer = document.createElement("div");
  footer.className = "footer";
  footer.append("Powered by ");

  const footerBrand = document.createElement("span");
  footerBrand.textContent = "RivetFlow AI";
  footer.appendChild(footerBrand);

  panel.appendChild(header);
  panel.appendChild(messages);
  panel.appendChild(composer);
  panel.appendChild(footer);

  shadow.appendChild(panel);
  shadow.appendChild(launcher);

  function addMessage(text, type) {
    const element = document.createElement("div");
    element.className = "message " + type;
    element.textContent = text;
    messages.appendChild(element);
    messages.scrollTop = messages.scrollHeight;
    return element;
  }

  function addTyping() {
    const element = document.createElement("div");
    element.className = "typing";
    element.textContent = "Typing...";
    messages.appendChild(element);
    messages.scrollTop = messages.scrollHeight;
    return element;
  }

  function openChat() {
    panel.classList.add("open");
    launcher.setAttribute("aria-expanded", "true");
    launcher.style.display = "none";
    input.focus();
  }

  function closeChat() {
    panel.classList.remove("open");
    launcher.setAttribute("aria-expanded", "false");
    launcher.style.display = "flex";
  }

  launcher.addEventListener("click", openChat);
  closeButton.addEventListener("click", closeChat);

  addMessage(
    "Hi! How can we help you today?",
    "assistant"
  );

  async function sendMessage(message) {
    if (isSending) return;

    isSending = true;
    input.disabled = true;
    sendButton.disabled = true;

    addMessage(message, "user");

    const typing = addTyping();

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          publicKey: publicKey,
          conversationId: conversationId,
          message: message
        })
      });

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error("The server returned an invalid response.");
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "The chat service is temporarily unavailable."
        );
      }

      if (data.business) {
        nameElement.textContent = data.business;
      }

      if (typeof data.reply !== "string" || !data.reply.trim()) {
        throw new Error("The assistant returned an empty response.");
      }

      typing.remove();
      addMessage(data.reply, "assistant");

    } catch (error) {
      typing.remove();

      console.error("RivetFlow chatbot error:", error);

      addMessage(
        "Sorry, we're having trouble connecting right now. Please try again in a moment.",
        "assistant"
      );

    } finally {
      isSending = false;
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  composer.addEventListener("submit", function (event) {
    event.preventDefault();

    const message = input.value.trim();

    if (!message || isSending) return;

    input.value = "";
    sendMessage(message);
  });

})();
