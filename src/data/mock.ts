export type Escola = {
  id: string;
  nome: string;
  cnpj: string;
  endereco: string;
  cidade: string;
  estado: string;
  telefone: string;
  email: string;
  logo: string;
  horarioEntrada: string;
  horarioSaida: string;
  toleranciaMin: number;
  ativa: boolean;
  totalAlunos: number;
  totalCameras: number;
};

export type Responsavel = {
  id: string;
  nome: string;
  cpf: string;
  whatsapp: string;
  email: string;
  parentesco: "Pai" | "Mãe" | "Avó" | "Avô" | "Tio" | "Tia" | "Responsável Legal" | "Outro";
  foto: string;
  ativo: boolean;
  filhosIds: string[];
};

export type Aluno = {
  id: string;
  nome: string;
  matricula: string;
  dataNascimento: string;
  escolaId: string;
  turma: string;
  turno: "Manhã" | "Tarde" | "Integral";
  foto: string;
  ativo: boolean;
  responsaveisIds: string[];
  responsavelPrincipalId: string;
  biometriaAtiva: boolean;
  presencaHoje: "presente" | "ausente" | "atrasado" | "saiu";
  horarioEntrada?: string;
  horarioSaida?: string;
};

export type Camera = {
  id: string;
  nome: string;
  escolaId: string;
  localizacao: string;
  tipo: "IP" | "USB" | "RTSP";
  url: string;
  resolucao: "720p" | "1080p" | "4K";
  fps: number;
  status: "Ativa" | "Inativa" | "Manutenção";
};

export type EventoCamera = {
  id: string;
  alunoId: string;
  cameraId: string;
  horario: string;
  tipo: "Entrou" | "Saiu";
  reconhecido: boolean;
};

export type Notificacao = {
  id: string;
  tipo: "Entrada" | "Saída" | "Falta" | "Atraso";
  alunoId: string;
  responsavelId: string;
  canal: "PWA Push" | "WhatsApp";
  horario: string;
  status: "Entregue" | "Falhou" | "Pendente";
};

const avatarUrl = (seed: string) =>
  `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=0a0e1a,111827`;

const logoUrl = (seed: string) =>
  `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(seed)}&backgroundColor=00d4ff,10b981`;

export const escolas: Escola[] = [
  {
    id: "esc-1",
    nome: "E.M. Monteiro Lobato",
    cnpj: "12.345.678/0001-90",
    endereco: "Rua das Acácias, 250 - Centro",
    cidade: "São Paulo",
    estado: "SP",
    telefone: "+55 (11) 3322-1100",
    email: "contato@monteirolobato.edu.br",
    logo: logoUrl("monteiro"),
    horarioEntrada: "07:30",
    horarioSaida: "12:00",
    toleranciaMin: 15,
    ativa: true,
    totalAlunos: 8,
    totalCameras: 2,
  },
  {
    id: "esc-2",
    nome: "Colégio São Francisco",
    cnpj: "23.456.789/0001-12",
    endereco: "Av. Brasil, 1500 - Jardim América",
    cidade: "Campinas",
    estado: "SP",
    telefone: "+55 (19) 3344-5566",
    email: "secretaria@saofrancisco.edu.br",
    logo: logoUrl("francisco"),
    horarioEntrada: "07:00",
    horarioSaida: "17:00",
    toleranciaMin: 10,
    ativa: true,
    totalAlunos: 7,
    totalCameras: 1,
  },
  {
    id: "esc-3",
    nome: "E.E. Rui Barbosa",
    cnpj: "34.567.890/0001-34",
    endereco: "Rua do Comércio, 88 - Vila Nova",
    cidade: "Santos",
    estado: "SP",
    telefone: "+55 (13) 3211-9988",
    email: "ruibarbosa@educacao.sp.gov.br",
    logo: logoUrl("rui"),
    horarioEntrada: "13:00",
    horarioSaida: "17:30",
    toleranciaMin: 20,
    ativa: true,
    totalAlunos: 5,
    totalCameras: 1,
  },
];

export const responsaveis: Responsavel[] = [
  { id: "r1", nome: "Carla Mendes", cpf: "123.456.789-00", whatsapp: "+55 (11) 98765-4321", email: "carla@email.com", parentesco: "Mãe", foto: avatarUrl("carla"), ativo: true, filhosIds: ["a1", "a2"] },
  { id: "r2", nome: "Roberto Silva", cpf: "234.567.890-11", whatsapp: "+55 (11) 99876-5432", email: "roberto@email.com", parentesco: "Pai", foto: avatarUrl("roberto"), ativo: true, filhosIds: ["a3"] },
  { id: "r3", nome: "Juliana Costa", cpf: "345.678.901-22", whatsapp: "+55 (19) 98123-4567", email: "juliana@email.com", parentesco: "Mãe", foto: avatarUrl("juliana"), ativo: true, filhosIds: ["a4", "a5"] },
  { id: "r4", nome: "Marcos Pereira", cpf: "456.789.012-33", whatsapp: "+55 (11) 97654-3210", email: "marcos@email.com", parentesco: "Pai", foto: avatarUrl("marcos"), ativo: true, filhosIds: ["a6"] },
  { id: "r5", nome: "Fernanda Almeida", cpf: "567.890.123-44", whatsapp: "+55 (13) 98765-1122", email: "fernanda@email.com", parentesco: "Mãe", foto: avatarUrl("fernanda"), ativo: true, filhosIds: ["a7", "a8"] },
  { id: "r6", nome: "Paulo Henrique", cpf: "678.901.234-55", whatsapp: "+55 (11) 96543-2109", email: "paulo@email.com", parentesco: "Pai", foto: avatarUrl("paulo"), ativo: true, filhosIds: ["a9"] },
  { id: "r7", nome: "Adriana Souza", cpf: "789.012.345-66", whatsapp: "+55 (19) 99988-7766", email: "adriana@email.com", parentesco: "Mãe", foto: avatarUrl("adriana"), ativo: true, filhosIds: ["a10"] },
  { id: "r8", nome: "Lucas Martins", cpf: "890.123.456-77", whatsapp: "+55 (11) 95432-1098", email: "lucas@email.com", parentesco: "Pai", foto: avatarUrl("lucas"), ativo: true, filhosIds: ["a11", "a12"] },
  { id: "r9", nome: "Patrícia Rocha", cpf: "901.234.567-88", whatsapp: "+55 (13) 98877-6655", email: "patricia@email.com", parentesco: "Mãe", foto: avatarUrl("patricia"), ativo: true, filhosIds: ["a13"] },
  { id: "r10", nome: "Sandra Oliveira", cpf: "012.345.678-99", whatsapp: "+55 (11) 94321-0987", email: "sandra@email.com", parentesco: "Avó", foto: avatarUrl("sandra"), ativo: true, filhosIds: ["a14", "a15"] },
];

const nomes = [
  "João Mendes", "Maria Mendes", "Pedro Silva", "Ana Costa", "Lucas Costa",
  "Beatriz Pereira", "Sofia Almeida", "Gabriel Almeida", "Rafael Henrique", "Laura Souza",
  "Felipe Martins", "Isabela Martins", "Mateus Rocha", "Helena Oliveira", "Davi Oliveira",
  "Larissa Santos", "Bruno Lima", "Camila Ferreira", "Tiago Ribeiro", "Yasmin Cardoso",
];

const turmasPorEscola: Record<string, string[]> = {
  "esc-1": ["5º Ano A", "5º Ano B", "6º Ano A"],
  "esc-2": ["3º Ano A", "4º Ano A", "7º Ano B"],
  "esc-3": ["8º Ano A", "9º Ano B"],
};

const escolaIds = ["esc-1", "esc-1", "esc-1", "esc-1", "esc-1", "esc-1", "esc-1", "esc-1",
                   "esc-2", "esc-2", "esc-2", "esc-2", "esc-2", "esc-2", "esc-2",
                   "esc-3", "esc-3", "esc-3", "esc-3", "esc-3"];

const respPorAluno = ["r1", "r1", "r2", "r3", "r3", "r4", "r5", "r5", "r6", "r7", "r8", "r8", "r9", "r10", "r10", "r2", "r4", "r6", "r9", "r7"];

export const alunos: Aluno[] = nomes.map((nome, i) => {
  const id = `a${i + 1}`;
  const escolaId = escolaIds[i];
  const turmas = turmasPorEscola[escolaId];
  const turma = turmas[i % turmas.length];
  const presenca = (["presente", "presente", "presente", "presente", "atrasado", "ausente", "saiu", "presente"] as const)[i % 8];
  const horarioEntrada = presenca === "presente" ? `07:${30 + (i % 15)}` : presenca === "atrasado" ? `08:${10 + (i % 20)}` : presenca === "saiu" ? "07:35" : undefined;
  return {
    id,
    nome,
    matricula: `2025${String(1000 + i).padStart(4, "0")}`,
    dataNascimento: `${2010 + (i % 6)}-0${1 + (i % 9)}-1${i % 9}`,
    escolaId,
    turma,
    turno: (["Manhã", "Tarde", "Integral"] as const)[i % 3],
    foto: avatarUrl(nome),
    ativo: true,
    responsaveisIds: [respPorAluno[i]],
    responsavelPrincipalId: respPorAluno[i],
    biometriaAtiva: i % 5 !== 4,
    presencaHoje: presenca,
    horarioEntrada,
    horarioSaida: presenca === "saiu" ? "11:50" : undefined,
  };
});

export const cameras: Camera[] = [
  { id: "c1", nome: "Portão Principal", escolaId: "esc-1", localizacao: "Entrada principal - Rua das Acácias", tipo: "RTSP", url: "rtsp://192.168.1.10:554/stream", resolucao: "1080p", fps: 30, status: "Ativa" },
  { id: "c2", nome: "Portão Secundário", escolaId: "esc-1", localizacao: "Saída lateral - Pátio interno", tipo: "IP", url: "http://192.168.1.11", resolucao: "720p", fps: 25, status: "Ativa" },
  { id: "c3", nome: "Entrada São Francisco", escolaId: "esc-2", localizacao: "Av. Brasil - Portaria", tipo: "RTSP", url: "rtsp://192.168.2.20:554/stream", resolucao: "1080p", fps: 30, status: "Ativa" },
  { id: "c4", nome: "Portão Rui Barbosa", escolaId: "esc-3", localizacao: "Entrada principal", tipo: "RTSP", url: "rtsp://192.168.3.30:554/stream", resolucao: "4K", fps: 30, status: "Manutenção" },
];

export const eventosHoje: EventoCamera[] = alunos
  .filter((a) => a.horarioEntrada)
  .map((a, i) => ({
    id: `e${i}`,
    alunoId: a.id,
    cameraId: cameras.find((c) => c.escolaId === a.escolaId)?.id || "c1",
    horario: a.horarioEntrada!,
    tipo: a.presencaHoje === "saiu" ? "Saiu" : "Entrou",
    reconhecido: a.biometriaAtiva,
  }))
  .sort((a, b) => b.horario.localeCompare(a.horario));

export const notificacoes: Notificacao[] = eventosHoje.slice(0, 12).map((e, i) => {
  const aluno = alunos.find((a) => a.id === e.alunoId)!;
  return {
    id: `n${i}`,
    tipo: e.tipo === "Entrou" ? "Entrada" : "Saída",
    alunoId: e.alunoId,
    responsavelId: aluno.responsavelPrincipalId,
    canal: i % 2 === 0 ? "WhatsApp" : "PWA Push",
    horario: e.horario,
    status: i === 3 ? "Falhou" : i === 7 ? "Pendente" : "Entregue",
  };
});

export const entradasPorHora = [
  { hora: "06:00", entradas: 0 },
  { hora: "06:30", entradas: 1 },
  { hora: "07:00", entradas: 4 },
  { hora: "07:15", entradas: 7 },
  { hora: "07:30", entradas: 12 },
  { hora: "07:45", entradas: 18 },
  { hora: "08:00", entradas: 14 },
  { hora: "08:15", entradas: 6 },
  { hora: "08:30", entradas: 3 },
  { hora: "09:00", entradas: 1 },
];

export const formatWhatsAppLink = (numero: string, mensagem: string) => {
  const cleaned = numero.replace(/\D/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(mensagem)}`;
};
