import type { ZodType } from "zod";

import type { Prettify } from "./type-utils";

type BasicAuth = {
  type: "basic";
  username: string;
  password: string;
};

type BearerAuth = {
  type: "bearer";
  token: string;
};

type CustomAuth = {
  type: "custom";
  prefix: string;
  value: string;
};

export type Auth = BasicAuth | BearerAuth | CustomAuth;

export type NonBodyMethods = "HEAD" | "OPTIONS";
export type BodyMethods = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
export type Method = BodyMethods | NonBodyMethods;

export type KanonicOptions = Prettify<
  Omit<RequestInit, "body" | "headers"> & {
    method?: Method;
    headers?: Record<string, string>;
    auth?: Auth;
    outputSchema?: ZodType;
    errorSchema?: ZodType;
    apiErrorDataSchema?: ZodType;
    baseURL?: string;
    params?: Record<string, string | number | boolean>;
    query?: Record<
      string,
      string | number | boolean | Array<string | number | boolean>
    >;
    // oxlint-disable-next-line typescript/no-explicit-any
    body?: any;
    timeout?: number;
    asStream?: boolean;
  }
>;
