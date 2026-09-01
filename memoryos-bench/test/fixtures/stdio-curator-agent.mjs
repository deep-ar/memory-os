let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
process.stdout.write(JSON.stringify({
  output: {
    memory_delta: {
      expected_revision: request.episode.prior_memory.revision,
      reflection: { trigger: "manual" },
      concepts: [{
        id: "stdio-smoke-concept",
        project_id: request.episode.project_id,
        canonical_name: "stdio smoke",
        concept_type: "test"
      }],
      claims: [],
      evidence: [],
      contexts: []
    }
  },
  cost: {
    input_tokens: 12,
    output_tokens: 7,
    cached_tokens: 0,
    tool_calls: 0,
    api_cost: 0
  }
}));
