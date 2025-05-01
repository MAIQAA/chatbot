import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { AssemblyAI } from "assemblyai";
import {
  convertWebmToFlac,
  extractTextFromPDF,
  extractTextFromDocx,
  transcribeAudio,
  getGeminiCompletion,
} from "../../lib/utils";

// Set FFmpeg path for all environments
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
} else {
  throw new Error("FFmpeg static path is not set.");
}
console.log("FFmpeg path set to:", ffmpegStatic);

const geminiApiKey = process.env.GEMINI_API_KEY;
const assemblyAIApiKey = process.env.ASSEMBLYAI_API_KEY;

console.log("Environment variables loaded:", {
  geminiApiKey: geminiApiKey ? "Set" : "Missing",
  assemblyAIApiKey: assemblyAIApiKey ? "Set" : "Missing",
});

if (!geminiApiKey || !assemblyAIApiKey) {
  console.error(
    "Missing API keys - GEMINI_API_KEY or ASSEMBLYAI_API_KEY not set."
  );
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
      prompt = (formData.get("prompt") as string) || null;
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
      console.log(
        `Processing attachment: ${filename}, MIME type: ${mimeType}, Buffer size: ${buffer.length} bytes`
      );

      if (mimeType === "audio/webm") {
        try {
          console.log("Starting webm to flac conversion...");
          const flacBuffer = await convertWebmToFlac(buffer);
          console.log(
            "Conversion successful, flacBuffer size:",
            flacBuffer.length
          );
          console.log("Starting audio transcription...");
          additionalContent = await transcribeAudio(flacBuffer, assemblyAI);
          console.log("Transcription result:", additionalContent);
        } catch (error) {
          console.error(
            "Audio processing error:",
            (error as Error).message,
            (error as Error).stack
          );
          return NextResponse.json(
            {
              error:
                "Failed to transcribe voice message: " +
                (error as Error).message,
            },
            { status: 500 }
          );
        }
      } else if (mimeType === "application/pdf") {
        try {
          console.log("Starting PDF text extraction...");
          additionalContent = await extractTextFromPDF(buffer);
          console.log(
            "PDF extraction result:",
            (additionalContent ? additionalContent.slice(0, 50) : "") + "..."
          );
        } catch (error) {
          console.error(
            "PDF extraction error:",
            (error as Error).message,
            (error as Error).stack
          );
          return NextResponse.json(
            {
              error:
                "Failed to extract text from PDF: " + (error as Error).message,
            },
            { status: 500 }
          );
        }
      } else if (
        mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        try {
          console.log("Starting DOCX text extraction...");
          const extractedContent = await extractTextFromDocx(buffer);
          if (
            typeof extractedContent === "string" ||
            extractedContent === null
          ) {
            additionalContent = extractedContent;
          } else {
            throw new Error(
              "Extracted content is not of type 'string | null'."
            );
          }
          if (additionalContent) {
            console.log(
              `Successfully extracted text from DOCX: ${additionalContent.slice(
                0,
                50
              )}...`
            );
          } else {
            console.error("No content extracted from DOCX.");
          }
        } catch (error) {
          console.error(
            "DOCX extraction error:",
            (error as Error).message,
            (error as Error).stack
          );
          return NextResponse.json(
            {
              error:
                "Failed to extract text from DOCX: " + (error as Error).message,
            },
            { status: 500 }
          );
        }
      } else {
        console.error("Unsupported file type:", mimeType);
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
        console.log(
          "Sending to Gemini with prompt:",
          fullPrompt.slice(0, 50) + "..."
        );
        const reply = await getGeminiCompletion(messageHistory, model);
        console.log("Gemini reply:", reply);
        messageHistory.push({ role: "assistant", content: reply });
        return NextResponse.json({ reply }, { status: 200 });
      }
    } else if (text) {
      messageHistory.push({ role: "user", content: text });
      console.log("Sending text to Gemini:", text);
      const reply = await getGeminiCompletion(messageHistory, model);
      console.log("Gemini reply:", reply);
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
    console.error(
      "Error in /api/talk:",
      (error as Error).message,
      (error as Error).stack
    );
    return NextResponse.json(
      { error: "Internal server error: " + (error as Error).message },
      { status: 500 }
    );
  }
}
