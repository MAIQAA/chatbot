"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import TalkJSComponent from "@/components/TalkJSComponent";

const TalkJS = dynamic(() => Promise.resolve(TalkJSComponent), { ssr: false });

export default function Home() {
  const [loadingError, setLoadingError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (
        document
          .getElementById("talkjs-container")
          ?.innerHTML.includes("Loading chat...")
      ) {
        setLoadingError(
          "Failed to load chat. Please refresh the page or check your network connection."
        );
      }
    }, 60000); // 10 seconds timeout

    return () => clearTimeout(timeout);
  }, []);

  return (
    <main>
      <div
        id="talkjs-container"
        style={{
          height: "500px",
          width: "90%",
          maxWidth: "800px",
          margin: "30px auto",
          border: "1px solid #ddd",
          borderRadius: "8px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {loadingError ? (
          <p style={{ color: "red", textAlign: "center", padding: "20px" }}>
            {loadingError}
          </p>
        ) : (
          <i>Loading chat...</i>
        )}
      </div>
      <TalkJS />
    </main>
  );
}
