/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import ffmpeg from "fluent-ffmpeg";
import mammoth from "mammoth";
import { AssemblyAI } from "assemblyai";
import PDFParser from "pdf2json";
import fs from "fs/promises";
import path from "path";

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
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Fetch File Error:", error);
    throw error;
  }
}

export async function convertWebmToFlac(webmBuffer: Buffer): Promise<Buffer> {
  console.log("Starting WebM to FLAC conversion...");
  console.log("WebM Buffer size:", webmBuffer.length, "bytes");

  const tempInput = path.join("/tmp", `input-${Date.now()}.webm`);
  const tempOutput = path.join("/tmp", `output-${Date.now()}.flac`);

  try {
    // Write input buffer to temporary file
    await fs.writeFile(tempInput, webmBuffer);

    // Run FFmpeg with optimized settings
    return await new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .inputFormat("webm")
        .audioCodec("flac")
        .audioChannels(1)
        .audioFrequency(16000)
        .outputOptions("-compression_level 8")
        .toFormat("flac")
        .save(tempOutput)
        .on("start", (commandLine: string) => {
          console.log("FFmpeg command:", commandLine);
        })
        .on("stderr", (line: string) => {
          console.log("FFmpeg stderr:", line.trim());
        })
        .on("error", (err: Error) => {
          console.error("FFmpeg error:", err.message, err.stack);
          if (err.message.includes("ffmpeg not found")) {
            reject(new Error("FFmpeg binary not found in environment."));
          } else {
            reject(new Error(`FFmpeg conversion failed: ${err.message}`));
          }
        })
        .on("end", async () => {
          console.log("FFmpeg conversion finished");
          try {
            const flacBuffer = await fs.readFile(tempOutput);
            if (flacBuffer.length === 0) {
              reject(new Error("No data in converted FLAC file."));
            } else {
              console.log("FLAC buffer size:", flacBuffer.length, "bytes");
              resolve(flacBuffer);
            }
          } catch (readError) {
            reject(
              new Error(
                `Failed to read FLAC file: ${(readError as Error).message}`
              )
            );
          }
        });
    });
  } catch (error) {
    console.error("convertWebmToFlac Error:", error);
    throw error;
  } finally {
    await fs.unlink(tempInput).catch(() => {});
    await fs.unlink(tempOutput).catch(() => {});
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
  flacBuffer: Buffer,
  assemblyAI: AssemblyAI
): Promise<string> {
  console.log("Starting audio transcription...");
  console.log("FLAC Buffer size:", flacBuffer.length, "bytes");
  try {
    const base64Audio = flacBuffer.toString("base64");
    const transcription = await assemblyAI.transcripts.transcribe({
      audio: `data:audio/flac;base64,${base64Audio}`,
    });
    if (transcription.status === "error") {
      console.error("Transcription failed:", transcription.error);
      throw new Error(`Transcription failed: ${transcription.error}`);
    }
    const text = transcription.text || "";
    console.log("Transcription result:", text || "No text transcribed");
    return text;
  } catch (error) {
    console.error("Transcription error:", error);
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
    console.error("Gemini API error:", error);
    return "Sorry, I encountered an error while processing your request.";
  }
}
