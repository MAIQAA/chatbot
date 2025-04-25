/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useEffect, useState } from "react";

export default function TalkJSComponent() {
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [readyInitialized, setReadyInitialized] = useState(false);
  const [error, setError] = useState(null);
  const [conversationId] = useState(`chatbotExampleConversation_${Date.now()}`); // Unique conversation ID

  // Load TalkJS script
  useEffect(() => {
    console.log("Attempting to load TalkJS script...");
    const script = document.createElement("script");
    script.src = "https://cdn.talkjs.com/talk.js";
    script.async = true;
    script.onload = () => {
      console.log("TalkJS SDK script loaded successfully");
      setScriptLoaded(true);
    };
    script.onerror = (event) => {
      console.error("Failed to load TalkJS SDK script:", event);
      setError(
        "Failed to load TalkJS script. Please check your network, disable ad blockers, or try a different browser."
      );
    };
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  // Initialize TalkJS
  useEffect(() => {
    if (!scriptLoaded || readyInitialized || error) {
      return;
    }

    const checkTalkJSReady = () => {
      if (!window.Talk) {
        console.log("window.Talk is not available yet...");
        setTimeout(checkTalkJSReady, 100);
        return;
      }

      if (window.Talk.ready && typeof window.Talk.ready.then === "function") {
        console.log("TalkJS.ready is available");
        setReadyInitialized(true);
        window.Talk.ready
          .then(() => {
            console.log("TalkJS.ready promise resolved");
            initializeTalkJS();
          })
          .catch((err) => {
            console.error("TalkJS.ready Error:", err);
            setError(
              "Failed to initialize TalkJS. Please check your appId and network."
            );
          });
      } else {
        console.log(
          "window.Talk is available but TalkJS.ready is not. Attempting manual initialization..."
        );
        setReadyInitialized(true);
        initializeTalkJS();
      }
    };

    const initializeTalkJS = () => {
      try {
        const me = new window.Talk.User({
          id: "chatbotUser",
          name: "Ammad",
          email: "ammadrana863@gmail.com",
          role: "default",
          photoUrl: "/User.jpg",
        });

        const talkSession = new window.Talk.Session({
          appId: "tess1K7E",
          me: me,
        });

        const bot = new window.Talk.User({
          id: "chatbotExampleBot",
          name: "Bot",
          email: "bot@example.com",
          role: "default",
          photoUrl: "/Bot.svg",
          welcomeMessage:
            "Hi, I'm a friendly chatbot! I'll use Google's Gemini API to assist with your queries. You can send voice messages or upload documents too. How can I help?",
        });

        const conversation =
          talkSession.getOrCreateConversation(conversationId);
        conversation.setParticipant(me);
        conversation.setParticipant(bot);

        console.log("Initialized conversation with ID:", conversationId);

        const inbox = talkSession.createChatbox();
        inbox.select(conversation);

        talkSession.onBrowserPermissionNeeded((event) => {
          alert("Please grant microphone access to send voice messages.");
        });
        talkSession.onBrowserPermissionDenied((event) => {
          alert(
            "Microphone access denied. Voice messages won't work until permission is granted."
          );
        });

        inbox
          .mount(document.getElementById("talkjs-container"))
          .then(() => {
            console.log("TalkJS chatbox mounted successfully");
          })
          .catch((err) => {
            console.error("TalkJS mount error:", err.message, err.stack);
            setError(
              "Failed to load chat: " +
                err.message +
                ". Please try again later."
            );
          });
      } catch (error) {
        console.error(
          "TalkJS Initialization Error:",
          error.message,
          error.stack
        );
        setError(
          "Failed to initialize chat: " +
            error.message +
            ". Please check the console for details."
        );
      }
    };

    checkTalkJSReady();
  }, [scriptLoaded, readyInitialized, error, conversationId]);

  useEffect(() => {
    if (error) {
      document.getElementById(
        "talkjs-container"
      ).innerHTML = `<p style="color: red; text-align: center;">${error}</p>`;
    }
  }, [error]);

  return null;
}
