/**
 * Regression guard: a timed-out LLM call must actually CLOSE its HTTP stream.
 *
 * runWithAbortTimeout bounds every fan-out call (planning + day calls) and
 * aborts the signal it hands to `llm.invoke`. @langchain/anthropic <1.3.13
 * never passed that signal to the HTTP request in streaming mode — it only
 * checked it between chunks — so a stream that stalled mid-response kept its
 * socket open until undici's 5-minute body timeout killed it. That surfaced in
 * Sentry as "TypeError: terminated" (MASTERSFIT-BACKEND-M, 2026-10-20), minutes
 * after the job had already retried and finished.
 *
 * The fake fetch below is a server that sends response headers and then never
 * a single byte — exactly the stall shape — and records whether the request's
 * signal was aborted.
 */
import { describe, it, expect } from "@jest/globals";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { runWithAbortTimeout, TimeoutError } from "./timeout.utils";

describe("LLM call abort on timeout", () => {
  it("aborts the underlying stalled stream, not just the promise", async () => {
    let requestSignal: AbortSignal | undefined;

    const stalledFetch = async (_url: any, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // Real undici errors the body when its request is aborted.
          requestSignal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError"))
          );
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    // Same shape as the fan-out: streaming + structured output + raw.
    const llm = new ChatAnthropic({
      model: "claude-haiku-4-5",
      anthropicApiKey: "test-key",
      streaming: true,
      maxRetries: 0,
      clientOptions: { fetch: stalledFetch as any },
    }).withStructuredOutput(
      {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      } as any,
      { name: "probe", includeRaw: true }
    );

    await expect(
      runWithAbortTimeout(
        (signal) => llm.invoke([new HumanMessage("hi")], { signal }),
        undefined,
        200,
        "Stalled stream probe"
      )
    ).rejects.toBeInstanceOf(TimeoutError);

    expect(requestSignal).toBeDefined();
    expect(requestSignal!.aborted).toBe(true);
  });
});
