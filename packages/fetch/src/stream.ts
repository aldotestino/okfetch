import { Result } from "better-result";
import type { ZodType } from "zod/v4";

import { ParseError, ValidationError } from "./errors";

const extractDataLine = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return null;
  }

  const dataContent = trimmed.slice(5).trim();
  if (!dataContent || dataContent === "[DONE]") {
    return null;
  }

  return dataContent;
};

const processStreamChunk = (
  dataContent: string,
  outputSchema?: ZodType,
  validateOutput = true
): Result<unknown, ParseError | ValidationError> => {
  if (!outputSchema) {
    return Result.ok(dataContent);
  }

  const parsedJson = Result.try({
    catch: (error) =>
      new ParseError({
        cause: error,
        message: "Failed to parse stream chunk as JSON",
      }),
    try: () => JSON.parse(dataContent),
  });
  if (parsedJson.isErr()) {
    return parsedJson;
  }

  if (!validateOutput) {
    return Result.ok(parsedJson.value);
  }

  const parsedChunk = outputSchema.safeParse(parsedJson.value);
  if (!parsedChunk.success) {
    return Result.err(
      new ValidationError({
        message: "Stream chunk did not match output schema",
        type: "output",
        zodError: parsedChunk.error,
      })
    );
  }

  return Result.ok(parsedChunk.data);
};

export const createParsedStream = <TRes>(
  responseBody: ReadableStream<Uint8Array>,
  outputSchema?: ZodType,
  validateOutput = true
): ReadableStream<TRes> => {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<TRes>({
    async cancel() {
      await reader.cancel();
    },
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            const lines = buffer.split("\n");
            for (const line of lines) {
              const dataContent = extractDataLine(line);
              if (dataContent === null) {
                continue;
              }

              const parsedChunk = processStreamChunk(
                dataContent,
                outputSchema,
                validateOutput
              );
              if (parsedChunk.isErr()) {
                controller.error(parsedChunk.error);
                return;
              }

              controller.enqueue(parsedChunk.value as TRes);
            }
          }

          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataContent = extractDataLine(line);
          if (dataContent === null) {
            continue;
          }

          const parsedChunk = processStreamChunk(
            dataContent,
            outputSchema,
            validateOutput
          );
          if (parsedChunk.isErr()) {
            controller.error(parsedChunk.error);
            return;
          }

          controller.enqueue(parsedChunk.value as TRes);
          return;
        }
      }
    },
  });
};
