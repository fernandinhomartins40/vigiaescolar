import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeCpf, normalizeEmail, normalizeNullableString } from '../utils/identity';

type IdentityDbClient = Prisma.TransactionClient | PrismaClient;

interface PersonIdentityInput {
  currentPersonId?: string | null;
  cpf?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  rg?: string | null;
  birthDate?: Date | null;
  isActive?: boolean | null;
}

interface SyncCitizenIdentityInput extends PersonIdentityInput {
  citizenId: string;
}

type PersonRecord = Awaited<ReturnType<typeof fetchPersonById>>;

async function fetchPersonById(db: IdentityDbClient, id: string) {
  return db.person.findUnique({
    where: { id },
    include: {
      user: { select: { id: true } },
      citizen: { select: { id: true } },
    },
  });
}

async function fetchPersonByCpf(db: IdentityDbClient, cpf: string) {
  return db.person.findUnique({
    where: { cpf },
    include: {
      user: { select: { id: true } },
      citizen: { select: { id: true } },
    },
  });
}

function buildPersonPayload(input: PersonIdentityInput) {
  return {
    cpf: normalizeCpf(input.cpf),
    name: normalizeNullableString(input.name) || 'Pessoa sem nome',
    email: normalizeEmail(input.email),
    phone: normalizeNullableString(input.phone),
    rg: normalizeNullableString(input.rg),
    birthDate: input.birthDate ?? null,
    isActive: input.isActive ?? true,
  };
}

function mergePersonPayload(existing: NonNullable<PersonRecord>, input: PersonIdentityInput) {
  const payload = buildPersonPayload(input);

  return {
    cpf: payload.cpf ?? existing.cpf ?? null,
    name: payload.name || existing.name,
    email: payload.email ?? existing.email ?? null,
    phone: payload.phone ?? existing.phone ?? null,
    rg: payload.rg ?? existing.rg ?? null,
    birthDate: payload.birthDate ?? existing.birthDate ?? null,
    isActive: input.isActive ?? existing.isActive,
  };
}

async function ensurePersonRecord(db: IdentityDbClient, input: PersonIdentityInput) {
  const normalizedCpf = normalizeCpf(input.cpf);
  const personByCpf = normalizedCpf ? await fetchPersonByCpf(db, normalizedCpf) : null;
  const currentPerson =
    input.currentPersonId && (!personByCpf || personByCpf.id !== input.currentPersonId)
      ? await fetchPersonById(db, input.currentPersonId)
      : null;

  const targetPerson = personByCpf || currentPerson;

  if (!targetPerson) {
    const now = new Date();

    return db.person.create({
      data: {
        ...buildPersonPayload(input),
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  return db.person.update({
    where: { id: targetPerson.id },
    data: {
      ...mergePersonPayload(targetPerson, input),
      updatedAt: new Date(),
    },
  });
}

export async function syncCitizenPersonIdentity(db: IdentityDbClient, input: SyncCitizenIdentityInput) {
  const person = await ensurePersonRecord(db, input);

  const matchingUser = person.cpf
    ? await db.user.findFirst({
        where: { cpf: person.cpf },
        select: { id: true, personId: true },
      })
    : null;

  if (matchingUser && matchingUser.personId !== person.id) {
    await db.user.update({
      where: { id: matchingUser.id },
      data: { personId: person.id },
    });
  }

  await db.citizen.update({
    where: { id: input.citizenId },
    data: { personId: person.id },
  });

  return { personId: person.id, linkedUserId: matchingUser?.id ?? null };
}
