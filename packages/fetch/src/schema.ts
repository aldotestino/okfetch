/**
 * Schema utilities shared across okfetch packages.
 *
 * @since 0.3.1
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";

type SchemaValidationSuccess<TValue> = {
  data: TValue;
  success: true;
};

type SchemaValidationFailure = {
  issues: readonly StandardSchemaV1.Issue[];
  success: false;
};

/**
 * Result returned by {@link validateSchema}.
 *
 * @category utils
 * @since 0.3.1
 */
export type SchemaValidationResult<TValue> =
  | SchemaValidationSuccess<TValue>
  | SchemaValidationFailure;

const createThrownIssue = (error: unknown): StandardSchemaV1.Issue => ({
  message: error instanceof Error ? error.message : "Schema validation failed",
});

/**
 * Validates an unknown value with any Standard Schema v1 compatible schema.
 *
 * @category utils
 * @since 0.3.1
 */
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

/** @internal */
type InferSchemaOutput<TSchema extends StandardSchemaV1> =
  TSchema extends StandardSchemaV1<unknown, infer TOutput> ? TOutput : never;
