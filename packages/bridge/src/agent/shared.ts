/**
 * The half of a runner that has nothing to do with any provider (AC-10.1).
 *
 * A runner is two things stacked: the vendor-specific part — how a request is
 * shaped, how tool calls arrive, what a turn looks like — and a much smaller
 * part that is the same whoever is answering. This module is that smaller part.
 *
 * Everything here was written for the first runner and none of it ever named a
 * vendor. It lives on its own so the second runner imports it instead of
 * copying it: two copies of the `BLOCKED:` parser would be two definitions of
 * "refused", and once they drift, a model that refused on one provider is
 * reported as having quietly written nothing on the other. One definition, one
 * answer, whoever was asked.
 */

/**
 * The contract every provider is held to.
 *
 * It names no tools, because the tools differ per runner — one drives a hosted
 * agent's built-in `Read`/`Edit`, another its own `read_file`/`apply_edit`. What
 * it fixes is the part the bridge depends on: do not search, change one element,
 * and answer with `DONE` or `BLOCKED: <reason>`. A runner appends one line
 * naming how its own tools are spelled, and changes nothing above it.
 */
export const SYSTEM_PROMPT = [
  'You are the writing half of a source-mapped visual editor.',
  '',
  'The element to change has already been located. Every request names the file, the',
  'line and the column that the build stamped into the source, and quotes the source',
  'around it as it is on disk right now.',
  '',
  'So: do not search. Do not look for a better place to make the change, do not open a',
  'file you were not given, and do not widen the edit to tidy anything up. Read the',
  'named file, apply the one described change, and stop.',
  '',
  'Reply `DONE` once the edit is written, or `BLOCKED: <reason>` if it cannot be made',
  'as described. Those are the only two replies that mean anything downstream.',
].join('\n');

/** {@link SYSTEM_PROMPT} plus the one paragraph only the calling runner can write. */
export function systemPromptWith(tools: string): string {
  return [SYSTEM_PROMPT, '', tools].join('\n');
}

/**
 * Tool names whose use means something was written.
 *
 * Spans providers on purpose: the built-in names a hosted agent reports, and the
 * `apply_edit` that this project's own chat-completions runner defines. A runner
 * asks this set rather than deciding for itself, so "did that call write?" has
 * one answer no matter which transcript it came out of.
 */
export const WRITING_TOOLS = new Set([
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Write',
  'apply_edit',
]);

/** The path a tool call names, under any of the keys a tool spells it with. */
export function pathOf(input: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * The refusal, if the agent gave one.
 *
 * Anchored to the start of a line: the prompt asks for `BLOCKED: <reason>` and
 * nothing else, and an agent that merely *mentions* being blocked in prose has
 * not refused. Guessing a refusal out of prose would turn a successful edit into
 * a reported failure, which is the same lie as the reverse.
 */
export const BLOCKED_LINE = /^\s*BLOCKED:[ \t]*(.+)$/m;

export function refusalIn(replies: readonly string[]): string | null {
  for (const reply of [...replies].reverse()) {
    const found = BLOCKED_LINE.exec(reply);
    if (found) return found[1]!.trim();
  }
  return null;
}
