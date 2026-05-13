import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseBody, parseQuery } from "../lib/handler";
import { ValidationError } from "../lib/errors";

const bodySchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1),
  q: z.string().min(1),
});

describe("handler smoke (parseBody / parseQuery)", () => {
  it("parseBody returns the parsed value on valid input", () => {
    const out = parseBody(bodySchema, { email: "a@b.co", age: 30 });
    expect(out).toEqual({ email: "a@b.co", age: 30 });
  });

  it("parseBody throws ValidationError on invalid input", () => {
    expect(() => parseBody(bodySchema, { email: "nope", age: -1 })).toThrow(
      ValidationError,
    );
  });

  it("parseBody ValidationError carries flattened zod details", () => {
    try {
      parseBody(bodySchema, { email: "nope", age: -1 });
      throw new Error("parseBody should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      if (err instanceof ValidationError) {
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("VALIDATION_ERROR");
        expect(err.details).toBeDefined();
      }
    }
  });

  it("parseQuery coerces string query params to typed values", () => {
    const out = parseQuery(querySchema, { page: "3", q: "hello" });
    expect(out).toEqual({ page: 3, q: "hello" });
  });

  it("parseQuery throws ValidationError on missing required fields", () => {
    expect(() => parseQuery(querySchema, { page: "1" })).toThrow(
      ValidationError,
    );
  });
});
