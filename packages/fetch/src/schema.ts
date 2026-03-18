import type { StandardSchemaIssue, StandardSchemaV1 } from "./standard-schema";

type SchemaValidationSuccess<TValue> = {
  data: TValue;
  success: true;
};

type SchemaValidationFailure = {
  issues: readonly StandardSchemaIssue[];
  success: false;
};

export type SchemaValidationResult<TValue> =
  | SchemaValidationSuccess<TValue>
  | SchemaValidationFailure;

const createThrownIssue = (error: unknown): StandardSchemaIssue => ({
  message: error instanceof Error ? error.message : "Schema validation failed",
});

export const validateSchema = async <TSchema extends StandardSchemaV1>(
  schema: TSchema,
  value: unknown
): Promise<SchemaValidationResult<InferSchemaOutput<TSchema>>> => {
  try {
    const result = await schema["~standard"].validate(value);
    if (result.issues) {
      return {
        issues: result.issues,
        success: false,
      };
    }

    return {
      data: result.value as InferSchemaOutput<TSchema>,
      success: true,
    };
  } catch (error) {
    return {
      issues: [createThrownIssue(error)],
      success: false,
    };
  }
};

type InferSchemaOutput<TSchema extends StandardSchemaV1> =
  TSchema extends StandardSchemaV1<unknown, infer TOutput> ? TOutput : never;
