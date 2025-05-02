/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useState, useEffect, useRef } from "react";
import {
  Mic,
  Paperclip,
  Send,
  X,
  Bot,
  User,
  FileText,
  File,
  Play,
  Download,
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content:
    | string
    | {
        type: "audio" | "file";
        data: string;
        filename?: string;
        filetype?: string;
      };
  timestamp: string;
}

export default function ChatbotComponent() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! I'm Chatbot Assistant! Ask me about anything! 😄",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);
  const [inputText, setInputText] = useState<string>("");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Scroll to bottom of chat on new message
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Start recording timer
  useEffect(() => {
    if (isRecording && recordingIntervalRef.current === null) {
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else if (!isRecording && recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
      setRecordingTime(0);
    }
    return () => {
      if (recordingIntervalRef.current)
        clearInterval(recordingIntervalRef.current);
    };
  }, [isRecording]);

  // Handle text message submission
  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const newMessage: Message = {
      role: "user",
      content: inputText,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setMessages((prev) => [...prev, newMessage]);
    setInputText("");
    if (typeof newMessage.content === "string") {
      await fetchGeminiResponse(newMessage.content);
    }
  };

  // Handle voice recording
  const handleVoiceRecording = async () => {
    if (isRecording) {
      mediaRecorder?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      setMediaRecorder(recorder);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(chunks, { type: "audio/webm" });
        const audioUrl = URL.createObjectURL(audioBlob);
        const newMessage: Message = {
          role: "user",
          content: { type: "audio", data: audioUrl },
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, newMessage]);
        const formData = new FormData();
        formData.append("attachment", audioBlob, "voice_message.webm");
        formData.append("prompt", "answer me for this: ");
        try {
          setIsLoading(true);
          const response = await fetch("/api/talk", {
            method: "POST",
            body: formData,
          });
          const data = await response.json();
          if ((data as { reply?: string }).reply) {
            const botMessage: Message = {
              role: "assistant",
              content: data.reply,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            };
            setMessages((prev) => [...prev, botMessage]);
          }
        } catch (err) {
          setError("Error processing voice message.");
        } finally {
          setIsLoading(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setError("Microphone access denied or unavailable.");
    }
  };

  // Handle file upload with progress tracking
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowedTypes.includes(file.type)) {
      setError("Only PDF and DOCX files are supported.");
      return;
    }

    const maxSize = 10 * 1024 * 1024; // 10MB limit
    if (file.size > maxSize) {
      setError("File is too large. Maximum size is 10MB.");
      return;
    }

    const filetype = file.type === "application/pdf" ? "pdf" : "docx";
    const newMessage: Message = {
      role: "user",
      content: {
        type: "file",
        data: URL.createObjectURL(file),
        filename: file.name,
        filetype,
      },
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setMessages((prev) => [...prev, newMessage]);

    try {
      const formData = new FormData();
      formData.append("attachment", file);
      formData.append("prompt", "read this and tell me what it says");

      setIsLoading(true);
      setUploadProgress(0);

      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          setUploadProgress(percentComplete);
        }
      };

      const responsePromise = new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) {
            const data = JSON.parse(xhr.responseText);
            console.log("File upload response from /api/talk:", data);
            resolve(data);
          } else {
            reject(new Error(`Failed to upload file. Status: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error while uploading."));
        xhr.open("POST", "/api/talk", true);
        xhr.send(formData);
      });

      const data = await responsePromise;
      if ((data as { reply?: string }).reply) {
        const botMessage: Message = {
          role: "assistant",
          content: (data as { reply: string }).reply,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, botMessage]);
      } else {
        throw new Error("No reply received from server.");
      }
    } catch (err) {
      setError(
        "Error processing document: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Fetch Gemini response for text input
  const fetchGeminiResponse = async (content: string) => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      console.log("Gemini response from /api/talk:", data);
      if (data.reply) {
        const botMessage: Message = {
          role: "assistant",
          content: data.reply,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, botMessage]);
      } else {
        setError("Failed to get response from Gemini.");
      }
    } catch (err) {
      setError(
        "Error communicating with the server: " + (err as Error).message
      );
      console.error("Fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Format Gemini response
  const formatResponse = (text: string) => {
    return text.split("\n").map((line, index) => {
      if (line.startsWith("# "))
        return (
          <h2 key={index} className="text-lg font-bold mt-2">
            {line.slice(2)}
          </h2>
        );
      if (line.startsWith("## "))
        return (
          <h3 key={index} className="text-md font-semibold mt-1">
            {line.slice(3)}
          </h3>
        );
      if (line.match(/^\s*[-*+]\s+/))
        return (
          <li key={index} className="ml-5">
            {line.replace(/^\s*[-*+]\s+/, "")}
          </li>
        );
      return (
        <p key={index} className="mt-1">
          {line}
        </p>
      );
    });
  };

  return (
    <div className="max-w-md mx-auto bg-white dark:bg-zinc-800 shadow-xl rounded-xl overflow-hidden transform transition-all duration-300 hover:shadow-2xl">
      {/* Header */}
      <div className="px-4 py-3 border-b dark:border-zinc-700 bg-blue-500 text-white">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center">
            <Bot className="h-6 w-6 mr-2 animate-pulse" />
            Chatbot Assistant
          </h2>
          <div className="bg-green-500 text-white text-xs px-2 py-1 rounded-full animate-pulse-slow">
            Online
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div
        ref={chatContainerRef}
        className="flex-1 p-4 overflow-y-auto flex flex-col space-y-3 bg-gray-50 dark:bg-zinc-900"
        id="chatDisplay"
        style={{ height: "600px" }}
      >
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex items-start space-x-2 animate-fade-in ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role === "assistant" && (
              <Bot className="h-8 w-8 text-teal-500 flex-shrink-0 mt-1" />
            )}
            <div className="max-w-[80%]">
              {typeof msg.content === "string" ? (
                <div
                  className={`chat-message ${
                    msg.role === "user"
                      ? "self-end bg-blue-500"
                      : "self-start bg-zinc-500"
                  } text-white rounded-lg px-3 py-2 text-sm shadow-md`}
                >
                  {typeof msg.content === "string"
                    ? formatResponse(msg.content)
                    : null}
                </div>
              ) : msg.content.type === "audio" ? (
                <div className="chat-message self-end bg-blue-200 dark:bg-blue-800 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm shadow-md flex items-center space-x-3">
                  <button className="p-1 bg-teal-500 text-white rounded-full hover:bg-teal-600 transition-colors">
                    <Play className="h-5 w-5" />
                  </button>
                  <div className="w-24 h-6 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="w-full h-full bg-teal-500 animate-waveform"></div>
                  </div>
                  <span className="text-xs opacity-70">{msg.timestamp}</span>
                </div>
              ) : msg.content.type === "file" ? (
                <div className="chat-message self-end bg-blue-200 dark:bg-blue-800 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm shadow-md flex items-center space-x-2">
                  {msg.content.filetype === "pdf" ? (
                    <FileText className="h-5 w-5 text-red-500" />
                  ) : (
                    <File className="h-5 w-5 text-blue-500" />
                  )}
                  <a
                    href={msg.content.data}
                    download={msg.content.filename}
                    className="hover:underline"
                  >
                    {msg.content.filename}
                  </a>
                  <a
                    href={msg.content.data}
                    download={msg.content.filename}
                    className="p-1 bg-gray-300 dark:bg-gray-600 rounded-full hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
                  >
                    <Download className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                  </a>
                  <span className="text-xs opacity-70">{msg.timestamp}</span>
                </div>
              ) : null}
            </div>
            {msg.role === "user" && (
              <User className="h-8 w-8 text-gray-600 flex-shrink-0 mt-1" />
            )}
          </div>
        ))}
        {uploadProgress > 0 && uploadProgress < 100 && (
          <div className="flex justify-center">
            <div className="w-1/2 bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
              <div
                className="bg-blue-500 h-2.5 rounded-full"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}
        {isLoading && (
          <div className="flex justify-center">
            <div className="animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full"></div>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-3 py-2 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg flex justify-between items-center animate-fade-in">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-700 dark:text-red-200 hover:text-red-900 dark:hover:text-red-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="px-3 py-2 border-t dark:border-zinc-700 bg-gray-100 dark:bg-zinc-700">
        <div className="flex items-center gap-2">
          <button
            onClick={handleVoiceRecording}
            className={`p-2 rounded-full ${
              isRecording
                ? "bg-red-500 text-white"
                : "bg-gray-200 dark:bg-zinc-600 text-gray-600 dark:text-gray-300"
            } hover:bg-gray-300 dark:hover:bg-zinc-500 transition-colors relative`}
            title="Record voice message"
          >
            <Mic className="h-5 w-5" />
            {isRecording && (
              <div className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 rounded-full animate-ping"></div>
            )}
            {isRecording && (
              <div className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center">
                <span className="text-xs text-white">
                  {Math.floor(recordingTime)}s
                </span>
              </div>
            )}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 bg-gray-200 dark:bg-zinc-600 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-300 dark:hover:bg-zinc-500 transition-colors"
            title="Upload document"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf,.docx"
            className="hidden"
          />

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Type your message..."
            className="flex-1 p-2 border rounded-lg dark:bg-zinc-700 dark:text-white dark:border-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200"
          />

          <button
            onClick={handleSendMessage}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-all duration-200 ease-in-out transform hover:scale-105 shadow-md"
            id="sendButton"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
