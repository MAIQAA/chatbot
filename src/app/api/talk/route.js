/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextResponse } from "next/server";
import fetch from "node-fetch";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import ffmpeg from "fluent-ffmpeg";
import { unlink } from "fs";
import path from "path";
import { AssemblyAI } from "assemblyai";
import {
  fetchFileToTemp,
  convertWebmToFlac,
  extractTextFromPDF,
  extractTextFromDocx,
  transcribeAudio,
  getGeminiCompletion,
  sendTalkJSMessage,
} from "../../lib/utils";

if (process.env.NODE_ENV === "development") {
  try {
    ffmpeg.setFfmpegPath(
      "C:\\Users\\ammad\\AppData\\Local\\ffmpeg\\bin\\ffmpeg.exe"
    );
    console.log("FFmpeg path set successfully for local development.");
  } catch (error) {
    console.error("Failed to set FFmpeg path:", error.message);
  }
}

const appId = process.env.TALKJS_APP_ID || "tess1K7E";
const talkJSSecretKey = process.env.TALKJS_SECRET_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const assemblyAIApiKey = process.env.ASSEMBLYAI_API_KEY;

console.log("Environment variables loaded:", {
  appId,
  talkJSSecretKey: talkJSSecretKey ? "Set" : "Missing",
  geminiApiKey: geminiApiKey ? "Set" : "Missing",
  assemblyAIApiKey: assemblyAIApiKey ? "Set" : "Missing",
});

if (!talkJSSecretKey || !geminiApiKey || !assemblyAIApiKey) {
  throw new Error("Missing required environment variables.");
}

const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const assemblyAI = new AssemblyAI({ apiKey: assemblyAIApiKey });

const botId = "chatbotExampleBot";
const allMessageHistory = {};
const processedMessageKeys = new Set();

export async function POST(req) {
  console.log(`[${new Date().toISOString()}] POST /api/talk`);
  let body;
  try {
    body = await req.json();
    console.log("Webhook payload:", body);
  } catch (error) {
    console.error("Failed to parse request body:", error.message);
    return NextResponse.json(
      { error: "Invalid request body. Expected JSON." },
      { status: 400 }
    );
  }

  try {
    const { conversation, message, sender } = body.data || {};
    const convId = conversation?.id;
    const messageId = message?.id;
    const messageText = message?.text?.trim();
    const senderId = sender?.id;
    const attachment = message?.attachment;

    if (!convId || !senderId || !messageId) {
      console.error("Invalid request payload:", body);
      return NextResponse.json(
        { error: "Invalid request payload. Missing required fields." },
        { status: 400 }
      );
    }

    // Use a composite key to check for duplicates: conversationId:messageId
    const messageKey = `${convId}:${messageId}`;
    if (processedMessageKeys.has(messageKey)) {
      console.log(`Skipping duplicate message: ${messageKey}`);
      return NextResponse.json({}, { status: 200 });
    }
    processedMessageKeys.add(messageKey);

    if (!(convId in allMessageHistory)) {
      allMessageHistory[convId] = [
        {
          role: "system",
          content:
            "You are a helpful assistant. Provide short, concise answers (max 150 characters).",
        },
      ];
    }
    const messageHistory = allMessageHistory[convId];

    if (messageHistory.length > 10) {
      messageHistory.splice(1, messageHistory.length - 10);
    }

    if (senderId === botId) {
      if (messageText) {
        messageHistory.push({ role: "assistant", content: messageText });
      }
      return NextResponse.json({}, { status: 200 });
    }

    let additionalContent = null;

    if (attachment) {
      let subtype = attachment.subtype || "generic";
      let mimeType = attachment.mimeType;
      let filename = attachment.filename || "attachment";
      const url = attachment.url;

      if (!url) {
        throw new Error("Attachment URL is missing.");
      }

      if (url.includes("talkjs_audio_message")) {
        subtype = "voice";
        if (!mimeType) {
          const extension = url.split(".").pop().split("?")[0].toLowerCase();
          mimeType = extension === "webm" ? "audio/webm" : "audio/flac";
          filename = url.split("/").pop().split("?")[0] || "voice_message";
        }
      } else if (!mimeType) {
        const extension = url.split(".").pop().split("?")[0].toLowerCase();
        mimeType =
          extension === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : extension === "pdf"
            ? "application/pdf"
            : "application/octet-stream";
        filename = url.split("/").pop().split("?")[0] || "document";
      }

      let buffer;
      let tempInputPath;

      if (mimeType === "application/pdf" || mimeType === "audio/webm") {
        tempInputPath = path.join(
          process.cwd(),
          "tmp",
          `${filename}_${Date.now()}.${
            mimeType.includes("webm") ? "webm" : "pdf"
          }`
        );
        await fs.promises.mkdir(path.dirname(tempInputPath), {
          recursive: true,
        });
        buffer = await fetchFileToTemp(url, tempInputPath);
      } else {
        buffer = await fetchFileToTemp(url);
      }

      if (mimeType === "audio/webm") {
        try {
          const tempOutputPath = path.join(
            process.cwd(),
            "tmp",
            `${filename}_${Date.now()}.flac`
          );
          await convertWebmToFlac(tempInputPath, tempOutputPath);
          additionalContent = await transcribeAudio(tempOutputPath, assemblyAI);

          unlink(tempInputPath, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
          unlink(tempOutputPath, (err) => {
            if (err) console.error("Failed to delete tempOutputPath:", err);
          });
        } catch (error) {
          unlink(tempInputPath, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
          if (error.message.includes("Cannot find ffmpeg")) {
            await sendTalkJSMessage(
              convId,
              "Sorry, I can't process voice messages right now. FFmpeg is not installed on the server.",
              appId,
              talkJSSecretKey,
              botId
            );
            return NextResponse.json({}, { status: 200 });
          }
          await sendTalkJSMessage(
            convId,
            "Sorry, I couldn't transcribe the voice message. Please try again or send a text message.",
            appId,
            talkJSSecretKey,
            botId
          );
          return NextResponse.json({}, { status: 200 });
        }
      } else if (mimeType === "application/pdf") {
        try {
          additionalContent = await extractTextFromPDF(tempInputPath);
          unlink(tempInputPath, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
        } catch (error) {
          unlink(tempInputPath, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
          await sendTalkJSMessage(
            convId,
            "Sorry, I couldn't extract text from the PDF. Please try again or send a text message.",
            appId,
            talkJSSecretKey,
            botId
          );
          return NextResponse.json({}, { status: 200 });
        }
      } else if (
        mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        try {
          additionalContent = await extractTextFromDocx(buffer);
        } catch (error) {
          await sendTalkJSMessage(
            convId,
            "Sorry, I couldn't extract text from the DOCX. Please try again or send a text message.",
            appId,
            talkJSSecretKey,
            botId
          );
          return NextResponse.json({}, { status: 200 });
        }
      } else {
        if (tempInputPath) {
          unlink(tempInputPath, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
        }
        await sendTalkJSMessage(
          convId,
          "Sorry, I can only process audio, PDF, and DOCX files.",
          appId,
          talkJSSecretKey,
          botId
        );
        return NextResponse.json({}, { status: 200 });
      }

      messageHistory.push({ role: "user", content: additionalContent });
    } else if (messageText) {
      if (
        !messageHistory.some(
          (msg) => msg.role === "user" && msg.content === messageText
        )
      ) {
        messageHistory.push({ role: "user", content: messageText });
      }
    } else {
      console.error("No text or attachment in message:", body);
      return NextResponse.json(
        { error: "No text or attachment in message." },
        { status: 400 }
      );
    }

    if (additionalContent || messageText) {
      const reply = await getGeminiCompletion(messageHistory, model);
      await sendTalkJSMessage(convId, reply, appId, talkJSSecretKey, botId);
    }

    return NextResponse.json({}, { status: 200 });
  } catch (error) {
    console.error("Webhook Error:", error.message, error.stack);
    return NextResponse.json(
      { error: "Internal server error: " + error.message },
      { status: 500 }
    );
  }
}
