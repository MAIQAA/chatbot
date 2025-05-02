/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
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
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Fetch File Error:", error.message, error.stack);
    } else {
      console.error("Fetch File Error:", error);
    }
    throw error;
  }
}

export async function convertWebmToFlac(webmBuffer: Buffer): Promise<Buffer> {
  console.log("Starting WebM to FLAC conversion...");
  console.log("WebM Buffer size:", webmBuffer.length, "bytes");
  try {
    return await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const readable = Readable.from(webmBuffer);

      const ffmpegProcess = ffmpeg(readable)
        .inputFormat("webm")
        .audioCodec("flac")
        .toFormat("flac")
        .on("start", (commandLine: string) => {
          console.log("FFmpeg process started with command:", commandLine);
        })
        .on("stderr", (line: string) => {
          const match = line.match(/frame=.*time=.*bitrate=.*speed=([\d.]+)/);
          if (match) {
            console.log("FFmpeg conversion progress:", line.trim());
          }
        })
        .on("error", (err: Error) => {
          console.error("FFmpeg error:", err.message, err.stack);
          reject(new Error(`FFmpeg conversion failed: ${err.message}`));
        })
        .on("end", () => {
          console.log("FFmpeg conversion finished");
          if (chunks.length === 0) {
            reject(new Error("No data received from FFmpeg conversion."));
          } else {
            resolve(Buffer.concat(chunks));
          }
        });

      const stream = ffmpegProcess.pipe();
      stream.on("data", (chunk: Buffer) => {
        console.log(
          "Received FFmpeg stream data chunk:",
          chunk.length,
          "bytes"
        );
        chunks.push(chunk);
      });
      stream.on("error", (err: Error) => {
        console.error("Stream error:", err.message, err.stack);
        reject(new Error(`Stream error: ${err.message}`));
      });
      stream.on("end", () => {
        console.log("FFmpeg stream ended");
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error("convertWebmToFlac Error:", error.message, error.stack);
    } else {
      console.error("convertWebmToFlac Error:", error);
    }
    throw error;
  }
}

export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  console.log("Starting PDF text extraction with pdf2json...");
  console.log("PDF Buffer size:", pdfBuffer.length, "bytes");

  try {
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error("Invalid or empty PDF buffer provided.");
    }

    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser();

      pdfParser.on(
        "pdfParser_dataError",
        (errData: Record<"parserError", Error>) => {
          console.error("pdf2json parsing error:", errData.parserError);
          reject(new Error(`PDF parsing error: ${errData.parserError}`));
        }
      );

      pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
        console.log("Raw pdfData:", JSON.stringify(pdfData, null, 2)); // Log raw data for debugging
        const pages = pdfData.Pages;

        if (!pages || pages.length === 0) {
          console.warn("No Pages in pdfData:", pdfData);
          reject(new Error("PDF structure not recognized or empty."));
          return;
        }

        let fullText = "";
        for (const page of pages) {
          const pageText = page.Texts.map((textItem: PDFTextItem) => {
            if (textItem.R && textItem.R.length > 0 && textItem.R[0].T) {
              return decodeURIComponent(textItem.R[0].T);
            }
            return "";
          }).join(" ");
          fullText += pageText + "\n";
        }

        const text = fullText.trim();
        if (!text) {
          console.warn(
            "No text extracted from PDF - it might be scanned or empty."
          );
          reject(new Error("No text extracted from PDF."));
        } else {
          console.log("PDF text extracted:", text.slice(0, 50) + "...");
          resolve(text);
        }
      });

      pdfParser.parseBuffer(pdfBuffer);
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error("pdf2json Error:", error.message, error.stack);
      if (error.message.includes("bad XRef entry")) {
        console.warn("PDF may be corrupted. Please try a different file.");
        throw new Error(
          "PDF is corrupted or unsupported. Please upload a valid file."
        );
      }
    } else {
      console.error("pdf2json Error:", error);
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
    if (error instanceof Error) {
      console.error("DOCX Extraction Error:", error.message, error.stack);
    } else {
      console.error("DOCX Extraction Error:", error);
    }
    throw new Error(
      `Failed to extract text from DOCX: ${(error as Error).message}`
    );
  }
}

export async function transcribeAudio(
  flacBuffer: Buffer,
  assemblyAI: AssemblyAI
): Promise<string> {
  console.log("Starting audio transcription with AssemblyAI...");
  console.log("FLAC Buffer size:", flacBuffer.length, "bytes");
  try {
    const base64Audio = flacBuffer.toString("base64");
    console.log("Sending audio to AssemblyAI...");
    const transcription = await assemblyAI.transcripts.transcribe({
      audio: `data:audio/flac;base64,${base64Audio}`,
    });
    console.log("AssemblyAI transcription response:", transcription);
    if (transcription.status === "error") {
      console.error("Transcription failed:", transcription.error);
      throw new Error(`Transcription failed: ${transcription.error}`);
    }
    const text = transcription.text || "";
    if (!text) {
      console.warn("No transcription text received from AssemblyAI.");
    }
    console.log("Transcription result:", text);
    return text;
  } catch (error) {
    if (error instanceof Error) {
      console.error("AssemblyAI Error:", error.message, error.stack);
    } else {
      console.error("AssemblyAI Error:", error);
    }
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
    console.log("Gemini Response:", reply);
    return reply;
  } catch (error) {
    if (error instanceof Error) {
      console.error("Gemini API Error:", error.message, error.stack);
    } else {
      console.error("Gemini API Error:", error);
    }
    return "Sorry, I encountered an error while processing your request.";
  }
}
