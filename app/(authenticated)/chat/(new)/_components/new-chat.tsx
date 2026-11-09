"use client";

import { useEveAgent } from "eve/react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@web/components/ai-elements/prompt-input";
import { chatTitle, messageContent } from "../../_lib/message-input";
import { api } from "@web/trpc/client";

const starterPrompts = [
  "Book 2 movie tickets tonight",
  "Triage my unread Gmail & draft replies",
  "Find the best flights to Tokyo next month",
  "Monitor a product price every morning",
] as const;

export function NewChat() {
  const router = useRouter();
  const { mutateAsync: saveChat } = api.chats.save.useMutation();
  const pendingTitle = useRef<string | undefined>(undefined);
  const isSubmitting = useRef(false);
  const navigationStarted = useRef(false);
  const agent = useEveAgent({
    onSessionChange(session) {
      if (session === undefined || navigationStarted.current) return;
      navigationStarted.current = true;
      const path = `/chat/${encodeURIComponent(session.sessionId)}`;
      void saveChat({
        sessionId: session.sessionId,
        title: pendingTitle.current,
      })
        .catch(() => undefined)
        .then(() => {
          router.replace(path);
          return undefined;
        });
      pendingTitle.current = undefined;
    },
  });

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (
      (text.length === 0 && message.files.length === 0) ||
      isSubmitting.current
    ) {
      return;
    }
    isSubmitting.current = true;
    pendingTitle.current = chatTitle(message);
    try {
      await agent.send(messageContent(message));
    } finally {
      isSubmitting.current = false;
    }
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <PromptInput compact onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-0"
            placeholder="Ask Blud to browse, book, research, or manage your inbox…"
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {starterPrompts.map((prompt) => (
          <button
            className="rounded-full border border-border bg-muted/40 px-3 py-1.5 type-caption text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            key={prompt}
            onClick={() => {
              void handleSubmit({ files: [], text: prompt });
            }}
            type="button"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
