#!/usr/bin/env tsx
import { cpSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(process.cwd(), 'src', 'db');
const destDir = join(process.cwd(), 'dist', 'db');

console.log(`Copying migrations from ${srcDir} to ${destDir}`);
cpSync(srcDir, destDir, { recursive: true });
console.log('Migrations copied successfully');
