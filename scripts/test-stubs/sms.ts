/**
 * Message capture for tests.
 *
 * The real queueMessage writes a Message row; here we keep them in an array so
 * a test can assert on how many texts a customer would have received. That
 * count is the point: the double-cancel bug's most visible symptom was two
 * apology texts for one failure.
 */

export const sent: Array<{ body: string; kind: string }> = [];

export async function queueMessage(input: { body: string; kind: string }) {
  sent.push({ body: input.body, kind: input.kind });
  return { id: `msg_${sent.length}` };
}

export function resetMessages() {
  sent.length = 0;
}
