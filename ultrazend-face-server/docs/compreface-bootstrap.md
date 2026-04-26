# Bootstrap do CompreFace

Use este bootstrap para criar ou reutilizar o usuario administrativo, a aplicacao e o modelo de reconhecimento usados pelo `ultrazend-face-server`.

## Variaveis obrigatorias

```bash
export COMPREFACE_ADMIN_PASSWORD='sua-senha-forte'
```

## Variaveis opcionais

```bash
export COMPREFACE_BOOTSTRAP_BASE_URL='http://localhost:8000'
export COMPREFACE_ADMIN_EMAIL='face-admin@digiurban.com.br'
export COMPREFACE_ADMIN_FIRST_NAME='Digiurban'
export COMPREFACE_ADMIN_LAST_NAME='Face'
export COMPREFACE_APP_NAME='Digiurban Face Platform'
export COMPREFACE_MODEL_NAME='Digiurban Recognition'
```

## Gerar ou reutilizar a chave

```bash
cd ultrazend-face-server
npm run bootstrap:compreface
```

## Atualizar um arquivo `.env`

```bash
cd ultrazend-face-server
npm run bootstrap:compreface -- ../.env
```

O script escreve ou atualiza:

```env
COMPREFACE_API_URL=http://localhost:8000
COMPREFACE_API_KEY=...
```

## Descoberta automática no runtime

Quando `COMPREFACE_API_KEY` estiver vazio, o `ultrazend-face-server` tenta descobrir a chave diretamente no banco do CompreFace usando:

```env
COMPREFACE_POSTGRES_HOST=compreface-postgres-db
COMPREFACE_POSTGRES_PORT=5432
COMPREFACE_POSTGRES_USER=postgres
COMPREFACE_POSTGRES_PASSWORD=postgres
COMPREFACE_POSTGRES_DB=frs
COMPREFACE_APP_NAME=Digiurban Face Platform
COMPREFACE_MODEL_NAME=Digiurban Recognition
```

Se esses dados estiverem corretos e o modelo já existir no CompreFace, o serviço sobe sem exigir preenchimento manual de `COMPREFACE_API_KEY`.
