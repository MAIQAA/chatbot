import fetch from "node-fetch";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import mammoth from "mammoth";

export async function fetchFileToTemp(url, tempPath = null) {
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
    console.error("Fetch File Error:", error.message);
    throw error;
  }
}

export async function convertWebmToFlac(inputPath, outputPath) {
  console.log("Converting WebM to FLAC:", inputPath);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .audioCodec("flac")
      .audioChannels(1)
      .audioFrequency(16000)
      .on("end", () => {
        console.log("Audio conversion to FLAC completed");
        resolve(outputPath);
      })
      .on("error", (err) => {
        reject(new Error(`FFmpeg Error: ${err.message}`));
      })
      .run();
  });
}

export async function extractTextFromPDF(filePath) {
  console.log("Extracting text from PDF:", filePath);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("PDF extraction timed out after 10 seconds."));
    }, 10000);
  });

  const parsePromise = new Promise((resolve, reject) => {
    try {
      const loader = new PDFLoader(filePath);
      loader
        .load()
        .then((docs) => {
          if (!docs || docs.length === 0) {
            reject(new Error("No text extracted from PDF."));
          } else {
            const text = docs
              .map((doc) => doc.pageContent)
              .join("\n")
              .trim();
            if (!text) {
              reject(new Error("Extracted text is empty."));
            } else {
              console.log(
                "Successfully extracted text from PDF:",
                text.slice(0, 100) + "..."
              );
              resolve(text);
            }
          }
        })
        .catch((err) => {
          reject(new Error(`PDF parsing error: ${err.message}`));
        });
    } catch (error) {
      reject(new Error(`Failed to initialize PDF loader: ${error.message}`));
    }
  });

  try {
    const text = await Promise.race([parsePromise, timeoutPromise]);
    return text;
  } catch (error) {
    console.error("PDF Extraction Error:", error.message);
    throw new Error("Failed to extract text from PDF: " + error.message);
  }
}

export async function extractTextFromDocx(buffer) {
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
        error.message,
        error.stack
      );
      reject(new Error(`Failed to initialize DOCX parser: ${error.message}`));
    }
  });

  try {
    const text = await Promise.race([parsePromise, timeoutPromise]);
    return text;
  } catch (error) {
    console.error("DOCX Extraction Error:", error.message);
    throw new Error("Failed to extract text from DOCX: " + error.message);
  }
}

export async function transcribeAudio(filePath, assemblyAI) {
  console.log("Transcribing audio with AssemblyAI...");
  try {
    const transcript = await assemblyAI.transcripts.transcribe({
      audio: fs.createReadStream(filePath),
    });

    while (transcript.status !== "completed" && transcript.status !== "error") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = await assemblyAI.transcripts.get(transcript.id);
      transcript.status = status.status;
      transcript.text = status.text;
    }

    if (transcript.status === "error") {
      throw new Error("AssemblyAI transcription failed.");
    }

    console.log("Transcription:", transcript.text);
    return transcript.text || "";
  } catch (error) {
    console.error("AssemblyAI Error:", error.message);
    throw new Error("Failed to transcribe audio.");
  }
}

export async function getGeminiCompletion(messageHistory, model) {
  console.log("Preparing Gemini prompt...");
  try {
    let prompt = messageHistory
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
    console.error("Gemini API Error:", error.message);
    return "Sorry, I encountered an error while processing your request.";
  }
}
