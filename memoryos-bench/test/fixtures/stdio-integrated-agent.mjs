let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
JSON.parse(input);
process.stdout.write(JSON.stringify({
  output: {
    decision: "stdio_smoke",
    changes: [],
    trace: [{ type: "agent_step", name: "stdio smoke", known_failure_id: null }],
    memory_citations: [],
    cost: {
      input_tokens: 10,
      output_tokens: 5,
      cached_tokens: 0,
      api_cost: 0,
      local_compute_time_ms: 1
    }
  }
}));
