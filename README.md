TalkJS Chatbot with Next.js
A Next.js app integrating a TalkJS chatbot with Google Gemini for responses and AssemblyAI for voice message transcription.
Setup

Install Dependencies:
npm install


Configure Environment Variables:Create a .env.local file:
TALKJS_APP_ID=tess1K7E
TALKJS_SECRET_KEY=your_talkjs_secret_key
GEMINI_API_KEY=your_gemini_api_key
ASSEMBLYAI_API_KEY=your_assemblyai_api_key


Create Temporary Directory:
mkdir tmp


Run Locally:
npm run dev


Set Up Ngrok:
ngrok http 3000

Update the TalkJS webhook URL to https://your-ngrok-url.ngrok.io/api/talk.

Test:

Open http://localhost:3000.
Send text or voice messages to the chatbot.
Check console logs for transcription and responses.



Deployment (Vercel)

Remove FFmpeg dependency (Vercel doesn't support it):
Update src/app/api/talk/route.js to send .webm directly to AssemblyAI.


Push to GitHub.
Deploy via Vercel dashboard, adding environment variables.
Update TalkJS webhook to https://your-vercel-url/api/talk.

Troubleshooting

TalkJS Cannot read properties of undefined (reading 'ready'):
Check browser console for Failed to load TalkJS SDK.
Ensure https://cdn.talkjs.com/talk.js is accessible.
Verify network connectivity and try a different network.


TalkJS .mount Timeout:
Check browser console for errors.
Verify appId and network connectivity.
Test with minimal TalkJS setup.


Webhook Issues:
Use ngrok's web interface (http://localhost:4040) to inspect requests.
Ensure API keys are valid.



#   c h a t b o t  
 