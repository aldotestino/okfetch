/**
 * Internal type utilities.
 *
 * @internal
 * @since 0.3.1
 */
/** @internal */
export type Prettify<T> = {
  [key in keyof T]: T[key];
} & {};
