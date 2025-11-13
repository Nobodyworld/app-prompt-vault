#!/usr/bin/env node

/**
 * @fileoverview Docker Deployment Script for Prompt Vault
 *
 * This script provides easy management of Docker containers for Prompt Vault deployment.
 * It supports common operations like start, stop, restart, logs, and status checking.
 *
 * Usage:
 *   node scripts/docker-deploy.js <command>
 *
 * Commands:
 *   start     - Start the Prompt Vault containers
 *   stop      - Stop the Prompt Vault containers
 *   restart   - Restart the Prompt Vault containers
 *   status    - Show status of containers
 *   logs      - Show container logs
 *   build     - Build the Docker images
 *   clean     - Remove containers and volumes (WARNING: destroys data)
 *
 * Environment Variables:
 *   DOCKER_COMPOSE_FILE - Path to docker-compose.yml (default: ./docker-compose.yml)
 *   PROMPT_VAULT_PORT   - Port to expose the application on (default: 3001)
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSE_FILE = process.env.DOCKER_COMPOSE_FILE || './docker-compose.yml';
const PROJECT_ROOT = resolve(__dirname, '..');

// Colors for console output
const colors: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m',
};

function log(message: string, color = 'reset'): void {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message: string): void {
    log(`❌ Error: ${message}`, 'red');
}

function success(message: string): void {
    log(`✅ ${message}`, 'green');
}

function info(message: string): void {
    log(`ℹ️  ${message}`, 'blue');
}

function warning(message: string): void {
    log(`⚠️  ${message}`, 'yellow');
}

function checkDocker() {
    try {
        execSync('docker --version', { stdio: 'pipe' });
        execSync('docker-compose --version', { stdio: 'pipe' });
        return true;
    } catch (err) {
        return false;
    }
}

function checkComposeFile() {
    const composePath = resolve(PROJECT_ROOT, COMPOSE_FILE);
    if (!existsSync(composePath)) {
        error(`Docker Compose file not found: ${composePath}`);
        error('Make sure docker-compose.yml exists in the project root.');
        process.exit(1);
    }
    return composePath;
}

function runCommand(command: string, description: string) {
    try {
        info(`Running: ${description}`);
        const result = execSync(command, {
            cwd: PROJECT_ROOT,
            stdio: 'inherit',
            env: { ...process.env, COMPOSE_FILE: COMPOSE_FILE }
        });
        return result;
    } catch (err) {
        error(`Failed to ${description.toLowerCase()}`);
        process.exit(1);
    }
}

function showUsage() {
    log('');
    log(`${colors.bold}Prompt Vault Docker Deployment Script${colors.reset}`);
    log('');
    log('Usage:');
    log('  node scripts/docker-deploy.js <command>');
    log('');
    log('Commands:');
    log('  start     Start the Prompt Vault containers');
    log('  stop      Stop the Prompt Vault containers');
    log('  restart   Restart the Prompt Vault containers');
    log('  status    Show status of containers');
    log('  logs      Show container logs');
    log('  build     Build the Docker images');
    log('  clean     Remove containers and volumes (WARNING: destroys data)');
    log('  help      Show this help message');
    log('');
    log('Environment Variables:');
    log('  DOCKER_COMPOSE_FILE  Path to docker-compose.yml (default: ./docker-compose.yml)');
    log('  PROMPT_VAULT_PORT    Port to expose the application on (default: 3001)');
    log('');
}

function start() {
    log(`${colors.bold}Starting Prompt Vault...${colors.reset}`);
    runCommand('docker-compose up -d', 'start containers');
    success('Prompt Vault started successfully!');
    info('Application will be available at: http://localhost:3001');
    info('Health check endpoint: http://localhost:3001/observability/health');
}

function stop() {
    log(`${colors.bold}Stopping Prompt Vault...${colors.reset}`);
    runCommand('docker-compose down', 'stop containers');
    success('Prompt Vault stopped successfully!');
}

function restart() {
    log(`${colors.bold}Restarting Prompt Vault...${colors.reset}`);
    runCommand('docker-compose restart', 'restart containers');
    success('Prompt Vault restarted successfully!');
}

function status() {
    log(`${colors.bold}Container Status:${colors.reset}`);
    try {
        runCommand('docker-compose ps', 'check container status');
    } catch (err) {
        // docker-compose ps might fail if no containers are running
        info('No containers are currently running.');
    }
}

function logs() {
    log(`${colors.bold}Container Logs:${colors.reset}`);
    runCommand('docker-compose logs -f --tail=100', 'show container logs');
}

function build() {
    log(`${colors.bold}Building Docker Images...${colors.reset}`);
    runCommand('docker-compose build --no-cache', 'build Docker images');
    success('Docker images built successfully!');
}

function clean() {
    warning('This will remove all containers and volumes, destroying all data!');
    warning('Are you sure? This action cannot be undone!');
    warning('Press Ctrl+C to cancel or wait 10 seconds to continue...');

    // Give user time to cancel
    setTimeout(() => {
        log(`${colors.bold}Cleaning up Docker resources...${colors.reset}`);
        try {
            runCommand('docker-compose down -v --remove-orphans', 'remove containers and volumes');
            success('Cleanup completed!');
        } catch (err) {
            error('Cleanup failed. You may need to manually remove containers and volumes.');
        }
    }, 10000);
}

function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        showUsage();
        process.exit(1);
    }

    const command = args[0].toLowerCase();

    // Check prerequisites
    if (!checkDocker()) {
        error('Docker and Docker Compose are required but not found.');
        error('Please install Docker Desktop or Docker Engine + Docker Compose.');
        process.exit(1);
    }

    checkComposeFile();

    // Execute command
    switch (command) {
        case 'start':
            start();
            break;
        case 'stop':
            stop();
            break;
        case 'restart':
            restart();
            break;
        case 'status':
            status();
            break;
        case 'logs':
            logs();
            break;
        case 'build':
            build();
            break;
        case 'clean':
            clean();
            break;
        case 'help':
        case '-h':
        case '--help':
            showUsage();
            break;
        default:
            error(`Unknown command: ${command}`);
            showUsage();
            process.exit(1);
    }
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    error(`Uncaught exception: ${err.message}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    error(`Unhandled rejection: ${reason}`);
    process.exit(1);
});

main();
