import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import dotenv from 'dotenv';
import {
  ProvidersFileSchema,
  InferenceFileSchema,
  WinnowFileSchema,
  FullWinnowConfig,
} from './models';

// Load .env before configuration parsing
dotenv.config();

function interpolateEnv(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const val = process.env[varName.trim()];
    if (val === undefined) {
      return ''; // will be caught by validation if mandatory
    }
    return val;
  });
}

function loadYamlFile(filePath: string): any {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file not found: ${filePath}`);
  }
  const rawContent = fs.readFileSync(filePath, 'utf8');
  const interpolated = interpolateEnv(rawContent);
  return yaml.load(interpolated);
}

export function loadConfig(configDir = path.join(process.cwd(), 'config')): FullWinnowConfig {
  const providersPath = path.join(configDir, 'providers.yaml');
  const inferencePath = path.join(configDir, 'inference.yaml');
  const winnowPath = path.join(configDir, 'winnow.yaml');

  // 1. Providers
  const rawProviders = loadYamlFile(providersPath);
  const parsedProviders = ProvidersFileSchema.safeParse(rawProviders);
  if (!parsedProviders.success) {
    throw new Error(`Invalid providers.yaml configuration: ${parsedProviders.error.message}`);
  }

  // Verify that enabled providers have non-empty auth keys
  for (const p of parsedProviders.data.providers) {
    if (p.enabled && (!p.request.auth.value || p.request.auth.value.trim() === '')) {
      throw new Error(`Provider "${p.name}" is enabled but its authentication key is missing or empty in .env.`);
    }
  }

  // 2. Inference
  const rawInference = loadYamlFile(inferencePath);
  const parsedInference = InferenceFileSchema.safeParse(rawInference);
  if (!parsedInference.success) {
    throw new Error(`Invalid inference.yaml configuration: ${parsedInference.error.message}`);
  }

  for (const ip of parsedInference.data.inference_providers) {
    if (ip.enabled && (!ip.api_key || ip.api_key.trim() === '')) {
      throw new Error(`Inference provider "${ip.name}" is enabled but its API key is missing or empty in .env.`);
    }
  }

  // 3. Winnow main
  const rawWinnow = loadYamlFile(winnowPath);
  const parsedWinnow = WinnowFileSchema.safeParse(rawWinnow);
  if (!parsedWinnow.success) {
    throw new Error(`Invalid winnow.yaml configuration: ${parsedWinnow.error.message}`);
  }

  return {
    providers: parsedProviders.data.providers,
    inference: parsedInference.data,
    winnow: parsedWinnow.data,
  };
}

let cachedConfig: FullWinnowConfig | null = null;

export function getConfig(): FullWinnowConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function reloadConfig(): FullWinnowConfig {
  cachedConfig = loadConfig();
  return cachedConfig;
}

export function getRedactedConfig(cfg = getConfig()): any {
  return JSON.parse(
    JSON.stringify(cfg, (key, value) => {
      if (['value', 'api_key', 'authorization'].includes(key.toLowerCase()) && typeof value === 'string') {
        if (value.length > 8) {
          return `${value.slice(0, 4)}...${value.slice(-4)}`;
        }
        return '********';
      }
      return value;
    })
  );
}
