/**
 * Validates structured API error payloads for `4xx` responses.
 *
 * @category utils
 * @since 0.3.1
 */
export const validateClientErrors = (statusCode: number) =>
  statusCode >= 400 && statusCode < 500;

/**
 * Validates structured API error payloads for all `4xx` and `5xx` responses.
 *
 * @category utils
 * @since 0.3.1
 */
export const validateAllErrors = (statusCode: number) => statusCode >= 400;
