import { Logo } from "@web/components/ui/logo";
import { NewChat } from "./_components/new-chat";

export default function NewChatPage() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background px-4 pb-[8vh] text-foreground sm:px-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted/50 text-foreground shadow-xs">
            <Logo className="size-5" />
          </div>
          <h1 className="type-section-title">Blud</h1>
          <p className="type-supporting-body max-w-md text-muted-foreground">
            Your personal iMessage and browser agent. Ask Blud to handle
            bookings, errands, research, or inbox triage with your encrypted
            vault.
          </p>
        </div>
        <NewChat />
      </div>
    </div>
  );
}
