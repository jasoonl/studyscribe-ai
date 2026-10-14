// Prints every tRPC procedure with its type and input shape (dev aid; `npx tsx scripts/dev/list-procedures.ts [prefix]`).
import { z } from "zod";
import { appRouter } from "../../server/routers";

const prefix = process.argv[2] ?? "";
const procedures = (appRouter as any)._def.procedures as Record<string, any>;
for (const [path, procedure] of Object.entries(procedures)) {
  if (!path.startsWith(prefix)) continue;
  const def = procedure._def;
  const inputs = (def.inputs ?? []) as unknown[];
  let shape = "";
  try {
    shape = inputs.map((input) => JSON.stringify((z as any).toJSONSchema(input, { unrepresentable: "any" }))).join(" & ");
  } catch {
    shape = "(input)";
  }
  shape = shape.replace(/"\$schema":"[^"]*",?/g, "").replace(/"additionalProperties":false,?/g, "");
  console.log(`${def.type.padEnd(8)} ${path} ${shape.slice(0, 600)}`);
}
process.exit(0);
