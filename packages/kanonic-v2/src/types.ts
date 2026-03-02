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

type Auth = BasicAuth | BearerAuth;

export type KanonicOptions = Prettify<
  Omit<RequestInit, "body" | "headers"> & {
    headers?: Record<string, string>;
    auth: Auth;
    outputSchema?: ZodType;
    errorSchema?: ZodType;
  }
>;
