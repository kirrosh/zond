import { describe, test, expect } from "bun:test";
import { parseFile } from "../../src/core/parser/yaml-parser.ts";
import { runSuite } from "../../src/core/runner/executor.ts";

const EXAMPLE_PATH = `${import.meta.dir}/../../examples/jsonplaceholder.yaml`;

describe("JSONPlaceholder integration", () => {
  test("full pipeline: parse YAML → runSuite → verify results", async () => {
    const suite = await parseFile(EXAMPLE_PATH);
    expect(suite.name).toBe("JSONPlaceholder CRUD");

    const result = await runSuite(suite);

    expect(result.suite_name).toBe("JSONPlaceholder CRUD");
    expect(result.total).toBe(4);
    expect(result.started_at).toBeTruthy();
    expect(result.finished_at).toBeTruthy();

    // Step 1: Get post by ID
    const getPost = result.steps[0]!;
    expect(getPost.status).toBe("pass");
    expect(getPost.response!.status).toBe(200);
    expect(getPost.assertions.every((a) => a.passed)).toBe(true);

    // Step 2: Create post — JSONPlaceholder returns 201 with id: 101
    const createPost = result.steps[1]!;
    expect(createPost.status).toBe("pass");
    expect(createPost.response!.status).toBe(201);
    expect(createPost.captures["post_id"]).toBeDefined();

    // Step 3: List posts
    const listPosts = result.steps[2]!;
    expect(listPosts.status).toBe("pass");
    expect(listPosts.request.url).toContain("_limit=5");

    // Step 4: Get users
    const getUser = result.steps[3]!;
    expect(getUser.status).toBe("pass");
    expect(getUser.assertions.every((a) => a.passed)).toBe(true);

    // Overall: all should pass
    expect(result.passed).toBe(4);
    expect(result.failed).toBe(0);
  }, 15000); // 15s timeout for real HTTP

  test("inline YAML test with captures", async () => {
    const { validateSuite } = await import("../../src/core/parser/schema.ts");

    const suite = validateSuite({
      name: "Inline test",
      base_url: "https://jsonplaceholder.typicode.com",
      tests: [
        {
          name: "Get first post",
          GET: "/posts/1",
          expect: {
            status: 200,
            body: {
              id: { capture: "post_id", equals: 1 },
              userId: { capture: "user_id", type: "integer" },
            },
          },
        },
        {
          name: "Get user from post",
          GET: "/users/{{user_id}}",
          expect: {
            status: 200,
            body: {
              id: { equals: "{{user_id}}" },
              name: { type: "string" },
            },
          },
        },
      ],
    });

    const result = await runSuite(suite);
    expect(result.passed).toBe(2);
    expect(result.steps[0]!.captures["post_id"]).toBe(1);
    expect(result.steps[0]!.captures["user_id"]).toBe(1);
    expect(result.steps[1]!.request.url).toBe("https://jsonplaceholder.typicode.com/users/1");
  }, 15000);
});
