"use client";

import dynamic from "next/dynamic";
import ChatbotComponent from "@/components/ChatbotComponent";

const Chatbot = dynamic(() => Promise.resolve(ChatbotComponent), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-100 to-white flex items-center justify-center">
      <Chatbot />
    </main>
  );
}
