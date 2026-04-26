import {
  AttendanceStatus,
  CameraEventType,
  CameraStatus,
  CameraType,
  FaceEnrollmentSource,
  GuardianRelationship,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  StudentShift,
  StudentStatus,
  TenantPlan,
  UserRole,
} from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { biometricEngine } from "../src/services/biometrics/engine";

const prisma = new PrismaClient();

const avatarUrl = (seed: string) =>
  `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=0a0e1a,111827`;

const logoUrl = (seed: string) =>
  `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(seed)}&backgroundColor=00d4ff,10b981`;

const localDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(date);

const toUploadFile = async (imageUrl: string, name: string) => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Falha ao carregar imagem de seed: ${imageUrl}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "image/png";

  return {
    name,
    type,
    size: buffer.length,
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
};

const hashPassword = (password: string) => bcrypt.hash(password, 12);

const encryptSecret = (value: string) => {
  const encryptionKey = crypto.createHash("sha256").update("vigiaescolar-seed-key").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
};

type SeedSchool = {
  id: string;
  name: string;
  cnpj: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  openingTime: string;
  closingTime: string;
  toleranceMinutes: number;
  isActive: boolean;
};

type SeedClass = {
  id: string;
  schoolId: string;
  name: string;
  shift: StudentShift;
  isActive: boolean;
};

type SeedGuardian = {
  id: string;
  name: string;
  cpf: string;
  whatsapp: string;
  email: string;
  relationship: GuardianRelationship;
  photoUrl: string;
  isActive: boolean;
};

type SeedStudent = {
  id: string;
  name: string;
  registrationNumber: string;
  birthDate: string;
  schoolId: string;
  className: string;
  shift: StudentShift;
  photoUrl: string;
  status: StudentStatus;
  biometricEnabled: boolean;
  currentPresence: AttendanceStatus;
  entryTime: string | null;
  exitTime: string | null;
  primaryGuardianId: string;
  guardiansIds: string[];
};

type SeedCamera = {
  id: string;
  name: string;
  schoolId: string;
  location: string;
  type: CameraType;
  streamUrl: string;
  resolution: string;
  fps: number;
  status: CameraStatus;
  port?: number;
  username?: string;
  password?: string;
  recognitionStartTime?: string;
  recognitionEndTime?: string;
};

const today = localDateKey();
const at = (time: string) => new Date(`${today}T${time}:00-03:00`);

async function main() {
  await prisma.tenant.deleteMany();

  const adminPasswordHash = await hashPassword("Admin@12345");
  const supportPasswordHash = await hashPassword("Suporte@12345");

  const tenantOne = await prisma.tenant.create({
    data: {
      id: "tenant-vigia-paulis",
      name: "Vigia Escolar Paulista",
      slug: "vigia-escolar-paulista",
      plan: TenantPlan.PRO,
      settings: {
        create: {
          notifyEntry: true,
          notifyExit: true,
          notifyLate: true,
          notifyAbsence: true,
          whatsappEnabled: true,
          pushEnabled: true,
          confidenceThreshold: 85,
          framesPerSecond: 15,
          saveFrames: true,
          detectMasks: false,
          twoFactorEnabled: true,
          auditLogEnabled: true,
          recordingsRetentionDays: 30,
          logsRetentionDays: 90,
        },
      },
    },
  });

  const tenantTwo = await prisma.tenant.create({
    data: {
      id: "tenant-horizonte-azul",
      name: "Instituto Horizonte Azul",
      slug: "instituto-horizonte-azul",
      plan: TenantPlan.PRO,
      settings: {
        create: {
          notifyEntry: true,
          notifyExit: true,
          notifyLate: true,
          notifyAbsence: true,
          whatsappEnabled: false,
          pushEnabled: true,
          confidenceThreshold: 90,
          framesPerSecond: 12,
          saveFrames: true,
          detectMasks: true,
          twoFactorEnabled: true,
          auditLogEnabled: true,
          recordingsRetentionDays: 45,
          logsRetentionDays: 120,
        },
      },
    },
  });

  await prisma.user.createMany({
    data: [
      {
        id: "user-admin-paulista",
        tenantId: tenantOne.id,
        name: "Camila Andrade",
        email: "admin@paulista.edu.br",
        passwordHash: adminPasswordHash,
        role: UserRole.OWNER,
        avatarUrl: avatarUrl("camila-andrade"),
        isActive: true,
      },
      {
        id: "user-secretaria-paulista",
        tenantId: tenantOne.id,
        name: "Renato Alves",
        email: "secretaria@paulista.edu.br",
        passwordHash: supportPasswordHash,
        role: UserRole.STAFF,
        avatarUrl: avatarUrl("renato-alves"),
        isActive: true,
      },
      {
        id: "user-admin-horizonte",
        tenantId: tenantTwo.id,
        name: "Juliana Rocha",
        email: "admin@horizonteazul.edu.br",
        passwordHash: adminPasswordHash,
        role: UserRole.OWNER,
        avatarUrl: avatarUrl("juliana-rocha"),
        isActive: true,
      },
      {
        id: "user-coordenacao-horizonte",
        tenantId: tenantTwo.id,
        name: "Paulo Mendonça",
        email: "coordenacao@horizonteazul.edu.br",
        passwordHash: supportPasswordHash,
        role: UserRole.ADMIN,
        avatarUrl: avatarUrl("paulo-mendonca"),
        isActive: true,
      },
    ],
  });

  const schoolsTenantOne: SeedSchool[] = [
    {
      id: "school-monteiro-lobato",
      name: "E.M. Monteiro Lobato",
      cnpj: "12.345.678/0001-90",
      address: "Rua das Acácias, 250 - Centro",
      city: "São Paulo",
      state: "SP",
      phone: "+55 (11) 3322-1100",
      email: "contato@monteirolobato.edu.br",
      openingTime: "07:30",
      closingTime: "12:00",
      toleranceMinutes: 15,
      isActive: true,
    },
    {
      id: "school-sao-francisco",
      name: "Colégio São Francisco",
      cnpj: "23.456.789/0001-12",
      address: "Av. Brasil, 1500 - Jardim América",
      city: "Campinas",
      state: "SP",
      phone: "+55 (19) 3344-5566",
      email: "secretaria@saofrancisco.edu.br",
      openingTime: "07:00",
      closingTime: "17:00",
      toleranceMinutes: 10,
      isActive: true,
    },
    {
      id: "school-rui-barbosa",
      name: "E.E. Rui Barbosa",
      cnpj: "34.567.890/0001-34",
      address: "Rua do Comércio, 88 - Vila Nova",
      city: "Santos",
      state: "SP",
      phone: "+55 (13) 3211-9988",
      email: "ruibarbosa@educacao.sp.gov.br",
      openingTime: "13:00",
      closingTime: "17:30",
      toleranceMinutes: 20,
      isActive: true,
    },
  ];

  const schoolsTenantTwo: SeedSchool[] = [
    {
      id: "school-horizonte-azul",
      name: "Instituto Horizonte Azul",
      cnpj: "45.678.901/0001-56",
      address: "Rua Aquarela, 120 - Parque Central",
      city: "Belo Horizonte",
      state: "MG",
      phone: "+55 (31) 3221-4411",
      email: "contato@horizonteazul.edu.br",
      openingTime: "07:15",
      closingTime: "16:45",
      toleranceMinutes: 12,
      isActive: true,
    },
  ];

  await prisma.school.createMany({
    data: [
      ...schoolsTenantOne.map((school) => ({
        ...school,
        tenantId: tenantOne.id,
        logoUrl: logoUrl(school.name),
      })),
      ...schoolsTenantTwo.map((school) => ({
        ...school,
        tenantId: tenantTwo.id,
        logoUrl: logoUrl(school.name),
      })),
    ],
  });

  const classesTenantOne: SeedClass[] = [
    {
      id: "class-monteiro-lobato-5a-manha",
      schoolId: "school-monteiro-lobato",
      name: "5º Ano A",
      shift: StudentShift.MORNING,
      isActive: true,
    },
    {
      id: "class-monteiro-lobato-5b-manha",
      schoolId: "school-monteiro-lobato",
      name: "5º Ano B",
      shift: StudentShift.MORNING,
      isActive: true,
    },
    {
      id: "class-monteiro-lobato-6a-manha",
      schoolId: "school-monteiro-lobato",
      name: "6º Ano A",
      shift: StudentShift.MORNING,
      isActive: true,
    },
    {
      id: "class-sao-francisco-3a-tarde",
      schoolId: "school-sao-francisco",
      name: "3º Ano A",
      shift: StudentShift.AFTERNOON,
      isActive: true,
    },
    {
      id: "class-sao-francisco-4a-tarde",
      schoolId: "school-sao-francisco",
      name: "4º Ano A",
      shift: StudentShift.AFTERNOON,
      isActive: true,
    },
    {
      id: "class-sao-francisco-7b-integral",
      schoolId: "school-sao-francisco",
      name: "7º Ano B",
      shift: StudentShift.FULL_DAY,
      isActive: true,
    },
    {
      id: "class-rui-barbosa-8a-tarde",
      schoolId: "school-rui-barbosa",
      name: "8º Ano A",
      shift: StudentShift.AFTERNOON,
      isActive: true,
    },
    {
      id: "class-rui-barbosa-9b-tarde",
      schoolId: "school-rui-barbosa",
      name: "9º Ano B",
      shift: StudentShift.AFTERNOON,
      isActive: true,
    },
  ];

  const classesTenantTwo: SeedClass[] = [
    {
      id: "class-horizonte-5b-manha",
      schoolId: "school-horizonte-azul",
      name: "5º Ano B",
      shift: StudentShift.MORNING,
      isActive: true,
    },
    {
      id: "class-horizonte-6a-manha",
      schoolId: "school-horizonte-azul",
      name: "6º Ano A",
      shift: StudentShift.MORNING,
      isActive: true,
    },
    {
      id: "class-horizonte-7b-manha",
      schoolId: "school-horizonte-azul",
      name: "7º Ano B",
      shift: StudentShift.MORNING,
      isActive: true,
    },
    {
      id: "class-horizonte-8a-integral",
      schoolId: "school-horizonte-azul",
      name: "8º Ano A",
      shift: StudentShift.FULL_DAY,
      isActive: true,
    },
  ];

  await prisma.schoolClass.createMany({
    data: [
      ...classesTenantOne.map((schoolClass) => ({
        ...schoolClass,
        tenantId: tenantOne.id,
      })),
      ...classesTenantTwo.map((schoolClass) => ({
        ...schoolClass,
        tenantId: tenantTwo.id,
      })),
    ],
  });

  const classIdByKey = new Map(
    [...classesTenantOne, ...classesTenantTwo].map((schoolClass) => [
      `${schoolClass.schoolId}::${schoolClass.name}::${schoolClass.shift}`,
      schoolClass.id,
    ]),
  );

  const guardiansTenantOne: SeedGuardian[] = [
    {
      id: "guardian-carla-mendes",
      name: "Carla Mendes",
      cpf: "123.456.789-00",
      whatsapp: "+55 (11) 98765-4321",
      email: "carla.mendes@exemplo.com",
      relationship: GuardianRelationship.MOTHER,
      photoUrl: avatarUrl("carla-mendes"),
      isActive: true,
    },
    {
      id: "guardian-roberto-silva",
      name: "Roberto Silva",
      cpf: "234.567.890-11",
      whatsapp: "+55 (11) 99876-5432",
      email: "roberto.silva@exemplo.com",
      relationship: GuardianRelationship.FATHER,
      photoUrl: avatarUrl("roberto-silva"),
      isActive: true,
    },
    {
      id: "guardian-juliana-costa",
      name: "Juliana Costa",
      cpf: "345.678.901-22",
      whatsapp: "+55 (19) 98123-4567",
      email: "juliana.costa@exemplo.com",
      relationship: GuardianRelationship.MOTHER,
      photoUrl: avatarUrl("juliana-costa"),
      isActive: true,
    },
    {
      id: "guardian-marcos-pereira",
      name: "Marcos Pereira",
      cpf: "456.789.012-33",
      whatsapp: "+55 (11) 97654-3210",
      email: "marcos.pereira@exemplo.com",
      relationship: GuardianRelationship.FATHER,
      photoUrl: avatarUrl("marcos-pereira"),
      isActive: true,
    },
    {
      id: "guardian-fernanda-almeida",
      name: "Fernanda Almeida",
      cpf: "567.890.123-44",
      whatsapp: "+55 (13) 98765-1122",
      email: "fernanda.almeida@exemplo.com",
      relationship: GuardianRelationship.MOTHER,
      photoUrl: avatarUrl("fernanda-almeida"),
      isActive: true,
    },
    {
      id: "guardian-paulo-henrique",
      name: "Paulo Henrique",
      cpf: "678.901.234-55",
      whatsapp: "+55 (11) 96543-2109",
      email: "paulo.henrique@exemplo.com",
      relationship: GuardianRelationship.FATHER,
      photoUrl: avatarUrl("paulo-henrique"),
      isActive: true,
    },
  ];

  const guardiansTenantTwo: SeedGuardian[] = [
    {
      id: "guardian-adriana-souza",
      name: "Adriana Souza",
      cpf: "789.012.345-66",
      whatsapp: "+55 (31) 99988-7766",
      email: "adriana.souza@exemplo.com",
      relationship: GuardianRelationship.MOTHER,
      photoUrl: avatarUrl("adriana-souza"),
      isActive: true,
    },
    {
      id: "guardian-lucas-martins",
      name: "Lucas Martins",
      cpf: "890.123.456-77",
      whatsapp: "+55 (31) 95432-1098",
      email: "lucas.martins@exemplo.com",
      relationship: GuardianRelationship.FATHER,
      photoUrl: avatarUrl("lucas-martins"),
      isActive: true,
    },
    {
      id: "guardian-patricia-rocha",
      name: "Patrícia Rocha",
      cpf: "901.234.567-88",
      whatsapp: "+55 (31) 98877-6655",
      email: "patricia.rocha@exemplo.com",
      relationship: GuardianRelationship.MOTHER,
      photoUrl: avatarUrl("patricia-rocha"),
      isActive: true,
    },
  ];

  await prisma.guardian.createMany({
    data: [
      ...guardiansTenantOne.map((guardian) => ({
        ...guardian,
        tenantId: tenantOne.id,
      })),
      ...guardiansTenantTwo.map((guardian) => ({
        ...guardian,
        tenantId: tenantTwo.id,
      })),
    ],
  });

  const studentsTenantOne: SeedStudent[] = [
    {
      id: "student-joao-mendes",
      name: "João Mendes",
      registrationNumber: "20250001",
      birthDate: "2015-02-14",
      schoolId: "school-monteiro-lobato",
      className: "5º Ano A",
      shift: StudentShift.MORNING,
      photoUrl: avatarUrl("joao-mendes"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.PRESENT,
      entryTime: "07:34",
      exitTime: null,
      primaryGuardianId: "guardian-carla-mendes",
      guardiansIds: ["guardian-carla-mendes", "guardian-roberto-silva"],
    },
    {
      id: "student-maria-mendes",
      name: "Maria Mendes",
      registrationNumber: "20250002",
      birthDate: "2016-08-22",
      schoolId: "school-monteiro-lobato",
      className: "5º Ano B",
      shift: StudentShift.MORNING,
      photoUrl: avatarUrl("maria-mendes"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.PRESENT,
      entryTime: "07:42",
      exitTime: null,
      primaryGuardianId: "guardian-carla-mendes",
      guardiansIds: ["guardian-carla-mendes"],
    },
    {
      id: "student-pedro-silva",
      name: "Pedro Silva",
      registrationNumber: "20250003",
      birthDate: "2014-11-03",
      schoolId: "school-monteiro-lobato",
      className: "6º Ano A",
      shift: StudentShift.MORNING,
      photoUrl: avatarUrl("pedro-silva"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: false,
      currentPresence: AttendanceStatus.LATE,
      entryTime: "08:12",
      exitTime: null,
      primaryGuardianId: "guardian-roberto-silva",
      guardiansIds: ["guardian-roberto-silva"],
    },
    {
      id: "student-ana-costa",
      name: "Ana Costa",
      registrationNumber: "20250004",
      birthDate: "2015-06-10",
      schoolId: "school-monteiro-lobato",
      className: "5º Ano A",
      shift: StudentShift.MORNING,
      photoUrl: avatarUrl("ana-costa"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.ABSENT,
      entryTime: null,
      exitTime: null,
      primaryGuardianId: "guardian-juliana-costa",
      guardiansIds: ["guardian-juliana-costa"],
    },
    {
      id: "student-lucas-costa",
      name: "Lucas Costa",
      registrationNumber: "20250005",
      birthDate: "2013-01-09",
      schoolId: "school-sao-francisco",
      className: "3º Ano A",
      shift: StudentShift.AFTERNOON,
      photoUrl: avatarUrl("lucas-costa"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.PRESENT,
      entryTime: "13:08",
      exitTime: null,
      primaryGuardianId: "guardian-juliana-costa",
      guardiansIds: ["guardian-juliana-costa"],
    },
    {
      id: "student-beatriz-pereira",
      name: "Beatriz Pereira",
      registrationNumber: "20250006",
      birthDate: "2012-10-17",
      schoolId: "school-sao-francisco",
      className: "4º Ano A",
      shift: StudentShift.AFTERNOON,
      photoUrl: avatarUrl("beatriz-pereira"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.LEFT,
      entryTime: "13:02",
      exitTime: "17:12",
      primaryGuardianId: "guardian-marcos-pereira",
      guardiansIds: ["guardian-marcos-pereira"],
    },
    {
      id: "student-sofia-almeida",
      name: "Sofia Almeida",
      registrationNumber: "20250007",
      birthDate: "2014-05-23",
      schoolId: "school-sao-francisco",
      className: "7º Ano B",
      shift: StudentShift.FULL_DAY,
      photoUrl: avatarUrl("sofia-almeida"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.PRESENT,
      entryTime: "07:18",
      exitTime: null,
      primaryGuardianId: "guardian-fernanda-almeida",
      guardiansIds: ["guardian-fernanda-almeida"],
    },
    {
      id: "student-gabriel-henrique",
      name: "Gabriel Henrique",
      registrationNumber: "20250008",
      birthDate: "2011-03-19",
      schoolId: "school-rui-barbosa",
      className: "8º Ano A",
      shift: StudentShift.AFTERNOON,
      photoUrl: avatarUrl("gabriel-henrique"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: false,
      currentPresence: AttendanceStatus.PRESENT,
      entryTime: "13:09",
      exitTime: null,
      primaryGuardianId: "guardian-paulo-henrique",
      guardiansIds: ["guardian-paulo-henrique"],
    },
    {
      id: "student-rafael-henrique",
      name: "Rafael Henrique",
      registrationNumber: "20250009",
      birthDate: "2011-12-02",
      schoolId: "school-rui-barbosa",
      className: "9º Ano B",
      shift: StudentShift.AFTERNOON,
      photoUrl: avatarUrl("rafael-henrique"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.ABSENT,
      entryTime: null,
      exitTime: null,
      primaryGuardianId: "guardian-paulo-henrique",
      guardiansIds: ["guardian-paulo-henrique"],
    },
  ];

  const studentsTenantTwo: SeedStudent[] = [
    {
      id: "student-laura-souza",
      name: "Laura Souza",
      registrationNumber: "20260001",
      birthDate: "2014-04-11",
      schoolId: "school-horizonte-azul",
      className: "6º Ano A",
      shift: StudentShift.MORNING,
      photoUrl: avatarUrl("laura-souza"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.PRESENT,
      entryTime: "07:19",
      exitTime: null,
      primaryGuardianId: "guardian-adriana-souza",
      guardiansIds: ["guardian-adriana-souza", "guardian-lucas-martins"],
    },
    {
      id: "student-bruno-lima",
      name: "Bruno Lima",
      registrationNumber: "20260002",
      birthDate: "2013-09-15",
      schoolId: "school-horizonte-azul",
      className: "7º Ano B",
      shift: StudentShift.MORNING,
      photoUrl: avatarUrl("bruno-lima"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.PRESENT,
      entryTime: "07:25",
      exitTime: null,
      primaryGuardianId: "guardian-lucas-martins",
      guardiansIds: ["guardian-lucas-martins"],
    },
    {
      id: "student-camila-ferreira",
      name: "Camila Ferreira",
      registrationNumber: "20260003",
      birthDate: "2015-01-28",
      schoolId: "school-horizonte-azul",
      className: "5º Ano B",
      shift: StudentShift.MORNING,
      photoUrl: avatarUrl("camila-ferreira"),
      status: StudentStatus.ACTIVE,
      biometricEnabled: true,
      currentPresence: AttendanceStatus.LATE,
      entryTime: "08:03",
      exitTime: null,
      primaryGuardianId: "guardian-patricia-rocha",
      guardiansIds: ["guardian-patricia-rocha"],
    },
    {
      id: "student-tiago-ribeiro",
      name: "Tiago Ribeiro",
      registrationNumber: "20260004",
      birthDate: "2012-07-04",
      schoolId: "school-horizonte-azul",
      className: "8º Ano A",
      shift: StudentShift.FULL_DAY,
      photoUrl: avatarUrl("tiago-ribeiro"),
      status: StudentStatus.TRANSFERRED,
      biometricEnabled: false,
      currentPresence: AttendanceStatus.ABSENT,
      entryTime: null,
      exitTime: null,
      primaryGuardianId: "guardian-adriana-souza",
      guardiansIds: ["guardian-adriana-souza"],
    },
  ];

  await prisma.student.createMany({
    data: [
      ...studentsTenantOne.map((student) => {
        const { guardiansIds, birthDate, ...rest } = student;
        const classId = classIdByKey.get(`${student.schoolId}::${student.className}::${student.shift}`);
        if (!classId) {
          throw new Error(`Turma não encontrada para o aluno seed ${student.id}`);
        }
        return {
          ...rest,
          classId,
          tenantId: tenantOne.id,
          birthDate: new Date(`${birthDate}T00:00:00.000Z`),
        };
      }),
      ...studentsTenantTwo.map((student) => {
        const { guardiansIds, birthDate, ...rest } = student;
        const classId = classIdByKey.get(`${student.schoolId}::${student.className}::${student.shift}`);
        if (!classId) {
          throw new Error(`Turma não encontrada para o aluno seed ${student.id}`);
        }
        return {
          ...rest,
          classId,
          tenantId: tenantTwo.id,
          birthDate: new Date(`${birthDate}T00:00:00.000Z`),
        };
      }),
    ],
  });

  const studentGuardianRows = [
    ...studentsTenantOne.flatMap((student) =>
      student.guardiansIds.map((guardianId, index) => ({
        tenantId: tenantOne.id,
        studentId: student.id,
        guardianId,
        isPrimary: index === 0,
      })),
    ),
    ...studentsTenantTwo.flatMap((student) =>
      student.guardiansIds.map((guardianId, index) => ({
        tenantId: tenantTwo.id,
        studentId: student.id,
        guardianId,
        isPrimary: index === 0,
      })),
    ),
  ];

  await prisma.studentGuardian.createMany({
    data: studentGuardianRows,
    skipDuplicates: true,
  });

  const biometricSeedStudents = [...studentsTenantOne, ...studentsTenantTwo].filter(
    (student) => student.biometricEnabled && Boolean(student.photoUrl),
  );

  for (const student of biometricSeedStudents) {
    const biometricFile = await toUploadFile(student.photoUrl, `${student.id}.png`);
    await biometricEngine.enrollStudent(
      {
        tenantId: student.schoolId === "school-horizonte-azul" ? tenantTwo.id : tenantOne.id,
        studentId: student.id,
        schoolId: student.schoolId,
        studentName: student.name,
        files: [biometricFile],
        sourceType: FaceEnrollmentSource.MIGRATION,
        sourceLabel: "Seed inicial",
        modelName: "face-api.js",
      },
      prisma,
    );
  }

  const camerasTenantOne: SeedCamera[] = [
    {
      id: "camera-portao-principal",
      name: "Portão Principal",
      schoolId: "school-monteiro-lobato",
      location: "Entrada principal - Rua das Acácias",
      type: CameraType.RTSP,
      streamUrl: "rtsp://10.10.0.10:554/stream",
      resolution: "1080p",
      fps: 30,
      status: CameraStatus.ACTIVE,
      port: 554,
      username: "admin",
      password: "SenhaCamera@123",
      recognitionStartTime: "06:00",
      recognitionEndTime: "13:00",
    },
    {
      id: "camera-portao-secundario",
      name: "Portão Secundário",
      schoolId: "school-monteiro-lobato",
      location: "Saída lateral - Pátio interno",
      type: CameraType.IP,
      streamUrl: "http://10.10.0.11",
      resolution: "720p",
      fps: 25,
      status: CameraStatus.ACTIVE,
      port: 80,
      username: "operador",
      password: "SenhaCamera@123",
      recognitionStartTime: "06:30",
      recognitionEndTime: "12:30",
    },
    {
      id: "camera-entrada-sao-francisco",
      name: "Entrada São Francisco",
      schoolId: "school-sao-francisco",
      location: "Av. Brasil - Portaria",
      type: CameraType.RTSP,
      streamUrl: "rtsp://10.10.1.20:554/stream",
      resolution: "1080p",
      fps: 30,
      status: CameraStatus.ACTIVE,
      port: 554,
      username: "operador",
      password: "SenhaCamera@123",
      recognitionStartTime: "06:45",
      recognitionEndTime: "18:00",
    },
    {
      id: "camera-rui-barbosa",
      name: "Portão Rui Barbosa",
      schoolId: "school-rui-barbosa",
      location: "Entrada principal",
      type: CameraType.RTSP,
      streamUrl: "rtsp://10.10.2.30:554/stream",
      resolution: "4K",
      fps: 30,
      status: CameraStatus.MAINTENANCE,
      port: 554,
      username: "operador",
      password: "SenhaCamera@123",
      recognitionStartTime: "12:30",
      recognitionEndTime: "18:30",
    },
  ];

  const camerasTenantTwo: SeedCamera[] = [
    {
      id: "camera-horizonte-principal",
      name: "Entrada Principal Horizonte",
      schoolId: "school-horizonte-azul",
      location: "Recepção",
      type: CameraType.RTSP,
      streamUrl: "rtsp://10.20.0.10:554/stream",
      resolution: "1080p",
      fps: 30,
      status: CameraStatus.ACTIVE,
      port: 554,
      username: "operador",
      password: "SenhaCamera@123",
      recognitionStartTime: "06:45",
      recognitionEndTime: "17:00",
    },
  ];

  await prisma.camera.createMany({
    data: [
      ...camerasTenantOne.map((camera) => {
        const { password, ...rest } = camera;
        return {
          ...rest,
          tenantId: tenantOne.id,
          passwordEncrypted: password ? encryptSecret(password) : null,
        };
      }),
      ...camerasTenantTwo.map((camera) => {
        const { password, ...rest } = camera;
        return {
          ...rest,
          tenantId: tenantTwo.id,
          passwordEncrypted: password ? encryptSecret(password) : null,
        };
      }),
    ],
  });

  const attendanceTenantOne = studentsTenantOne.map((student, index) => ({
    id: `attendance-${student.id}`,
    tenantId: tenantOne.id,
    studentId: student.id,
    schoolId: student.schoolId,
    cameraId:
      index < 4 ? "camera-portao-principal" : index < 7 ? "camera-entrada-sao-francisco" : "camera-rui-barbosa",
    date: today,
    status: student.currentPresence,
    entryAt:
      student.entryTime && student.currentPresence !== AttendanceStatus.ABSENT
        ? at(student.entryTime)
        : null,
    exitAt:
      student.exitTime && student.currentPresence === AttendanceStatus.LEFT ? at(student.exitTime) : null,
    recognized: student.biometricEnabled,
    confidence:
      student.currentPresence === AttendanceStatus.ABSENT ? 0.72 : student.currentPresence === AttendanceStatus.LATE ? 0.84 : 0.96,
    notified: student.currentPresence !== AttendanceStatus.ABSENT,
    notes: student.currentPresence === AttendanceStatus.ABSENT ? "Ausência registrada pela secretaria" : null,
  }));

  const attendanceTenantTwo = studentsTenantTwo.map((student, index) => ({
    id: `attendance-${student.id}`,
    tenantId: tenantTwo.id,
    studentId: student.id,
    schoolId: student.schoolId,
    cameraId: "camera-horizonte-principal",
    date: today,
    status: student.currentPresence,
    entryAt:
      student.entryTime && student.currentPresence !== AttendanceStatus.ABSENT
        ? at(student.entryTime)
        : null,
    exitAt:
      student.exitTime && student.currentPresence === AttendanceStatus.LEFT ? at(student.exitTime) : null,
    recognized: student.biometricEnabled,
    confidence:
      student.currentPresence === AttendanceStatus.ABSENT ? 0.7 : student.currentPresence === AttendanceStatus.LATE ? 0.82 : 0.95,
    notified: student.currentPresence !== AttendanceStatus.ABSENT,
    notes: student.currentPresence === AttendanceStatus.ABSENT ? "Ausência registrada pela coordenação" : null,
  }));

  await prisma.attendance.createMany({
    data: [...attendanceTenantOne, ...attendanceTenantTwo],
  });

  const events = [...attendanceTenantOne, ...attendanceTenantTwo]
    .filter((entry) => entry.status !== AttendanceStatus.ABSENT)
    .flatMap((entry) => [
      {
        id: `event-entry-${entry.id}`,
        tenantId: entry.tenantId,
        schoolId: entry.schoolId,
        cameraId: entry.cameraId ?? "",
        studentId: entry.studentId,
        attendanceId: entry.id,
        type: CameraEventType.ENTRY,
        recognized: true,
        confidence: entry.confidence,
        snapshotUrl: null,
        happenedAt: entry.entryAt ?? at("07:00"),
      },
      ...(entry.exitAt
        ? [
            {
              id: `event-exit-${entry.id}`,
              tenantId: entry.tenantId,
              schoolId: entry.schoolId,
              cameraId: entry.cameraId ?? "",
              studentId: entry.studentId,
              attendanceId: entry.id,
              type: CameraEventType.EXIT,
              recognized: true,
              confidence: entry.confidence,
              snapshotUrl: null,
              happenedAt: entry.exitAt,
            },
          ]
        : []),
    ]);

  await prisma.cameraEvent.createMany({
    data: events,
  });

  const notifications = [
    {
      id: "notification-1",
      tenantId: tenantOne.id,
      schoolId: "school-monteiro-lobato",
      studentId: "student-joao-mendes",
      guardianId: "guardian-carla-mendes",
      attendanceId: "attendance-student-joao-mendes",
      type: NotificationType.ENTRY,
      channel: NotificationChannel.WHATSAPP,
      status: NotificationStatus.SENT,
      sentAt: at("07:36"),
      message: "João entrou na escola às 07:34.",
    },
    {
      id: "notification-2",
      tenantId: tenantOne.id,
      schoolId: "school-monteiro-lobato",
      studentId: "student-pedro-silva",
      guardianId: "guardian-roberto-silva",
      attendanceId: "attendance-student-pedro-silva",
      type: NotificationType.LATE,
      channel: NotificationChannel.PUSH,
      status: NotificationStatus.SENT,
      sentAt: at("08:15"),
      message: "Pedro chegou atrasado às 08:12.",
    },
    {
      id: "notification-3",
      tenantId: tenantOne.id,
      schoolId: "school-sao-francisco",
      studentId: "student-beatriz-pereira",
      guardianId: "guardian-marcos-pereira",
      attendanceId: "attendance-student-beatriz-pereira",
      type: NotificationType.EXIT,
      channel: NotificationChannel.WHATSAPP,
      status: NotificationStatus.FAILED,
      sentAt: at("17:15"),
      message: "Beatriz saiu da escola às 17:12.",
    },
    {
      id: "notification-4",
      tenantId: tenantTwo.id,
      schoolId: "school-horizonte-azul",
      studentId: "student-camila-ferreira",
      guardianId: "guardian-patricia-rocha",
      attendanceId: "attendance-student-camila-ferreira",
      type: NotificationType.LATE,
      channel: NotificationChannel.PUSH,
      status: NotificationStatus.PENDING,
      sentAt: at("08:05"),
      message: "Camila chegou atrasada às 08:03.",
    },
  ];

  await prisma.notification.createMany({
    data: notifications,
  });

  console.log("Seed concluído com dados reais e multi-tenant.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
