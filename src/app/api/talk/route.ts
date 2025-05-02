import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import ffmpeg from "fluent-ffmpeg";
import { AssemblyAI } from "assemblyai";
import {
  convertWebmToFlac,
  extractTextFromPDF,
  extractTextFromDocx,
  transcribeAudio,
  getGeminiCompletion,
} from "../../lib/utils";

// Set FFmpeg path based on environment
if (process.env.NODE_ENV === "development") {
  ffmpeg.setFfmpegPath(
    "C:\\Users\\ammad\\AppData\\Local\\ffmpeg\\bin\\ffmpeg.exe"
  );
  console.log("FFmpeg set to local path for development");
} else {
  ffmpeg.setFfmpegPath("/opt/ffmpeg"); 
  console.log("FFmpeg set to: /opt/ffmpeg");
}

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
    console.log("Request Content-Type:", contentType);
    if (contentType?.includes("multipart/form-data")) {
      const formData = await req.formData();
      attachment = formData.get("attachment") as File;
      prompt = (formData.get("prompt") as string) || null;
      console.log(
        "FormData - Attachment:",
        attachment?.name,
        "Prompt:",
        prompt
      );
    } else {
      body = await req.json();
      text = body?.text?.trim() ?? null;
      console.log("JSON Body - Text:", text);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        "Failed to parse request body:",
        error.message,
        error.stack
      );
    } else {
      console.error("Failed to parse request body:", error);
    }
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
      const buffer = Buffer.from(await attachment.arrayBuffer());
      console.log(
        `Processing attachment, MIME type: ${mimeType}, Buffer size: ${buffer.length} bytes`
      );

      if (mimeType === "audio/webm") {
        try {
          console.log("Starting audio processing...");
          const flacBuffer = await convertWebmToFlac(buffer);
          console.log("Audio converted to FLAC, starting transcription...");
          additionalContent = await transcribeAudio(flacBuffer, assemblyAI);
          console.log("Audio transcription completed:", additionalContent);
        } catch (error) {
          if (error instanceof Error) {
            console.error(
              "Audio processing error:",
              error.message,
              error.stack
            );
          } else {
            console.error("Audio processing error:", error);
          }
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
          console.log("Starting PDF processing...");
          additionalContent = await extractTextFromPDF(buffer);
          console.log(
            "PDF text extraction completed:",
            additionalContent.slice(0, 50) + "..."
          );
        } catch (error) {
          if (error instanceof Error) {
            console.error("PDF extraction error:", error.message, error.stack);
          } else {
            console.error("PDF extraction error:", error);
          }
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
          console.log("Starting DOCX processing...");
          additionalContent = await extractTextFromDocx(buffer);
          console.log(
            "DOCX text extraction completed:",
            additionalContent.slice(0, 50) + "..."
          );
        } catch (error) {
          if (error instanceof Error) {
            console.error("DOCX extraction error:", error.message, error.stack);
          } else {
            console.error("DOCX extraction error:", error);
          }
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
        messageHistory.push({ role: "assistant", content: reply });
        console.log("Gemini reply:", reply);
        return NextResponse.json({ reply }, { status: 200 });
      }
    } else if (text) {
      messageHistory.push({ role: "user", content: text });
      console.log("Sending text to Gemini:", text.slice(0, 50) + "...");
      const reply = await getGeminiCompletion(messageHistory, model);
      messageHistory.push({ role: "assistant", content: reply });
      console.log("Gemini reply:", reply);
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
      console.error("Error in /api/talk:", error.message, error.stack);
    } else {
      console.error("Error in /api/talk:", error);
    }
    return NextResponse.json(
      { error: "Internal server error: " + (error as Error).message },
      { status: 500 }
    );
  }
}
