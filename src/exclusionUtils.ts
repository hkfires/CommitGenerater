/**
 * Lock file exclusion utilities for commit message generation.
 * Excludes package manager lock files and build artifacts that typically
 * shouldn't be included in commit message analysis.
 */

// Comprehensive list of lock files across different languages and package managers
const LOCK_FILES: string[] = [
  // --- JavaScript / Node.js ---
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'bun.lockb',
  '.yarnrc.yml',
  '.pnp.js',
  '.pnp.cjs',

  // --- Python ---
  'Pipfile.lock',
  'poetry.lock',
  'pdm.lock',
  '.pdm-lock.toml',
  'conda-lock.yml',
  'pylock.toml',
  'uv.lock',

  // --- Ruby ---
  'Gemfile.lock',

  // --- PHP ---
  'composer.lock',

  // --- Java / JVM ---
  'gradle.lockfile',

  // --- Rust ---
  'Cargo.lock',

  // --- Go ---
  'go.sum',
  'Gopkg.lock',

  // --- .NET ---
  'packages.lock.json',
  'paket.lock',

  // --- Swift / iOS ---
  'Package.resolved',
  'Podfile.lock',
  'Cartfile.resolved',

  // --- Dart / Flutter ---
  'pubspec.lock',

  // --- Elixir ---
  'mix.lock',

  // --- Haskell ---
  'stack.yaml.lock',
  'cabal.project.freeze',

  // --- Crystal ---
  'shard.lock',

  // --- Julia ---
  'Manifest.toml',

  // --- Terraform ---
  '.terraform.lock.hcl',

  // --- Nix ---
  'flake.lock',

  // --- Deno ---
  'deno.lock',

  // --- C/C++ ---
  'conan.lock',
  'vcpkg-lock.json',
];

// Directories to exclude entirely
const EXCLUDED_DIRECTORIES: string[] = [
  'node_modules',
  '.yarn/cache',
  '.yarn/unplugged',
  '.pnp',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.nuxt',
];

/**
 * Check if a file path matches any lock file pattern.
 * @param filePath - The file path to check (can be relative or absolute)
 * @returns true if the file should be excluded
 */
export function shouldExcludeLockFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').pop() || '';
  
  // Check if it's a known lock file
  if (LOCK_FILES.includes(fileName)) {
    return true;
  }
  
  // Check if it's in an excluded directory
  for (const dir of EXCLUDED_DIRECTORIES) {
    if (normalizedPath.includes(`/${dir}/`) || normalizedPath.startsWith(`${dir}/`)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Filter diff content to remove lock file changes.
 * This function parses a unified diff and removes hunks for excluded files.
 * @param diff - The full diff string
 * @returns Filtered diff with lock file changes removed
 */
export function filterDiffExcludingLockFiles(diff: string): string {
  if (!diff) {
    return diff;
  }

  const lines = diff.split('\n');
  const filteredLines: string[] = [];
  let currentFile = '';
  let skipCurrentFile = false;
  let inFileHeader = false;
  const skippedFiles: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect file header (diff --git a/... b/...)
    if (line.startsWith('diff --git ')) {
      // Extract file path from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      if (match) {
        currentFile = match[2];
        skipCurrentFile = shouldExcludeLockFile(currentFile);
        inFileHeader = true;
        
        if (skipCurrentFile) {
          skippedFiles.push(currentFile);
        }
      }
    }

    // If we're not skipping this file, include the line
    if (!skipCurrentFile) {
      filteredLines.push(line);
    }

    // Detect end of file header (start of actual diff content)
    if (inFileHeader && line.startsWith('@@')) {
      inFileHeader = false;
    }
  }

  // If files were skipped, add a note at the end
  if (skippedFiles.length > 0) {
    filteredLines.push('');
    filteredLines.push(`# Note: ${skippedFiles.length} lock file(s) excluded from diff analysis:`);
    for (const file of skippedFiles.slice(0, 5)) {
      filteredLines.push(`#   - ${file}`);
    }
    if (skippedFiles.length > 5) {
      filteredLines.push(`#   ... and ${skippedFiles.length - 5} more`);
    }
  }

  return filteredLines.join('\n');
}
