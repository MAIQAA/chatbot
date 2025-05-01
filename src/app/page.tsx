"use client";

import dynamic from "next/dynamic";
import ChatbotComponent from "@/components/ChatbotComponent";

const Chatbot = dynamic(() => Promise.resolve(ChatbotComponent), { ssr: false });

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center">
      <Chatbot />
    </main>
  );
}