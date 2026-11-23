import type * as EveTools from "eve/tools";
import type { ToolContext } from "eve/tools";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dynamicContextFor,
  dynamicTool,
  evaluateDynamic,
  withEvaluableDynamic,
} from "@tests/helpers/dynamic";
import { toolContextFor } from "@tests/helpers/tool-context";
import type * as EnvModule from "@shared/environment";
import messaging from "@agent/tools/messaging";
import { sendMessageOutputSchema } from "@shared/chat/message-delivery";

const controls = vi.hoisted(() => ({
  // SAFETY: Tests replace only this optional configured E.164 phone number.
  phone: "+12025550123" as string | undefined,
  readContactSent: vi.fn<() => boolean | undefined>(),
  // SAFETY: The mock adds only zero-argument state reset callbacks.
  reset: [] as (() => void)[],
}));

vi.mock("eve/tools", async (importOriginal) =>
  withEvaluableDynamic(await importOriginal<typeof EveTools>())
);
vi.mock("eve/context", () => ({
  defineState<T>(name: string, initial: () => T) {
    let value = initial();
    if (name === "blud.contact-delivery")
      controls.readContactSent.mockImplementation(
        () => z.object({ sent: z.boolean() }).nullable().parse(value)?.sent
      );
    controls.reset.push(() => {
      value = initial();
    });
    return {
      get: () => value,
      update(update: (current: T) => T) {
        value = update(value);
      },
    };
  },
}));
vi.mock("@shared/environment", async (importOriginal) => {
  const original = await importOriginal<typeof EnvModule>();
  return {
    ...original,
    env: {
      ...original.env,
      get SENDBLUE_FROM_NUMBER() {
        return controls.phone;
      },
    },
  };
});

beforeEach(() => {
  for (const reset of controls.reset) reset();
  vi.clearAllMocks();
  controls.phone = "+12025550123";
});
afterEach(() => vi.restoreAllMocks());

describe("share_contact", () => {
  it("renders the contact in browser chat and suppresses repeats", async () => {
    const tool = await shareContactTool();
    const first = await tool.execute(
      { text: "Save my contact." },
      toolContext()
    );
    expect(first).toMatchObject({
      kind: "message",
      text: "Save my contact.",
      attachments: [
        {
          kind: "file",
          mimeType: "text/vcard",
          name: "Blud.vcf",
        },
      ],
    });
    const contact = sendMessageOutputSchema.parse(first);
    expect(
      contact.kind === "message" && contact.attachments?.[0]?.url
    ).toContain(
      "https://example.com/contacts/blud.vcf?phone=%2B12025550123&expires="
    );
    expect(controls.readContactSent()).toBe(true);
    expect(await tool.execute({ text: "Again." }, toolContext())).toBeNull();
  });

  it("fails without preparing a delivery when the number is unavailable", async () => {
    controls.phone = undefined;
    const tool = await shareContactTool();
    await expect(
      tool.execute({ text: "Save me." }, toolContext())
    ).rejects.toThrow("number is unavailable");
    expect(controls.readContactSent()).toBeUndefined();
  });

  it("rejects a conversation channel that cannot render a contact card", async () => {
    const tool = await shareContactTool();
    await expect(
      tool.execute({ text: "Save me." }, toolContext("studio"))
    ).rejects.toThrow("Sendblue or browser conversation");
    expect(controls.readContactSent()).toBeUndefined();
  });

  it("requires an authenticated workspace user and is root-only", async () => {
    const tool = await shareContactTool();
    expect(tool.availableInSubagents).toBe(false);
    const context = toolContext();
    await expect(
      tool.execute(
        { text: "Save me." },
        {
          ...context,
          session: {
            ...context.session,
            auth: { current: null, initiator: null },
          },
        }
      )
    ).rejects.toThrow("authenticated user");
    expect(controls.readContactSent()).toBeUndefined();
  });
});

async function shareContactTool() {
  const tools = await evaluateDynamic(
    messaging,
    dynamicContextFor({
      auth: toolContext().session.auth,
      sessionId: "session-1",
    })
  );
  return dynamicTool(tools, "share_contact");
}

function toolContext(channel = "eve"): ToolContext {
  return toolContextFor({
    auth: {
      current: {
        attributes: {
          conversationChannel: channel,
          conversationId: `${channel}:session-1`,
          workspaceId: "workspace-1",
        },
        authenticator: "authjs",
        principalId: "user-1",
        principalType: "user",
      },
      initiator: null,
    },
    callId: "contact-call-1",
    sessionId: "session-1",
    toolName: "share_contact",
  });
}
