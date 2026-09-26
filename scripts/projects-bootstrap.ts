import path from 'path';
import fs from 'fs';
import { bootstrapProjectsYaml } from '../src/server/projectsRegistry';

async function main() {
  const vaultPath = process.argv[2] || process.env.VAULT_PATH;
  if (!vaultPath) {
    console.error('Usage: tsx scripts/projects-bootstrap.ts <vaultPath>');
    process.exit(1);
  }

  console.log(`Bootstrapping projects.yaml for vault at: ${vaultPath}`);
  try {
    const yamlPath = await bootstrapProjectsYaml(vaultPath);
    console.log(`Successfully generated projects registry at: ${yamlPath}`);
  } catch (err: any) {
    console.error(`Bootstrap failed: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
