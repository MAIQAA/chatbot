import fetch from "node-fetch";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
// import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import mammoth from "mammoth";
import { AssemblyAI } from "assemblyai";
import { Readable } from 'stream';
import pdfParse from 'pdf-parse';

export async function fetchFileToTemp(url: string, tempPath: string | null = null) {
  console.log("Fetching file:", url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (tempPath) {
      await fs.promises.mkdir("/tmp", { recursive: true }).catch((err) => {
        if (err.code !== "EEXIST") throw err;
      });
      await fs.promises.writeFile(tempPath, buffer);
    }

    return buffer;
  } catch (error) {
    console.error("Fetch File Error:", (error as Error).message);
    throw error;
  }
}

// export async function convertWebmToFlac(inputPath, outputPath) {
//   console.log("Converting WebM to FLAC:", inputPath);
//   return new Promise((resolve, reject) => {
//     ffmpeg(inputPath)
//       .output(outputPath)
//       .audioCodec("flac")
//       .audioChannels(1)
//       .audioFrequency(16000)
//       .on("end", () => {
//         console.log("Audio conversion to FLAC completed");
//         resolve(outputPath);
//       })
//       .on("error", (err) => {
//         reject(new Error(`FFmpeg Error: ${err.message}`));
//       })
//       .run();
//   });
// }


export async function convertWebmToFlac(webmBuffer: Buffer): Promise<Buffer> {
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



export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(pdfBuffer, { max: 1000 }); // Limit pages to avoid crashes
    if (!data.text || data.text.trim() === "") {
      throw new Error("No text extracted from PDF - it might be scanned or empty.");
    }
    return data.text;
  } catch (error) {
    throw new Error(`PDF parsing failed: ${(error as Error).message}`);
  }
}

export async function extractTextFromDocx(buffer: Buffer) {
  console.log("Extracting text from DOCX...");
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("DOCX extraction timed out after 5 seconds."));
    }, 5000);
  });

  const parsePromise = new Promise((resolve, reject) => {
    try {
      console.log("Buffer length:", buffer.length);
      mammoth
        .extractRawText({ buffer })
        .then((result) => {
          const text = result.value.trim();
          if (!text) {
            reject(new Error("No text extracted from DOCX."));
          } else {
            console.log(
              "Successfully extracted text from DOCX:",
              text.slice(0, 100) + "..."
            );
            resolve(text);
          }
        })
        .catch((err) => {
          console.error("DOCX parsing error:", err.message, err.stack);
          reject(new Error(`DOCX parsing error: ${err.message}`));
        });
    } catch (error) {
      console.error(
        "DOCX parser initialization error:",
        (error as Error).message,
        (error as Error).stack
      );
      reject(new Error(`Failed to initialize DOCX parser: ${(error as Error).message}`));
    }
  });

  try {
    const text = await Promise.race([parsePromise, timeoutPromise]);
    return text;
  } catch (error) {
    console.error("DOCX Extraction Error:", (error as Error).message);
    throw new Error(
      "Failed to extract text from DOCX: " + (error as Error).message
    );
  }
}



export async function transcribeAudio(flacBuffer: Buffer, assemblyAI: AssemblyAI): Promise<string> {
  try {
    const base64Audio = flacBuffer.toString('base64');
    const transcription = await assemblyAI.transcripts.transcribe({
      audio: `data:audio/flac;base64,${base64Audio}`,
    });
    if (transcription.status === "error") {
      throw new Error(`Transcription failed: ${transcription.error}`);
    }
    return transcription.text || "No transcription available";
  } catch (error) {
    throw new Error(`Transcription error: ${(error as Error).message}`);
  }
}

export async function getGeminiCompletion(messageHistory: { role: string; content: string; }[], model: { generateContent: (params: { contents: { role: string; parts: { text: string; }[]; }[]; generationConfig: { maxOutputTokens: number; temperature: number; }; }) => Promise<{ response: { text: () => string; }; }>; }) {
  console.log("Preparing Gemini prompt...");
  try {
    const prompt = messageHistory
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");
    console.log("Calling Gemini with prompt:", prompt);
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1200, // Approximately 300 words
        temperature: 0.7,
      },
    });

    const reply = result.response.text().trim();
    if (!reply) throw new Error("No content in Gemini response.");
    console.log("Gemini Response:", reply);
    return reply;
  } catch (error) {
    console.error("Gemini API Error:", (error as Error).message);
    return "Sorry, I encountered an error while processing your request.";
  }
}
