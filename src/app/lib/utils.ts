/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import mammoth from "mammoth";
import { AssemblyAI } from "assemblyai";
import PDFParser from "pdf2json";

interface PDFTextItem {
  R: { T: string }[];
}

interface PDFPage {
  Texts: PDFTextItem[];
}

interface PDFData {
  Pages?: PDFPage[];
}

export async function fetchFileToTemp(url: string): Promise<Buffer> {
  console.log("Fetching file:", url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log("Fetched buffer size:", buffer.length, "bytes");
    return buffer;
  } catch (error) {
    console.error("Fetch File Error:", error);
    throw new Error(`Failed to fetch file: ${(error as Error).message}`);
  }
}

export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  console.log("Starting PDF text extraction...");
  console.log("PDF Buffer size:", pdfBuffer.length, "bytes");
  try {
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error("Invalid or empty PDF buffer.");
    }
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser();
      pdfParser.on(
        "pdfParser_dataError",
        (errData: Record<"parserError", Error>) => {
          console.error("PDF parsing error:", errData.parserError);
          reject(
            new Error(`PDF parsing error: ${errData.parserError.message}`)
          );
        }
      );
      pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
        const pages = pdfData.Pages;
        if (!pages || pages.length === 0) {
          console.warn("No pages in PDF data.");
          reject(new Error("PDF structure not recognized or empty."));
          return;
        }
        let fullText = "";
        for (const page of pages) {
          const pageText = page.Texts.map((textItem: PDFTextItem) =>
            textItem.R?.[0]?.T ? decodeURIComponent(textItem.R[0].T) : ""
          ).join(" ");
          fullText += pageText + "\n";
        }
        const text = fullText.trim();
        if (!text) {
          console.warn("No text extracted from PDF.");
          reject(new Error("No text extracted from PDF."));
        } else {
          console.log("PDF text extracted:", text.slice(0, 50) + "...");
          resolve(text);
        }
      });
      pdfParser.parseBuffer(pdfBuffer);
    });
  } catch (error) {
    console.error("PDF extraction error:", error);
    if ((error as Error).message.includes("bad XRef entry")) {
      throw new Error("PDF is corrupted or unsupported.");
    }
    throw new Error(
      `Failed to extract text from PDF: ${(error as Error).message}`
    );
  }
}

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  console.log("Extracting text from DOCX...");
  console.log("DOCX Buffer size:", buffer.length, "bytes");
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (!text) {
      console.warn("No text extracted from DOCX.");
      throw new Error("No text extracted from DOCX.");
    }
    console.log("DOCX text extracted:", text.slice(0, 50) + "...");
    return text;
  } catch (error) {
    console.error("DOCX extraction error:", error);
    throw new Error(
      `Failed to extract text from DOCX: ${(error as Error).message}`
    );
  }
}

export async function transcribeAudio(
  buffer: Buffer,
  assemblyAI: AssemblyAI,
  mimeType: string
): Promise<string> {
  console.log("Starting audio transcription...");
  console.log("Buffer size:", buffer.length, "bytes", "MIME type:", mimeType);
  try {
    if (!buffer || buffer.length === 0) {
      throw new Error("Invalid or empty audio buffer");
    }
    const base64Audio = buffer.toString("base64");
    console.log("Base64 audio length:", base64Audio.length);
    const audioFormat = mimeType === "audio/webm" ? "webm" : "flac";
    const transcription = await assemblyAI.transcripts.transcribe({
      audio: `data:audio/${audioFormat};base64,${base64Audio}`,
    });
    if (transcription.status === "error") {
      console.error("Transcription failed:", transcription.error);
      throw new Error(`Transcription failed: ${transcription.error}`);
    }
    const text = transcription.text || "";
    console.log("Transcription result:", text || "No text transcribed");
    return text;
  } catch (error) {
    console.error("Transcription error:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw new Error(`Failed to transcribe audio: ${(error as Error).message}`);
  }
}

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
    const userMessages = messageHistory
      .filter((msg) => msg.role !== "system")
      .map((msg) => msg.content)
      .join("\n");
    const systemInstruction =
      messageHistory.find((msg) => msg.role === "system")?.content || "";
    const prompt = systemInstruction
      ? `${systemInstruction}\n${userMessages}`
      : userMessages;
    console.log("Calling Gemini with prompt:", prompt.slice(0, 50) + "...");
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1200,
        temperature: 0.7,
      },
    });
    const reply = result.response.text().trim();
    if (!reply) throw new Error("No content in Gemini response.");
    console.log("Gemini response:", reply.slice(0, 50) + "...");
    return reply;
  } catch (error) {
    console.error("Gemini API error:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return "Sorry, I encountered an error while processing your request.";
  }
}
