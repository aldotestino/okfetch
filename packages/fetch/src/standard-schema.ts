export type StandardSchemaV1<Input = unknown, Output = Input> = {
  readonly "~standard": StandardSchemaV1Props<Input, Output>;
};

export type StandardSchemaV1Props<Input = unknown, Output = Input> = {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (
    value: unknown,
    options?: StandardSchemaV1Options
  ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
};

export type StandardSchemaV1Types<Input = unknown, Output = Input> = {
  readonly input: Input;
  readonly output: Output;
};

export type StandardSchemaV1Options = {
  readonly libraryOptions?: Record<string, unknown> | undefined;
};

export type StandardSchemaV1Result<Output> =
  | StandardSchemaV1SuccessResult<Output>
  | StandardSchemaV1FailureResult;

export type StandardSchemaV1SuccessResult<Output> = {
  readonly value: Output;
  readonly issues?: undefined;
};

export type StandardSchemaV1FailureResult = {
  readonly issues: readonly StandardSchemaIssue[];
};

export type StandardSchemaIssue = {
  readonly message: string;
  readonly path?:
    | readonly (PropertyKey | StandardSchemaPathSegment)[]
    | undefined;
};

export type StandardSchemaPathSegment = {
  readonly key: PropertyKey;
};

export type InferInput<TSchema extends StandardSchemaV1> = NonNullable<
  TSchema["~standard"]["types"]
>["input"];

export type InferOutput<TSchema extends StandardSchemaV1> = NonNullable<
  TSchema["~standard"]["types"]
>["output"];
