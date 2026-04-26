import fs from 'node:fs/promises';
import path from 'node:path';

const BASIC_TOKEN = 'Basic Q29tbW9uQ2xpZW50SWQ6cGFzc3dvcmQ=';

function stripTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function readHeaderSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const cookieHeader = headers.get('set-cookie');
  return cookieHeader ? [cookieHeader] : [];
}

function mergeCookies(currentCookie, response) {
  const nextValues = new Map();

  for (const entry of currentCookie.split(';')) {
    const [rawName, rawValue] = entry.trim().split('=');
    if (rawName && rawValue) {
      nextValues.set(rawName, rawValue);
    }
  }

  for (const cookie of readHeaderSetCookies(response.headers)) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');

    if (name && value) {
      nextValues.set(name.trim(), value.trim());
    }
  }

  return Array.from(nextValues.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function requestJson(baseUrl, input, options = {}, currentCookie = '') {
  const headers = new Headers(options.headers || {});

  if (currentCookie) {
    headers.set('Cookie', currentCookie);
  }

  let body = options.body;

  if (options.json) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.json);
  }

  const response = await fetch(`${baseUrl}${input}`, {
    method: options.method || 'GET',
    headers,
    body,
  });

  const nextCookie = mergeCookies(currentCookie, response);
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error_description ||
      payload?.error ||
      payload?.raw ||
      `${response.status} ${response.statusText}`;

    const error = new Error(String(message));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    payload,
    cookie: nextCookie,
    status: response.status,
  };
}

async function ensureUser(baseUrl, config) {
  try {
    const response = await requestJson(baseUrl, '/admin/user/register', {
      method: 'POST',
      json: {
        email: config.adminEmail,
        password: config.adminPassword,
        firstName: config.adminFirstName,
        lastName: config.adminLastName,
        isAllowStatistics: false,
      },
    });

    console.log(`Usuario administrativo criado (${response.status}).`);
  } catch (error) {
    if (error.status === 400 || error.status === 409) {
      console.log('Usuario administrativo do CompreFace ja existe. Seguindo.');
      return;
    }

    throw error;
  }
}

async function login(baseUrl, config) {
  const form = new URLSearchParams();
  form.set('username', config.adminEmail);
  form.set('password', config.adminPassword);
  form.set('grant_type', 'password');

  const response = await requestJson(
    baseUrl,
    '/admin/oauth/token',
    {
      method: 'POST',
      headers: {
        Authorization: BASIC_TOKEN,
      },
      body: form,
    },
    ''
  );

  if (!response.cookie) {
    throw new Error('Nao foi possivel obter a sessao do CompreFace apos o login.');
  }

  return response.cookie;
}

async function ensureApp(baseUrl, cookie, appName) {
  const appsResponse = await requestJson(baseUrl, '/admin/apps', {}, cookie);
  const apps = Array.isArray(appsResponse.payload) ? appsResponse.payload : [];
  const existing = apps.find((entry) => entry?.name === appName);

  if (existing) {
    return {
      app: existing,
      cookie: appsResponse.cookie,
      created: false,
    };
  }

  const created = await requestJson(
    baseUrl,
    '/admin/app',
    {
      method: 'POST',
      json: {
        name: appName,
      },
    },
    appsResponse.cookie
  );

  return {
    app: created.payload,
    cookie: created.cookie,
    created: true,
  };
}

async function ensureModel(baseUrl, cookie, appId, modelName) {
  const modelsResponse = await requestJson(baseUrl, `/admin/app/${appId}/models`, {}, cookie);
  const models = Array.isArray(modelsResponse.payload) ? modelsResponse.payload : [];
  const existing = models.find((entry) => entry?.name === modelName && entry?.type === 'RECOGNITION');

  if (existing) {
    return {
      model: existing,
      cookie: modelsResponse.cookie,
      created: false,
    };
  }

  const created = await requestJson(
    baseUrl,
    `/admin/app/${appId}/model`,
    {
      method: 'POST',
      json: {
        name: modelName,
        type: 'RECOGNITION',
      },
    },
    modelsResponse.cookie
  );

  return {
    model: created.payload,
    cookie: created.cookie,
    created: true,
  };
}

function upsertEnvContent(content, updates) {
  const lines = content.split(/\r?\n/);
  const seen = new Set();

  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);

    if (!match) {
      return line;
    }

    const key = match[1];

    if (!(key in updates)) {
      return line;
    }

    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  return `${nextLines.filter((line, index, arr) => !(index === arr.length - 1 && line === '')).join('\n')}\n`;
}

async function writeEnvFile(envFile, updates) {
  const resolved = path.resolve(envFile);
  let content = '';

  try {
    content = await fs.readFile(resolved, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(resolved, upsertEnvContent(content, updates), 'utf8');
  console.log(`Arquivo de ambiente atualizado em ${resolved}.`);
}

async function main() {
  const envFile = process.argv[2] || process.env.COMPREFACE_ENV_FILE || '';
  const config = {
    baseUrl: stripTrailingSlash(
      process.env.COMPREFACE_BOOTSTRAP_BASE_URL ||
        process.env.COMPREFACE_API_URL ||
        'http://localhost:8000'
    ),
    adminEmail: process.env.COMPREFACE_ADMIN_EMAIL || 'face-admin@digiurban.com.br',
    adminPassword: process.env.COMPREFACE_ADMIN_PASSWORD || '',
    adminFirstName: process.env.COMPREFACE_ADMIN_FIRST_NAME || 'Digiurban',
    adminLastName: process.env.COMPREFACE_ADMIN_LAST_NAME || 'Face',
    appName: process.env.COMPREFACE_APP_NAME || 'Digiurban Face Platform',
    modelName: process.env.COMPREFACE_MODEL_NAME || 'Digiurban Recognition',
  };

  if (!config.adminPassword) {
    throw new Error('Defina COMPREFACE_ADMIN_PASSWORD para bootstrap do CompreFace.');
  }

  await ensureUser(config.baseUrl, config);
  const cookie = await login(config.baseUrl, config);
  const appResult = await ensureApp(config.baseUrl, cookie, config.appName);
  const modelResult = await ensureModel(config.baseUrl, appResult.cookie, appResult.app.id, config.modelName);

  if (!modelResult.model?.apiKey) {
    throw new Error('Nao foi possivel obter a apiKey do modelo de reconhecimento.');
  }

  console.log(appResult.created ? 'Aplicacao criada.' : 'Aplicacao reutilizada.');
  console.log(modelResult.created ? 'Modelo de reconhecimento criado.' : 'Modelo de reconhecimento reutilizado.');
  console.log(`COMPREFACE_API_URL=${config.baseUrl}`);
  console.log(`COMPREFACE_API_KEY=${modelResult.model.apiKey}`);

  if (envFile) {
    await writeEnvFile(envFile, {
      COMPREFACE_API_URL: config.baseUrl,
      COMPREFACE_API_KEY: modelResult.model.apiKey,
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
