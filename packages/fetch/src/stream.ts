import { Result } from "better-result";

import { ParseError, ValidationError } from "./errors";
import { validateSchema } from "./schema";
import type { StandardSchemaV1 } from "./standard-schema";

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
  outputSchema?: StandardSchemaV1,
  validateOutput = true
): Promise<Result<unknown, ParseError | ValidationError>> => {
  if (!outputSchema) {
    return Promise.resolve(Result.ok(dataContent));
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
    return Promise.resolve(parsedJson);
  }

  if (!validateOutput) {
    return Promise.resolve(Result.ok(parsedJson.value));
  }

  return validateSchema(outputSchema, parsedJson.value).then((parsedChunk) => {
    if (!parsedChunk.success) {
      return Result.err(
        new ValidationError({
          issues: parsedChunk.issues,
          message: "Stream chunk did not match output schema",
          type: "output",
        })
      );
    }

    return Result.ok(parsedChunk.data);
  });
};

export const createParsedStream = <TRes>(
  responseBody: ReadableStream<Uint8Array>,
  outputSchema?: StandardSchemaV1,
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

              const parsedChunk = await processStreamChunk(
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

          const parsedChunk = await processStreamChunk(
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
