export const validateClientErrors = (statusCode: number) =>
  statusCode >= 400 && statusCode < 500;

export const validateAllErrors = (statusCode: number) => statusCode >= 400;
