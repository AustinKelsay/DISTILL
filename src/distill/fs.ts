import fs from "node:fs";
import path from "node:path";

export function expandHome(inputPath: string): string {
  if (!inputPath.startsWith("~/")) {
    return inputPath;
  }

  const home = process.env.HOME;
  if (!home) {
    return inputPath;
  }

  return path.join(home, inputPath.slice(2));
}

export function pathExists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}

export function countFiles(targetPath: string): number {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return 1;
  }

  let total = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const childPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += countFiles(childPath);
    } else {
      total += 1;
    }
  }

  return total;
}

export function findExecutable(binaryName: string): string | undefined {
  const envPath = process.env.PATH;
  if (!envPath) {
    return undefined;
  }

  for (const part of envPath.split(path.delimiter)) {
    const candidate = path.join(part, binaryName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}
