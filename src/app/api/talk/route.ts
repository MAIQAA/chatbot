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
} from "../../lib/utils";

if (process.env.NODE_ENV === "development") {
  try {
    ffmpeg.setFfmpegPath(
      "C:\\Users\\ammad\\AppData\\Local\\ffmpeg\\bin\\ffmpeg.exe"
    );
    console.log("FFmpeg path set successfully for local development.");
  } catch (error) {
    console.error("Failed to set FFmpeg path:", (error as Error).message);
  }
}

const geminiApiKey = process.env.GEMINI_API_KEY;
const assemblyAIApiKey = process.env.ASSEMBLYAI_API_KEY;

console.log("Environment variables loaded:", {
  geminiApiKey: geminiApiKey ? "Set" : "Missing",
  assemblyAIApiKey: assemblyAIApiKey ? "Set" : "Missing",
});

if (!geminiApiKey || !assemblyAIApiKey) {
  throw new Error("Missing required environment variables.");
}

const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const assemblyAI = new AssemblyAI({ apiKey: assemblyAIApiKey });

const allMessageHistory: {
  [key: string]: { role: string; content: string }[];
} = {};
const sessionId = "default-session"; // Simplified for single-session use

export async function POST(req: Request) {
  console.log(`[${new Date().toISOString()}] POST /api/talk`);
  let body: { text?: string } | null = null;
  let text: string | null = null;
  let attachment: File | null = null;
  let prompt: string | null = null;

  try {
    const contentType = req.headers.get("content-type");
    if (contentType?.includes("multipart/form-data")) {
      const formData = await req.formData();
      attachment = formData.get("attachment") as File;
      prompt = (formData.get("prompt") as string) || null; // Get the prompt from formData
    } else {
      body = await req.json();
      text = body?.text?.trim() ?? null;
    }
  } catch (error) {
    console.error("Failed to parse request body:", (error as Error).message);
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  try {
    if (!(sessionId in allMessageHistory)) {
      allMessageHistory[sessionId] = [
        {
          role: "system",
          content:
            "You are a helpful assistant. Provide concise answers (max 300 words). Maintain context from previous messages, including document content.",
        },
      ];
    }
    const messageHistory = allMessageHistory[sessionId];

    if (messageHistory.length > 10) {
      messageHistory.splice(1, messageHistory.length - 10);
    }

    let additionalContent: string | null = null;

    if (attachment) {
      const mimeType = attachment.type;
      const filename = attachment.name || "attachment";
      const buffer = Buffer.from(await attachment.arrayBuffer());
      let tempInputPath: string | null = null;

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
        await fs.promises.writeFile(tempInputPath, buffer);
      }

      if (mimeType === "audio/webm") {
        try {
          const tempOutputPath = path.join(
            process.cwd(),
            "tmp",
            `${filename}_${Date.now()}.flac`
          );
          await convertWebmToFlac(tempInputPath!, tempOutputPath);
          additionalContent = await transcribeAudio(tempOutputPath, assemblyAI);

          unlink(tempInputPath!, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
          unlink(tempOutputPath, (err) => {
            if (err) console.error("Failed to delete tempOutputPath:", err);
          });
        } catch (error) {
          unlink(tempInputPath!, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
          if (
            error instanceof Error &&
            error.message.includes("Cannot find ffmpeg")
          ) {
            return NextResponse.json(
              { error: "FFmpeg is not installed on the server." },
              { status: 500 }
            );
          }
          return NextResponse.json(
            { error: "Failed to transcribe voice message." },
            { status: 500 }
          );
        }
      } else if (mimeType === "application/pdf") {
        try {
          additionalContent = await extractTextFromPDF(tempInputPath!);
          unlink(tempInputPath!, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
        } catch (error) {
          unlink(tempInputPath!, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
          return NextResponse.json(
            { error: "Failed to extract text from PDF." },
            { status: 500 }
          );
        }
      } else if (
        mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        try {
          additionalContent = await extractTextFromDocx(buffer);
          if (additionalContent) {
            console.log(
              `Successfully extracted text from DOCX: ${additionalContent.slice(
                0,
                50
              )}...`
            );
          } else {
            console.log("No content extracted from DOCX.");
          }
        } catch (error) {
          return NextResponse.json(
            { error: "Failed to extract text from DOCX." },
            { status: 500 }
          );
        }
      } else {
        if (tempInputPath) {
          unlink(tempInputPath, (err) => {
            if (err) console.error("Failed to delete tempInputPath:", err);
          });
        }
        return NextResponse.json(
          { error: "Only audio, PDF, and DOCX files are supported." },
          { status: 400 }
        );
      }

      if (additionalContent) {
        const fullPrompt = prompt
          ? `${prompt}\n\n${additionalContent}`
          : additionalContent;
        messageHistory.push({ role: "user", content: fullPrompt });
        const reply = await getGeminiCompletion(messageHistory, model);
        messageHistory.push({ role: "assistant", content: reply });
        return NextResponse.json({ reply }, { status: 200 });
      }
    } else if (text) {
      messageHistory.push({ role: "user", content: text });
      const reply = await getGeminiCompletion(messageHistory, model);
      messageHistory.push({ role: "assistant", content: reply });
      return NextResponse.json({ reply }, { status: 200 });
    } else {
      console.error("No text or attachment in request.");
      return NextResponse.json(
        { error: "No text or attachment in request." },
        { status: 400 }
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message, error.stack);
    } else {
      console.error("Error:", error);
    }
    return NextResponse.json(
      {
        error:
          "Internal server error: " +
          (error instanceof Error ? error.message : "Unknown error"),
      },
      { status: 500 }
    );
  }
}
