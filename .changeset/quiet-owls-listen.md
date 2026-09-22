---
"@okfetch/api": patch
---

Honor per-call `validateOutput` and `shouldValidateError` overrides in `@okfetch/api`. Both are typed as request overrides, but the endpoint builder wrote the client-level value after spreading the overrides, so a call could never change them.
