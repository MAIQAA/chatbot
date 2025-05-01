/* eslint-disable @typescript-eslint/no-unused-vars */
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
import PDFParser from "pdf2json";
import mammoth from "mammoth";
import { AssemblyAI } from "assemblyai";

// Convert WebM to FLAC in memory
export async function convertWebmToFlac(webmBuffer: Buffer): Promise<Buffer> {
  console.log("Starting WebM to FLAC conversion...");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = Readable.from(webmBuffer);

    const ffmpegProcess = ffmpeg(readable)
      .inputFormat("webm")
      .audioCodec("flac")
      .toFormat("flac")
      .on("error", (err: Error) => {
        console.error("FFmpeg error:", err.message);
        reject(new Error(`FFmpeg conversion failed: ${err.message}`));
      })
      .on("end", () => {
        console.log("FFmpeg conversion finished");
        resolve(Buffer.concat(chunks));
      });

    const stream = ffmpegProcess.pipe();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", (err: Error) =>
      reject(new Error(`Stream error: ${err.message}`))
    );
  });
}

// Extract text from PDF using pdf2json
export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  console.log("Extracting text from PDF...");
  const pdfParser = new PDFParser();
  return new Promise((resolve, reject) => {
    pdfParser.on("pdfParser_dataError", (errData: { parserError: Error }) => {
      console.error("PDFParser error:", errData.parserError.message);
      reject(new Error(`PDF parsing failed: ${errData.parserError.message}`));
    });
    pdfParser.on("pdfParser_dataReady", () => {
      const text = pdfParser.getRawTextContent();
      if (!text || text.trim() === "") {
        console.warn(
          "No text extracted from PDF - it might be scanned or empty."
        );
        reject(
          new Error(
            "No text extracted from PDF - it might be scanned or empty."
          )
        );
      } else {
        console.log(
          "PDF text extracted successfully:",
          text.slice(0, 50) + "..."
        );
        resolve(text);
      }
    });
    pdfParser.parseBuffer(pdfBuffer);
  });
}

// Extract text from DOCX using mammoth
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  console.log("Extracting text from DOCX...");
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (!text) {
      console.warn("No text extracted from DOCX.");
      throw new Error("No text extracted from DOCX.");
    }
    console.log(
      "Successfully extracted text from DOCX:",
      text.slice(0, 50) + "..."
    );
    return text;
  } catch (error) {
    console.error("DOCX Extraction Error:", (error as Error).message);
    throw new Error(
      `Failed to extract text from DOCX: ${(error as Error).message}`
    );
  }
}

// Transcribe audio using AssemblyAI
export async function transcribeAudio(
  flacBuffer: Buffer,
  assemblyAI: AssemblyAI
): Promise<string> {
  console.log("Transcribing audio...");
  try {
    const base64Audio = flacBuffer.toString("base64");
    const transcription = await assemblyAI.transcripts.transcribe({
      audio: `data:audio/flac;base64,${base64Audio}`,
    });
    if (transcription.status === "error") {
      console.error("Transcription failed:", transcription.error);
      throw new Error(`Transcription failed: ${transcription.error}`);
    }
    const text = transcription.text || "No transcription available";
    console.log("Transcription result:", text);
    return text;
  } catch (error) {
    console.error("Transcription error:", (error as Error).message);
    throw new Error(`Transcription error: ${(error as Error).message}`);
  }
}

// Call Gemini API for response
export async function getGeminiCompletion(
  messageHistory: { role: string; content: string }[],
  model: {
    generateContent: (params: {
      contents: { role: string; parts: { text: string }[] }[];
      generationConfig: { maxOutputTokens: number; temperature: number };
    }) => Promise<{ response: { text: () => string } }>;
  }
): Promise<string> {
  console.log("Preparing Gemini prompt...");
  try {
    const prompt = messageHistory
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");
    console.log("Calling Gemini with prompt:", prompt.slice(0, 50) + "...");
    const result = await model.generateContent({
      contents: messageHistory.map((msg) => ({
        role: msg.role === "system" ? "system" : "user",
        parts: [{ text: msg.content }],
      })),
      generationConfig: {
        maxOutputTokens: 1200, // Approximately 300 words
        temperature: 0.7,
      },
    });

    const reply = result.response.text().trim();
    if (!reply) {
      console.warn("No content in Gemini response.");
      throw new Error("No content in Gemini response.");
    }
    console.log("Gemini Response:", reply);
    return reply;
  } catch (error) {
    console.error("Gemini API Error:", (error as Error).message);
    return "Sorry, I encountered an error while processing your request.";
  }
}
