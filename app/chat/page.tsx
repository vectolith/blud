"use client";

import { useState } from "react";
import {
  AudioLines,
  ChevronDown,
  CircleUserRound,
  Menu,
  Mic,
  Plus,
  Sparkles,
  SquarePen,
} from "lucide-react";

export default function BludChatPage() {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");

  function submitDraft() {
    if (!draft.trim()) return;
    setNotice("The BLUD chat runtime is not connected to this page yet.");
  }

  return (
    <main className="blud-shell">
      <header className="blud-topbar">
        <button className="blud-icon-button" aria-label="Open navigation"><Menu /></button>
        <button className="blud-brand" aria-label="BLUD home">
          <span>BLUD <span className="blud-muted">Agent</span></span>
          <ChevronDown size={16} />
          <span className="blud-status" aria-label="Status" />
        </button>
        <div className="blud-top-actions">
          <button className="blud-icon-button" aria-label="New task"><SquarePen /></button>
          <button className="blud-avatar" aria-label="Profile"><CircleUserRound /></button>
        </div>
      </header>

      <section className="blud-center" aria-label="Start a task">
        <div className="blud-orb" aria-hidden="true"><Sparkles /></div>
        <h1>What can I take care of?</h1>
        <p>Give BLUD a task. It will work through it.</p>
        <button className="blud-live" onClick={() => setNotice("Voice interaction is not connected yet.")}>
          <AudioLines size={20} /> Talk to BLUD
        </button>
      </section>

      <div className="blud-composer-wrap">
        <div className="blud-composer">
          <button className="blud-composer-button" aria-label="Add attachment" onClick={() => setNotice("Attachments are not connected yet.")}><Plus /></button>
          <textarea
            aria-label="Message BLUD"
            rows={1}
            value={draft}
            placeholder="Ask BLUD to take care of something"
            onChange={(e) => { setDraft(e.target.value); setNotice(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitDraft(); } }}
          />
          <button className="blud-composer-button" aria-label="Use microphone" onClick={() => setNotice("Voice input is not connected yet.")}><Mic /></button>
          <button className="blud-send" aria-label="Start task" onClick={submitDraft}><AudioLines /></button>
        </div>
        {notice && <p className="blud-notice" role="status">{notice}</p>}
      </div>

      <style jsx>{`
        .blud-shell { min-height:100dvh; color:#f4f4f5; background:radial-gradient(ellipse 90% 58% at 100% 100%, rgba(25,48,150,.46) 0%, rgba(11,17,49,.38) 34%, transparent 72%), radial-gradient(ellipse 70% 50% at 50% 100%, rgba(22,28,82,.30), transparent 75%), #050506; display:flex; flex-direction:column; padding:20px 24px 28px; position:relative; overflow:hidden; }
        .blud-topbar { display:flex; align-items:center; gap:20px; min-height:56px; z-index:1; }
        .blud-icon-button,.blud-composer-button { border:0; background:transparent; color:#d4d4d8; display:grid; place-items:center; cursor:pointer; }
        .blud-icon-button { width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.075); }
        .blud-icon-button :global(svg) { width:23px;height:23px; }
        .blud-brand { display:flex;align-items:center;gap:7px;background:transparent;border:0;color:#e5e5e9;font-size:18px;font-weight:600; }
        .blud-muted { color:#9696a3;font-weight:400; }
        .blud-status { width:8px;height:8px;border-radius:50%;background:#6479ff;margin-left:6px; }
        .blud-top-actions { margin-left:auto;display:flex;align-items:center;gap:12px; }
        .blud-avatar { width:50px;height:50px;border-radius:50%;border:1px solid #34354a;background:linear-gradient(145deg,#2d3dd1,#11131b);color:white;display:grid;place-items:center; }
        .blud-center { margin:auto;display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px; padding:50px 0 120px; z-index:1; }
        .blud-orb { width:60px;height:60px;display:grid;place-items:center;margin-bottom:12px;color:#fff; }
        .blud-orb :global(svg) { width:46px;height:46px;stroke-width:1.3;filter:drop-shadow(0 0 18px rgba(95,105,255,.55)); }
        .blud-orb { background:conic-gradient(from 210deg,#4167ff,#7a4cff,#df477d,#e4b64e,#3bcbab,#4167ff); -webkit-background-clip:text;background-clip:text;color:transparent; }
        .blud-center h1 { font-size:clamp(28px,5vw,42px);font-weight:550;letter-spacing:-.035em;line-height:1.15;margin:0; }
        .blud-center p { font-size:18px;color:#9a9aa5;margin:0; }
        .blud-live { border:0;border-radius:999px;background:#191a20;color:#eee;padding:16px 24px;display:flex;gap:12px;align-items:center;font-size:17px;margin-top:14px;cursor:pointer; }
        .blud-composer-wrap { width:min(100%,900px);margin:0 auto;z-index:1; }
        .blud-composer { min-height:82px;border-radius:999px;background:rgba(28,29,37,.92);border:1px solid rgba(255,255,255,.055);box-shadow:0 16px 60px rgba(0,0,0,.25);display:flex;align-items:center;gap:14px;padding:12px 16px 12px 24px; }
        .blud-composer textarea { flex:1;resize:none;max-height:180px;min-height:24px;background:transparent;border:0;outline:none;color:#f4f4f5;font:inherit;font-size:17px;line-height:1.5; }
        .blud-composer textarea::placeholder { color:#9696a1; }
        .blud-composer-button { width:38px;height:38px;flex-shrink:0; }
        .blud-composer-button :global(svg) { width:24px;height:24px; }
        .blud-send { flex-shrink:0;width:58px;height:58px;border:0;border-radius:50%;background:#2738df;color:white;display:grid;place-items:center;cursor:pointer;box-shadow:0 0 28px rgba(56,70,255,.18); }
        .blud-send :global(svg) { width:26px;height:26px; }
        .blud-notice { color:#a6a6b2;text-align:center;font-size:13px;margin-top:12px; }
        @media(max-width:640px) { .blud-shell {padding:16px 14px 22px;} .blud-topbar {gap:12px;} .blud-icon-button {width:46px;height:46px;} .blud-avatar {width:46px;height:46px;} .blud-center {padding:30px 0 110px;gap:14px;} .blud-center h1 {font-size:30px;} .blud-center p {font-size:15px;} .blud-composer {min-height:70px;padding:9px 10px 9px 15px;gap:8px;} .blud-send {width:50px;height:50px;} .blud-composer textarea {font-size:16px;} }
      `}</style>
    </main>
  );
}
