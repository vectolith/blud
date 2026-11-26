import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";
import {
  preserveProfileMemoryCancellation,
  resolveProfileMemoryScope,
} from "../lib/profile-memory";

export default defineMemory({
  description: "Remember stable facts and preferences about the current user.",
  provider: preserveProfileMemoryCancellation(fileMemory()),
  scope: resolveProfileMemoryScope,
});
