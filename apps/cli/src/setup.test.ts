import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { promptHidden } from "./setup";

/** A fake TTY input + a capturing output, so we can assert the secret is never echoed. */
function harness() {
  const stream = new PassThrough();
  (stream as unknown as { isTTY: boolean }).isTTY = true;
  (stream as unknown as { setRawMode: (m: boolean) => void }).setRawMode = () => {};
  const writes: string[] = [];
  const output = { write: (s: string) => (writes.push(String(s)), true) } as unknown as NodeJS.WritableStream;
  return { stream, input: stream as unknown as NodeJS.ReadStream, output, writes };
}

describe("promptHidden", () => {
  it("reads the secret but NEVER echoes it to the output", async () => {
    const { stream, input, output, writes } = harness();
    const p = promptHidden("API key: ", { input, output });
    stream.write("sk-secret-123\n");
    const answer = await p;
    expect(answer).toBe("sk-secret-123");
    expect(writes.join("")).toContain("API key:"); // the prompt label is shown
    expect(writes.join("")).not.toContain("sk-secret-123"); // ...but never the secret
  });

  it("applies backspace edits", async () => {
    const { stream, input, output } = harness();
    const DEL = String.fromCharCode(127);
    const p = promptHidden("k: ", { input, output });
    stream.write("abX");
    stream.write(DEL); // DEL removes the X
    stream.write("c\r"); // CR ends the line
    expect(await p).toBe("abc");
  });
});
