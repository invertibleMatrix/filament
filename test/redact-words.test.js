// @ts-check
// The secret redactor (core/redact.js) runs over everything Filament stores: the run files, the operation log, the
// usage records. A key's shape is matched where a key stands, never inside a word of the conversation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../src/core/redact.js";

// (fails before: yes — the `sk-` shape matched inside any word, so "task-graph-runner" was stored as "task-grap…",
// "disk-usage-monitor" as "disk-usag…", in every run file read back after the run)
test("a word with sk- inside it is left whole; a key is redacted wherever it stands as one", () => {
  for (const words of ["task-graph-runner", "the subtask-planning-notes", "disk-usage-monitor-2026", "risk-assessment-framework", "whisk-together-the-eggs"])
    assert.equal(redactSecrets(words), words, words);
  for (const [said, kept] of [
    ["sk-ant-api03-verysecretkeyvalue1234567890", "sk-ant-…"],
    ["key sk-live-abcdef0123456789 here", "key sk-live… here"],
    ['{"k":"sk-proj-abcdefghijklmnop"}', '{"k":"sk-proj…"}'],
    ["OPENAI_API_KEY=sk-abcd1234567890xyz", "OPENAI_API_KEY=sk-abcd…"],
    ["my_sk-abcd1234567890xyz", "my_sk-abcd…"],
  ])
    assert.equal(redactSecrets(said), kept, said);
});

// (fails before: yes — the run file redacts the event's JSON, where a newline is the two characters \ and n, so a key
// on a line of its own stood after a letter and was stored whole; so were one after a tab, a colour code or %20)
test("a key after a JSON escape, a colour code or a percent-encoded character is redacted, in a string and in its JSON", () => {
  const key = "sk-ant-api03-verysecretkeyvalue1234567890";
  for (const before of ["line one\n", "a\r\n", "col\t", "\u001b[32m", "Bearer%20", "key%3D", "'"]) {
    const said = before + key;
    const red = redactSecrets(JSON.stringify({ text: said }));
    assert.ok(!red.includes("verysecret"), JSON.stringify(red));
    assert.ok(!redactSecrets(said).includes("verysecret"), JSON.stringify(said));
    assert.ok(!redactSecrets({ text: said }).text.includes("verysecret"), JSON.stringify(said));
  }
  for (const words of ["line one\ntask-graph-runner", "\tdisk-usage-monitor-2026"])
    assert.equal(redactSecrets(JSON.stringify(words)), JSON.stringify(words), words);
});

// The review of 11-16, again: the other shapes stood behind \b, which the n of \n passes too; a terminal's other codes
// (ESC[2K, a progress line's erase) end in a letter as a colour's does.
// (fails before: yes — a GitHub or Google key on a line of its own, a key after ESC[2K, and one after a newline of JSON
// inside JSON, were stored whole)
test("every key shape after a newline in JSON, in JSON inside JSON, or a terminal's code is redacted", () => {
  for (const [key, secret] of [["ghp_abcdefghijklmnopqrstuvwxyz0123", "abcdefghijklmnop"], ["AIzaSyA-abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnop"], ["sk-ant-api03-verysecretkeyvalue1234567890", "verysecret"]])
    for (const before of ["log\n", "\u001b[2K", "\u001b[1G", "x_"]) {
      const said = before + key;
      assert.ok(!redactSecrets(JSON.stringify({ text: said })).includes(secret), JSON.stringify(said));
      assert.ok(!redactSecrets(JSON.stringify({ preview: JSON.stringify({ text: said }) })).includes(secret), `inside JSON inside JSON: ${JSON.stringify(said)}`);
      assert.ok(!redactSecrets(said).includes(secret), JSON.stringify(said));
    }
  assert.equal(redactSecrets(JSON.stringify("[tsk-ingest-worker-01]")), JSON.stringify("[tsk-ingest-worker-01]"));
});
