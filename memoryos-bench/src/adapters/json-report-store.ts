import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
export async function prepareJsonReportTarget(path: string): Promise<string> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const preflight = `${target}.preflight-${process.pid}`;
  await writeFile(preflight, "", { encoding: "utf8", flag: "wx" });
  await unlink(preflight);
  return target;
}

export async function writeJsonReport(report: unknown, path: string): Promise<string> {
  const target = await prepareJsonReportTarget(path);
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}
