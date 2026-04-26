export function formatWhatsAppLink(numero: string, mensagem: string) {
  const cleaned = numero.replace(/\D/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(mensagem)}`;
}
